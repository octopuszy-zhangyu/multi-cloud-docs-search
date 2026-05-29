# CLAUDE.md

## 项目概述

多云文档搜索 MCP Server。支持多云厂商文档搜索和获取，采用适配器架构便于扩展。

## 技术栈

- TypeScript + `@modelcontextprotocol/sdk`
- 本地 stdio 模式运行（`tsx` 直接执行）
- 保留 Cloudflare Workers 兼容性（`src/index.ts`），但不部署

## 适配器统一规范（重要）

所有适配器必须严格遵循以下规范，确保行为一致、可调试。

### 返回类型规范

| 方法 | 基类签名 | 必须返回类型 | 当前状态 |
|------|---------|------------|---------|
| `listProducts` | `(options?: ListProductsOptions) => Promise<PaginatedResult<Product>>` | **必须返回 `PaginatedResult<Product>`** | ✅ 全部合规 |
| `getDocumentToc` | `(productId: string, options?: TocOptions) => Promise<PaginatedResult<TocItem>>` | **必须返回 `PaginatedResult<TocItem>`** | ✅ 全部合规 |
| `searchDocuments` | `(productId: string, keyword: string) => Promise<SearchResult[]>` | **必须返回 `SearchResult[]`** | ✅ 全部合规 |
| `getPageMetadata` | `(pageId: string) => Promise<PageMetadata>` | **必须返回 `PageMetadata`** | ✅ 全部合规 |
| `getPageContent` | `(contentPath: string) => Promise<string>` | **必须返回 `string`** | ✅ 全部合规 |
| `getProductPrice` | `(productId?: string, options?: PriceQueryOptions) => Promise<PriceResult>` | **必须返回 `PriceResult`** | ✅ 全部合规 |

### contentPath 规范

`getPageMetadata` 返回的 `contentPath` 必须遵循以下规则：

| 厂商 | contentPath 格式 | 传给 get_page_content 方式 | 说明 |
|------|-----------------|--------------------------|------|
| ctyun | 相对路径（如 `/document/10027004/10028086`） | 直接传 | stdio.ts 中自动补全为完整 URL |
| aliyun | 完整 URL（如 `https://help.aliyun.com/zh/ecs/...`） | 直接传 | 已在 getPageMetadata 中补全 |
| volcengine | `productId/docId`（如 `6396/12345`） | 直接传 | 特殊格式，getPageContent 内部解析 |
| tencent | 完整 URL（如 `https://cloud.tencent.com/...`） | 直接传 | 已在 getPageMetadata 中补全 |
| huawei | 完整 URL（如 `https://support.huaweicloud.com/...`） | 直接传 | 已在 getPageMetadata 中补全 |
| ecloud | hash 字符串（如 `60daff9598d5c8fe58d847009f94c256`） | 直接传 | 特殊格式，getPageContent 内部解析 |
| cucloud | 完整 URL（如 `https://support.cucloud.cn/document/123.html`） | 直接传 | 已在 getPageMetadata 中补全 |
| deepseek | 完整 URL（如 `https://api-docs.deepseek.com/...`） | 直接传 | 已在 getPageMetadata 中补全 |
| glm | 相对路径（如 `/cn/guide/start/quick-start`） | 直接传 | stdio.ts 中自动补全为完整 URL |
| minimax | 完整 URL（如 `https://platform.minimaxi.com/...`） | 直接传 | 已在 getPageMetadata 中补全 |
| kimi | 完整 URL（如 `https://platform.kimi.com/...`） | 直接传 | 已在 getPageMetadata 中补全 |
| baidu | 完整 URL（如 `https://cloud.baidu.com/doc/...`） | 直接传 | 已在 getPageMetadata 中补全 |
| bailian | 完整 URL（如 `https://help.aliyun.com/...`） | 直接传 | 已在 getPageMetadata 中补全 |

**规范要求：** 所有适配器的 `getPageMetadata` 应返回可直接使用的 contentPath。对于返回相对路径的适配器，在 stdio.ts 的 `get_page_metadata` 工具中统一补全为完整 URL。特殊格式（volcengine、ecloud）保持原样。

### pageId 格式规范

| 厂商 | pageId 格式 | 示例 |
|------|------------|------|
| ctyun | 纯数字 | `10028086` |
| aliyun | 文档路径 | `/zh/ecs/user-guide/what-is-ecs` |
| volcengine | `productId/docId` | `6396/12345` |
| tencent | `productId/pageId` | `213/495` |
| huawei | `productId/docPath` | `ecs/productdesc-ecs/ecs_01_0073` |
| ecloud | 纯数字 | `41800` |
| cucloud | 纯数字 | `12345` |
| deepseek | 路径（以 `/` 开头） | `/quick_start/pricing` |
| glm | 路径（以 `/` 开头） | `/cn/guide/start/quick-start` |
| minimax | 路径（以 `/` 开头） | `/docs/api-reference/models/...` |
| kimi | 路径（以 `/` 开头） | `/docs/pricing/chat-k26` |
| baidu | `productId/s/SLUG` | `BCC/s/8kbbkwg4p` |
| bailian | 路径（以 `/` 开头） | `/zh/model-studio/billing` |

