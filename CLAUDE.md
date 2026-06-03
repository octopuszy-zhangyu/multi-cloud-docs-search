# CLAUDE.md

多云文档搜索 MCP Server。适配器架构，支持 14 个云厂商文档搜索与价格获取。

**技术栈：** TypeScript + `@modelcontextprotocol/sdk`，stdio 模式运行（`tsx` 直接执行）。

## 项目架构

```
src/
├── stdio.ts              # MCP Server 主入口：工具注册、参数校验、响应格式化
├── types.ts              # 天翼云 API 响应类型 + 导出 base.ts 类型
├── adapters/
│   ├── index.ts          # 适配器工厂 getAdapter() + getSupportedProviders()
│   ├── base.ts           # 抽象基类 + 全部共享类型定义 + 基础工具方法
│   └── *.ts              # 各厂商适配器：只实现 6 个抽象方法
└── utils/
    └── html-to-md.ts     # HTML 转 Markdown 工具函数
```

**原则：** 一个文件一个职责。适配器只关注"如何获取该厂商的数据"，不关注"数据如何被 MCP 工具消费"。

## 核心工具

| 工具 | 参数 | 用途 |
|------|------|------|
| `list_products` | provider | 获取产品文档列表（**优先用 keyword 搜索**，不传 keyword 返回全量需翻页） |
| `get_document_toc` | provider, productId | 获取文档目录（支持 keyword 过滤） |
| `search_documents` | provider, productId, keyword | 搜索文档（支持关键词自动扩展） |
| `get_page_metadata` | provider, pageId | 获取页面元信息（contentPath 已统一为完整 URL） |
| `get_page_content` | provider, contentPath | 获取 Markdown 正文 |
| `get_product_price` | provider, productId? | 获取产品价格（动态获取实时数据） |

### 调用规范

1. **先目录，后搜索**：优先 `get_document_toc` 浏览目录，迫不得已再 `search_documents`
2. **metadata → content 不可颠倒**：先 `get_page_metadata` 获取 contentPath，再传给 `get_page_content`，不能跳过 metadata 构造 URL
3. **并行调用**：无依赖的调用应并行执行（`Promise.all`）
4. **搜索关键词要宽泛**：用"计费""价格""规格"，不要用"价格 4C8G"
5. **关键词自动扩展**：`search_documents` 返回空时，系统自动去掉具体规格词（如 4C8G、5M）后重搜

### 价格查询流程

1. **`get_product_price` 直接调用**：获取实时价格数据
2. **`search_documents` 搜宽泛关键词**：用"价格""计费"等（文档找不到价格时回退）

## 适配器统一规范（重要）

所有适配器必须严格遵循以下规范。

### 返回类型

| 方法 | 基类签名 | 必须返回 |
|------|---------|---------|
| `listProducts` | `(options?: ListProductsOptions) => Promise<PaginatedResult<Product>>` | `PaginatedResult<Product>` ✅ |
| `getDocumentToc` | `(productId: string, options?: TocOptions) => Promise<PaginatedResult<TocItem>>` | `PaginatedResult<TocItem>` ✅ |
| `searchDocuments` | `(productId: string, keyword: string) => Promise<SearchResult[]>` | `SearchResult[]` ✅ |
| `getPageMetadata` | `(pageId: string) => Promise<PageMetadata>` | `PageMetadata` ✅ |
| `getPageContent` | `(contentPath: string) => Promise<string>` | `string` ✅ |
| `getProductPrice` | `(productId?: string, options?: PriceQueryOptions) => Promise<PriceResult>` | `PriceResult` ✅ |

### contentPath 格式

