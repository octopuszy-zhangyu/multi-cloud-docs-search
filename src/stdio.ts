import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAdapter } from "./adapters/index.js";
import type { PaginatedResult, Product, TocItem } from "./adapters/base.js";

/** 关键词过滤函数（AND 逻辑，多个空格分隔的关键词必须全部匹配） */
function filterByKeywords<T extends { name?: string; title?: string }>(
  items: T[],
  keywords: string[]
): T[] {
  if (keywords.length === 0) return items;
  return items.filter((item) => {
    const text = (item.name || item.title || "").toLowerCase();
    return keywords.every((kw) => text.includes(kw.toLowerCase()));
  });
}

/** 统一格式化分页结果 */
function formatPaginatedResult<T>(
  result: T[] | PaginatedResult<T>,
  defaultPageSize: number = 100
): { text: string; total: number; page: number; pageSize: number; hasMore: boolean } {
  if ("items" in result) {
    return {
      text: JSON.stringify(result.items, null, 2),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      hasMore: result.hasMore,
    };
  }
  const items = result as T[];
  return {
    text: JSON.stringify(items, null, 2),
    total: items.length,
    page: 1,
    pageSize: defaultPageSize,
    hasMore: false,
  };
}

const server = new McpServer(
  {
    name: "multi-cloud-docs-search",
    version: "1.0.0",
  },
  {
    instructions: `云厂商文档搜索 MCP Server。

## 核心原则（重要）

1. **优先浏览目录，迫不得已再搜索**：先调用 get_document_toc 查看文档目录结构，定位到相关章节后，再决定是否调用 search_documents。search_documents 的关键词不宜太具体（如"价格 4C8G"会返回空），应使用宽泛关键词（如"计费""价格""规格"）。
2. **严格遵循 metadata → content 顺序**：必须先调用 get_page_metadata 获取 contentPath，再将 contentPath 传给 get_page_content。不能跳过 metadata 直接构造 URL。
3. **并行 Agent 模式（重要）**：当需要查询多个云厂商时，必须为每个云厂商分别启动一个独立的 Agent 并行执行，而不是串行逐个查询。每个 Agent 负责一个云厂商的完整查询流程（list_products → get_document_toc → get_page_metadata → get_page_content），最后汇总所有 Agent 的结果。
4. **list_products 结果可能过大**：阿里云等厂商的产品列表可能超过 token 限制，需分块读取或 grep 过滤。

## 工作模式

### 多厂商并行查询（推荐）
当用户需要对比多个云厂商的产品/价格时，使用以下模式：

1. **启动并行 Agent**：为每个需要查询的云厂商分别启动一个 Agent（使用 Agent 工具，设置 subagent_type="claude"）
2. **每个 Agent 独立执行完整流程**：每个 Agent 负责一个云厂商的完整查询链路
3. **汇总结果**：等待所有 Agent 完成后，汇总各厂商的结果进行对比分析

示例：用户问"对比阿里云和腾讯云的 ECS 价格"
- Agent 1：查询阿里云 ECS 价格（list_products → get_document_toc → 定位定价页面 → get_page_metadata → get_page_content）
- Agent 2：查询腾讯云 CVM 价格（list_products → get_document_toc → 定位定价页面 → get_page_metadata → get_page_content）
- 汇总两个 Agent 的结果进行对比

### 需要规划时使用 Plan 模式
当任务涉及以下场景时，先调用 EnterPlanMode 进入规划模式：
- 需要多步骤执行的复杂查询
- 需要对比多个厂商的跨厂商分析
- 需要分阶段执行的大型任务
- 需要用户确认执行路径的场景

在 Plan 模式下制定清晰的执行计划，获得用户确认后再执行。

### 需要任务列表时使用 Task/Todos
当任务需要拆分为多个可追踪的子任务时，使用 TaskCreate 创建任务列表：
- 每个子任务创建一个 Task（如"查询阿里云价格"、"查询腾讯云价格"）
- 任务完成后调用 TaskUpdate 更新状态
- 使用 TaskList 查看当前进度

## 工作流程

### 标准流程（推荐）
1. 获取产品列表：调用 list_products({ provider: "xxx" })（可并行查询多个厂商）
2. 匹配产品：从返回结果中找到用户询问的产品，获取 productId
3. 获取文档目录：调用 get_document_toc({ provider: "xxx", productId: "xxx" }) 浏览目录结构
4. 定位章节：从目录中找到相关章节的 pageId（如"计费说明""价格""规格"等）
5. 获取页面元信息：调用 get_page_metadata({ provider: "xxx", pageId: "xxx" }) 获取 contentPath
6. 获取文档正文：调用 get_page_content({ provider: "xxx", contentPath: "xxx" })
7. 总结回答：基于文档内容回答用户问题

### 搜索流程（当目录无法定位或用户询问具体功能时）
1. 获取产品列表：调用 list_products 获取产品 productId（可并行）
2. 先用宽泛关键词搜索：调用 search_documents，关键词不要太具体（如用"计费"而非"4C8G价格"）
3. 获取页面元信息：调用 get_page_metadata 获取 contentPath
4. 获取文档正文：调用 get_page_content 获取完整 Markdown 内容
5. 总结回答

### 价格查询流程（当用户询问价格时）

**优先从文档目录定位定价页面**（推荐）：
1. 获取产品列表：调用 list_products 获取产品 productId（可并行查询多个厂商）
2. 获取文档目录：调用 get_document_toc 查看目录，寻找"计费说明""价格""定价""计费"等章节
3. 定位定价页面：从目录中找到定价相关章节的 pageId
4. 获取定价页面内容：调用 get_page_metadata → get_page_content 获取定价页面 Markdown 内容
5. 提取价格表：从 Markdown 内容中解析价格表格
6. 总结回答

**搜索回退**（目录中找不到定价章节时）：
1. 调用 search_documents({ provider: "xxx", productId: "xxx", keyword: "计费" }) 搜索定价相关页面（用宽泛关键词）
2. 获取搜索结果中的 pageId，调用 get_page_metadata → get_page_content
3. 提取价格信息

**get_product_price 回退**（文档中找不到价格时）：
1. 调用 get_product_price({ provider: "xxx" }) 获取价格数据
2. 如果返回空，尝试带 productId 调用：get_product_price({ provider: "xxx", productId: "xxx" })

## 各厂商特殊说明

- **联通云 cucloud**：文档详情页为 Vue SPA 有反爬保护，get_page_content 返回搜索 API 摘要而非完整页面，价格信息需从搜索摘要中提取
- **移动云 ecloud**：contentPath 是 hash 字符串（如 60daff9598d5c8fe58d847009f94c256）而非 URL，直接传给 get_page_content 即可
- **华为云 CloudPond 云桌面**：文档只有规格清单（企业办公型-4U8GB 等），具体价格需联系销售，get_product_price 返回空
- **腾讯云云桌面**：文档未公开具体价格，需官网价格计算器
- **天翼云云电脑价格**：get_product_price({ provider: "ctyun", productId: "10027004" }) 可获取完整价格表

## 腾讯云大模型 Token 价格速查

当用户询问腾讯云大模型 Token 价格时，直接使用以下已知的文档页面获取价格信息（无需搜索目录）：

| 价格类型 | 文档 URL | 说明 |
|---------|---------|------|
| 模型价格（按需） | https://cloud.tencent.com/document/product/1823/130055 | 各模型按量计费单价 |
| Token Plan 企业版专业套餐 | https://cloud.tencent.com/document/product/1823/130659 | 企业版专业套餐价格 |
| Token Plan 企业版轻享套餐 | https://cloud.tencent.com/document/product/1823/131173 | 企业版轻享套餐价格 |
| Token Plan 个人版 | https://cloud.tencent.com/document/product/1823/130060 | 个人版套餐价格 |

获取方式：直接调用 get_page_metadata({ provider: "tencent", pageId: "1823/130055" }) → get_page_content 即可获取完整价格表。所有 Token 价格页面可并行获取。

## 火山引擎大模型 Token 价格速查

当用户询问火山引擎（火山方舟/豆包）大模型 Token 价格时，直接使用以下页面：

| 价格类型 | 文档 URL | 说明 |
|---------|---------|------|
| 模型价格（按需） | https://www.volcengine.com/docs/82379/1544106 | 各模型按量计费单价（含 doubao、DeepSeek 等） |
| 定价详情页 | https://www.volcengine.com/pricing?product=ark_bd&tab=1 | 价格计算器（含资源包） |

获取方式：调用 get_page_metadata({ provider: "volcengine", pageId: "82379/1544106" }) → get_page_content 获取模型价格表。火山方舟的 Agent Plan / Coding Plan（套餐概览）页面为 pageId: "82379/2366394"，可通过 get_page_metadata → get_page_content 获取套餐详情（含 Small/Medium/Large/Max 四档套餐价格）。

## 华为云大模型 Token 价格速查

当用户询问华为云 MaaS（模型即服务）Token 价格时，直接使用以下方式：

| 价格类型 | 获取方式 | 说明 |
|---------|---------|------|
| 模型价格（按需） | get_product_price({ provider: "huawei", productId: "maas" }) | 返回所有模型的输入/输出 Token 单价 |
| Token Plan（套餐） | https://support.huaweicloud.com/price-maas/price-maas-0002.html | 套餐包价格详情 |

获取方式：按需价格直接调用 get_product_price 获取；套餐价格通过 get_page_metadata({ provider: "huawei", pageId: "maas/price-maas/price-maas-0002" }) → get_page_content 获取套餐详情页面。

## 移动云大模型 Token 价格速查

当用户询问移动云 MoMA（模型服务平台）Token 价格时，直接使用以下页面：

| 价格类型 | 文档 URL | 说明 |
|---------|---------|------|
| 预置模型服务-token按量计费 | https://ecloud.10086.cn/op-help-center/doc/article/91592 | 预置模型 Token 按量价格 |
| 预置模型服务-一次性资源包 | https://ecloud.10086.cn/op-help-center/doc/article/95323 | 预置模型资源包价格 |
| 合作模型服务-token按量计费 | https://ecloud.10086.cn/op-help-center/doc/article/99427 | 合作模型 Token 按量价格 |
| Coding Plan个人版价格 | https://ecloud.10086.cn/op-help-center/doc/article/98320 | Coding Plan 套餐价格 |

获取方式：直接调用 get_page_metadata({ provider: "ecloud", pageId: "91592" }) → get_page_content 获取 Token 价格表。所有 Token 价格页面可并行获取。

## 百度云千帆大模型 Token 价格速查

当用户询问百度云千帆大模型 Token 价格时，直接使用以下页面：

| 价格类型 | 文档 URL | 说明 |
|---------|---------|------|
| Token 计费说明 | https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya | 千帆大模型 Token 按量计费价格 |
| Token 福利包 | https://cloud.baidu.com/doc/qianfan/s/Smoghsq3g | Token 福利包套餐价格 |

获取方式：直接调用 get_page_metadata({ provider: "baidu", pageId: "qianfan/s/wmh4sv6ya" }) → get_page_content 获取 Token 价格表。所有 Token 价格页面可并行获取。

## 智谱 GLM 大模型 Token 价格速查

当用户询问智谱 GLM Token 价格时，直接使用以下方式：

| 价格类型 | 获取方式 | 说明 |
|---------|---------|------|
| 模型按量价格 | https://bigmodel.cn/pricing | 各模型按量计费单价（含 GLM-4 系列、GLM-4V 等） |
| GLM Coding Plan | https://bigmodel.cn/glm-coding | Coding Plan 套餐（Lite/Pro/Max）价格 |

获取方式：按量价格通过 get_page_metadata({ provider: "glm", pageId: "/cn/guide/start/quick-start" }) → get_page_content 获取文档中的价格信息。Coding Plan 套餐详情通过 get_page_metadata({ provider: "glm", pageId: "/cn/coding-plan/overview" }) → get_page_content 获取。

## 当前支持的云厂商

- ctyun - 天翼云
- aliyun - 阿里云
- volcengine - 火山引擎
- tencent - 腾讯云
- huawei - 华为云
- ecloud - 移动云
- cucloud - 联通云
- bailian - 阿里云百炼
- baidu - 百度云
- deepseek - DeepSeek
- glm - 智谱 GLM
- minimax - MiniMax
- kimi - 月之暗面 Kimi`,
  }
);