### 基类可重用方法

以下方法已在 `CloudDocAdapter` 基类中提供，所有适配器可直接使用：

| 方法 | 签名 | 用途 |
|------|------|------|
| `filterByKeywords` | `<T extends { name?: string; title?: string }>(items: T[], keyword?: string): T[]` | 按空格分隔的关键词 AND 逻辑过滤 |
| `paginate` | `<T>(items: T[], page?: number, pageSize?: number): PaginatedResult<T>` | 数组分页包装 |
| `paginateProducts` | `(products: Product[], options?: ListProductsOptions): PaginatedResult<Product>` | 合并 filterByKeywords + paginate 快捷方法 |
| `determineDataStatus` | `(prices: PriceItem[]): "complete" | "partial" | "no_price" | "no_data"` | 根据价格数组判断数据状态 |
| `makePriceResult` | `(prices: PriceItem[], source: string, extra?: Partial<PriceResult>): PriceResult` | 构造 PriceResult 的快捷方法 |
| `parseMarkdownTable` | `(markdown: string): { headers: string[]; rows: string[][] }` | 解析 Markdown 表格行 |

**注意：** 新增适配器时**不需要**自己实现 `filterByKeywords` 和 `paginate`，直接调用基类方法即可。`parsePriceTable` 因各厂商价格表格格式差异大，需各适配器自行实现。

### 错误处理规范

所有适配器方法必须遵循以下错误处理规则：

1. **网络请求失败**：使用基类 `fetchWithRetry`（自动重试 2 次），失败时抛出 Error
2. **数据解析失败**：捕获异常并继续（不中断整体流程），如 `getProductPrice` 中单个页面解析失败
3. **空结果处理**：返回空数组/空对象，不抛出异常
4. **无效参数**：`getProductPrice` 无 `productId` 时返回空 `PriceResult`（`prices: []`）

### 价格获取规范

`getProductPrice` 方法必须：

1. 返回 `PriceResult` 类型，包含 `dataStatus` 字段
2. `dataStatus` 取值：`"complete"` | `"partial"` | `"no_price"` | `"no_data"`
3. 价格数据来源标注在 `source` 字段
4. 无价格数据时提供明确的引导提示（`note` 字段）

### 新增适配器检查清单

新增云厂商适配器时，必须逐项检查：

- [ ] 实现全部 6 个抽象方法
- [ ] `listProducts` 返回 `PaginatedResult<Product>`
- [ ] `getDocumentToc` 返回 `PaginatedResult<TocItem>`
- [ ] `searchDocuments` 返回 `SearchResult[]`
- [ ] `getPageMetadata` 返回 `PageMetadata`（contentPath 可被 stdio.ts 消费）
- [ ] `getPageContent` 返回 Markdown 格式字符串
- [ ] `getProductPrice` 返回 `PriceResult`（含 dataStatus）
- [ ] 利用基类的 `filterByKeywords`、`paginate`、`paginateProducts`、`makePriceResult` 等方法
- [ ] 实现 `parsePriceTable` 私有方法（各厂商价格表格格式不同，需自行实现）
- [ ] 在 `adapters/index.ts` 注册
- [ ] 在 `stdio.ts` 的 instructions 中添加厂商说明
- [ ] 在 CLAUDE.md 的厂商列表和价格策略表中添加记录

## 项目架构

```
src/
├── index.ts                  # Cloudflare Worker 入口（保留兼容性，不部署）
├── stdio.ts                  # 主入口 — stdio 模式 MCP Server
├── types.ts                  # 类型定义
├── adapters/
│   ├── index.ts              # 适配器工厂 getAdapter(provider)
│   ├── base.ts               # 抽象基类 CloudDocAdapter
│   ├── ctyun.ts              # 天翼云适配器
│   ├── aliyun.ts             # 阿里云适配器
│   ├── volcengine.ts         # 火山引擎适配器
│   ├── tencent.ts            # 腾讯云适配器
│   ├── huawei.ts            # 华为云适配器
│   ├── ecloud.ts            # 移动云适配器
│   ├── cucloud.ts           # 联通云适配器
│   ├── bailian.ts           # 阿里云百炼适配器
│   ├── baidu.ts             # 百度云适配器
│   ├── deepseek.ts          # DeepSeek 适配器
│   ├── glm.ts               # 智谱 GLM 适配器
│   ├── minimax.ts           # MiniMax 适配器
│   └── kimi.ts              # 月之暗面 Kimi 适配器
└── utils/
    └── html-to-md.ts         # HTML 转 Markdown 工具
```