| 厂商 | contentPath 格式 | 说明 |
|------|-----------------|------|
| ctyun | 相对路径 `/document/10027004/10028086` | stdio.ts 中自动补全 URL |
| aliyun | 完整 URL | 已在 getPageMetadata 补全 |
| volcengine | `productId/docId` | 特殊格式，getPageContent 内部解析 |
| tencent | 完整 URL | 已在 getPageMetadata 补全 |
| huawei | 完整 URL | 已在 getPageMetadata 补全 |
| ecloud | hash 字符串 | 特殊格式，getPageContent 内部解析 |
| cucloud | 完整 URL | 已在 getPageMetadata 补全 |
| deepseek | 完整 URL | 已在 getPageMetadata 补全 |
| glm | 相对路径 `/cn/guide/start/quick-start` | stdio.ts 中自动补全 URL |
| minimax | 完整 URL | 已在 getPageMetadata 补全 |
| kimi | 完整 URL | 已在 getPageMetadata 补全 |
| baidu | 完整 URL | 已在 getPageMetadata 补全 |
| bailian | 完整 URL | 已在 getPageMetadata 补全 |

**规范：** 返回相对路径的适配器，在 stdio.ts 的 `get_page_metadata` 中统一补全 URL。特殊格式（volcengine、ecloud）保持原样。

### pageId 格式

| 厂商 | 格式 | 示例 |
|------|------|------|
| ctyun | 纯数字 | `10028086` |
| aliyun | 文档路径 | `/zh/ecs/user-guide/what-is-ecs` |
| volcengine | `productId/docId` | `6396/12345` |
| tencent | `productId/pageId` | `213/495` |
| huawei | `productId/docPath` | `ecs/productdesc-ecs/ecs_01_0073` |
| ecloud | 纯数字 | `41800` |
| cucloud | 纯数字 | `12345` |
| deepseek | 路径（`/` 开头） | `/quick_start/pricing` |
| glm | 路径（`/` 开头） | `/cn/guide/start/quick-start` |
| minimax | 路径（`/` 开头） | `/docs/api-reference/models/...` |
| kimi | 路径（`/` 开头） | `/docs/pricing/chat-k26` |
| baidu | `productId/s/SLUG` | `BCC/s/8kbbkwg4p` |
| bailian | 路径（`/` 开头） | `/zh/model-studio/billing` |

### 基类可重用方法

| 方法 | 用途 |
|------|------|
| `filterByKeywords<T>(items, keyword?)` | 空格分词 AND 逻辑过滤 |
| `paginate<T>(items, page?, pageSize?)` | 数组分页包装 |
| `paginateProducts(products, options?)` | `filterByKeywords` + `paginate` 快捷方法 |
| `determineDataStatus(prices)` | 根据价格数组判断 `"complete"\|"partial"\|"no_price"\|"no_data"` |
| `makePriceResult(prices, extra?)` | 构造 PriceResult（自动设置 dataStatus） |
| `parseMarkdownTable(markdown)` | 解析 Markdown 表格行 |

**注意：** 新增适配器直接调用基类方法，不要自己实现 `filterByKeywords` 和 `paginate`。`parsePriceTable` 需自行实现（各厂商价格表格格式不同）。

### PriceItem / PriceResult 类型规范

**PriceItem 字段：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `productName` | `string` | ✅ | 产品/规格名称 |
| `billingMode` | `string` | ✅ | 计费模式：`"包月"`、`"包年"`、`"按量"`、`"包年包月"` |
| `price` | `number` | ✅ | 价格数值 |
| `unit` | `string` | ✅ | 价格单位：`"元/月"`、`"元/小时"`、`"元/核/月"` |
| `region` | `string` | ❌ | 地域名称 |
| `componentType` | `string` | ❌ | 组件类型：如 `"云电脑"`、`"磁盘"`、`"VM"` |

**已移除：** `specification` → 合并到 productName，`currency` → 默认人民币，`source`/`note` → 由 stdio.ts 统一处理

**PriceResult 字段：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `provider` | `string` | ✅ | 厂商标识 |
| `name` | `string` | ✅ | 厂商名称 |
| `prices` | `PriceItem[]` | ✅ | 价格条目数组 |
| `dataStatus` | `string` | ✅ | 数据完整性标记 |
| `updateDate` | `string` | ❌ | 数据更新日期 |
| `message` | `string` | ❌ | 额外提示信息 |
| `total`/`page`/`pageSize`/`hasMore` | - | ❌ | 分页字段 |

**已移除：** `source`、`note`

### 价格获取规范