server.registerTool(
  "list_products",
  {
    description: "获取指定云厂商的产品文档列表，返回产品名称和对应的 productId。支持关键词过滤（多个空格分隔的关键词用 AND 逻辑）和分页",
    inputSchema: z.object({
      provider: z.string().describe("云厂商标识，如 'ctyun'"),
      keyword: z.string().optional().describe("精简关键词过滤（支持多个空格分隔，如 'ecs cvm'），多个关键词用 AND 逻辑（必须全部匹配）"),
      page: z.number().optional().describe("页码，默认 1"),
      pageSize: z.number().optional().describe("每页条数，默认 100，最大 500"),
    }).strict(),
  },
  async ({ provider, keyword, page, pageSize }: { provider: string; keyword?: string; page?: number; pageSize?: number }) => {
    const adapter = getAdapter(provider);
    const keywords = keyword ? keyword.trim().split(/\s+/).filter(Boolean) : [];
    const result = await adapter.listProducts({ keyword, page, pageSize });

    let items: Product[];
    let total: number;
    let currentPage: number;
    let currentPageSize: number;
    let hasMore: boolean;

    if ("items" in result) {
      items = result.items;
      total = result.total;
      currentPage = result.page;
      currentPageSize = result.pageSize;
      hasMore = result.hasMore;
    } else {
      items = result as Product[];
      total = items.length;
      currentPage = 1;
      currentPageSize = pageSize || 100;
      hasMore = false;
    }

    if (keywords.length > 0) {
      const filtered = filterByKeywords(items, keywords);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            items: filtered,
            total: total,
            page: currentPage,
            pageSize: currentPageSize,
            hasMore: hasMore,
            message: filtered.length === 0
              ? `未找到匹配 "${keyword}" 的产品，请尝试更宽泛的关键词`
              : `共 ${total} 个产品，已过滤出 ${filtered.length} 个匹配 "${keyword}" 的产品`,
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          items,
          total,
          page: currentPage,
          pageSize: currentPageSize,
          hasMore,
        }, null, 2),
      }],
    };
  }
);