## 核心工具（所有工具第一个参数为 provider）

| 工具 | 参数 | 用途 |
|------|------|------|
| `list_products` | provider | 获取所有产品文档列表（**优先使用 keyword 参数搜索**，不传 keyword 返回全量列表需翻页） |
| `get_document_toc` | provider, productId | 获取文档目录（支持 keyword 过滤） |
| `search_documents` | provider, productId, keyword | 搜索文档（支持关键词自动扩展） |
| `get_page_metadata` | provider, pageId | 获取页面元信息（contentPath 已统一为完整 URL） |
| `get_page_content` | provider, contentPath | 获取 Markdown 正文 |
| `get_product_price` | provider, productId?, quick? | 获取产品价格信息（quick=true 时返回定价页面 URL，quick=false 时动态获取价格数据） |

## MCP 工具使用指引（重要）

### 调用顺序原则
1. **先目录，后搜索**：优先调用 `get_document_toc` 浏览目录结构定位章节，迫不得已再调用 `search_documents`
2. **metadata → content 顺序不可颠倒**：必须先 `get_page_metadata` 获取 contentPath，再将 contentPath 传给 `get_page_content`，不能跳过 metadata 构造 URL
3. **并行调用最大化效率**：无依赖关系的调用应并行执行（如同时查询多个厂商的 `list_products`、同时获取多个页面的 `get_page_metadata`）

### 搜索注意事项
- 搜索关键词要宽泛：如搜价格用"计费""价格""规格"，不要用"价格 4C8G"这种具体组合
- **关键词自动扩展**：当 `search_documents` 返回空结果时，系统会自动去掉具体规格词（如 4C8G、5M）后重新搜索
- `list_products` 结果可能过大（如阿里云），需分块读取或 grep 过滤

### 价格查询流程（优化版）
1. **优先使用 `get_product_price(quick=true)`**：对于已知产品 ID 的场景，直接获取定价页面 URL
2. **`search_documents` 搜索宽泛关键词**：用"价格""计费"等宽泛词
3. **`get_product_price` 回退**：文档找不到价格时调用

### 各厂商特殊说明
- **联通云 cucloud**：文档详情页为 Vue SPA 有反爬保护，`get_page_content` 返回搜索 API 摘要而非完整页面，价格信息需从搜索摘要中提取
- **移动云 ecloud**：contentPath 是 hash 字符串（如 `60daff9598d5c8fe58d847009f94c256`）而非 URL，直接传给 `get_page_content` 即可
- **华为云 CloudPond 云桌面**：文档只有规格清单，具体价格需联系销售
- **腾讯云云桌面**：文档未公开具体价格，需官网价格计算器
- **华为云价格数据来源已标注**：价格数据会标注来源（官网价格计算器或文档），便于区分标准定价和参考价
- **阿里云文档无价格表**：阿里云 ECS 等产品的文档中无具体价格表，`get_product_price` 会返回提示信息并指向官网定价页

## 当前支持的云厂商

| provider | 名称 | 状态 |
|----------|------|------|
| ctyun | 天翼云 | 已实现 |
| aliyun | 阿里云 | 已实现 |
| volcengine | 火山引擎 | 已实现 |
| tencent | 腾讯云 | 已实现 |
| huawei | 华为云 | 已实现 |
| ecloud | 移动云 | 已实现 |
| cucloud | 联通云 | 已实现 |
| bailian | 阿里云百炼 | 已实现 |
| baidu | 百度云 | 已实现 |
| deepseek | DeepSeek | 已实现 |
| glm | 智谱 GLM | 已实现 |
| minimax | MiniMax | 已实现 |
| kimi | 月之暗面 Kimi | 已实现 |

## 常用命令

```bash
npm run start    # 启动 MCP Server（stdio 模式）
npm run dev      # 开发模式（文件监听）
npm run build    # TypeScript 编译检查
npx tsx src/smoke-test.ts  # 全流程穿测（需先创建穿测脚本）
```

**MCP Inspector 调试：**
```bash
# 方式 1：使用 MCP Inspector（推荐）
npx @modelcontextprotocol/inspector npx tsx src/stdio.ts

# 方式 2：直接启动后通过 MCP 客户端连接
npm run start
```

## 常用产品 bookId