1. 返回 `PriceResult`，包含 `dataStatus` 字段
2. `dataStatus` 取值：`"complete"` | `"partial"` | `"no_price"` | `"no_data"`
3. 用 `makePriceResult(prices, extra?)` 构造（自动设置 dataStatus）
4. 无价格数据时返回 `prices: []`，不设 `note` 字段（stdio.ts 统一处理）

### stdio.ts 价格过滤规则

1. **AND 逻辑**：keyword 空格分词，每个词必须匹配 productName / region / billingMode
2. **计费模式近义词**：`"按量"` 匹配 按量/按需/按量计费/按需计费/后付费/postpaid/hourly/日单价；`"包年包月"` 匹配 包年包月/包月/包年/预付费/prepaid/monthly/yearly
3. **规格自动扩展**：精确匹配为空时自动尝试变体（如 `"4C8G"` → `["4核", "8GB"]`）

### 错误处理

**适配器层：**
- 网络请求用基类 `fetchWithRetry`（自动重试 2 次），失败时抛出 Error
- 数据解析用 try/catch 包裹，单个页面失败不中断整体流程
- 空结果返回空数组/空对象，不抛异常
- `getProductPrice` 无 productId 时返回空 `PriceResult`

**MCP 工具层（stdio.ts）：**
- 所有工具用 try/catch 包裹整个业务逻辑
- 异常返回标准错误 JSON：`{ error, message, provider, suggestion }`
- 不抛出异常到 MCP SDK 层

### 新增适配器检查清单

- [ ] 实现全部 6 个抽象方法
- [ ] `listProducts` / `getDocumentToc` 返回 `PaginatedResult`
- [ ] `searchDocuments` 返回 `SearchResult[]`
- [ ] `getPageMetadata` 返回 `PageMetadata`（contentPath 可被 stdio.ts 消费）
- [ ] `getPageContent` 返回 Markdown 字符串
- [ ] `getProductPrice` 返回 `PriceResult`（含 dataStatus）
- [ ] 利用基类 `filterByKeywords`、`paginate`、`paginateProducts`、`makePriceResult`
- [ ] 自行实现 `parsePriceTable`（各厂商格式不同）
- [ ] PriceItem 无 specification/currency/source/note 字段
- [ ] 用 `makePriceResult(prices, extra?)` 构造（无 source 参数）
- [ ] 在 `adapters/index.ts` 注册
- [ ] 在 `stdio.ts` instructions 中添加厂商说明
- [ ] 更新 CLAUDE.md 厂商列表和价格策略表

## 各厂商注意事项

| 厂商 | 关键点 |
|------|--------|
| **ctyun** | API 无需认证；ECS 价格：获取 cookie → 地域 → flavor UUID → 并行查包月/按量（`proxyv3/querynew`）；云电脑价格：分批并发（每批 ≤10），componentType 区分云电脑/磁盘，Set 去重 |
| **aliyun** | API 返回 JSON 目录树，内容需 HTML→Markdown；ECS 价格通过 `buy-api.aliyun.com/pricingDetail/queryPricingDetailList.json` 获取实例/系统盘/数据盘/带宽四种组件价格 |
| **volcengine** | API 无需认证，文档直接返回 Markdown（`MDContent` 字段） |
| **tencent** | 文档 SSR 渲染，内容需 HTML→Markdown；产品 ID 数字（213=CVM），pageId 格式 `productId/pageId` |
| **huawei** | 通过公开 API 获产品列表，目录通过 `v3_support_leftmenu_fragment.html` 加载；内容需 HTML→Markdown，自动提取正文区域去页头页脚 |
| **ecloud** | 首页 SSR 渲染（HTML 为空），通过 API 获产品列表/目录；内容通过 API 返回 HTML；可能屏蔽 CF Workers IP，本地 stdio 正常 |
| **cucloud** | 首页 HTML 嵌入 `finalResConfig` JSON；文档详情页 Vue SPA 有反爬（JS 混淆 + debugger），getPageContent 返回搜索 API 摘要；搜索 API `gateway.cucloud.cn/search/` 正常访问 |
| **bailian** | 托管在阿里云帮助中心，productId=`model-studio`，目录从 HTML 解析（JSON API 返回 302） |
| **baidu** | 静态 HTML，产品列表从首页解析，文档内容从 `.post__body` 容器提取 |
| **deepseek** | Docusaurus 静态站点，通过 sitemap.xml 获取目录 |
| **glm** | Mintlify 站点，通过 llms.txt 获目录，llms-full.txt 获完整内容 |
| **minimax** | 直接返回 Markdown，通过 llms.txt 获目录 |
| **kimi** | Mintlify 站点，通过 llms.txt 获目录，内容需 HTML→Markdown |

