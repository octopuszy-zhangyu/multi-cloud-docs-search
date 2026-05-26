# ctyun-docs-search

多云文档搜索 MCP Server — 在 Claude 中直接搜索和获取云厂商官方产品文档。采用适配器架构，支持多云厂商扩展。

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
用户提问 → 自动调用 MCP 工具 → 搜索云厂商文档 → 返回内容 → Claude 回答
```

## 可用工具

所有工具第一个参数为 `provider`（云厂商标识）。

| 工具 | 参数 | 说明 |
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
src/
├── index.ts                  # Cloudflare Worker 入口 (McpAgent)
├── stdio.ts                  # 本地 stdio 模式入口
├── types.ts                  # 类型定义
├── adapters/
│   ├── index.ts              # 适配器工厂 getAdapter(provider)
│   ├── base.ts               # 抽象基类 CloudDocAdapter
│   ├── ctyun.ts              # 天翼云适配器
│   ├── aliyun.ts             # 阿里云适配器
│   ├── volcengine.ts         # 火山引擎适配器
│   ├── tencent.ts            # 腾讯云适配器
│   ├── huawei.ts             # 华为云适配器
│   └── ecloud.ts             # 移动云适配器
└── utils/
    └── html-to-md.ts         # HTML 转 Markdown 工具
```

## 部署与验证

### 部署
代码 push 到 GitHub 后，Cloudflare Pages 会自动构建部署。

### 验证
部署后使用 MCP 工具测试所有 5 个核心功能：

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
```

## 许可证

MIT