| 产品名称 | bookId |
|---------|--------|
| 天翼云电脑（政企版） | 10027004 |
| 弹性云主机 ECS | 10026730 |
| 对象存储 TOS | 6349 |
| 云服务器 ECS | 6396 |
| 云服务器 CVM（腾讯云） | 213 |
| 大模型服务平台 TokenHub（腾讯云） | 1823 |
| 弹性云服务器 ECS（华为云） | ecs |
| 对象存储服务 OBS（华为云） | obs |
| 云主机 ECS（移动云） | 706 |
| 对象存储 EOS（移动云） | 729 |
| 云服务器 ECS（联通云） | 128 |
| AI服务平台 AISP（联通云） | 2357 |
| Token服务（天翼云） | 11061839 |
| 大模型服务平台百炼（阿里云） | model-studio |
| 大模型服务平台 TokenHub（腾讯云） | 1823 |
| MaaS 模型即服务（华为云） | maas |
| 模型服务平台 MoMA（移动云） | 1456 |
| AI算力平台 AICP（联通云） | 1398 |
| BML 全功能AI开发平台（百度云） | BML |

## 价格获取说明

`get_product_price` 工具用于获取云厂商产品价格信息。工作流程：

1. **优先从文档获取价格**：先调用 `search_documents` 搜索"价格"/"计费"/"定价"关键词，找到定价页面后调用 `get_page_content` 获取内容，从中提取价格表
2. **回退到 `get_product_price`**：当文档中找不到价格信息时，调用 `get_product_price` 获取价格数据
3. **AI 厂商价格**：DeepSeek、MiniMax、Kimi 等 AI 厂商的定价页面可直接通过 `get_product_price` 获取
4. **传统云厂商价格**：天翼云、阿里云（百炼）可通过 `get_product_price` 获取部分产品价格；火山引擎、腾讯云、华为云、移动云、联通云、百度云的 AI 产品价格需从文档中搜索获取

### 价格获取策略

| 厂商 | 文档价格 | get_product_price | get_product_price(quick=true) |
|------|---------|-------------------|------------------------|
| deepseek | `/quick_start/pricing` | ✅ 可用 | ✅ 支持 |
| minimax | `/docs/guides/pricing-paygo` | ✅ 可用 | ✅ 支持 |
| kimi | `/docs/pricing` | ✅ 可用 | ✅ 支持 |
| bailian | `/zh/model-studio/billing` | ✅ 可用 | ✅ 支持 |
| glm | `open.bigmodel.cn/pricing` | ⚠️ SPA 页面 | ✅ 支持 |
| ctyun | 文档计费说明 | ✅ 可用（内部价格计算器 API，支持 ECS 规格精确询价） | ✅ 支持 |
| aliyun | 文档计费说明 | ✅ 可用（需 productId，文档无价格表时返回提示） | ✅ 支持 |
| volcengine | 文档计费规则 | ✅ 可用（GetTable API） | ✅ 支持 |
| tencent | 文档计费说明 | ✅ 可用（CVM API） | ✅ 支持 |
| huawei | 文档计费说明 | ✅ 可用（export/productlist API，已标注数据来源） | ✅ 支持 |
| ecloud | 文档价格页面 | ⚠️ 待完善 | ✅ 支持 |
| cucloud | 文档价格页面 | ⚠️ 待完善 | ❌ 待完善 |
| baidu | 产品页内嵌数据 | ⚠️ 待完善 | ✅ 支持 |

## 注意事项