server.registerTool(
  "get_document_toc",
  {
    description: "获取指定产品的文档目录树。参数 productId 来自 list_products 返回的 productId。支持关键词过滤、分页和顶层目录模式",
    inputSchema: z.object({
      provider: z.string().describe("云厂商标识"),
      productId: z.string().describe("产品文档 ID"),
      keyword: z.string().optional().describe("精简关键词过滤（支持多个空格分隔，如 '价格 计费'），多个关键词用 AND 逻辑"),
      page: z.number().optional().describe("页码，默认 1"),
      pageSize: z.number().optional().describe("每页条数，默认 200，最大 500"),
      topOnly: z.boolean().optional().describe("是否只返回顶层目录，默认 false"),
    }).strict(),
  },
  async ({ provider, productId, keyword, page, pageSize, topOnly }: { provider: string; productId: string; keyword?: string; page?: number; pageSize?: number; topOnly?: boolean }) => {
    const adapter = getAdapter(provider);
    const keywords = keyword ? keyword.trim().split(/\s+/).filter(Boolean) : [];
    const result = await adapter.getDocumentToc(productId, { keyword, page, pageSize, topOnly });

    let items: TocItem[];
    let total: number;
    let currentPage: number;
    let currentPageSize: number;
    let hasMore: boolean;

    if ("items" in result) {
      items = result.items;
      total = result.total;
      currentPage = result.page;
      currentPageSize = result.pageSize;
      hasMore = result.hasMore;
    } else {
      items = result as TocItem[];
      total = items.length;
      currentPage = 1;
      currentPageSize = pageSize || 200;
      hasMore = false;
    }

    if (topOnly) {
      items = items.map(item => ({ pageId: item.pageId, title: item.title }));
    }

    if (keywords.length > 0) {
      const filtered = filterByKeywords(items, keywords);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            items: filtered,
            total: total,
            page: currentPage,
            pageSize: currentPageSize,
            hasMore: hasMore,
            message: filtered.length === 0
              ? `未找到匹配 "${keyword}" 的页面，请尝试更宽泛的关键词`
              : `共 ${total} 个页面，已过滤出 ${filtered.length} 个匹配 "${keyword}" 的页面`,
          }, null, 2),
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          items,
          total,
          page: currentPage,
          pageSize: currentPageSize,
          hasMore,
        }, null, 2),
      }],
    };
  }
);

