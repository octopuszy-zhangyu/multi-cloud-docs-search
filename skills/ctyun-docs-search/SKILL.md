---
name: ctyun-docs-search
description: Use when the user asks about cloud provider products, services, documentation, or pricing. Supports 天翼云(CTYUN), 阿里云(Aliyun), 火山引擎(Volcengine), 腾讯云(Tencent Cloud), 华为云(Huawei Cloud). Searches official cloud provider documentation sites and returns relevant content.
---

# 多云文档搜索 (Multi-Cloud Docs Search)

## 概述

搜索多云厂商的官方文档站，获取产品文档内容。当用户询问云产品相关问题时，使用本技能自动获取官方文档并回答用户问题。

## 架构

本技能使用 MCP (Model Context Protocol) 工具与 Cloudflare Workers 部署的服务通信。所有工具统一接受 `provider` 参数。

## 当前支持的云厂商

| provider | 名称 | 文档特点 |
|----------|------|---------|
| ctyun | 天翼云 | API 返回 JSON，内容需 HTML 转 Markdown |
| aliyun | 阿里云 | API 返回 JSON 目录树，内容需 HTML 转 Markdown |
| volcengine | 火山引擎 | API 直接返回 Markdown（`MDContent` 字段） |
| tencent | 腾讯云 | SSR 渲染，内容需 HTML 转 Markdown |
| huawei | 华为云 | 公开 API 获取产品列表，HTML 目录，内容需 HTML 转 Markdown |

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

## 各厂商 pageId 格式

| provider | pageId 格式 | 示例 |
|----------|------------|------|
| ctyun | 纯数字 ID | `10028086` |
| aliyun | 文档路径 | `/zh/ecs/product-overview/what-is-ecs` |
| volcengine | `{productId}/{docId}` | `6349/1183370` |
| tencent | `{productId}/{pageId}` | `213/495` |
| huawei | `{productId}/{docPath}` | `ecs/productdesc-ecs/zh-cn_topic_0013771112` |

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

## 注意事项

- 所有工具第一个参数必须是 `provider`，指定云厂商
- 天翼云 API 无需认证
- 火山引擎 API 无需认证，文档内容直接返回 Markdown
- 腾讯云文档为 SSR 渲染，内容需从 HTML 转换为 Markdown
- 华为云通过公开 API 获取产品列表，文档内容已自动提取正文区域去除页头页脚
- 获取文档正文的推荐方式：`get_page_metadata` → `get_page_content`
- 本技能已部署到 Cloudflare Workers，GitHub push 后自动部署