- `GetFolderBook` API 已废弃，目录需从 HTML 页面提取
- 所有工具为只读操作
- 天翼云 API 无需认证
- 天翼云 `getProductPrice` 通过内部价格计算器 API（`proxyv3/querynew`）获取精确价格，流程：获取 `ct_tgc` cookie → 获取地域列表 → 获取 flavor UUID 映射 → 调用 `proxyv3/querynew` 询价。当前仅支持 ECS（productId=10026730），返回 150+ 条规格价格数据
- 天翼云 `listProducts` 已填充 `description` 字段（从 API 的 `note` 获取），`filterByKeywords` 搜索时包含 `description` 实现全文检索，返回时由 stdio.ts 统一去掉 `description` 节约 token
- 阿里云 API 返回 JSON 目录树，内容需 HTML 转 Markdown
- 火山引擎 API 无需认证，文档内容直接返回 Markdown（`MDContent` 字段）
- 腾讯云文档为 SSR 渲染，内容需从 HTML 转换为 Markdown
- 腾讯云产品 ID 为数字（如 213=云服务器 CVM），页面 ID 格式为 `productId/pageId`
- 华为云通过公开 API 获取产品列表，目录通过 `v3_support_leftmenu_fragment.html` 加载
- 华为云文档内容需从 HTML 转换为 Markdown，已自动提取正文区域去除页头页脚
- 移动云通过 API 获取产品列表（`/category/tree`）和文档目录（`/outline/tree`）
- 移动云文档内容通过 API 获取（`/article/info` → `/article/content`），返回 HTML 格式
- 移动云首页为 SSR 渲染，HTML 内容为空，无法通过 HTML 解析获取产品列表
- 移动云 API 可能屏蔽 Cloudflare Workers IP，本地 stdio 模式可正常使用
- 联通云通过首页 HTML 中嵌入的 `finalResConfig` JSON 数据获取产品列表和文档目录
- 联通云文档详情页为 Vue SPA，有反爬保护（JS 混淆 + debugger 断点），`getPageContent` 返回搜索 API 摘要内容
- 联通云搜索 API（`gateway.cucloud.cn/search/`）可正常访问，用于文档搜索和内容摘要
- 百炼（bailian）文档托管在阿里云帮助中心，productId 为 `model-studio`，目录需从 HTML 页面解析（JSON API 返回 302 重定向）
- 百度云（baidu）文档为静态 HTML，产品列表从首页 HTML 解析，文档内容从 `.post__body` 容器提取
- DeepSeek（deepseek）文档为 Docusaurus 静态站点，通过 sitemap.xml 获取文档目录
- GLM（glm）文档为 Mintlify 站点，通过 llms.txt 获取目录，通过 llms-full.txt 获取完整内容
- MiniMax（minimax）文档直接返回 Markdown，无需 HTML 转换，通过 llms.txt 获取目录
- Kimi（kimi）文档为 Mintlify 站点，通过 llms.txt 获取目录，内容需 HTML 转 Markdown
- MCP Server 的完整使用指引和注意事项已内置在 stdio.ts 的 instructions 中，通过 npx 安装后自动生效

## 验证方法

使用 MCP 工具测试所有 5 个核心功能：

```bash
# 1. 测试获取产品列表
list_products({ provider: "ctyun" })

# 2. 测试获取文档目录
get_document_toc({ provider: "ctyun", productId: "10027004" })

# 3. 测试搜索文档
search_documents({ provider: "ctyun", productId: "10027004", keyword: "登录" })

# 4. 测试获取页面元信息
get_page_metadata({ provider: "ctyun", pageId: "10028086" })

# 5. 测试获取页面正文
get_page_content({ provider: "ctyun", contentPath: "从 get_page_metadata 获取的 contentPath" })

# 腾讯云验证
list_products({ provider: "tencent" })
get_document_toc({ provider: "tencent", productId: "213" })
search_documents({ provider: "tencent", productId: "213", keyword: "登录" })
get_page_metadata({ provider: "tencent", pageId: "213/495" })
get_page_content({ provider: "tencent", contentPath: "https://cloud.tencent.com/document/product/213/495" })

# 华为云验证
list_products({ provider: "huawei" })
get_document_toc({ provider: "huawei", productId: "ecs" })
search_documents({ provider: "huawei", productId: "ecs", keyword: "安全组" })
get_page_metadata({ provider: "huawei", pageId: "ecs/productdesc-ecs/zh-cn_topic_0013771112" })
get_page_content({ provider: "huawei", contentPath: "https://support.huaweicloud.com/productdesc-ecs/zh-cn_topic_0013771112.html" })
```

### 价格获取验证

```bash
# AI 厂商价格
get_product_price({ provider: "deepseek" })
get_product_price({ provider: "minimax" })
get_product_price({ provider: "bailian" })

# 传统云厂商价格（需指定 productId）
get_product_price({ provider: "ctyun", productId: "10026730" })  # ECS 价格（内部 API 询价，返回 150+ 条规格价格）
get_product_price({ provider: "ctyun", productId: "11061839" })
get_product_price({ provider: "aliyun", productId: "model-studio" })
get_product_price({ provider: "volcengine" })
get_product_price({ provider: "volcengine", productId: "ECS" })
get_product_price({ provider: "tencent" })
get_product_price({ provider: "tencent", productId: "cvm" })
get_product_price({ provider: "huawei" })
get_product_price({ provider: "huawei", productId: "maas" })

# 快捷定价查询
get_product_price(quick=true)({ provider: "tencent", productId: "cvm" })
get_product_price(quick=true)({ provider: "aliyun", productId: "ecs" })
get_product_price(quick=true)({ provider: "huawei", productId: "ecs" })
```

### 验证原则
- 每次代码变更后必须执行完整测试流程
- 所有 6 个工具都必须返回正确结果
- 检查返回数据格式是否符合预期
- 确保新增云厂商适配器后测试覆盖所有工具

## 软件开发全流程规范

### 一、代码框架与结构规范

#### 1.1 适配器模式规则

