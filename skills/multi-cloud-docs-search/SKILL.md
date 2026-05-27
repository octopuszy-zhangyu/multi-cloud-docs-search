---
name: multi-cloud-docs-search
description: Use when the user asks about cloud provider products, services, documentation, or pricing. Supports 天翼云(CTYUN), 阿里云(Aliyun), 火山引擎(Volcengine), 腾讯云(Tencent Cloud), 华为云(Huawei Cloud), 移动云(Ecloud), 联通云(Cucloud). Searches official cloud provider documentation sites and returns relevant content.
---

# 多云文档搜索 (Multi-Cloud Docs Search)

## 概述

搜索多云厂商的官方文档站，获取产品文档内容。当用户询问云产品相关问题时，使用本技能自动获取官方文档并回答用户问题。

## 架构

本技能使用 MCP (Model Context Protocol) stdio 模式运行，通过 `npx multi-cloud-docs-search` 启动。所有工具统一接受 `provider` 参数。

## 当前支持的云厂商

| provider | 名称 | 文档特点 |
|----------|------|---------|
| ctyun | 天翼云 | API 返回 JSON，内容需 HTML 转 Markdown |
| aliyun | 阿里云 | API 返回 JSON 目录树，内容需 HTML 转 Markdown |
| volcengine | 火山引擎 | API 直接返回 Markdown（`MDContent` 字段） |
| tencent | 腾讯云 | SSR 渲染，内容需 HTML 转 Markdown |
| huawei | 华为云 | 公开 API 获取产品列表，HTML 目录，内容需 HTML 转 Markdown |
| ecloud | 移动云 | API 获取产品列表和文档目录，内容通过 API 返回 HTML |
| cucloud | 联通云 | 首页 HTML 嵌入 JSON 数据获取产品列表和目录，搜索 API 获取文档摘要 |
| bailian | 阿里云百炼 | 阿里云帮助中心托管，HTML 解析目录，内容需 HTML 转 Markdown |
| baidu | 百度云 | 静态 HTML 页面，HTML 解析产品列表和目录，内容需 HTML 转 Markdown |
| deepseek | DeepSeek | Docusaurus 静态站点，sitemap.xml 获取目录，内容需 HTML 转 Markdown |
| glm | 智谱 GLM | Mintlify 文档站，llms.txt 获取目录，内容需 HTML 转 Markdown |
| minimax | MiniMax | Mintlify 文档站，llms.txt 获取目录，内容直接返回 Markdown |
| kimi | 月之暗面 Kimi | Mintlify 文档站，llms.txt 获取目录，内容需 HTML 转 Markdown |

## MCP 工具

### 1. list_products

获取指定云厂商的所有产品文档列表。

**参数**：
```typescript
{ provider: "ctyun" }
```

**返回**：
```json
[
  { "productId": "10027004", "name": "天翼云电脑（政企版）", "description": "..." },
  { "productId": "10026730", "name": "弹性云主机 ECS", "description": "..." }
]
```

### 2. get_document_toc

获取指定产品的文档目录树。

**参数**：
```typescript
{ provider: "ctyun", productId: "10027004" }
```

**返回**：
```json
[
  { "pageId": "10028050", "title": "产品动态" },
  { "pageId": "10028042", "title": "产品定义" }
]
```

### 3. search_documents

在指定云厂商的产品文档中按关键词搜索。

**参数**：
```typescript
{ provider: "ctyun", productId: "10027004", keyword: "登录" }
```

**返回**：
```json
[
  { "pageId": "10028086", "title": "登录控制台", "description": "..." }
]
```

### 4. get_page_metadata

获取文档页面的元信息，包括标题和 contentPath（文档正文地址）。

**参数**：
```typescript
{ provider: "ctyun", pageId: "10028086" }
```

**返回**：
```json
{
  "pageId": "10028086",
  "title": "登录控制台",
  "note": "本节介绍登录天翼云电脑（政企版）控制台的操作指导。",
  "contentPath": "https://www.ctyun.cn/v2/portal/s/..."
}
```

### 5. get_page_content

获取文档页面的完整 Markdown 正文。

