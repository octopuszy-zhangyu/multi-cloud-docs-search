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

| 方法 | 基类签名 | 必须返回类型 | 违规厂商 |
|------|---------|------------|---------|
| `listProducts` | `(options?: ListProductsOptions) => Promise<Product[] \| PaginatedResult<Product>>` | **必须返回 `PaginatedResult<Product>`** | ❌ aliyun（返回 `Product[]`） |
| `getDocumentToc` | `(productId: string, options?: TocOptions) => Promise<TocItem[] \| PaginatedResult<TocItem>>` | **必须返回 `PaginatedResult<TocItem>`** | ❌ aliyun、huawei、bailian（返回 `TocItem[]`） |
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

### 私有辅助方法命名规范

所有适配器必须使用以下统一的私有方法命名：

| 方法 | 签名 | 用途 |
|------|------|------|
| `filterByKeywords` | `<T extends { name?: string; title?: string }>(items: T[], keyword?: string): T[]` | 按空格分隔的关键词 AND 逻辑过滤 |
| `paginate` | `<T>(items: T[], page?: number, pageSize?: number): PaginatedResult<T>` | 数组分页包装 |
| `parsePriceTable` | `(markdown: string, source?: string): PriceItem[]` | 从 Markdown 表格解析价格 |

**违规厂商：**
- ❌ aliyun：缺少 `filterByKeywords` 和 `paginate`（内联实现）
- ❌ huawei：缺少 `filterByKeywords` 和 `paginate`（内联实现）
- ❌ bailian：缺少 `filterByKeywords` 和 `paginate`（内联实现）
- ❌ deepseek：`filterByKeywords` 和 `paginate` 为私有方法（正确）
- ❌ glm：`filterByKeywords` 和 `paginate` 为私有方法（正确）
- ❌ minimax：`filterByKeywords` 和 `paginate` 为私有方法（正确）
- ❌ kimi：`filterByKeywords` 和 `paginate` ��私有方法（正确）
- ❌ baidu：`filterByKeywords` 和 `paginate` 为私有方法（正确）

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
- [ ] 包含 `filterByKeywords`、`paginate`、`parsePriceTable` 三个私有方法
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
| `list_products` | provider | 获取所有产品文档列表 |
| `get_document_toc` | provider, productId | 获取文档目录（支持 keyword 过滤） |
| `search_documents` | provider, productId, keyword | 搜索文档（支持关键词自动扩展） |
| `get_page_metadata` | provider, pageId | 获取页面元信息（contentPath 已统一为完整 URL） |
| `get_page_content` | provider, contentPath | 获取 Markdown 正文 |
| `get_product_price` | provider, productId? | 获取产品价格信息 |
| `get_product_price_quick` | provider, productId? | **快捷定价查询** — 直接返回已知定价页面 URL，绕过目录浏览 |

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
1. **优先使用 `get_product_price_quick`**：对于已知产品 ID 的场景，直接获取定价页面 URL
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

| 厂商 | 文档价格 | get_product_price | get_product_price_quick |
|------|---------|-------------------|------------------------|
| deepseek | `/quick_start/pricing` | ✅ 可用 | ✅ 支持 |
| minimax | `/docs/guides/pricing-paygo` | ✅ 可用 | ✅ 支持 |
| kimi | `/docs/pricing` | ✅ 可用 | ✅ 支持 |
| bailian | `/zh/model-studio/billing` | ✅ 可用 | ✅ 支持 |
| glm | `open.bigmodel.cn/pricing` | ⚠️ SPA 页面 | ✅ 支持 |
| ctyun | 文档计费说明 | ✅ 可用（需 productId） | ✅ 支持 |
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
get_product_price({ provider: "ctyun", productId: "11061839" })
get_product_price({ provider: "aliyun", productId: "model-studio" })
get_product_price({ provider: "volcengine" })
get_product_price({ provider: "volcengine", productId: "ECS" })
get_product_price({ provider: "tencent" })
get_product_price({ provider: "tencent", productId: "cvm" })
get_product_price({ provider: "huawei" })
get_product_price({ provider: "huawei", productId: "maas" })

# 快捷定价查询
get_product_price_quick({ provider: "tencent", productId: "cvm" })
get_product_price_quick({ provider: "aliyun", productId: "ecs" })
get_product_price_quick({ provider: "huawei", productId: "ecs" })
```

### 验证原则
- 每次代码变更后必须执行完整测试流程
- 所有 6 个工具都必须返回正确结果
- 检查返回数据格式是否符合预期
- 确保新增云厂商适配器后测试覆盖所有工具

## 开发工作流规范

### 全流程穿测（必须）

每次修改项目后，必须执行以下全流程穿测，确保基础功能和修改功能完全正常：

1. **编译检查**：`npx tsc --noEmit` 确保无类型错误（`test-fix.ts` 的预存错误除外）
2. **启动服务**：`npm run start` 确认 MCP Server 正常启动（stdio 模式）
3. **核心功能穿测**：使用 MCP Inspector 或直接调用工具，覆盖以下场景：
   - 至少 1 个传统云厂商（如 ctyun）的完整链路：`list_products` → `get_document_toc` → `search_documents` → `get_page_metadata` → `get_page_content`
   - 至少 1 个 AI 厂商（如 deepseek）的完整链路
   - 至少 1 个厂商的价格查询：`get_product_price` 或 `get_product_price_quick`
4. **修改专项测试**：对本次修改的函数进行针对性测试
   - 修改了返回类型 → 验证返回的 JSON 结构包含 `items`/`total`/`page`/`pageSize`/`hasMore`
   - 修改了 contentPath → 验证 `get_page_metadata` 返回的 contentPath 可被 `get_page_content` 消费
   - 修改了价格逻辑 → 验证 `get_product_price` 返回的 `dataStatus` 字段正确
5. **回归测试**：确保未修改的厂商功能不受影响

### 提交规范

每次修改完项目后，必须自行 commit，commit message 需详细说明修改点及缘由：

```bash
# 格式
git add <files>
git commit -m "类型: 简短描述

## 修改内容
- 修改点1：具体说明
- 修改点2：具体说明

## 修改缘由
- 缘由1：为什么这样改
- 缘由2：解决了什么问题

## 影响范围
- 影响的厂商/模块
- 是否需要更新文档"
```

**commit 类型前缀：**
| 前缀 | 用途 |
|------|------|
| `feat` | 新增功能/适配器 |
| `fix` | 修复 bug |
| `refactor` | 重构（不改变外部行为） |
| `style` | 代码风格调整 |
| `docs` | 文档更新 |
| `chore` | 构建/工具链变更 |

**禁止行为：**
- ❌ 不允许 `git commit -m "fix bug"` 这种无意义 message
- ❌ 不允许跳过测试直接 commit
- ❌ 不允许一次性 commit 大量无关修改（应拆分）