- 新增云厂商适配器必须继承 `CloudDocAdapter` 抽象基类
- 必须实现全部 6 个抽象方法（不可抛出 `NotImplementedError`）
- 利用基类的 `filterByKeywords`、`paginate`、`paginateProducts`、`makePriceResult` 等方法
	- 实现 `parsePriceTable` 私有方法（各厂商价格表格格式不同，需自行实现）
- 必须在 `adapters/index.ts` 中注册适配器实例
- 必须在 `adapters/index.ts` 的 `providerAliases` 中添加别名映射（如有）
- 必须在 `stdio.ts` 的 instructions 中添加厂商说明

#### 1.2 文件职责边界

```
src/
├── index.ts              # 仅 Cloudflare Worker 入口（不部署，仅保留兼容性）
├── stdio.ts              # MCP Server 主入口：工具注册、参数校验、响应格式化
├── types.ts              # 仅天翼云 API 响应类型 + 导出 base.ts 类型
├── adapters/
│   ├── index.ts          # 适配器工厂：getAdapter() + getSupportedProviders()
│   ├── base.ts           # 抽象基类 + 全部共享类型定义 + 基础工具方法
│   └── *.ts              # 各厂商适配器：只实现 6 个抽象方法，不做工具注册相关的事
└── utils/
    └── html-to-md.ts     # HTML 转 Markdown 工具函数
```

**原则：** 一个文件一个职责。适配器只关注"如何获取该厂商的文档数据"，不关注"数据如何被 MCP 工具消费"。

#### 1.3 导入规范

- 类型导入使用 `import type { ... }` 语法（编译期擦除，减少运行时开销）
- 第三方库导入放在第一组，内部模块导入放在第二组
- 不使用的 import 必须删除
- 禁止使用 `import * as` 导入非必要的内容

```typescript
// ✅ 正确
import * as cheerio from "cheerio";
import { htmlToMarkdown } from "../utils/html-to-md.js";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PaginatedResult } from "./base.js";

// ❌ 禁止
import { CloudDocAdapter, Product, TocItem, SearchResult } from "./base.js"; // 未使用 type 关键字
import { unusedVar } from "./base.js"; // 未使用的导入
```

#### 1.4 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 类名 | PascalCase | `CtyunAdapter`, `CloudDocAdapter` |
| 方法名 | camelCase | `getDocumentToc`, `parsePriceTable` |
| 变量名 | camelCase | `productId`, `pageSize` |
| 常量 | UPPER_SNAKE_CASE | `BASE_URL`, `PRODUCTS_API` |
| 类型/接口 | PascalCase | `PriceResult`, `PaginatedResult` |
| 私有方法 | camelCase（不加 `_` 前缀） | `filterByKeywords` |
| 文件名 | kebab-case | `ctyun.ts`, `html-to-md.ts` |
| 文件扩展名 | `.ts`（编译后为 `.js`） | `aliyun.ts` → `aliyun.js` |

#### 1.5 文件组织规范

- 方法按调用顺序排列：`listProducts` → `getDocumentToc` → `searchDocuments` → `getPageMetadata` → `getPageContent` → `getProductPrice`
- 私有辅助方法放在所有公有方法之后
- 类型定义放在文件顶部（导入之后）
- 常量定义放在文件顶部（导入之后、类定义之前）

### 二、代码质量规范

#### 2.1 DRY 原则（禁止重复）

- **禁止重复的 parsePriceTable**：每个适配器有自己的价格表格解析逻辑，这是合理的（各厂商格式不同）。但如果两个适配器的解析逻辑完全相同，必须提取到基类或工具函数中
- **禁止重复的 filterByKeywords**：基类中已有 `fetchWithRetry`、`fetchHtml`、`fetchJson`、`fetchText` 方法，适配器中禁止再写重复的网络请求逻辑
- **禁止重复的 URL 拼接**：将 BASE_URL 定义为类常量，所有 URL 基于 BASE_URL 拼接

#### 2.2 禁止使用的语句和模式

| 禁止项 | 原因 | 替代方案 |
|--------|------|---------|
| `as any` | 绕过类型检查 | 使用正确的类型定义 |
| `@ts-ignore` / `@ts-nocheck` | 隐藏类型错误 | 修复类型或使用类型守卫 |
| `!` 非空断言（`foo!.bar`） | 可能运行时崩溃 | 使用可选链 `foo?.bar` 或类型守卫 |
| `console.log`（生产代码） | 污染 stdout | 使用 `console.error`（MCP stdio 模式 stdout 为协议通道） |
| `any` 类型 | 丧失类型安全 | 使用 `unknown` + 类型守卫 |
| `// TODO:`（长期未处理） | 技术债务积累 | 立即实现或创建 Issue |
| `Promise<void>` 但不 await | 未捕获的拒绝 | 使用 `void` 操作符标记有意忽略 |
| 魔法数字 | 不可维护 | 定义为具名常量 |
| 空的 catch 块 | 吞咽错误 | 至少记录 `console.error` |
| `process.exit()`（库代码） | 杀死宿主进程 | 抛出错误让调用者处理 |