**参数**：
```typescript
{ provider: "ctyun", contentPath: "从 get_page_metadata 获取的 contentPath" }
```

**返回**：
```markdown
# 操作场景
...
```

### 6. get_product_price

获取指定云厂商的产品价格信息。不传 productId 则返回所有产品价格概览。

**参数**：
```typescript
{ provider: "deepseek" }
// 或指定产品
{ provider: "ctyun", productId: "11061839" }
```

**返回**：
```json
{
  "provider": "deepseek",
  "name": "DeepSeek",
  "prices": [
    {
      "productName": "DeepSeek-V4-Flash",
      "specification": "输入",
      "billingMode": "按量",
      "price": 1,
      "unit": "元/百万Token",
      "currency": "CNY",
      "source": "文档定价页面"
    }
  ],
  "source": "https://api-docs.deepseek.com/quick_start/pricing"
}
```

## 各厂商 pageId 格式

| provider | pageId 格式 | 示例 |
|----------|------------|------|
| ctyun | 纯数字 ID | `10028086` |
| aliyun | 文档路径 | `/zh/ecs/product-overview/what-is-ecs` |
| volcengine | `{productId}/{docId}` | `6349/1183370` |
| tencent | `{productId}/{pageId}` | `213/495` |
| huawei | `{productId}/{docPath}` | `ecs/productdesc-ecs/zh-cn_topic_0013771112` |
| ecloud | 纯数字 ID | `23663` |
| cucloud | 纯数字 ID | `128`（云服务器 ECS） |
| bailian | 文档路径 | `/zh/model-studio/what-is-model-studio` |
| baidu | `{productId}/s/{slug}` | `BCC/s/8kbbkwg4p` |
| deepseek | 文档路径 | `/guides/quick-start` |
| glm | 文档路径 | `/cn/guide/start/model-overview` |
| minimax | 文档路径 | `/docs/api-reference/models/openai/list-models` |
| kimi | 文档路径 | `/docs/getting-started` |

## 常用产品 productId 映射

### 天翼云
| 产品名称 | productId |
|---------|-----------|
| 天翼云电脑（政企版） | 10027004 |
| 弹性云主机 ECS | 10026730 |

### 腾讯云
| 产品名称 | productId |
|---------|-----------|
| 云服务器 CVM | 213 |
| 大模型服务平台 TokenHub | 1823 |
| 腾讯混元大模型 | 1729 |

### 华为云
| 产品名称 | productId |
|---------|-----------|
| 弹性云服务器 ECS | ecs |
| 对象存储服务 OBS | obs |
| 云容器引擎 CCE | cce |

### 移动云
| 产品名称 | productId |
|---------|-----------|
| 云主机 ECS | 706 |
| 对象存储 EOS | 729 |
| 虚拟私有云 | 737 |

### 联通云
| 产品名称 | productId |
|---------|-----------|
| 云服务器 ECS | 128 |
| AI服务平台 AISP | 2357 |
| AI算力平台 AICP | 1398 |
| AI计算集群 AICC | 2252 |
| 对象存储 OSS | 133 |

### AI/模型服务产品（用于价格查询）
| 厂商 | 产品名称 | productId |
|------|---------|-----------|
| 天翼云 | Token服务（原模型推理服务） | 11061839 |
| 天翼云 | AI Store | 11085484 |
| 阿里云 | 大模型服务平台百炼 | model-studio |
| 阿里云 | 人工智能平台 PAI | pai |
| 火山引擎 | 大模型服务（待确认） | - |
| 腾讯云 | 大模型服务平台 TokenHub | 1823 |
| 腾讯云 | 腾讯混元大模型 | 1729 |
| 华为云 | MaaS 模型即服务 | maas |
| 华为云 | 魔坊 ModelArts | modelarts |
| 移动云 | 模型服务平台 MoMA | 1456 |
| 移动云 | AI原生行业智能体 | 1428 |
| 联通云 | AI服务平台 AISP | 2357 |
| 联通云 | AI算力平台 AICP | 1398 |
| 百度云 | BML 全功能AI开发平台 | BML |
| 百度云 | 智能代码助手 COMATE | COMATE |

> 更多产品 productId 通过 `list_products` 获取

