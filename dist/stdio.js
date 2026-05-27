import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAdapter } from "./adapters/index.js";
const server = new McpServer({
    name: "multi-cloud-docs-search",
    version: "1.0.0",
}, {
    instructions: `云厂商文档搜索 MCP Server。

## 核心原则（重要）

1. **优先浏览目录，迫不得已再搜索**：先调用 get_document_toc 查看文档目录结构，定位到相关章节后，再决定是否调用 search_documents。search_documents 的关键词不宜太具体（如"价格 4C8G"会返回空），应使用宽泛关键词（如"计费""价格""规格"）。
2. **严格遵循 metadata → content 顺序**：必须先调用 get_page_metadata 获取 contentPath，再将 contentPath 传给 get_page_content。不能跳过 metadata 直接构造 URL。
3. **最大化并行调用效率**：无依赖关系的调用应并行执行。例如：同时查询多个厂商的 list_products、同时获取多个页面的 get_page_metadata、同时获取多个页面的 get_page_content。
4. **list_products 结果可能过大**：阿里云等厂商的产品列表可能超过 token 限制，需分块读取或 grep 过滤。

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
});
server.registerTool("list_products", {
    description: "获取指定云厂商的所有产品文档列表，返回产品名称和对应的 productId",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识，如 'ctyun'"),
    }).strict(),
}, async ({ provider }) => {
    const adapter = getAdapter(provider);
    const products = await adapter.listProducts();
    return { content: [{ type: "text", text: JSON.stringify(products) }] };
});
server.registerTool("get_document_toc", {
    description: "获取指定产品的文档目录树。参数 productId 来自 list_products 返回的 productId",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        productId: z.string().describe("产品文档 ID"),
    }).strict(),
}, async ({ provider, productId }) => {
    const adapter = getAdapter(provider);
    const items = await adapter.getDocumentToc(productId);
    return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
});
server.registerTool("search_documents", {
    description: "在指定云厂商的产品文档中按关键词搜索，返回匹配的页面列表",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        productId: z.string().describe("产品文档 ID"),
        keyword: z.string().describe("搜索关键词"),
    }).strict(),
}, async ({ provider, productId, keyword }) => {
    const adapter = getAdapter(provider);
    const results = await adapter.searchDocuments(productId, keyword);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
});
server.registerTool("get_page_metadata", {
    description: "获取文档页面的元信息，包括标题和 contentPath。参数 pageId 来自 get_document_toc 或 search_documents",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        pageId: z.string().describe("文档页面 ID"),
    }).strict(),
}, async ({ provider, pageId }) => {
    const adapter = getAdapter(provider);
    const metadata = await adapter.getPageMetadata(pageId);
    return { content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }] };
});
server.registerTool("get_product_price", {
    description: "获取指定云厂商的产品价格信息。不传 productId 则返回所有产品价格概览",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        productId: z.string().optional().describe("产品 ID（可选，不传则返回所有产品价格概览）"),
    }).strict(),
}, async ({ provider, productId }) => {
    const adapter = getAdapter(provider);
    const result = await adapter.getProductPrice(productId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});
server.registerTool("get_page_content", {
    description: "获取文档页面的完整 Markdown 正文。参数 contentPath 来自 get_page_metadata 返回的 contentPath",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        contentPath: z.string().describe("文档正文 URL"),
    }).strict(),
}, async ({ provider, contentPath }) => {
    const adapter = getAdapter(provider);
    const content = await adapter.getPageContent(contentPath);
    return { content: [{ type: "text", text: content }] };
});
export async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch(console.error);