#### 2.3 类型安全规范

- 优先使用 `interface` 定义对象形状，使用 `type` 定义联合类型/工具类型
- 函数参数使用解构时，必须同时定义类型注解
- 禁止隐式 `any`：所有函数参数必须有明确的类型注解
- 泛型约束使用 `extends` 而非 `any`
- `PriceResult` 的 `dataStatus` 字段必须为字面量联合类型 `"complete" | "partial" | "no_price" | "no_data"`

```typescript
// ✅ 正确
async function getPageMetadata(pageId: string): Promise<PageMetadata> { ... }
const filtered = items.filter((item: TocItem) => item.title.includes(keyword));

// ❌ 禁止
async function getPageMetadata(pageId) { ... } // 隐式 any
const filtered = items.filter(item => item.title.includes(keyword as any)); // as any
```

#### 2.4 异步编程规范

- 优先使用 `async/await`，禁止裸 `.then()` / `.catch()`
- 并行请求使用 `Promise.all()`，禁止串行 await
- 使用基类的 `fetchWithRetry`（自动重试 2 次），不要自己写重试逻辑
- `fetchWithTimeout` 默认超时 15 秒，API 请求超时可传 `timeout` 参数
- 捕获异常时使用 `instanceof Error` 判断类型

```typescript
// ✅ 正确 — 并行请求
const [toc, price] = await Promise.all([
  adapter.getDocumentToc(productId),
  adapter.getProductPrice(productId),
]);

// ❌ 禁止 — 串行请求
const toc = await adapter.getDocumentToc(productId);
const price = await adapter.getProductPrice(productId);

// ✅ 正确 — 错误处理
try {
  const result = await adapter.listProducts();
} catch (error) {
  console.error(`请求失败: ${error instanceof Error ? error.message : String(error)}`);
}
```

### 三、错误处理规范

#### 3.1 适配器层

- 网络请求：使用 `fetchWithRetry`，失败时抛出 Error（由 stdio.ts 统一捕获）
- 数据解析：**必须 try/catch 包裹**，单个页面解析失败不中断整体流程
- 空结果：返回空数组/空对象，不抛出异常
- 无效参数：`getProductPrice` 无 `productId` 时返回空 `PriceResult`

#### 3.2 MCP 工具层（stdio.ts）

- 所有工具必须用 try/catch 包裹整个业务逻辑
- 异常时返回标准错误 JSON：`{ error: true, message, provider, suggestion }`
- 永远不抛出异常到 MCP SDK 层

#### 3.3 错误信息规范

- 错误信息必须包含：错误原因 + 建议操作
- 网络错误：`"请求失败: {status} {statusText} — {url}"`
- 参数错误：`"请提供合法参数: {detail}"` + `suggestion`
- 权限错误：`"认证失败: {detail}"` + `suggestion`

### 四、测试规范

#### 4.1 全流程穿测（每次修改后必须执行）

1. **编译检查**：`npx tsc --noEmit` 确保无类型错误
2. **核心功能穿测**：覆盖以下场景
   - 至少 1 个传统云厂商的完整链路
   - 至少 1 个 AI 厂商的完整链路
   - 至少 1 个厂商的价格查询
3. **修改专项测试**：对本次修改的函数进行针对性验证
4. **回归测试**：确保未修改的厂商功能不受影响

#### 4.2 验证指标

| 检查项 | 验证方式 | 通过标准 |
|--------|---------|---------|
| PaginatedResult 结构 | 检查 JSON 字段 | 包含 items/total/page/pageSize/hasMore |
| contentPath 可用性 | metadata → content 链路 | getPageContent 返回非空 Markdown |
| dataStatus 完整性 | 检查 PriceResult | dataStatus 不为 undefined |
| 搜索功能 | searchDocuments | 返回结果数组，非空时包含 pageId |
| 编译 | tsc --noEmit | 0 个错误（test-fix.ts 预存错误除外） |

### 五、提交规范

#### 5.1 Commit Message 格式

```
类型: 简短描述（不超过 50 字）

## 修改内容
- 修改点 1：具体说明文件和修改内容
- 修改点 2：具体说明

## 修改缘由
- 缘由 1：为什么这样改
- 缘由 2：解决了什么问题

## 影响范围
- 影响的厂商/模块
- 是否需要更新文档/迁移数据
```

