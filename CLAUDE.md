# CLAUDE.md

## 项目概述

多云文档搜索 MCP Server。支持多云厂商文档搜索和获取，采用适配器架构便于扩展。

## 技术栈

- TypeScript + `@modelcontextprotocol/sdk`
- 本地 stdio 模式运行（`tsx` 直接执行）
- 保留 Cloudflare Workers 兼容性（`src/index.ts`），但不部署

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
| `get_document_toc` | provider, productId | 获取文档目录 |
| `search_documents` | provider, productId, keyword | 搜索文档 |
| `get_page_metadata` | provider, pageId | 获取页面元信息 |
| `get_page_content` | provider, contentPath | 获取 Markdown 正文 |

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
- 详细 API 规范见 `skills/multi-cloud-docs-search/SKILL.md`

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

### 验证原则
- 每次代码变更后必须执行完整测试流程
- 所有 5 个工具都必须返回正确结果
- 检查返回数据格式是否符合预期
- 确保新增云厂商适配器后测试覆盖所有工具
