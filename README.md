# ctyun-docs-search

天翼云文档搜索 MCP Server — 在 Claude 中直接搜索和获取天翼云官方产品文档。

## 快速开始

### 在 Claude 中添加

1. 打开 Claude → Settings → Connectors
2. 选择 Add Custom Connector
3. 输入 MCP Server URL：
   ```
   https://ctyun-docs-search.<你的pages域名>.pages.dev/mcp
   ```
4. 保存后即可使用

### 工作原理

```
用户提问 → 自动调用 MCP 工具 → 搜索天翼云文档 → 返回内容 → Claude 回答
```

## 可用工具

| 工具 | 说明 |
|------|------|
| `list_products` | 获取所有产品文档分类列表 |
| `get_document_toc` | 获取指定产品的文档目录 |
| `search_documents` | 在产品文档中搜索关键词 |
| `get_page_metadata` | 获取页面元信息 |
| `get_page_content` | 获取文档 Markdown 正文 |

## 本地开发

```bash
# 安装依赖
npm install

# 本地启动
npm run dev

# 部署（Git push 自动构建）
git push origin main
```

## 项目结构

```
├── functions/mcp.ts    # MCP Server Pages Function 入口
├── src/
│   ├── api.ts          # 天翼云 API 封装
│   └── types.ts        # 类型定义
├── package.json
├── tsconfig.json
└── wrangler.toml
```

## 许可证

MIT