#### 5.2 Commit 类型前缀

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feat` | 新增功能/适配器 | `feat: 新增青云适配器` |
| `fix` | 修复 bug | `fix: 华为云 getDocumentToc 返回类型错误` |
| `refactor` | 重构 | `refactor: 统一适配器返回类型为 PaginatedResult` |
| `style` | 代码风格调整 | `style: 统一 filterByKeywords 命名` |
| `docs` | 文档更新 | `docs: 更新适配器规范` |
| `chore` | 构建/工具链 | `chore: 升级 typescript 到 5.x` |

#### 5.3 禁止行为

- ❌ `git commit -m "fix bug"` — 无意义 message
- ❌ 跳过测试直接 commit
- ❌ 一次性 commit 大量无关修改（应拆分）
- ❌ commit 包含 `console.log` 调试代码
- ❌ commit 包含自动生成的无需提交的文件

### 六、代码审查规范

#### 6.1 自我审查清单（commit 前检查）

- [ ] 编译通过（`npx tsc --noEmit`）
- [ ] 没有 `console.log`（生产代码用 `console.error`）
- [ ] 没有 `as any` / `@ts-ignore` / `!` 非空断言
- [ ] 所有函数参数有明确的类型注解
- [ ] 新增适配器在 `index.ts` 注册
- [ ] 返回类型符合基类签名
- [ ] 异常路径有 try/catch 处理
- [ ] 价格查询返回了 `dataStatus` 字段
- [ ] 全流程穿测通过
- [ ] 如涉及 API 变化，更新了 instructions

#### 6.2 常见审查发现

| 问题 | 严重程度 | 检查方法 |
|------|---------|---------|
| 返回类型与基类不一致 | ❌ 阻断 | `npx tsc --noEmit` |
| 未处理异常路径 | ⚠️ 高 | 检查 try/catch 覆盖率 |
| 魔法数字/URL | ⚠️ 中 | grep 查找硬编码值 |
| console.log 污染 stdout | ❌ 阻断 | grep 'console.log' |
| 未使用的导入 | ⚠️ 低 | 编辑器提示 / lint |

### 七、常量与配置管理规范

- API 端点 URL 定义为类级别 `const`（`BASE_URL`、`API_URL` 等）
- 超时时间、重试次数等配置参数使用默认参数，非特殊情况不改写
- 厂商特有映射表（如产品代码映射）定义为 `private readonly` 属性
- 禁止在方法内部硬编码 URL 片段（如 `/v2/portal/book/ListForHelp`），应定义为常量

```typescript
// ✅ 正确
const BASE_URL = "https://www.ctyun.cn";
private readonly PRODUCT_CODE_MAP: Record<string, string> = { "6396": "ECS" };

// ❌ 禁止
const url = `https://www.ctyun.cn/v2/portal/book/ListForHelp?bookClassDomain=product`;
```

### 八、性能规范

- **并行请求**：循环查询多个地域/产品时使用 `Promise.all`，禁止串行 await
- **缓存**：频繁访问的数据（如产品列表、llms.txt）使用私有缓存变量
- **分页**：`listProducts` 和 `getDocumentToc` 返回大列表时必须分页
- **超时**：所有网络请求必须有超时控制（基类 `fetchWithTimeout` 默认 15 秒）
- **限制并发**：`Promise.all` 的并发数不超过 20（防止连接池耗尽）
- **避免重复请求**：同一个工具的多次调用应利用适配器的缓存机制（如 `productListCache`）

### 九、安全规范

- 所有工具为只读操作，禁止写入/修改/删除
- API 密钥/token 禁止硬编码在代码中
- 用户输入的 URL 参数必须校验格式，禁止 SSRF
- HTML 内容中提取文本时，使用 cheerio 安全解析，禁止正则表达式直接提取
- 检测文件编码时限制检测范围（如仅读取前 1024 字节），防止恶意大文件

### 十、FAQ 与常见陷阱

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| `getDocumentToc` 返回空 | 厂商文档站改版/API 变化 | 检查 HTML 结构是否变化 |
| `getPageContent` 返回空或 HTML | 页面为 SPA 渲染 | 检查厂商是否改了前端框架 |
| `getProductPrice` 返回 `dataStatus: "no_price"` | 该厂商文档不列价格 | 使用 `get_product_price(quick=true)` 获取定价页 URL |
| 编译错误 `not assignable to type` | 返回类型与基类不匹配 | 检查签名是否一致 |
| MCP 连接后无响应 | stdout 被 `console.log` 污染 | 全部改为 `console.error` |
| 中文乱码 | 编码检测失败 | 天翼云使用 GBK 编码检测器 |

