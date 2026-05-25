---
name: ctyun-docs-search
description: Use when the user asks about 天翼云(CTYUN) products, services, documentation, or needs help with 天翼云 features. Triggers: mentions of 天翼云, CTYUN, ctyun, 弹性云主机, ECS, 天翼云产品, 天翼云文档. Searches official 天翼云 documentation site for product docs and returns relevant content.
---

# 天翼云文档搜索 (CTYUN Docs Search)

## 概述

搜索天翼云官方文档站，获取产品文档内容。当用户询问天翼云相关产品时，使用本技能自动获取官方文档并回答用户问题。

## 架构

本技能使用 MCP (Model Context Protocol) 工具与 Cloudflare Workers 部署的服务通信。所有工具统一接受 `provider` 参数，当前支持 `ctyun`（天翼云）。

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
  { "pageId": "10028042", "title": "产品定义" },
  { "pageId": "10028086", "title": "登录控制台" }
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
  { "pageId": "10028086", "title": "登录控制台", "description": "本节介绍登录天翼云电脑（政企版）控制台的操作指导。" }
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
  "contentPath": "https://www.ctyun.cn/v2/portal/s/...",
  "chapterId": "10028032",
  "bookId": "10027004",
  "updateDate": "2025-09-08 17:30:46"
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

登录AI云电脑（政企版）控制台后，才能进行如下业务操作：

- 订购并管理资源包...
- 创建并管理AI云电脑...

# 通过产品详情页进入

1. 使用管理员帐号登录天翼云门户；
2. 前往天翼AI云电脑（政企版）产品详情页面；
...
```

## 常用产品 productId 映射

| 产品名称 | productId | 分类 |
|---------|-----------|------|
| 天翼云电脑（政企版） | 10027004 | 云终端 |
| 弹性云主机 ECS | 10026730 | 计算 |

> 更多产品 productId 通过 `list_products` 获取

## 工作流程

### 标准流程（推荐）
1. **获取产品列表**：调用 `list_products({ provider: "ctyun" })`
2. **匹配产品**：从返回结果中找到用户询问的产品，获取 productId
3. **获取文档目录**：调用 `get_document_toc({ provider: "ctyun", productId: "xxx" })`
4. **获取页面元信息**：调用 `get_page_metadata({ provider: "ctyun", pageId: "xxx" })` 获取 contentPath
5. **获取文档正文**：调用 `get_page_content({ provider: "ctyun", contentPath: "xxx" })`
6. **总结回答**：基于文档内容回答用户问题

### 搜索流程（当用户询问具体功能时）
1. **获取产品列表**：调用 `list_products` 获取产品 productId
2. **搜索关键词**：调用 `search_documents({ provider: "ctyun", productId: "xxx", keyword: "xxx" })` 搜索相关页面
3. **获取页面元信息**：调用 `get_page_metadata` 获取 contentPath
4. **获取文档正文**：调用 `get_page_content` 获取完整 Markdown 内容
5. **总结回答**：基于文档内容回答用户问题

### 快速定位
如果已知产品 productId：
1. 直接调用 `get_document_toc({ provider: "ctyun", productId: "xxx" })` 获取文档目录
2. 或调用 `search_documents` 搜索关键词
3. 调用 `get_page_metadata` 获取 contentPath，再调用 `get_page_content` 获取正文
4. 总结回答

## 注意事项

- 所有工具第一个参数必须是 `provider: "ctyun"`
- `productId` 对应原来的 `bookId`
- 获取文档正文的推荐方式：`get_page_metadata` → `get_page_content`
- 本技能已部署到 Cloudflare Workers，GitHub push 后自动部署