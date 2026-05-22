# 天翼云文档搜索 MCP Server 设计文档

## 概述

将现有的天翼云文档搜索 SKILL 改造成标准 MCP Server，运行在 Cloudflare Pages 上，通过 Git 自动构建部署。改造后，任何支持 MCP 协议的客户端（Claude Code、Claude Desktop、Claude.ai 等）均可直接使用。

## 架构

```
Claude Host (Claude Code / Desktop / Claude.ai)
        │  streamable HTTP
        ▼
Cloudflare Pages Function (/mcp 路由)
        │
        ▼
MCP Server (TypeScript SDK + McpAgent)
        │
        ▼
天翼云公开 API (ListForHelp, ContentQuery, page/Get, contentPath)
```

## 部署模型

- **平台**: Cloudflare Pages（Functions）
- **部署方式**: Git push → 自动构建（Pages Git 集成）
- **运行时**: Cloudflare Workers 运行时（Pages Functions 底层）
- **框架**: `@modelcontextprotocol/sdk` + `agents`（Cloudflare McpAgent）

## 工具设计

共 5 个工具，每个对应一个天翼云 API 操作：

| 工具名 | 参数 | 返回 | 对应 API |
|--------|------|------|----------|
| `list_products` | 无 | 产品分类列表（含 bookId） | `ListForHelp` |
| `get_document_toc` | `bookId: string` | 文档目录树（pageId → 标题） | 从 HTML 提取 |
| `search_documents` | `bookId: string`, `keyword: string` | 匹配页面列表 | `ContentQuery` |
| `get_page_metadata` | `pageId: string` | 页面元信息 + contentPath | `page/Get` |
| `get_page_content` | `contentPath: string` | Markdown 正文 | contentPath URL |

所有工具标注 `readOnlyHint: true`（只读操作）。

## 项目结构

```
ctyun-docs-search/
├── src/
│   ├── index.ts          # Pages Function 入口 + McpAgent 定义
│   ├── api.ts            # 天翼云 API 封装（fetch 调用）
│   └── types.ts          # 类型定义
├── package.json
├── tsconfig.json
├── wrangler.toml         # Cloudflare Pages 配置
├── CLAUDE.md             # 更新为 MCP 项目说明
├── README.md             # 更新为 MCP Server 使用说明
└── skills/
    └── ctyun-docs-search/
        └── SKILL.md      # 保留作为参考
```

## 关键实现细节

### 1. API 封装（src/api.ts）

- 使用 `fetch` 直接调用天翼云 REST API
- 所有 API 无需认证（公开可访问）
- `_t` 参数使用当前时间戳

### 2. HTML 目录提取

`GetFolderBook` API 已废弃，目录需从 HTML 页面提取：
- 请求 `https://www.ctyun.cn/document/{bookId}/`
- 用正则提取所有 `/document/{bookId}/{数字}` 格式的链接
- 返回 pageId → 标题 的映射

### 3. MCP 协议处理（src/index.ts）

- 使用 Cloudflare `McpAgent` 处理 streamable HTTP 传输
- 注册 5 个工具，每个工具调用对应的 API 封装
- 工具返回格式：`{ content: [{ type: "text", text: JSON.stringify(data) }] }`

### 4. 配置（wrangler.toml）

- Pages Functions 配置
- `nodejs_compat` 兼容性标志
- Durable Objects 绑定（McpAgent 必需）

## 工作流程

### 标准查询流程
1. 用户提问 → Claude 调用 `list_products` 获取产品列表
2. 匹配产品获取 bookId
3. 调用 `get_document_toc` 获取目录，或 `search_documents` 搜索关键词
4. 调用 `get_page_metadata` 获取 contentPath
5. 调用 `get_page_content` 获取 Markdown 正文
6. Claude 基于文档内容回答用户

### 已知 bookId 快速查询
如果已知 bookId（如 10027004），可直接从步骤 3 开始。

## 注意事项

- `GetFolderBook` API 已废弃，目录必须从 HTML 提取
- 所有工具为只读操作，不修改任何数据
- 天翼云 API 无需认证，直接调用
- 文档内容以 Markdown 格式返回
