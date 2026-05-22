# CLAUDE.md

## 项目概述

天翼云文档搜索 MCP Server。提供 5 个 MCP 工具用于搜索和获取天翼云官方产品文档。

## 技术栈

- TypeScript + `@modelcontextprotocol/sdk` + Cloudflare `McpAgent`
- 部署在 Cloudflare Pages（Git push 自动构建）

## 核心工具

| 工具 | 用途 |
|------|------|
| `list_products` | 获取所有产品文档列表 |
| `get_document_toc` | 从 HTML 提取产品文档目录 |
| `search_documents` | 在产品文档中按关键词搜索 |
| `get_page_metadata` | 获取文档页面元信息和 contentPath |
| `get_page_content` | 获取文档 Markdown 正文 |

## 常用命令

```bash
npm run dev      # 本地开发
npm run build    # 构建
```

## 常用产品 bookId

| 产品名称 | bookId |
|---------|--------|
| 天翼云电脑（政企版） | 10027004 |
| 弹性云主机 ECS | 10026730 |

## 注意事项

- `GetFolderBook` API 已废弃，目录需从 HTML 页面提取
- 所有工具为只读操作
- 天翼云 API 无需认证
- 详细 API 规范见 `skills/ctyun-docs-search/SKILL.md`