## 价格获取策略

| 厂商 | 文档价格 | get_product_price |
|------|---------|-------------------|
| deepseek/minimax/kimi | 定价文档 | ✅ 可用 |
| bailian | `/zh/model-studio/billing` | ✅ 文档解析 |
| glm | `open.bigmodel.cn/pricing` SPA | ⚠️ SPA |
| ctyun | 文档计费说明 | ✅ 内部价格计算器 API（ECS 规格询价 + 云电脑组件价格） |
| aliyun | 文档计费说明 | ✅ ECS：价格计算器 API（实例/系统盘/数据盘/带宽）；百炼：文档解析 |
| volcengine | 文档计费规则 | ✅ GetTable API |
| tencent | 文档计费说明 | ✅ CVM API |
| huawei | 文档计费说明 | ✅ export/productlist API（标注来源） |
| ecloud | 文档价格页面 | ⚠️ 待完善 |
| cucloud | 文档价格页面 | ⚠️ 待完善 |
| baidu | 产品页内嵌数据 | ⚠️ 待完善 |

## 常用产品 bookId

| 产品 | bookId | 厂商 |
|------|--------|------|
| 天翼云电脑（政企版） | 10027004 | ctyun |
| 弹性云主机 ECS | 10026730 | ctyun |
| 对象存储 TOS | 6349 | volcengine |
| 云服务器 ECS | 6396 | volcengine |
| 云服务器 CVM | 213 | tencent |
| TokenHub | 1823 | tencent |
| 弹性云服务器 ECS | ecs | huawei |
| 对象存储 OBS | obs | huawei |
| 云主机 ECS | 706 | ecloud |
| 对象存储 EOS | 729 | ecloud |
| 云服务器 ECS | 128 | cucloud |
| AISP | 2357 | cucloud |
| Token 服务 | 11061839 | ctyun |
| 百炼 | model-studio | bailian |
| MaaS | maas | huawei |
| MoMA | 1456 | ecloud |
| AICP | 1398 | cucloud |
| BML | BML | baidu |

## 代码质量规范

### 导入规范

```typescript
// ✅ 正确
import * as cheerio from "cheerio";
import { htmlToMarkdown } from "../utils/html-to-md.js";
import { CloudDocAdapter, type Product, type TocItem } from "./base.js";

// ❌ 禁止
import { CloudDocAdapter, Product } from "./base.js"; // Product 未用 type 关键字
import { unusedVar } from "./base.js"; // 未使用的导入
```

### 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 类名 | PascalCase | `CtyunAdapter` |
| 方法/变量 | camelCase | `getDocumentToc` |
| 常量 | UPPER_SNAKE_CASE | `BASE_URL` |
| 类型/接口 | PascalCase | `PriceResult` |
| 文件名 | kebab-case | `ctyun.ts` |
| 私有方法 | camelCase（无 `_` 前缀） | `filterByKeywords` |

### 禁止模式

| 禁止 | 原因 | 替代 |
|------|------|------|
| `as any` | 绕过类型检查 | 正确类型定义 |
| `@ts-ignore` / `@ts-nocheck` | 隐藏类型错误 | 修复类型或类型守卫 |
| `!` 非空断言 | 运行时可能崩溃 | 可选链 `?.` 或类型守卫 |
| `console.log`（生产代码） | 污染 stdout（MCP 协议通道） | `console.error` |
| `any` | 丧失类型安全 | `unknown` + 类型守卫 |
| 空 catch 块 | 吞咽错误 | 至少 `console.error` |
| `process.exit()`（库代码） | 杀死宿主进程 | 抛出错误 |

