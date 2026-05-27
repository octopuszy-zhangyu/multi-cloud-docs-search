# multi-cloud-docs-search

多云文档搜索 MCP Server — 在 AI 编程助手中直接搜索和获取云厂商官方产品文档。采用适配器架构，支持多云厂商扩展。

## 安装（MCP 配置）

无需手动 clone 或安装，直接在 AI 助手的 MCP 配置中添加以下 stdio 命令即可。

### Claude Code / Claude CLI

在 `~/.claude/settings.json` 中添加：

```json
{
  "mcpServers": {
    "multi-cloud-docs-search": {
      "command": "npx",
      "args": ["multi-cloud-docs-search"]
    }
  }
}
```

### Cursor

在 Cursor Settings → Extensions → MCP 中添加：

```json
{
  "mcpServers": {
    "multi-cloud-docs-search": {
      "command": "npx",
      "args": ["multi-cloud-docs-search"]
    }
  }
}
```

### OpenCode

在 `~/.opencode/settings.json` 中添加：

```json
{
  "mcpServers": {
    "multi-cloud-docs-search": {
      "command": "npx",
      "args": ["multi-cloud-docs-search"]
    }
  }
}
```

### Windsurf

在 `~/.codeium/windsurf/settings.json` 中添加：

```json
{
  "mcpServers": {
    "multi-cloud-docs-search": {
      "command": "npx",
      "args": ["multi-cloud-docs-search"]
    }
  }
}
```

### 通用配置（任意支持 MCP 的客户端）

```json
{
  "mcpServers": {
    "multi-cloud-docs-search": {
      "command": "npx",
      "args": ["multi-cloud-docs-search"]
    }
  }
}
```

> **说明**：`npx multi-cloud-docs-search` 会自动从 npm 下载并执行，无需手动 clone 或构建。国内用户如果 npm 访问慢，可设置 npm 镜像源（见下方说明）。

### 国内镜像（可选）

如果 npm 访问慢，可设置国内镜像源：

```bash
npm config set registry https://registry.npmmirror.com/
```

然后正常使用 `npx multi-cloud-docs-search` 即可。

### 工作原理

```
用户提问 → AI 自动调用 MCP 工具 → 搜索云厂商文档 → 返回内容 → AI 回答
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
| cucloud | 联通云 | 已实现 |

## 本地开发

```bash
# 克隆项目
git clone https://gh-proxy.com/github.com/octopuszy-zhangyu/multi-cloud-docs-search.git
cd multi-cloud-docs-search

# 安装依赖
npm install

# 启动 MCP Server（stdio 模式）
npm run start

# 开发模式（文件监听）
npm run dev

# TypeScript 编译检查
npm run build
```

## 项目结构

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
│   ├── huawei.ts             # 华为云适配器
│   ├── ecloud.ts             # 移动云适配器
│   └── cucloud.ts            # 联通云适配器
└── utils/
    └── html-to-md.ts         # HTML 转 Markdown 工具
```

## 验证

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
```

## 许可证

GPL-3.0
