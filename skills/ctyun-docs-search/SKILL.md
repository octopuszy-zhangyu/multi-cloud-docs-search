---
name: ctyun-docs-search
description: Use when the user asks about 天翼云(CTYUN) products, services, documentation, or needs help with 天翼云 features. Triggers: mentions of 天翼云, CTYUN, ctyun, 弹性云主机, ECS, 天翼云产品, 天翼云文档. Searches official 天翼云 documentation site for product docs and returns relevant content.
---

# 天翼云文档搜索 (CTYUN Docs Search)

## 概述
搜索天翼云官方文档站，获取产品文档内容。当用户询问天翼云相关产品时，使用本技能自动获取官方文档并回答用户问题。

## 核心 API

### 1. 获取所有产品文档列表（必用）
```
GET https://www.ctyun.cn/v2/portal/book/ListForHelp?bookClassDomain=product&_t={时间戳}
```

**用途**：获取天翼云所有产品文档的分类和列表，返回完整的 bookId 映射。

**返回数据结构**：
```json
{
  "code": "core.ok",
  "data": {
    "list": [
      {
        "bookClassId": "10630935",
        "bookClassName": "云终端",
        "list": [
          {
            "bookId": "10027004",
            "name": "天翼云电脑（政企版）",
            "bookName": "天翼云电脑（政企版）",
            "note": "天翼AI云电脑是云计算技术和终端相结合的创新型产品...",
            "productId": "10042330"
          }
        ]
      }
    ]
  }
}
```

**使用方式**：
- 首次使用时调用此 API 获取所有产品列表
- 从返回结果中匹配用户询问的产品名称，获取对应的 bookId
- 匹配规则：优先精确匹配 name 或 bookName，模糊匹配 note 中的关键词

### 2. 获取产品文档目录（从 HTML 提取）
```
GET https://www.ctyun.cn/document/{bookId}/
```

**重要**：`GetFolderBook` API 已废弃（返回空数组），目录数据直接嵌入在 HTML 页面中。

**获取目录的步骤**：
1. 用 WebFetch 抓取 `https://www.ctyun.cn/document/{bookId}/` 页面
2. 从页面 HTML 中提取所有 `/document/{bookId}/数字` 格式的链接
3. 链接格式：`/document/{bookId}/{pageId}`，如 `/document/10027004/10028042`

**返回的目录结构示例**：
| URL | 标题 |
|-----|------|
| /document/10027004/10028050 | 产品动态 |
| /document/10027004/10028042 | 产品定义 |
| /document/10027004/10028043 | 产品优势 |
| /document/10027004/10028044 | 产品功能 |
| /document/10027004/10028040 | 计费说明 |
| /document/10027004/10028034 | 入门概述 |
| /document/10027004/10028086 | 登录控制台 |
| ... | ... |

### 3. 文档内搜索（按关键词查找页面）
```
GET https://www.ctyun.cn/v2/portal/book/ContentQuery?bookId={bookId}&keyword={关键词}&_t={时间戳}
```

**用途**：在指定产品的文档中按关键词搜索，返回匹配的页面列表。

**参数**：
- `bookId`: 产品文档 ID
- `keyword`: 搜索关键词（需 URL 编码）

**返回示例**（搜索"登录"）：
```json
{
  "code": "core.ok",
  "data": {
    "bookName": "天翼云电脑（政企版）",
    "pages": [
      {
        "pageId": "10028086",
        "name": "登录控制台",
        "title": "登录控制台",
        "note": "本节介绍登录天翼云电脑（政企版）控制台的操作指导。"
      },
      {
        "pageId": "10267241",
        "name": "登录AI云电脑",
        "title": "登录AI云电脑",
        "note": "本节介绍天翼云电脑移动客户端登录的相关操作。"
      }
    ]
  }
}
```

**使用场景**：
- 用户想了解某个具体功能（如"登录"、"备份"、"网络"）
- 需要快速定位相关文档页面，无需遍历整个目录

### 4. 获取文档页面元信息（推荐）
```
GET https://www.ctyun.cn/v2/portal/book/page/Get?pageId={pageId}&_t={时间戳}
```

**用途**：获取文档页面的元信息，包括标题、简介和 contentPath（文档正文地址）。