### 异步编程

- 用 `async/await`，禁止裸 `.then()`/`.catch()`
- 并行请求用 `Promise.all()`，禁止串行 await
- 用基类 `fetchWithRetry`（自动重试 2 次），不自己写重试
- 捕获异常用 `instanceof Error` 判断

```typescript
// ✅ 并行
const [toc, price] = await Promise.all([
  adapter.getDocumentToc(productId),
  adapter.getProductPrice(productId),
]);

// ❌ 串行
const toc = await adapter.getDocumentToc(productId);
const price = await adapter.getProductPrice(productId);
```

### 性能要求

- **并行请求**：循环查多地域/产品时用 `Promise.all`
- **分批并发**：大量请求时（如天翼云电脑价格），每批 ≤10 个，避免连接池耗尽
- **去重**：价格查询用 Set 记录 dedup key
- **缓存**：频繁访问的数据（产品列表、llms.txt）用私有缓存变量
- **分页**：`listProducts` 和 `getDocumentToc` 返回大列表时必须分页
- **超时**：所有网络请求有超时控制（基类默认 15 秒）
- **并发限制**：`Promise.all` 并发数 ≤20

### 安全要求

- 所有工具只读，禁止写入/修改/删除
- API 密钥/token 禁止硬编码
- 用户输入 URL 参数必须校验格式，禁止 SSRF
- HTML 提取文本用 cheerio 安全解析，禁止正则直接提取

## 开发流程

### 常用命令

```bash
npm run start      # 启动 MCP Server
npm run dev        # 开发模式（文件监听）
npm run build      # TypeScript 编译检查
npm run test       # 适配器层测试 + 数据质量验证（本项目的主要测试命令）
npm run test:mcp   # MCP 协议层测试（独立启动 Server）
npm run test:retest # 修复复测（只测上次失败的用例）
# MCP Inspector 调试：
npx @modelcontextprotocol/inspector npx tsx src/stdio.ts
```

### 提交规范

格式：`类型: 简短描述（≤50 字）`

| 类型 | 用途 | 示例 |
|------|------|------|
| `feat` | 新增功能/适配器 | `feat: 新增青云适配器` |
| `fix` | 修复 bug | `fix: 华为云 getDocumentToc 返回类型错误` |
| `refactor` | 重构 | `refactor: 统一适配器返回类型为 PaginatedResult` |
| `style` | 代码风格 | `style: 统一 filterByKeywords 命名` |
| `docs` | 文档更新 | `docs: 更新适配器规范` |
| `chore` | 构建/工具链 | `chore: 升级 typescript 到 5.x` |

### 自我审查清单（commit 前）

- [ ] 编译通过（`npx tsc --noEmit`）
- [ ] 无 `console.log`（生产用 `console.error`）
- [ ] 无 `as any` / `@ts-ignore` / `!` 非空断言
- [ ] 所有函数参数有明确类型注解
- [ ] 新增适配器在 `index.ts` 注册
- [ ] 返回类型符合基类签名
- [ ] 异常路径有 try/catch 处理
- [ ] 价格查询返回了 `dataStatus`
- [ ] PriceItem 无 specification/currency/source/note
- [ ] 用 `makePriceResult(prices, extra?)` 构造（无 source 参数）
- [ ] 全流程穿测通过（`npm run test`）
- [ ] 数据质量检查：抽样验证字段完整性、无异常数据
- [ ] 检查 `scripts/lib/types.ts` 中 `TEST_PROVIDERS` 配置是否完整

### 验证指标

| 检查项 | 通过标准 |
|--------|---------|
| PaginatedResult 结构 | 含 items/total/page/pageSize/hasMore |
| contentPath 可用性 | getPageContent 返回非空 Markdown |
| dataStatus 完整性 | 不为 undefined |
| 搜索功能 | 返回结果数组，非空时含 pageId |
| 编译 | `tsc --noEmit` 0 错误 |

### 全量穿测规范

每次代码变更后，必须运行全量穿测脚本，确保所有云厂商的 6 个核心工具函数返回正确结果。

#### 测试架构

测试系统分为三层，覆盖不同维度的验证：

