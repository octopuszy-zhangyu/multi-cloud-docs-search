# CLAUDE.md

## 项目概述

多云文档搜索 MCP Server。支持多云厂商文档搜索和获取，采用适配器架构便于扩展。

## 技术栈

- TypeScript + `@modelcontextprotocol/sdk` + Cloudflare `McpAgent`
- 部署在 Cloudflare Pages（Git push 自动构建）

## 项目架构

```
src/
├── index.ts                  # Cloudflare Worker 入口 (McpAgent)
├── stdio.ts                  # 本地 stdio 模式入口
├── types.ts                  # 类型定义
├── adapters/
│   ├── index.ts              # 适配器工厂 getAdapter(provider)
│   ├── base.ts               # 抽象基类 CloudDocAdapter
│   └── ctyun.ts              # 天翼云适配器
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