server.registerTool(
  "search_documents",
  {
    description: "在指定云厂商的产品文档中按关键词搜索，返回匹配的页面列表。关键词支持多个空格分隔（AND 逻辑），建议使用精简关键词",
    inputSchema: z.object({
      provider: z.string().describe("云厂商标识"),
      productId: z.string().describe("产品文档 ID"),
      keyword: z.string().describe("搜索关键词（支持多个空格分隔，如 '价格 计费'），多个关键词用 AND 逻辑"),
      query: z.string().optional().describe("搜索关键词（keyword 的别名，两者传一个即可）"),
    }).strict(),
  },
  async ({ provider, productId, keyword, query }: { provider: string; productId: string; keyword?: string; query?: string }) => {
    const adapter = getAdapter(provider);
    const searchKeyword = keyword || query || "";
    if (!searchKeyword) {
      return { content: [{ type: "text", text: "请提供搜索关键词（keyword 或 query 参数）" }] };
    }

    const keywords = searchKeyword.trim().split(/\s+/).filter(Boolean);
    const results = await adapter.searchDocuments(productId, searchKeyword);

    let filteredResults = results;
    if (keywords.length > 1) {
      filteredResults = results.filter(item => {
        const text = (item.title + " " + (item.description || "")).toLowerCase();
        return keywords.every(kw => text.includes(kw.toLowerCase()));
      });
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          items: filteredResults,
          total: filteredResults.length,
          message: filteredResults.length === 0
            ? `未找到同时匹配 "${searchKeyword}" 的页面`
            : `找到 ${filteredResults.length} 个匹配的页面`,
        }, null, 2),
      }],
    };
  }
);