**返回数据结构**：
```json
{
  "code": "core.ok",
  "data": {
    "pageId": "11073902",
    "name": "登录AI云电脑",
    "title": "登录AI云电脑",
    "contentType": "common",
    "note": "本节介绍天翼量子AI云电脑-电脑客户端登录的相关操作。",
    "contentPath": "https://www.ctyun.cn/v2/portal/s/DHl8uIfyjbSOLJfgwiJKjePayMv7AIrUEhlSunlf5e3bM6OTLG90a5Qs4Pb16ZSvJBEhyNU3L4QeQ6hUTCVM7M-9sKrb09iCIq7ygQePM4960vX9EtsHQ6k85NNZ-_Aq",
    "chapterId": "11073673",
    "bookId": 10027004,
    "updateDateShow": "2026-02-06 10:34:04"
  }
}
```

### 5. 获取文档正文内容（核心）
```
GET {contentPath}
```

**用途**：获取文档的完整 Markdown 正文内容。

**说明**：
- `contentPath` 来自 `page/Get` API 返回的字段
- 返回内容为完整的 Markdown 格式文档，包含标题、段落、列表、图片链接等
- 图片链接格式：`![](https://ctyun-portal.gdoss.xstore.ctyun.cn/file/xxx)`

**返回示例**（"登录AI云电脑"文档内容）：
```
扫码登录
登录页-扫码登录，支持通过天翼云电脑APP、翼连、微信扫码登录...

账号登录
登录页-账号登录，支持AI云电脑账号，手机号码和邮箱登录...

自动登录
（1）账密登录：用户输入账号密码，勾选"自动登录"...
（2）扫码登录：勾选"自动登录"，扫码登录成功后...

记住密码
忘记密码
企业专线
企业账号登录
...
```

### 6. 直接获取文档内容（SSR，备选）
文档内容通过服务端渲染直接嵌入 HTML，可通过以下方式提取：

```javascript
// 页面中 #mdContent 元素包含文档 Markdown 内容
document.querySelector('#mdContent')?.innerText
```

## 常用产品 bookId 映射

| 产品名称 | bookId | 分类 |
|---------|--------|------|
| 天翼云电脑（政企版） | 10027004 | 云终端 |
| 弹性云主机 ECS | 10026730 | 计算 |

> 更多产品 bookId 通过 ListForHelp API 获取

## 工作流程

### 标准流程（推荐）
1. **获取产品列表**：调用 `ListForHelp` 获取所有产品文档列表
2. **匹配产品**：从返回结果中找到用户询问的产品，获取 bookId
3. **获取文档目录**：用 WebFetch 抓取 `https://www.ctyun.cn/document/{bookId}/` 页面，从 HTML 中提取所有 `/document/{bookId}/数字` 链接
4. **获取页面元信息**：调用 `page/Get?pageId={pageId}` 获取 contentPath
5. **获取文档正文**：请求 `contentPath` URL 获取完整 Markdown 内容
6. **总结回答**：基于文档内容回答用户问题

### 搜索流程（当用户询问具体功能时）
1. **获取产品列表**：调用 `ListForHelp` 获取产品 bookId
2. **搜索关键词**：调用 `ContentQuery?bookId={bookId}&keyword={关键词}` 搜索相关页面
3. **获取页面元信息**：调用 `page/Get?pageId={pageId}` 获取 contentPath
4. **获取文档正文**：请求 `contentPath` URL 获取完整 Markdown 内容
5. **总结回答**：基于文档内容回答用户问题

### 快速定位
如果已知产品 bookId：
1. 直接访问 `https://www.ctyun.cn/document/{bookId}` 获取文档目录（从 HTML 提取）
2. 或调用 `ContentQuery` 搜索关键词
3. 调用 `page/Get` 获取 contentPath，再请求 contentPath 获取正文
4. 总结回答

## 注意事项

- `GetFolderBook` API 已废弃，返回空数组，不要使用
- `GetRelateBookPage` API 返回的是页面列表而非正文内容，不推荐使用
- 目录数据直接嵌入在 HTML 页面中，必须从页面提取
- `ListForHelp` 返回完整产品列表，包含所有分类
- 获取文档正文的推荐方式：`page/Get` → `contentPath`（比 SSR 提取更完整）
- 所有 API 需要携带 `csm` 和 `cst` 请求头（从浏览器会话中自动获取）
- `_t` 参数使用当前时间戳即可
