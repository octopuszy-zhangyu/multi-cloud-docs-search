# multi-cloud-docs-search

多云文档搜索 MCP Server — 在 AI 编程助手中直接搜索和获取云厂商官方产品文档。采用适配器架构，支持 14 个云厂商。

## 安装

### 一键安装

```bash
# 直接通过 npx 运行，无需安装
npx multi-cloud-docs-search
```

配置到 Claude Code / Cursor / Windsurf 等支持 MCP 的客户端：

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

### 国内镜像加速

```bash
npm config set registry https://registry.npmmirror.com/
```

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
| `get_product_price` | provider, productId? | 获取产品价格信息 |

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

## 价格获取

`get_product_price` 工具支持获取云厂商产品价格信息。各厂商实现方式：

| 厂商 | 实现方式 | 说明 |
|------|---------|------|
| 火山引擎 | GetTable API | 通过 SSR 定价页面获取 TemplateCode，调用 GetTable API 获取完整定价表格 |
| 腾讯云 | DescribeZoneInstanceConfigInfos API | 并行查询 18 个地域的 CVM 实例配置和价格 |
| 华为云 | export/productlist API | 通过价格计算器 API 获取全量价格数据（支持 100+ 产品） |
| 移动云 | 文档 API 解析 | 从文档 Markdown 表格中解析价格数据 |
| 天翼云 | 文档 API | 通过文档 API 获取价格信息 |
| 阿里云百炼 | 文档 API | 通过文档 API 获取价格信息 |
| DeepSeek | 文档页面 | 从定价文档页面提取价格 |
| MiniMax | 文档页面 | 从定价文档页面提取价格 |

### 大模型 Token 价格速查

MCP Server 内置了各厂商大模型 Token 价格的快速获取指引，AI 客户端连接后会自动获取。支持的厂商和价格类型：

| 厂商 | 价格类型 |
|------|---------|
| 腾讯云 TokenHub | 模型按需价格、Token Plan 企业版专业套餐、Token Plan 企业版轻享套餐、Token Plan 个人版 |
| 火山引擎方舟 | 模型按需价格、Agent Plan / Coding Plan 套餐 |
| 华为云 MaaS | 模型按需价格、Token Plan 套餐 |
| 移动云 MoMA | 预置模型 Token 按量、一次性资源包、合作模型 Token 按量、Coding Plan 个人版 |
| 百度千帆 | Token 计费说明、Token 福利包 |
| 智谱 GLM | 模型按需价格、GLM Coding Plan |

## 使用指引

MCP Server 内置了完整的使用指引（instructions），AI 客户端连接后会自动获取。核心原则：

1. **优先浏览目录，迫不得已再搜索**：先 `get_document_toc` 看目录结构，再决定是否搜索
2. **metadata → content 顺序不可颠倒**：先 `get_page_metadata` 获取 contentPath，再传给 `get_page_content`
3. **并行调用最大化效率**：无依赖的调用应��行执行
4. **搜索关键词要宽泛**：用"计费"而非"4C8G价格"

## 本地开发

```bash
# 克隆项目
git clone https://github.com/octopuszy-zhangyu/multi-cloud-docs-search.git
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
├── stdio.ts                  # 主入口 — stdio 模式 MCP Server（含 instructions）
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
│   ├── cucloud.ts            # 联通云适配器
│   ├── bailian.ts            # 阿里云百炼适配器
│   ├── baidu.ts              # 百度云适配器
│   ├── deepseek.ts           # DeepSeek 适配器
│   ├── glm.ts                # 智谱 GLM 适配器
│   ├── minimax.ts            # MiniMax 适配器
│   └── kimi.ts               # 月之暗面 Kimi 适配器
└── utils/
    └── html-to-md.ts         # HTML 转 Markdown 工具
```

## 验证

使用 MCP 工具测试核心功能：

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

# 6. 测试获取价格
get_product_price({ provider: "deepseek" })
get_product_price({ provider: "ctyun", productId: "10027004" })
```

## 许可证

GPL-3.0
