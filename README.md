# multi-cloud-docs-search

多云文档搜索 MCP Server — 在 AI 编程助手中直接搜索和获取云厂商官方产品文档。采用适配器架构，支持 **14 个云厂商**。

## 安装配置

在 Claude Code、Cursor、Windsurf 等支持 MCP 的客户端中，添加以下配置：

**从 npm 安装（推荐，自动更新）：**
```json
{
  "mcpServers": {
    "multi-cloud-docs-search": {
      "command": "npx",
      "args": ["-y", "multi-cloud-docs-search@latest"]
    }
  }
}
```

**从 GitHub 安装（自动更新）：**
```json
{
  "mcpServers": {
    "multi-cloud-docs-search": {
      "command": "npx",
      "args": ["-y", "github:octopuszy-zhangyu/multi-cloud-docs-search"]
    }
  }
}
```

> **国内镜像加速：** `npm config set registry https://registry.npmmirror.com/`

## 可用工具

所有工具第一个参数为 `provider`（云厂商标识）。

| 工具 | 参数 | 说明 |
|------|------|------|
| `list_products` | provider, keyword? | 获取产品文档列表 |
| `get_document_toc` | provider, productId, keyword? | 获取文档目录 |
| `search_documents` | provider, productId, keyword | 搜索文档正文 |
| `get_page_metadata` | provider, pageId | 获取页面元信息 |
| `get_page_content` | provider, contentPath | 获取 Markdown 正文 |
| `get_product_price` | provider, productId?, quick? | 获取产品价格信息 |

## 支持的云厂商

| provider | 名称 | 类型 |
|----------|------|------|
| ctyun | 天翼云 | 传统云 |
| aliyun | 阿里云 | 传统云 |
| volcengine | 火山引擎 | 传统云 |
| tencent | 腾讯云 | 传统云 |
| huawei | 华为云 | 传统云 |
| ecloud | 移动云 | 传统云 |
| cucloud | 联通云 | 传统云 |
| baidu | 百度云 | 传统云 |
| bailian | 阿里云百炼 | AI 平台 |
| deepseek | DeepSeek | AI 平台 |
| glm | 智谱 GLM | AI 平台 |
| minimax | MiniMax | AI 平台 |
| kimi | 月之暗面 Kimi | AI 平台 |

## 价格获取

`get_product_price` 工具支持获取云厂商产品价格信息：

| 厂商 | 方式 | 说明 |
|------|------|------|
| 天翼云 | 内部价格计算器 API | ECS 规格精确询价 + 云电脑组件价格查询 |
| 阿里云 | 价格计算器 API | ECS 实例/系统盘/数据盘/带宽价格 |
| 火山引擎 | GetTable API | 通过 SSR 定价页面获取完整定价表格 |
| 腾讯云 | CVM API | 并行查询多地域实例配置和价格 |
| 华为云 | export/productlist API | 支持 100+ 产品 |
| DeepSeek / MiniMax / Kimi | 定价文档解析 | 直接从定价页面提取 |
| 阿里云百炼 | 文档 API | 从文档中解析价格 |

## 本地开发

```bash
git clone https://github.com/octopuszy-zhangyu/multi-cloud-docs-search.git
cd multi-cloud-docs-search
npm install
npm run start    # 启动 MCP Server
npm run dev      # 开发模式（文件监听）
npm run build    # TypeScript 编译检查
```

## 许可证

GPL-3.0