```
┌─────────────────────────────────────────────────────┐
│                  测试编排层                           │
│  scripts/test-all-providers.ts (主入口)              │
│  读取配置 → 按厂商/产品循环 → 收集结果 → 生成报告     │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
┌─────────────────┐ ┌──────────┐ ┌──────────────────┐
│  适配器层测试     │ │ MCP协议层 │ │  数据质量验证层    │
│  (直接调用函数)   │ │ (JSON-RPC)│ │  (内容抽样/异常)   │
│  快速验证逻辑     │ │ 端到端验证│ │  深度检查数据      │
└─────────────────┘ └──────────┘ └──────────────────┘
```

#### 测试命令

| 命令 | 模式 | 用途 | 速度 |
|------|------|------|------|
| `npm run test` | 适配器层 | 快速验证 + 数据质量检查 | ~2min |
| `npm run test:mcp` | MCP 协议层 | 独立启动 Server 端到端测试 | ~3min |
| `npm run test:retest` | 修复复测 | 只测上次失败的用例 | 最快 |

#### 测试脚本结构

```
scripts/
├── test-all-providers.ts      # 主入口 - 适配器层测试 + 数据质量验证
├── test-mcp-protocol.ts       # MCP 协议层测试（独立启动 Server）
├── test-retest.ts             # 修复复测（读取上次失败记录）
├── lib/
│   ├── types.ts               # 共享类型定义 + 测试配置
│   ├── reporter.ts            # 报告生成器（终端 + JSON + Markdown）
│   ├── quality.ts             # 数据质量验证（内容抽样 + 异常检测）
│   └── mcp-client.ts          # MCP JSON-RPC 客户端
└── reports/                   # 测试报告输出目录
```

#### 测试产品覆盖

测试覆盖三类核心产品：**ECS**、**云电脑/云桌面**、**Token/模型服务**。

| 厂商 | ECS | 云电脑/云桌面 | Token/模型服务 |
|------|-----|--------------|---------------|
| **ctyun** | ✅ 10026730 | ✅ 10027004 (云电脑) | ✅ 11061839 (Token服务) |
| **aliyun** | ✅ ecs | ✅ wuying-workspace (无影云电脑) | - |
| **volcengine** | ✅ 6396 | ❌ 无此产品 | ✅ 火山方舟 (定价页) |
| **tencent** | ✅ 213 | ✅ 1291 (云桌面) | ✅ 1823 (TokenHub) |
| **huawei** | ✅ ecs | ✅ workspace (云桌面) | ✅ maas (MaaS模型即服务) |
| **ecloud** | ✅ 706 | ✅ 1246 (云电脑) | ✅ 1456 (MoMA模型服务) |
| **cucloud** | ✅ 128 | ✅ 2267 (联通云桌面) | ✅ 2357 (AISP AI服务) |
| **baidu** | BCC | ❌ 无此产品 | ✅ BML (AI开发平台) |
| **deepseek** | - | - | ✅ (API定价=Token价格) |
| **glm** | - | - | ✅ (API定价=Token价格) |
| **minimax** | - | - | ✅ (API定价=Token价格) |
| **kimi** | - | - | ✅ (API定价=Token价格) |
| **bailian** | - | - | ✅ (API定价=Token价格) |

#### 穿测覆盖范围

| 工具函数 | 测试内容 | 验证标准 |
|----------|---------|---------|
| `list_products` | 每个厂商调用一次 | 返回 `PaginatedResult`，含 items/total/page/pageSize/hasMore |
| `get_document_toc` | 每个产品调用一次 | 返回 `PaginatedResult`，total > 0 |
| `search_documents` | 每个产品搜索"价格" | 返回 `SearchResult[]`，格式正确 |
| `get_page_metadata` | 从目录取第一个有效 pageId | 返回 `PageMetadata`，含 title/contentPath |
| `get_page_content` | 用 metadata 的 contentPath | 返回非空 Markdown 字符串 |
| `get_product_price` | 每个产品调用一次 | 返回 `PriceResult`，含 dataStatus/prices |

#### 数据质量验证