server.registerTool(
  "get_page_metadata",
  {
    description: "获取文档页面的元信息，包括标题和 contentPath。参数 pageId 来自 get_document_toc 或 search_documents",
    inputSchema: z.object({
      provider: z.string().describe("云厂商标识"),
      pageId: z.string().describe("文档页面 ID"),
    }).strict(),
  },
  async ({ provider, pageId }: { provider: string; pageId: string }) => {
    const adapter = getAdapter(provider);
    const metadata = await adapter.getPageMetadata(pageId);
    return { content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }] };
  }
);

server.registerTool(
  "get_product_price",
  {
    description: "获取指定云厂商的产品价格信息。不传 productId 则返回所有产品价格概览",
    inputSchema: z.object({
      provider: z.string().describe("云厂商标识"),
      productId: z.string().optional().describe("产品 ID（可选，不传则返回所有产品价格概览）"),
    }).strict(),
  },
  async ({ provider, productId }: { provider: string; productId?: string }) => {
    const adapter = getAdapter(provider);
    const result = await adapter.getProductPrice(productId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.registerTool(
  "get_page_content",
  {
    description: "获取文档页面的完整 Markdown 正文。参数 contentPath 来自 get_page_metadata 返回的 contentPath",
    inputSchema: z.object({
      provider: z.string().describe("云厂商标识"),
      contentPath: z.string().describe("文档正文 URL"),
    }).strict(),
  },
  async ({ provider, contentPath }: { provider: string; contentPath: string }) => {
    const adapter = getAdapter(provider);
    const content = await adapter.getPageContent(contentPath);
    return { content: [{ type: "text", text: content }] };
  }
);

export async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
