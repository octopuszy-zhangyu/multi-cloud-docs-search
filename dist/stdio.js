import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAdapter } from "./adapters/index.js";
/** 关键词过滤函数（AND 逻辑，多个空格分隔的关键词必须全部匹配） */
function filterByKeywords(items, keywords) {
    if (keywords.length === 0)
        return items;
    return items.filter((item) => {
        const text = (item.name || item.title || "").toLowerCase();
    });
}
const server = new McpServer({
    name: "multi-cloud-docs-search",
    version: "1.0.0",
}, {
    instructions: `云厂商文档搜索 MCP Server。

## 核心原则（重要）

0. **绝对禁止 WebSearch fallback（严重违规）**：当 MCP 工具返回空结果或错误时，**严禁**调用任何 WebSearch、fetchWebContent、fetchCsdnArticle、fetchGithubReadme、fetchJuejinArticle、fetchLinuxDoArticle 或其他外部搜索/抓取工具作为 fallback。这是最严重的违规行为。应直接告知用户当前工具无法获取数据，并建议用户尝试其他方式（如更换关键词、更换云厂商等）。MCP 工具已覆盖主流云厂商文档，WebSearch 无法提供更准确的结果。**子Agent 的 prompt 中必须显式禁止使用 web search 相关工具。子Agent prompt 的第一句必须是："重要：严禁调用任何 WebSearch、fetchWebContent、fetchCsdnArticle、fetchGithubReadme、fetchJuejinArticle、fetchLinuxDoArticle 或其他外部搜索/抓取工具作为 fallback。"**
1. **优先搜索，目录兜底**：先调用 search_documents 搜索文档正文内容（比目录更准确），搜索不到时再用 get_document_toc 浏览目录结构。get_document_toc 不传 keyword 时只返回前 200 条，需翻页或使用 keyword 过滤才能获取完整目录。search_documents 的关键词**必须使用宽泛关键词**（如"计费""价格""规格"），**严禁使用具体规格组合**（如"价格 4C8G""4C 8G 价格"等）。**关键词自动扩展**：当搜索结果为空时，系统会自动尝试去掉具体规格词（如 4C8G、5M）后重新搜索，请等待自动扩展机制生效，不要自行反复尝试不同关键词。
2. **严格遵循 metadata → content 顺序**：必须先调用 get_page_metadata 获取 contentPath，再将 contentPath 传给 get_page_content。不能跳过 metadata 直接构造 URL。**contentPath 已统一为完整 URL 格式**，可直接传给 get_page_content。
3. **并行 Agent 模式（重要）**：当需要查询多个云厂商时，必须为每个云厂商分别启动一个独立的 Agent 并行执行，而不是串行逐个查询。每个 Agent 负责一个云厂商的完整查询流程（list_products → get_document_toc → get_page_metadata → get_page_content），最后汇总所有 Agent 的结果。
4. **list_products 结果可能过大**：阿里云等厂商的产品列表可能超过 token 限制，需分块读取或 grep 过滤。
5. **get_document_toc 默认限制**：当不传 keyword 参数时，get_document_toc 默认只返回前 200 个页面（不是 50）。如需查看更多页面，请使用 keyword 参数过滤或调整 page/pageSize 参数。

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

### 子Agent 输出规范（严格）
当启动子Agent 执行查询时，子Agent 必须遵守以下输出规范：

1. **只返回结构化 JSON 数据**：最终输出必须为纯 JSON 格式，包含查询结果和关键信息
2. **禁止输出任何中间思考过程**：严禁输出"让我整理一下"、"现在我有了足够的信息"、"让我看看"、"好的"、"首先"等中间思考过程文字。子Agent 的最终输出必须是一个纯 JSON 对象，不包含任何前缀、后缀、解释性文字
3. **禁止重复数据**：同一个数据表格只输出一次
4. **输出格式**：返回 JSON 格式数据，包含 provider、product、priceInfo、source、note 等字段
5. **工具调用次数限制（硬性限制）**：每个子Agent 的工具调用次数**必须控制在 12 次以内**。如果超过 12 次仍未获取到数据，必须立即停止并返回 JSON 格式的失败报告（包含 provider、product、error、reason 字段）。**超过 12 次调用仍未停止视为违规。**
6. **提前终止策略（关键优化）**：如果连续 2 次工具调用都返回空结果或错误，立即判断该路径不可行并切换策略或停止，而不是继续尝试。
7. **"文档不列价格"模式识别（重要）**：当搜索价格相关页面时，如果连续 2 次返回"需通过价格计算器实时查询"、"文档中不包含具体价格"、"请访问官网价格计算器"等类似提示，应立即停止搜索该厂商的价格，**直接调用 get_product_price 或 get_product_price(quick=true) 获取价格数据**。**严禁反复尝试不同关键词确认同一结论**。

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

**价格查询首选：get_product_price(quick=true)（重要）**
- 对于已知产品 ID 的场景（如 ECS/CVM/云电脑），**必须优先使用 get_product_price(quick=true)**
- get_product_price(quick=true) 直接返回定价页面 URL 和价格信息，绕过完整的目录浏览流程
- 使用 get_product_price(quick=true) 可以将工具调用次数从 20+ 次减少到 2-3 次

**价格查询三步法（重要）**：
1. **第一步：get_product_price(quick=true)** — 直接调用 get_product_price(quick=true)({ provider: "xxx", productId: "xxx" }) 获取定价页面 URL
2. **第二步：get_page_content** — 使用返回的 URL 调用 get_page_metadata → get_page_content 获取价格信息
3. **第三步：get_product_price 回退** — 如果 get_product_price(quick=true) 没有返回数据，调用 get_product_price

**禁止行为**：
- **严禁先遍历 list_products** — 价格查询不需要获取完整产品列表
- **严禁先遍历 get_document_toc** — 直接使用 get_product_price(quick=true) 即可

**不需要先 list_products 获取所有产品**：搜索价格时不需要遍历目录树，直接使用 get_product_price(quick=true) 或 search_documents 搜索定价关键词即可。

**价格数据注意事项**：
- **dataStatus 字段说明**：get_product_price 返回结果中的 dataStatus 字段标记数据完整性：complete=有完整价格数据, partial=部分数据, no_price=文档无价格（需访问外部定价页）, no_data=无数据。子Agent 应根据 dataStatus 决定下一步操作，dataStatus 为 no_price 或 no_data 时立即停止搜索并返回结果。
- **关键词自动扩展**：get_product_price 和 search_documents 均支持关键词自动扩展。如 "4C8G" 会自动匹配各厂商的规格命名（如腾讯云 S6.LARGE8、火山引擎 g3al.2xlarge、华为云 m9.2xlarge.8 等）。无需手动尝试不同关键词。
- **分页参数**：get_product_price 支持 page/pageSize 和 offset/limit 两种分页方式。当返回数据量过大时，可使用 offset/limit 精确控制返回条数。
- 阿里云、腾讯云、华为云的文档中通常只有折扣框架，不含精确基准价格（价格在独立价格计算器页面）。**遇到此类提示时，应直接调用 get_product_price 或 get_product_price(quick=true) 获取价格数据，而非继续搜索文档**。
- 天翼云、火山引擎的文档中包含价格表，可直接通过 search_documents + get_page_content 获取
- AI 厂商（DeepSeek、MiniMax、Kimi、百炼）定价可通过 get_product_price 获取
- 华为云等动态渲染的价格页面，WebFetch 无法抓取，应直接调用 get_product_price 获取价格数据
- **价格数据来源已标注**：华为云的价格数据会标注来源（官网价格计算器或文档），便于区分标准定价和参考价
- **火山引擎 ECS 价格**：文档明确说明"价格信息需要通过价格计算器查看"，文档中不直接显示价格，无需遍历目录寻找价格表，直接调用 get_product_price 获取
- **百度云 BCC 价格**：文档引用外部定价页面（cloud.baidu.com/publicity/bccplus.html），文档内无具体价格数字，直接调用 get_product_price(quick=true) 获取 URL
- **联通云 ECS 价格**：文档只有按日单价（vCPU ¥55.89/核/日, 内存 ¥11.50/GB/日），没有包月/包年价格，直接调用 get_product_price 获取
- **天翼云价格页面**：部分定价页面为 JavaScript 动态渲染，get_page_content 可能无法获取完整价格数据。建议使用 get_product_price 获取结构化价格数据，或访问天翼云官网价格计算器。

**已知数据缺失的厂商（无需遍历目录，直接返回提示）**：
- **华为云 ECS**：定价数据位于外部页面 huaweicloud.com/pricing，文档系统中无具体价格。调用 get_product_price(quick=true) 获取价格计算器 URL 后即可返回，无需遍历目录或搜索文档。如果 get_product_price 返回空，直接告知用户使用官网价格计算器。**遇到"请使用价格计算器"提示时，应调用 get_product_price 获取价格数据**。
- **阿里云 ECS**：文档中只有计费模式说明，无具体实例价格。调用 get_product_price(quick=true) 获取计费说明 URL 后即可返回。如需具体价格，告知用户访问 aliyun.com/price。**遇到"请使用价格计算器"提示时，应调用 get_product_price 获取价格数据**。
- **百度云 BCC**：定价页面在外部（cloud.baidu.com/publicity/bccplus.html），文档中无具体价格。调用 get_product_price(quick=true) 获取 URL 后即可返回。**遇到"请使用价格计算器"提示时，应调用 get_product_price 获取价格数据**。
- **联通云 ECS**：定价页面返回 404，只能从搜索摘要中提取按日单价。调用 get_product_price(quick=true) 后直接搜索"价格"关键词获取摘要即可，无需遍历目录。**遇到"请使用价格计算器"提示时，应调用 get_product_price 获取价格数据**。

**ECS/CVM 4C8G 价格查询速查（必须按此顺序）**：

| 厂商 | 首选方式 | 备选方式 | 说明 | 预期调用次数 | dataStatus |
|------|---------|---------|------|------------|-----------|
| 天翼云 | get_product_price(provider="ctyun", productId="10027004") | get_product_price(quick=true) | 文档含价格表 | 2-3 次 | complete |
| 火山引擎 | get_product_price(provider="volcengine", productId="ECS") | get_product_price(quick=true) | GetTable API 返回完整定价表格 | 2-3 次 | complete |
| 腾讯云 | **get_product_price(provider="tencent", productId="cvm")** | get_product_price(quick=true) | workbench API 返回全量 CVM 实例价格 | 2-3 次 | complete |
| 阿里云 | get_product_price(quick=true)(provider="aliyun", productId="ecs") | get_product_price | 文档无价格表，需访问官网定价页。**无需遍历目录** | 1-2 次 | no_price |
| 华为云 | get_product_price(provider="huawei", productId="ecs") | get_product_price(quick=true) | 价格计算器 API 返回标准定价。**如果返回空，直接告知用户使用官网价格计算器** | 2-3 次 | complete/no_price |
| 移动云 | get_product_price(provider="ecloud", productId="706") | search_documents | 文档含价格信息 | 3-5 次 | complete |
| 联通云 | get_product_price(quick=true)(provider="cucloud", productId="128") | search_documents | 文档含按日单价。**定价页面 404，从搜索摘要提取** | 3-5 次 | partial |
| 百度云 | get_product_price(quick=true)(provider="baidu", productId="bcc") | search_documents | 文档引用外部定价页。**无需遍历目录** | 1-2 次 | no_price |

**必须使用 get_product_price 获取价格的厂商**：腾讯云、天翼云、火山引擎、华为云、阿里云（通过 get_product_price(quick=true) 获取 URL 后访问）。

**禁止行为**：不要对已覆盖的厂商额外搜索文档目录，直接使用 get_product_price 或 get_product_price(quick=true)。

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
});
server.registerTool("list_products", {
    description: "获取指定云厂商的产品文档列表，返回产品名称和对应的 productId。**优先使用 keyword 参数搜索**（如 '云电脑'、'ECS'、'CVM'），支持别名匹配（如 '云服务器' 可匹配 'ECS'、'CVM'）。keyword 为空时返回全量列表（可能很大，需翻页获取全部）。支持分页（page/pageSize）。支持的 provider：ctyun(天翼云), aliyun(阿里云), volcengine(火山引擎), tencent(腾讯云), huawei(华为云), ecloud(移动云), cucloud(联通云), bailian(阿里云百炼), baidu(百度云), deepseek(DeepSeek), glm(智谱GLM), minimax(MiniMax), kimi(月之暗面Kimi)。别名：tencentcloud→tencent, huaweicloud→huawei, alibaba→aliyun, cmcc→ecloud, chinaunicom→cucloud",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识，如 'ctyun'"),
        keyword: z.string().optional().describe("**优先使用此参数**，按产品名称关键词过滤（支持多个空格分隔，如 '云电脑'、'ecs'、'云服务器'），多个关键词用 AND 逻辑。支持别名匹配。不传此参数返回全量列表（需翻页获取全部）"),
        page: z.number().optional().describe("页码，默认 1"),
        pageSize: z.number().optional().describe("每页条数，默认 100，最大 500"),
    }).strict(),
}, async ({ provider, keyword, page, pageSize }) => {
    try {
        const adapter = getAdapter(provider);
        const keywords = keyword ? keyword.trim().split(/\s+/).filter(Boolean) : [];
        const result = await adapter.listProducts({ keyword, page, pageSize });
        const items = result.items.map((item) => ({ productId: item.productId, name: item.name }));
        const total = result.total;
        const currentPage = result.page;
        const currentPageSize = result.pageSize;
        const hasMore = result.hasMore;
        if (keywords.length > 0) {
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({
                            items,
                            total,
                            page: currentPage,
                            pageSize: currentPageSize,
                            hasMore,
                            message: items.length === 0
                                ? `未找到匹配 "${keyword}" 的产品，请尝试更宽泛的关键词`
                                : `共 ${total} 个产品，已过滤出 ${items.length} 个匹配 "${keyword}" 的产品。下一步：调用 search_documents(provider="${provider}", productId="<上一步返回的 productId>", keyword="<关键词>") 搜索文档内容`,
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
                        message: hasMore
                            ? `共 ${total} 个产品，已返回第 ${currentPage} 页 ${currentPageSize} 条。如需查看更多产品，请使用 keyword 参数过滤，或传 page=${currentPage + 1} 翻页。下一步：调用 search_documents(provider="${provider}", productId="<productId>", keyword="<关键词>") 搜索文档内容`
                            : `共 ${total} 个产品，已全部返回。下一步：调用 search_documents(provider="${provider}", productId="<productId>", keyword="<关键词>") 搜索文档内容`,
                    }, null, 2),
                }],
        };
    }
    catch (error) {
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        error: true,
                        message: `查询失败: ${error instanceof Error ? error.message : String(error)}`,
                        provider,
                        suggestion: "请稍后重试，或检查网络连接",
                    }, null, 2),
                }],
        };
    }
});
server.registerTool("get_document_toc", {
    description: "**优先使用 search_documents 搜索文档内容**，仅当搜索不到时再用此工具浏览目录结构。返回指定产品的文档目录树。参数 productId 来自 list_products 返回的 productId。支持关键词过滤、分页和顶层目录模式。**注意：不传 keyword 时只返回前 200 条目录，需翻页或使用 keyword 过滤才能获取完整目录。**",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        productId: z.string().describe("产品文档 ID"),
        keyword: z.string().optional().describe("精简关键词过滤（支持多个空格分隔，如 '价格 计费'），多个关键词用 AND 逻辑"),
        page: z.number().optional().describe("页码，默认 1"),
        pageSize: z.number().optional().describe("每页条数，默认 50，最大 500"),
        topOnly: z.boolean().optional().describe("是否只返回顶层目录，默认 false"),
    }).strict(),
}, async ({ provider, productId, keyword, page, pageSize, topOnly }) => {
    try {
        const adapter = getAdapter(provider);
        const keywords = keyword ? keyword.trim().split(/\s+/).filter(Boolean) : [];
        const result = await adapter.getDocumentToc(productId, { keyword, page, pageSize, topOnly });
        const items = result.items;
        const total = result.total;
        const currentPage = result.page;
        const currentPageSize = result.pageSize;
        const hasMore = result.hasMore;
        const topItems = topOnly
            ? items.map(item => ({ pageId: item.pageId, title: item.title }))
            : items;
        if (keywords.length > 0) {
            const filtered = filterByKeywords(topItems, keywords);
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
                                : `共 ${total} 个页面，已过滤出 ${filtered.length} 个匹配 "${keyword}" 的页面。下一步：调用 get_page_metadata(provider="${provider}", pageId="<上一步返回的 pageId>") 获取页面元信息`,
                        }, null, 2),
                    }],
            };
        }
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        items: topItems,
                        total,
                        page: currentPage,
                        pageSize: currentPageSize,
                        hasMore,
                        message: hasMore
                            ? `共 ${total} 个页面，已返回第 ${currentPage} 页 ${currentPageSize} 条。如需查看更多页面，请使用 keyword 参数过滤，或传 page=${currentPage + 1} 翻页。下一步：调用 get_page_metadata(provider="${provider}", pageId="<上一步返回的 pageId>") 获取页面元信息`
                            : `共 ${total} 个页面，已全部返回。下一步：调用 get_page_metadata(provider="${provider}", pageId="<上一步返回的 pageId>") 获取页面元信息`,
                    }, null, 2),
                }],
        };
    }
    catch (error) {
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        error: true,
                        message: `查询失败: ${error instanceof Error ? error.message : String(error)}`,
                        provider,
                        productId,
                        suggestion: "请稍后重试，或检查网络连接",
                    }, null, 2),
                }],
        };
    }
});
server.registerTool("search_documents", {
    description: "**首选搜索方式**，在指定云厂商的产品文档中按关键词搜索正文内容，返回匹配的页面列表。比 get_document_toc 更强大（搜索正文而非仅标题）。关键词支持多个空格分隔（AND 逻辑），建议使用精简关键词。当搜索结果为空时，系统会自动尝试去掉具体规格词（如 4C8G、5M）后重新搜索，并支持规格变体扩展（如 4C8G → 4核/8gb/xlarge/s6 等）。",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        productId: z.string().describe("产品文档 ID"),
        keyword: z.string().describe("搜索关键词（支持多个空格分隔，如 '价格 计费'），多个关键词用 AND 逻辑"),
    }).strict(),
}, async ({ provider, productId, keyword }) => {
    try {
        const adapter = getAdapter(provider);
        if (!keyword) {
            return { content: [{ type: "text", text: "请提供搜索关键词（keyword 参数）" }] };
        }
        const keywords = keyword.trim().split(/\s+/).filter(Boolean);
        const results = await adapter.searchDocuments(productId, keyword);
        let filteredResults = results;
        if (keywords.length > 1) {
            filteredResults = results.filter(item => {
                const text = (item.title + " " + (item.description || "")).toLowerCase();
                return keywords.every(kw => text.includes(kw.toLowerCase()));
            });
        }
        // 关键词自动扩展：当搜索结果为空时，尝试多种扩展策略
        if (filteredResults.length === 0) {
            // 过滤掉看起来像具体规格的词（包含数字+字母组合、纯数字、具体配置描述）
            const specPattern = /^[\d.]+[cCgGmMkKtTbB]*$|^\d+[cC]\d+[gG]$|^\d+Mbps$|^\d+M$|^[\d.]+[gG][hH][zZ]$|^[\d.]+[cC][oO][rR][eE]$/;
            const coreKeywords = keywords.filter(kw => !specPattern.test(kw) && !/^\d+$/.test(kw));
            // 尝试多级自动扩展
            const expansionAttempts = [];
            // 第一级：去掉规格词后的核心词组合
            if (coreKeywords.length > 0 && coreKeywords.length < keywords.length) {
                expansionAttempts.push(coreKeywords.join(" "));
            }
            // 第二级：如果核心词有多个，尝试逐个使用
            if (coreKeywords.length > 1) {
                expansionAttempts.push(coreKeywords[0]);
            }
            else if (coreKeywords.length > 0 && coreKeywords.length === keywords.length) {
                // 所有词都不是规格词但结果为空，尝试只用第一个词
                expansionAttempts.push(coreKeywords[0]);
            }
            // 第三级：实例规格变体扩展（4C8G → 4核/8gb/xlarge/s6等）
            const specVariants = {
                "4c8g": ["4核", "8gb", "4核 8gb", "4c", "8g", "large8", "xlarge", "2xlarge", "s6", "g3", "m9", "s5", "ecs.g7", "c7", "规格", "实例类型", "配置"],
                "2c4g": ["2核", "4gb", "2核 4gb", "2c", "4g", "medium", "small", "s6.small", "c7", "规格", "实例类型", "配置"],
                "8c16g": ["8核", "16gb", "8核 16gb", "8c", "16g", "2xlarge", "4xlarge", "c7", "m9", "规格", "实例类型", "配置"],
                "16c32g": ["16核", "32gb", "16核 32gb", "16c", "32g", "4xlarge", "8xlarge", "规格", "实例类型", "配置"],
            };
            for (const [spec, variants] of Object.entries(specVariants)) {
                if (keyword.toLowerCase().includes(spec)) {
                    for (const variant of variants) {
                        expansionAttempts.push(variant);
                    }
                }
            }
            // 第三级扩展：尝试提取数字核数和内存大小（如 "4C8G" → "4核 8GB"）
            const coreMemMatch = keyword.toLowerCase().match(/(\d+)\s*[cC核]\s*(\d+)\s*[gG]/);
            if (coreMemMatch) {
                const cores = coreMemMatch[1];
                const mem = coreMemMatch[2];
                expansionAttempts.push(`${cores}核`);
                expansionAttempts.push(`${mem}gb`);
                expansionAttempts.push(`${cores}核 ${mem}gb`);
            }
            // 第四级：尝试常用宽泛词
            if (keywords.some(kw => /价|计费|定价|收费|规格|配置|套餐|费用/i.test(kw))) {
                // 已经包含宽泛词，不需要再尝试
            }
            else if (expansionAttempts.length === 0) {
                // 所有词都是规格词，直接尝试常用宽泛词
                const broadKeywords = ["价格", "计费", "规格"];
                for (const broadKw of broadKeywords) {
                    expansionAttempts.push(broadKw);
                }
            }
            for (const attemptKeyword of expansionAttempts) {
                const attemptResults = await adapter.searchDocuments(productId, attemptKeyword);
                if (attemptResults.length > 0) {
                    return {
                        content: [{
                                type: "text",
                                text: JSON.stringify({
                                    items: attemptResults,
                                    total: attemptResults.length,
                                    message: `原始关键词 "${keyword}" 过于具体，已自动扩展为 "${attemptKeyword}"，找到 ${attemptResults.length} 个匹配页面。建议：使用宽泛关键词如"价格"、"计费"、"规格"等`,
                                    autoExpanded: true,
                                    originalKeyword: keyword,
                                    expandedKeyword: attemptKeyword,
                                }, null, 2),
                            }],
                    };
                }
            }
        }
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        items: filteredResults,
                        total: filteredResults.length,
                        message: filteredResults.length === 0
                            ? `未找到同时匹配 "${keyword}" 的页面。建议：使用更宽泛的关键词，如"价格"、"计费"、"规格"、"配置"等，不要使用"4C8G"等具体规格组合`
                            : `找到 ${filteredResults.length} 个匹配的页面。下一步：调用 get_page_metadata(provider="${provider}", pageId="<上一步返回的 pageId>") 获取页面元信息，再调用 get_page_content 获取正文`,
                    }, null, 2),
                }],
        };
    }
    catch (error) {
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        error: true,
                        message: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
                        provider,
                        productId,
                        keyword: keyword,
                        suggestion: "请稍后重试，或尝试使用更宽泛的关键词",
                    }, null, 2),
                }],
        };
    }
});
server.registerTool("get_page_metadata", {
    description: "获取文档页面的元信息，包括标题和 contentPath。参数 pageId 来自 get_document_toc 或 search_documents",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        pageId: z.string().describe("文档页面 ID"),
    }).strict(),
}, async ({ provider, pageId }) => {
    try {
        const adapter = getAdapter(provider);
        const metadata = await adapter.getPageMetadata(pageId);
        // 统一 contentPath 格式：确保返回的 contentPath 是完整可访问的 URL
        // 对于返回相对路径的适配器，补全为完整 URL
        if (metadata.contentPath && !metadata.contentPath.startsWith("http")) {
            // 火山引擎的 contentPath 是 "productId/docId" 格式，通过 API 获取，不需要补全
            // 移动云的 contentPath 是 hash 字符串，直接传给 get_page_content 即可
            // 其他相对路径需要补全
            if (provider === "volcengine" || provider === "ecloud") {
                // 这些厂商的 contentPath 是特殊格式，不需要补全
            }
            else if (metadata.contentPath.startsWith("/")) {
                // 相对路径，补全为完整 URL
                const baseUrls = {
                    "aliyun": "https://help.aliyun.com",
                    "bailian": "https://help.aliyun.com",
                    "tencent": "https://cloud.tencent.com",
                    "huawei": "https://support.huaweicloud.com",
                    "ctyun": "https://www.ctyun.cn",
                    "baidu": "https://cloud.baidu.com",
                    "deepseek": "https://api-docs.deepseek.com",
                    "glm": "https://docs.bigmodel.cn",
                    "minimax": "https://platform.minimaxi.com",
                    "kimi": "https://platform.kimi.com",
                    "cucloud": "https://support.cucloud.cn",
                };
                const baseUrl = baseUrls[provider];
                if (baseUrl) {
                    metadata.contentPath = `${baseUrl}${metadata.contentPath}`;
                }
            }
        }
        return { content: [{ type: "text", text: JSON.stringify({ ...metadata, message: `下一步：调用 get_page_content(provider="${provider}", contentPath="${metadata.contentPath}") 获取页面正文`, }, null, 2) }] };
    }
    catch (error) {
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        error: true,
                        message: `获取页面元信息失败: ${error instanceof Error ? error.message : String(error)}`,
                        provider,
                        pageId,
                        suggestion: "请稍后重试，或检查 pageId 是否正确",
                    }, null, 2),
                }],
        };
    }
});
server.registerTool("get_product_price", {
    description: "获取指定云厂商的产品价格信息。传 quick=true 时返回已知的定价页面 URL（快速获取，无需网络请求）；传 quick=false（默认）时动态获取结构化价格数据。不传 productId 则返回所有产品价格概览。支持精确价格的厂商：腾讯云 CVM（productId 传 \"cvm\" 或 \"213\"）、天翼云云电脑（productId 传 \"10027004\"）、AI 厂商（DeepSeek、MiniMax、Kimi、百炼）。阿里云、华为云文档不含精确价格，需使用官网价格计算器。支持分页（page/pageSize 或 offset/limit）和关键词过滤（keyword）。关键词支持自动扩展：如 \"4C8G\" 会自动匹配各厂商的规格命名",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        productId: z.string().optional().describe("产品 ID（可选，不传则返回所有产品价格概览）。腾讯云传 \"cvm\" 或 \"213\"，天翼云传 \"10027004\"（云电脑）或 \"11061839\"（Token 服务）"),
        quick: z.boolean().optional().describe("是否快速获取定价页面 URL（默认 false）。true=返回已知定价页面 URL（无需网络请求），false=动态获取结构化价格数据"),
        page: z.number().optional().describe("页码，默认 1"),
        pageSize: z.number().optional().describe("每页条数，默认 100，最大 500"),
        keyword: z.string().optional().describe("关键词过滤（如规格型号 's6.large'、计费模式 '按量'、地域 '华北' 等），支持模糊匹配和自动扩展（如 '4C8G' 自动匹配各厂商规格）"),
    }).strict(),
}, async ({ provider, productId, quick, page, pageSize, keyword }) => {
    if (quick === true) {
        const priceQuickMap = {
            "ctyun": {
                "10027004": [
                    { url: "https://www.ctyun.cn/document/10027004", description: "天翼云电脑（政企版）价格（注意：定价页面为 JavaScript 动态渲染，文档中可能无法获取完整价格数据）" },
                    { url: "https://www.ctyun.cn/price", description: "天翼云官网价格计算器（推荐：获取实时价格）" },
                ],
                "10026730": [
                    { url: "https://www.ctyun.cn/document/10026730", description: "弹性云主机 ECS 价格（注意：定价页面为 JavaScript 动态渲染，文档中可能无法获取完整价格数据）" },
                    { url: "https://www.ctyun.cn/price", description: "天翼云官网价格计算器（推荐：获取实时价格）" },
                ],
                "11061839": [{ url: "https://www.ctyun.cn/document/11061839", description: "Token 服务价格" }],
            },
            "aliyun": {
                "ecs": [
                    { url: "https://help.aliyun.com/zh/ecs/billing", description: "云服务器 ECS 计费说明（仅含计费模式说明，无具体实例价格）" },
                    { url: "https://www.aliyun.com/price/product", description: "阿里云官网定价计算器（选择地域和实例规格后查询实时价格）" },
                ],
            },
            "tencent": {
                "cvm": [{ url: "https://buy.cloud.tencent.com/price/cvm/overview", description: "云服务器 CVM 价格概览" }],
                "213": [{ url: "https://buy.cloud.tencent.com/price/cvm/overview", description: "云服务器 CVM 价格概览" }],
            },
            "huawei": {
                "ecs": [{ url: "https://www.huaweicloud.com/pricing/calculator.html#/ecs", description: "弹性云服务器 ECS 价格计算器" }],
                "maas": [{ url: "https://support.huaweicloud.com/price-maas/price-maas-0002.html", description: "MaaS 模型即服务价格" }],
            },
            "ecloud": {
                "706": [{ url: "https://ecloud.10086.cn/op-help-center/doc/category/706", description: "云主机 ECS 价格" }],
            },
            "volcengine": {
                "ECS": [{ url: "https://www.volcengine.com/pricing?product=ECS", description: "ECS 价格" }],
            },
            "deepseek": {
                "api-docs": [{ url: "https://api-docs.deepseek.com/quick_start/pricing", description: "DeepSeek API 定价" }],
            },
            "minimax": {
                "minimax-api": [{ url: "https://platform.minimaxi.com/docs/guides/pricing-paygo", description: "MiniMax 定价" }],
            },
            "kimi": {
                "kimi-api": [{ url: "https://platform.kimi.com/docs/pricing", description: "Kimi API 定价" }],
            },
            "bailian": {
                "model-studio": [{ url: "https://help.aliyun.com/zh/model-studio/billing", description: "百炼大模型服务平台计费说明" }],
            },
            "baidu": {
                "BML": [{ url: "https://cloud.baidu.com/doc/BML/s/9kq7tfy4p", description: "BML 全功能AI开发平台价格" }],
                "BCC": [
                    { url: "https://cloud.baidu.com/publicity/bccplus.html", description: "百度云 BCC 价格详情（外部页面，文档中无具体价格）" },
                    { url: "https://cloud.baidu.com/doc/BCC/index.html", description: "百度云 BCC 文档首页（仅含计费模式说明，无具体实例价格）" },
                ],
            },
            "glm": {
                "bigmodel": [{ url: "https://open.bigmodel.cn/pricing", description: "智谱 GLM 定价" }],
            },
            "cucloud": {
                "128": [
                    { url: "https://support.cucloud.cn/document/128", description: "云服务器 ECS 价格（注意：定价页面返回 404，价格信息需从搜索摘要中提取）" },
                ],
                "2357": [{ url: "https://support.cucloud.cn/document/2357", description: "AI服务平台 AISP 价格" }],
            },
        };
        const providerMap = priceQuickMap[provider];
        if (!providerMap) {
            return { content: [{ type: "text", text: JSON.stringify({ error: true, message: `不支持的 provider: ${provider}，或该厂商暂无定价页面速查数据`, provider }, null, 2) }] };
        }
        if (productId && providerMap[productId]) {
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({
                            provider,
                            productId,
                            quickLinks: providerMap[productId],
                            message: "以上为已知的定价页面 URL，可直接通过 get_page_metadata + get_page_content 获取价格信息，或传 quick=false 获取结构化价格数据",
                        }, null, 2),
                    }],
            };
        }
        // 没有匹配的 productId，返回所有已知的定价页面
        const allLinks = Object.entries(providerMap).flatMap(([pid, links]) => links.map(l => ({ productId: pid, ...l })));
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        provider,
                        quickLinks: allLinks,
                        message: "以上为已知的定价页面 URL。如需查询具体产品价格，请指定 productId 参数，或传 quick=false 获取结构化价格数据",
                    }, null, 2),
                }],
        };
    }
    try {
        const adapter = getAdapter(provider);
        const result = await adapter.getProductPrice(productId, { page, pageSize, keyword });
        // 应用分页和过滤（如果适配器未处理）
        let prices = result.prices || [];
        const total = result.total || prices.length;
        let currentPage = result.page || page || 1;
        let currentPageSize = result.pageSize || pageSize || 100;
        // 如果适配器返回了完整数据但没有分页，在此处处理
        if (!result.hasMore && prices.length > 0 && (page || pageSize || keyword)) {
            // 关键词过滤（支持自动扩展）
            if (keyword) {
                const lowerKeyword = keyword.toLowerCase().trim();
                // 计费模式近义词映射（覆盖所有云厂商的 billingMode 取值）
                // 标准值: "按量", "包年包月", "包月", "包年"
                const billingModeAliases = {
                    "按量": ["按量", "按需", "按量计费", "按需计费", "后付费", "postpaid", "hourly", "日单价"],
                    "包年包月": ["包年包月", "包月", "包年", "预付费", "prepaid", "monthly", "yearly"],
                    "包月": ["包月", "包年包月", "预付费", "prepaid", "monthly"],
                    "包年": ["包年", "包年包月", "预付费", "prepaid", "yearly"],
                };
                // 检查 keyword 是否匹配 billingMode（含近义词）
                const matchBillingMode = (billingMode, kw) => {
                    if (!billingMode)
                        return false;
                    const lowerBilling = billingMode.toLowerCase();
                    if (lowerBilling.includes(kw))
                        return true;
                    for (const [standard, aliases] of Object.entries(billingModeAliases)) {
                        if (aliases.includes(kw) && lowerBilling.includes(standard.toLowerCase())) {
                            return true;
                        }
                    }
                    return false;
                };
                // 按空格分词，每个词必须 AND 匹配
                const keywords = lowerKeyword.split(/\s+/).filter(k => k.length > 0);
                // 精确匹配过滤
                let filtered = prices.filter(p => {
                    // 每个关键词都必须匹配至少一个字段
                    return keywords.every(kw => {
                        // productName 匹配
                        if (p.productName?.toLowerCase().includes(kw))
                            return true;
                        // region 匹配
                        if (p.region?.toLowerCase().includes(kw))
                            return true;
                        // billingMode 近义词匹配
                        if (matchBillingMode(p.billingMode, kw))
                            return true;
                        return false;
                    });
                });
                // 自动扩展：精确匹配为空时，尝试规格变体匹配
                if (filtered.length === 0) {
                    // 规格变体映射表：通用规格名 → 各厂商可能的规格表示
                    const specVariants = {
                        "4c8g": ["4核", "8gb", "4核 8gb", "4c", "8g", "large8", "xlarge", "2xlarge", "s6", "g3", "m9", "s5", "ecs.g7", "c7"],
                        "2c4g": ["2核", "4gb", "2核 4gb", "2c", "4g", "medium", "small", "s6.small", "c7"],
                        "8c16g": ["8核", "16gb", "8核 16gb", "8c", "16g", "2xlarge", "4xlarge", "c7", "m9"],
                        "16c32g": ["16核", "32gb", "16核 32gb", "16c", "32g", "4xlarge", "8xlarge"],
                    };
                    // 检查 keyword 是否匹配某个通用规格
                    const matchedSpec = Object.entries(specVariants).find(([spec]) => lowerKeyword.includes(spec) || spec.includes(lowerKeyword.replace(/[^a-z0-9]/g, "")));
                    if (matchedSpec) {
                        const variants = matchedSpec[1];
                        filtered = prices.filter(p => {
                            const specText = (p.productName + " " + (p.productName || "")).toLowerCase();
                            return variants.some(v => specText.includes(v));
                        });
                        if (filtered.length > 0) {
                            // 标记为自动扩展结果
                            return {
                                content: [{
                                        type: "text",
                                        text: JSON.stringify({
                                            ...result,
                                            prices: filtered,
                                            total: filtered.length,
                                            page: 1,
                                            pageSize: filtered.length,
                                            hasMore: false,
                                            autoExpanded: true,
                                            originalKeyword: keyword,
                                            message: `关键词 "${keyword}" 已自动扩展为匹配规格变体，找到 ${filtered.length} 条价格记录`,
                                        }, null, 2),
                                    }],
                            };
                        }
                    }
                    // 第二级扩展：尝试提取数字核数和内存大小
                    const coreMemMatch = lowerKeyword.match(/(\d+)\s*[cC核]\s*(\d+)\s*[gG]/);
                    if (coreMemMatch) {
                        const cores = coreMemMatch[1];
                        const mem = coreMemMatch[2];
                        filtered = prices.filter(p => {
                            const specText = (p.productName + " " + (p.productName || "")).toLowerCase();
                            return specText.includes(`${cores}核`) && specText.includes(`${mem}gb`);
                        });
                        if (filtered.length > 0) {
                            return {
                                content: [{
                                        type: "text",
                                        text: JSON.stringify({
                                            ...result,
                                            prices: filtered,
                                            total: filtered.length,
                                            page: 1,
                                            pageSize: filtered.length,
                                            hasMore: false,
                                            autoExpanded: true,
                                            originalKeyword: keyword,
                                            message: `关键词 "${keyword}" 已自动扩展为匹配 "${cores}核 ${mem}GB" 规格，找到 ${filtered.length} 条价格记录`,
                                        }, null, 2),
                                    }],
                            };
                        }
                    }
                    // 第三级扩展：尝试只匹配核数
                    const coreOnlyMatch = lowerKeyword.match(/(\d+)\s*[cC核]/);
                    if (coreOnlyMatch) {
                        const cores = coreOnlyMatch[1];
                        filtered = prices.filter(p => {
                            const specText = (p.productName + " " + (p.productName || "")).toLowerCase();
                            return specText.includes(`${cores}核`);
                        });
                        if (filtered.length > 0) {
                            return {
                                content: [{
                                        type: "text",
                                        text: JSON.stringify({
                                            ...result,
                                            prices: filtered,
                                            total: filtered.length,
                                            page: 1,
                                            pageSize: filtered.length,
                                            hasMore: false,
                                            autoExpanded: true,
                                            originalKeyword: keyword,
                                            message: `关键词 "${keyword}" 已自动扩展为匹配 "${cores}核" 规格，找到 ${filtered.length} 条价格记录`,
                                        }, null, 2),
                                    }],
                            };
                        }
                    }
                    // 所有扩展都失败，返回空结果
                    prices = filtered;
                }
                else {
                    prices = filtered;
                }
            }
            // 分页（使用 page/pageSize）
            if (page !== undefined || pageSize !== undefined) {
                const p = page || 1;
                const ps = pageSize || 100;
                const start = (p - 1) * ps;
                const end = start + ps;
                prices = prices.slice(start, end);
                currentPage = p;
                currentPageSize = ps;
            }
        }
        const hasMore = currentPageSize > 0 ? currentPage * currentPageSize < total : false;
        // 构建 message 指引
        let message = "";
        if (result.dataStatus === "no_data" || result.dataStatus === "no_price") {
            message = `价格数据状态：${result.dataStatus}。建议：传 quick=true 获取定价页面 URL，或访问官网价格计算器`;
        }
        else if (prices.length === 0) {
            message = "未找到匹配的价格数据。建议：使用 keyword 参数过滤（如 keyword=\"4C8G\"、\"按量\"、\"包月\"），或传 quick=true 获取定价页面 URL";
        }
        else if (hasMore) {
            message = `返回第 ${currentPage} 页 ${prices.length} 条，共 ${total} 条价格数据（还有更多）。下一步：传 page=${currentPage + 1} 翻页，或使用 keyword 参数过滤缩小范围`;
        }
        else {
            message = `共 ${total} 条价格数据。如需过滤，可传 keyword 参数（如 keyword=\"4C8G\"、\"按量\"、\"包月\"）；如需翻页，传 page 参数`;
        }
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        ...result,
                        prices,
                        total,
                        page: currentPage,
                        pageSize: currentPageSize,
                        hasMore,
                        message,
                    }, null, 2),
                }],
        };
    }
    catch (error) {
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        error: true,
                        message: `获取价格失败: ${error instanceof Error ? error.message : String(error)}`,
                        provider,
                        productId,
                        suggestion: "请稍后重试，或传 quick=true 获取定价页面 URL",
                    }, null, 2),
                }],
        };
    }
});
server.registerTool("get_page_content", {
    description: "获取文档页面的完整 Markdown 正文。参数 contentPath 来自 get_page_metadata 返回的 contentPath",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        contentPath: z.string().describe("文档正文 URL"),
    }).strict(),
}, async ({ provider, contentPath }) => {
    try {
        const adapter = getAdapter(provider);
        const content = await adapter.getPageContent(contentPath);
        return { content: [{ type: "text", text: content }] };
    }
    catch (error) {
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        error: true,
                        message: `获取文档内容失败: ${error instanceof Error ? error.message : String(error)}`,
                        provider,
                        contentPath,
                        suggestion: "请稍后重试，或检查 contentPath 是否正确",
                    }, null, 2),
                }],
        };
    }
});
export async function main() {
    const transport = new StdioServerTransport();
    // 优雅关闭：处理进程退出信号
    const shutdown = async (signal) => {
        console.error(`[multi-cloud-docs-search] 收到 ${signal} 信号，正在关闭...`);
        process.exit(0);
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    // 未捕获异常处理：记录错误但不退出进程
    process.on("uncaughtException", (err) => {
        console.error(`[multi-cloud-docs-search] 未捕获异常: ${err.message}`);
    });
    process.on("unhandledRejection", (reason) => {
        console.error(`[multi-cloud-docs-search] 未处理的 Promise 拒绝: ${reason}`);
    });
    await server.connect(transport);
    console.error("[multi-cloud-docs-search] MCP Server 已启动 (stdio 模式)");
}
main().catch((err) => {
    console.error(`[multi-cloud-docs-search] 启动失败: ${err.message}`);
    process.exit(1);
});