测试不只看数据返回条数，更进行抽样检查，避免有数据但是异常数据：

| 检查项 | 检测内容 | 严重度 |
|--------|---------|--------|
| 字段完整性 | 必填字段是否为空 | error |
| 字段合理性 | price 是否为负数、title 是否过长 | error/warning |
| HTML 残留 | productName 是否包含 `<tag>` 标签 | warning |
| 编码问题 | 是否包含乱码字符 | error |
| 重复数据 | 相同 pageId/title 出现多次 | warning |
| 格式一致性 | 所有条目的字段结构是否一致 | warning |

#### 测试报告

每次测试生成三种格式的报告：

1. **终端输出**：彩色实时显示，包含失败详情和堆栈
2. **JSON 报告** (`reports/test-report-{timestamp}.json`)：机器可解析，含完整 debug 信息
3. **Markdown 报告** (`reports/test-report-{timestamp}.md`)：可读性强，含修复建议

#### 修复流程

```
测试失败 → 生成报告（含 debug 信息：请求参数、响应数据、堆栈）
    ↓
分析根因 → 生成修复建议（写入报告）
    ↓
执行修复（手动或自动）
    ↓
npm run test:retest → 只测失败用例
    ↓
全部通过 → 全量回归测试 (npm run test)
```

#### 穿测通过标准

1. **所有厂商 6 个工具函数全部通过**（已知问题除外）
2. **已知问题**（如 volcengine API 变更）需在测试结果中明确标记，并在 FAQ 中记录
3. **新增适配器**必须 6/6 全部通过
4. **回归测试**确保未修改厂商不受影响

#### 失败处理

| 失败类型 | 处理方式 |
|----------|---------|
| 新增适配器失败 | 必须修复后才能提交 |
| 已有厂商回归失败 | 检查是否因代码变更导致，修复或回退 |
| 厂商 API 变更 | 更新适配器适配新 API，更新 FAQ |
| 网络超时 | 重试 2 次，仍失败则标记为环境问题 |

#### 测试配置

测试配置位于 `scripts/lib/types.ts` 中的 `TEST_PROVIDERS` 常量。**新增适配器时**，必须在此配置中添加对应的测试产品（ECS + 云电脑 + Token 三类）。

#### 验证原则
- 每次代码变更后必须执行编译检查 + 全量穿测
- 覆盖：所有 13 个云厂商的 6 个核心工具函数
- 检查返回数据格式符合预期
- 数据质量验证：抽样检查字段完整性、合理性、异常数据
- 回归测试确保未修改厂商不受影响
- 新增适配器必须 6/6 全部通过

## FAQ

| 问题 | 原因 | 解决 |
|------|------|------|
| `getDocumentToc` 返回空 | 厂商文档站改版/API 变化 | 检查 HTML 结构 |
| `getPageContent` 返回空或 HTML | 页面为 SPA 渲染 | 检查厂商前端框架 |
| `getProductPrice` 返回 `dataStatus: "no_price"` | 厂商文档不列价格 | 访问官网价格计算器 |
| 编译错误 `not assignable to type` | 返回类型与基类不匹配 | 检查签名一致性 |
| 中文乱码 | 编码检测失败 | 天翼云用 GBK 编码检测器 |
| volcengine get_page_metadata 报错 `Cannot read properties of undefined` | 火山引擎文档 API `/api/doc/getDocDetail` 已不再公开返回文档内容（HasPass=false） | 需要重新研究内容获取方式（如解析 HTML 页面），当前 getDocList API 仍正常工作 |
| MCP 无响应 | stdout 被 `console.log` 污染 | 改为 `console.error` |
| 中文乱码 | 编码检测失败 | 天翼云用 GBK 编码检测器 |
| 测试报告显示大量重复价格数据 | 部分厂商（华为云、腾讯云）价格数据按地域/规格重复，属于正常业务数据 | 检查重复 key 是否合理，如 `productName` 相同但 `region` 不同则正常 |
| 测试报告显示 HTML 残留 | 部分厂商（MiniMax）的 productName 包含 `<br />` 等 HTML 标签 | 需要在适配器中清理 HTML 标签后再返回 |