## 工作流程

### 标准流程（推荐）
1. **获取产品列表**：调用 `list_products({ provider: "xxx" })`
2. **匹配产品**：从返回结果中找到用户询问的产品，获取 productId
3. **获取文档目录**：调用 `get_document_toc({ provider: "xxx", productId: "xxx" })`
4. **获取页面元信息**：调用 `get_page_metadata({ provider: "xxx", pageId: "xxx" })` 获取 contentPath
5. **获取文档正文**：调用 `get_page_content({ provider: "xxx", contentPath: "xxx" })`
6. **总结回答**：基于文档内容回答用户问题

### 搜索流程（当用户询问具体功能时）
1. **获取产品列表**：调用 `list_products` 获取产品 productId
2. **搜索关键词**：调用 `search_documents({ provider: "xxx", productId: "xxx", keyword: "xxx" })` 搜索相关页面
3. **获取页面元信息**：调用 `get_page_metadata` 获取 contentPath
4. **获取文档正文**：调用 `get_page_content` 获取完整 Markdown 内容
5. **总结回答**：基于文档内容回答用户问题

### 快速定位
如果已知产品 productId：
1. 直接调用 `get_document_toc({ provider: "xxx", productId: "xxx" })` 获取文档目录
2. 或调用 `search_documents` 搜索关键词
3. 调用 `get_page_metadata` 获取 contentPath，再调用 `get_page_content` 获取正文
4. 总结回答

### 价格查询流程（当用户询问价格时）

**优先从文档获取价格**（推荐，数据更准确）：
1. **获取产品列表**：调用 `list_products({ provider: "xxx" })` 获取产品 productId
2. **搜索定价文档**：调用 `search_documents({ provider: "xxx", productId: "xxx", keyword: "价格" })` 搜索定价相关页面
3. **获取定价页面内容**：调用 `get_page_metadata` → `get_page_content` 获取定价页面 Markdown 内容
4. **提取价格表**：从 Markdown 内容中解析价格表格，提取产品名称、规格、价格等信息
5. **总结回答**：基于文档中的价格信息回答用户问题

**回退方案**（当文档中找不到价格时）：
1. 调用 `get_product_price({ provider: "xxx" })` 获取价格数据
2. 如果返回空，尝试带 productId 调用：`get_product_price({ provider: "xxx", productId: "xxx" })`
3. 总结回答

### 价格获取注意事项
- AI 厂商（DeepSeek、MiniMax、百炼）的定价页面可直接通过 `get_product_price` 获取
- 传统云厂商（天翼云、阿里云）需指定 productId 才能获取价格
- 火山引擎、腾讯云、华为云、移动云、联通云、百度云的 AI 产品价格可能不在文档中，需通过其他方式获取
- `get_product_price` 返回的价格数据可能不如文档中的价格表完整准确，优先使用文档搜索

## 注意事项

- 所有工具第一个参数必须是 `provider`，指定云厂商
- 天翼云 API 无需认证
- 火山引擎 API 无需认证，文档内容直接返回 Markdown
- 腾讯云文档为 SSR 渲染，内容需从 HTML 转换为 Markdown
- 华为云通过公开 API 获取产品列表，文档内容已自动提取正文区域去除页头页脚
- 移动云通过 API 获取产品列表和文档目录，文档内容通过 API 返回 HTML 格式
- 移动云首页为 SSR 渲染，HTML 内容为空，无法通过 HTML 解析获取产品列表
- 移动云 API 可能屏蔽 Cloudflare Workers IP，本地 stdio 模式可正常使用
- 联通云通过首页 HTML 中嵌入的 `finalResConfig` JSON 数据获取产品列表和文档目录
- 联通云文档详情页为 Vue SPA，有反爬保护（JS 混淆 + debugger 断点），`getPageContent` 返回搜索 API 摘要内容
- 联通云搜索 API（`gateway.cucloud.cn/search/`）可正常访问，用于文档搜索和内容摘要
- 获取文档正文的推荐方式：`get_page_metadata` → `get_page_content`
- 本技能已发布到 npm，通过 `npx multi-cloud-docs-search` 直接运行
