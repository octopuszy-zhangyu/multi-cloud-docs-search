# 多云适配器架构重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前天翼云单一 API 架构重构为适配器模式，为后续多厂商支持做准备

**Architecture:** 抽取 `CloudDocAdapter` 抽象基类定义统一接口（5 个方法），将现有 `CtyunApi` 逻辑迁移为 `CtyunAdapter`，通过工厂函数 `getAdapter(provider)` 获取实例。HTML 转 Markdown 工具独立为 `utils/html-to-md.ts`。两个入口文件（`index.ts` Cloudflare 版、`stdio.ts` 本地版）均使用适配器工厂。

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, cheerio, zod, Cloudflare Workers

---

### Task 1: 创建适配器基类 `src/adapters/base.ts`

**Files:**
- Create: `src/adapters/base.ts`

- [ ] **Step 1: 编写抽象基类**

```typescript
/** 统一产品接口 */
export interface Product {
  productId: string;
  name: string;
  description?: string;
}

/** 文档目录项 */
export interface TocItem {
  pageId: string;
  title: string;
  children?: TocItem[];
}

/** 搜索结果项 */
export interface SearchResult {
  pageId: string;
  title: string;
  description?: string;
}

/** 页面元信息 */
export interface PageMetadata {
  pageId: string;
  title: string;
  note?: string;
  contentPath: string;
  chapterId?: string;
  bookId?: string;
  updateDate?: string;
}

/** 云厂商文档适配器抽象基类 */
export abstract class CloudDocAdapter {
  /** 厂商标识，如 "ctyun"、"aliyun" */
  abstract readonly provider: string;
  /** 厂商中文名称，如 "天翼云"、"阿里云" */
  abstract readonly name: string;

  /** 获取所有产品文档列表 */
  abstract listProducts(): Promise<Product[]>;

  /** 获取指定产品的文档目录树 */
  abstract getDocumentToc(productId: string): Promise<TocItem[]>;

  /** 在产品文档中搜索关键词 */
  abstract searchDocuments(productId: string, keyword: string): Promise<SearchResult[]>;

  /** 获取页面元信息（含 contentPath） */
  abstract getPageMetadata(pageId: string): Promise<PageMetadata>;

  /** 获取文档页面 Markdown 正文 */
  abstract getPageContent(contentPath: string): Promise<string>;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/adapters/base.ts
git commit -m "feat: add CloudDocAdapter abstract base class"
```

---

### Task 2: 创建 HTML 转 Markdown 工具 `src/utils/html-to-md.ts`

**Files:**
- Create: `src/utils/html-to-md.ts`

- [ ] **Step 1: 从 `src/index.ts` 提取 HTML 转 Markdown 逻辑**

```typescript
import * as cheerio from "cheerio";

/**
 * 将 HTML 文档正文转换为 Markdown 格式
 * 处理标题、列表、图片、表格等元素
 */
export function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);

  // 移除不需要的标签
  $("script, style, nav, footer, header, aside, .ad, .advertisement").remove();

  // 将标题转换为 Markdown 格式
  $("h1").each((_, el) => $(el).replaceWith("\n# " + $(el).text().trim() + "\n"));
  $("h2").each((_, el) => $(el).replaceWith("\n## " + $(el).text().trim() + "\n"));
  $("h3").each((_, el) => $(el).replaceWith("\n### " + $(el).text().trim() + "\n"));
  $("h4").each((_, el) => $(el).replaceWith("\n#### " + $(el).text().trim() + "\n"));
  $("h5").each((_, el) => $(el).replaceWith("\n##### " + $(el).text().trim() + "\n"));
  $("h6").each((_, el) => $(el).replaceWith("\n###### " + $(el).text().trim() + "\n"));

  // 将列表转换为 Markdown 格式
  $("ul").each((_, el) => {
    const items: string[] = [];
    $(el).find("li").each((_, li) => {
      items.push("- " + $(li).text().trim().replace(/\s+/g, " "));
    });
    $(el).replaceWith("\n" + items.join("\n") + "\n");
  });
  $("ol").each((_, el) => {
    const items: string[] = [];
    let idx = 1;
    $(el).find("li").each((_, li) => {
      items.push(idx + ". " + $(li).text().trim().replace(/\s+/g, " "));
      idx++;
    });
    $(el).replaceWith("\n" + items.join("\n") + "\n");
  });

  // 将图片转换为 Markdown 格式
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    const alt = $(el).attr("alt") || "";
    if (src) {
      $(el).replaceWith("![" + alt + "](" + src + ")");
    }
  });

  // 将表格转换为 Markdown 格式
  const markdownTables: string[] = [];
  $("table").each((_, table) => {
    const $table = $(table);
    const rows: string[] = [];

    $table.find("tr").each((_, tr) => {
      const cells: string[] = [];
      $(tr).find("th, td").each((_, cell) => {
        let text = $(cell).text().trim().replace(/\s+/g, " ");
        text = text.replace(/\n/g, " ");
        cells.push(text);
      });
      if (cells.length > 0) {
        rows.push("| " + cells.join(" | ") + " |");
      }
    });

    if (rows.length > 1) {
      const headerCells = rows[0].split("|").filter((_, i, arr) => i > 0 && i < arr.length - 1);
      const separator = "| " + headerCells.map(() => "---").join(" | ") + " |";
      rows.splice(1, 0, separator);
    }

    markdownTables.push(rows.join("\n"));
  });

  // 清理 HTML 并转换为纯文本
  let text = $("body").html() || "";
  text = text.replace(/<(\w+)[^>]*>\s*<\/\1>/g, "");
  text = text.replace(/<\/?(p|div|br|blockquote|pre|section)[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  if (markdownTables.length > 0) {
    text += "\n\n" + markdownTables.join("\n\n");
  }

  return text || "(空内容)";
}
```

- [ ] **Step 2: 提交**

```bash
git add src/utils/html-to-md.ts
git commit -m "refactor: extract htmlToMarkdown to utils"
```

---

### Task 3: 更新 `src/types.ts` - 统一类型定义

**Files:**
- Modify: `src/types.ts` (完全重写)

- [ ] **Step 1: 重写 types.ts，保留原有响应类型 + 引入适配器接口类型**

```typescript
import type { Product, TocItem, SearchResult, PageMetadata } from "./adapters/base";

// ===== 天翼云 API 响应类型（与现有逻辑兼容） =====

export interface ProductCategory {
  bookClassId: string;
  bookClassName: string;
  list: ProductItem[];
}

export interface ProductItem {
  bookId: string;
  name: string;
  bookName: string;
  note: string;
  productId: string;
}

export interface ListForHelpResponse {
  code: string;
  data: {
    list: ProductCategory[];
  };
}

export interface SearchPageItem {
  pageId: string;
  name: string;
  title: string;
  note?: string;
  contentType?: string;
}

export interface ContentQueryResponse {
  code: string;
  data: {
    bookName: string;
    pages: SearchPageItem[];
  };
}

export interface PageMetadataResponse {
  code: string;
  data: {
    pageId: string;
    name: string;
    title: string;
    contentType: string;
    note?: string;
    contentPath: string;
    chapterId: string;
    bookId: number;
    updateDateShow: string;
  };
}

// ===== 重新导出适配器基础类型 =====
export type { Product, TocItem, SearchResult, PageMetadata };
```

- [ ] **Step 2: 提交**

```bash
git add src/types.ts
git commit -m "refactor: update types with adapter base interfaces"
```

---

### Task 4: 创建天翼云适配器 `src/adapters/ctyun.ts`

**Files:**
- Create: `src/adapters/ctyun.ts`

- [ ] **Step 1: 从 `src/api.ts` 迁移逻辑到适配器**

```typescript
import * as cheerio from "cheerio";
import type {
  ListForHelpResponse,
  ContentQueryResponse,
  PageMetadataResponse,
} from "../types";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata } from "./base";

const BASE_URL = "https://www.ctyun.cn";

export class CtyunAdapter extends CloudDocAdapter {
  readonly provider = "ctyun";
  readonly name = "天翼云";

  private async request<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(`API request failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async listProducts(): Promise<Product[]> {
    const url = `${BASE_URL}/v2/portal/book/ListForHelp?bookClassDomain=product&_t=${Date.now()}`;
    const raw = await this.request<ListForHelpResponse>(url);
    const result: Product[] = [];
    for (const cat of raw.data?.list ?? []) {
      for (const p of cat.list) {
        result.push({
          productId: p.bookId,
          name: this.clean(p.bookName),
          description: this.clean(p.note),
        });
      }
    }
    return result;
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
    const res = await fetch(`${BASE_URL}/document/${productId}/`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: TocItem[] = [];
    const linkPattern = new RegExp(`^/document/${productId}/(\\d+)$`);

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const match = href.match(linkPattern);
      if (match) {
        const pageId = match[1];
        const title = $(el).text().trim();
        if (title && !items.some((i) => i.pageId === pageId)) {
          items.push({ pageId, title });
        }
      }
    });

    return items;
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const url = `${BASE_URL}/v2/portal/book/ContentQuery?bookId=${productId}&keyword=${encodeURIComponent(keyword)}&_t=${Date.now()}`;
    const raw = await this.request<ContentQueryResponse>(url);
    return (raw.data?.pages ?? []).map((p) => ({
      pageId: p.pageId,
      title: p.title,
      description: p.note,
    }));
  }

  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    const url = `${BASE_URL}/v2/portal/book/page/Get?pageId=${pageId}&_t=${Date.now()}`;
    const raw = await this.request<PageMetadataResponse>(url);
    const d = raw.data;
    return {
      pageId: d.pageId,
      title: d.title,
      note: d.note,
      contentPath: d.contentPath,
      chapterId: d.chapterId,
      bookId: String(d.bookId),
      updateDate: d.updateDateShow,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    const res = await fetch(contentPath, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(`Content fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.text();
  }

  /** 清理字符串中的 HTML 标签和特殊字符 */
  private clean(str: string): string {
    if (!str) return "";
    let result = str.replace(/<[^>]*>/g, "");
    result = result.replace(/&[a-zA-Z]+;/g, " ");
    result = result.replace(/[\n\r\t]/g, " ");
    result = result.replace(/\\/g, "");
    result = result.replace(/\s+/g, " ").trim();
    return result;
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/adapters/ctyun.ts
git commit -m "feat: add CtyunAdapter"
```

---

### Task 5: 创建适配器工厂 `src/adapters/index.ts`

**Files:**
- Create: `src/adapters/index.ts`

- [ ] **Step 1: 编写工厂函数**

```typescript
import { CloudDocAdapter } from "./base";
import { CtyunAdapter } from "./ctyun";

const adapters: Record<string, CloudDocAdapter> = {
  ctyun: new CtyunAdapter(),
};

/** 获取指定云厂商的适配器实例 */
export function getAdapter(provider: string): CloudDocAdapter {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`不支持的云厂商: ${provider}，当前支持的厂商: ${Object.keys(adapters).join(", ")}`);
  }
  return adapter;
}

/** 获取所有已注册的云厂商列表 */
export function getSupportedProviders(): { provider: string; name: string }[] {
  return Object.values(adapters).map((a) => ({
    provider: a.provider,
    name: a.name,
  }));
}
```

- [ ] **Step 2: 提交**

```bash
git add src/adapters/index.ts
git commit -m "feat: add adapter factory"
```

---

### Task 6: 重构 `src/index.ts` - Cloudflare 版使用适配器架构

**Files:**
- Modify: `src/index.ts` (完全重写)

- [ ] **Step 1: 重写 index.ts 使用适配器工厂**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { getAdapter } from "./adapters";
import { htmlToMarkdown } from "./utils/html-to-md";

interface Env {}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      return CtyunDocsMCP.serve("/mcp").fetch(request, env, ctx);
    }
    return new Response("Not found", { status: 404 });
  },
};

export class CtyunDocsMCP extends McpAgent<Env, unknown> {
  server = new McpServer(
    {
      name: "ctyun-docs-search",
      version: "1.0.0",
    },
    {
      instructions: `云厂商文档搜索 MCP Server。

## 工作流程
1. 先调用 list_products 获取所有产品列表，匹配用户关心的产品获取 productId
2. 调用 get_document_toc 获取产品文档目录，或 search_documents 按关键词搜索
3. 调用 get_page_metadata 获取页面元信息和 contentPath
4. 调用 get_page_content 获取文档 Markdown 正文

## 当前支持的云厂商
- ctyun - 天翼云

## 工具参数规范
| 工具 | 参数 | 说明 |
|------|------|------|
| list_products | provider: string | 云厂商标识，如 "ctyun" |
| get_document_toc | provider: string, productId: string | 产品文档 ID |
| search_documents | provider: string, productId: string, keyword: string | 搜索 |
| get_page_metadata | provider: string, pageId: string | 页面 ID |
| get_page_content | provider: string, contentPath: string | 正文 URL |

## 常用天翼云产品 productId
- 天翼云电脑（政企版）：10027004
- 弹性云主机 ECS：10026730`,
    }
  );

  async init() {
    this.server.registerTool(
      "list_products",
      {
        description: "获取指定云厂商的所有产品文档列表，返回产品名称和对应的 productId",
        inputSchema: z.object({
          provider: z.string().describe("云厂商标识，如 'ctyun'"),
        }).strict(),
        annotations: { readOnlyHint: true },
      },
      async ({ provider }: { provider: string }) => {
        const adapter = getAdapter(provider);
        const products = await adapter.listProducts();
        return {
          content: [{ type: "text", text: JSON.stringify(products) }],
        };
      }
    );

    this.server.registerTool(
      "get_document_toc",
      {
        description: "获取指定产品的文档目录树。参数 productId 来自 list_products 返回的 productId",
        inputSchema: z.object({
          provider: z.string().describe("云厂商标识"),
          productId: z.string().describe("产品文档 ID"),
        }).strict(),
        annotations: { readOnlyHint: true },
      },
      async ({ provider, productId }: { provider: string; productId: string }) => {
        const adapter = getAdapter(provider);
        const items = await adapter.getDocumentToc(productId);
        return {
          content: [{ type: "text", text: JSON.stringify(items, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "search_documents",
      {
        description: "在指定云厂商的产品文档中按关键词搜索，返回匹配的页面列表",
        inputSchema: z.object({
          provider: z.string().describe("云厂商标识"),
          productId: z.string().describe("产品文档 ID"),
          keyword: z.string().describe("搜索关键词"),
        }).strict(),
        annotations: { readOnlyHint: true },
      },
      async ({
        provider,
        productId,
        keyword,
      }: {
        provider: string;
        productId: string;
        keyword: string;
      }) => {
        const adapter = getAdapter(provider);
        const results = await adapter.searchDocuments(productId, keyword);
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "get_page_metadata",
      {
        description: "获取文档页面的元信息，包括标题和 contentPath。参数 pageId 来自 get_document_toc 或 search_documents",
        inputSchema: z.object({
          provider: z.string().describe("云厂商标识"),
          pageId: z.string().describe("文档页面 ID"),
        }).strict(),
        annotations: { readOnlyHint: true },
      },
      async ({ provider, pageId }: { provider: string; pageId: string }) => {
        const adapter = getAdapter(provider);
        const metadata = await adapter.getPageMetadata(pageId);
        return {
          content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "get_page_content",
      {
        description: "获取文档页面的完整 Markdown 正文。参数 contentPath 来自 get_page_metadata 返回的 contentPath",
        inputSchema: z.object({
          provider: z.string().describe("云厂商标识"),
          contentPath: z.string().describe("文档正文 URL"),
        }).strict(),
        annotations: { readOnlyHint: true },
      },
      async ({ provider, contentPath }: { provider: string; contentPath: string }) => {
        const adapter = getAdapter(provider);
        const html = await adapter.getPageContent(contentPath);
        const text = htmlToMarkdown(html);
        return {
          content: [{ type: "text", text }],
        };
      }
    );
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/index.ts
git commit -m "refactor: use adapter pattern in Cloudflare entry"
```

---

### Task 7: 重构 `src/stdio.ts` - 本地版使用适配器架构

**Files:**
- Modify: `src/stdio.ts` (完全重写)

- [ ] **Step 1: 重写 stdio.ts 使用适配器工厂**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAdapter } from "./adapters";

const server = new McpServer(
  {
    name: "ctyun-docs-search",
    version: "1.0.0",
  },
  {
    instructions: `云厂商文档搜索 MCP Server。

工作流程：
1. 先调用 list_products 获取所有产品列表
2. 调用 get_document_toc 或 search_documents
3. 调用 get_page_metadata 获取 contentPath
4. 调用 get_page_content 获取 Markdown 正文

当前支持的云厂商：ctyun - 天翼云`,
  }
);

server.registerTool(
  "list_products",
  {
    description: "获取指定云厂商的所有产品文档列表",
    inputSchema: z.object({
      provider: z.string().describe("云厂商标识，如 'ctyun'"),
    }).strict(),
  },
  async ({ provider }: { provider: string }) => {
    const adapter = getAdapter(provider);
    const products = await adapter.listProducts();
    return { content: [{ type: "text", text: JSON.stringify(products, null, 2) }] };
  }
);

server.registerTool(
  "get_document_toc",
  {
    description: "获取指定产品的文档目录树",
    inputSchema: z.object({
      provider: z.string().describe("云厂商标识"),
      productId: z.string().describe("产品文档 ID"),
    }).strict(),
  },
  async ({ provider, productId }: { provider: string; productId: string }) => {
    const adapter = getAdapter(provider);
    const items = await adapter.getDocumentToc(productId);
    return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
  }
);

server.registerTool(
  "search_documents",
  {
    description: "在指定云厂商的产品文档中按关键词搜索",
    inputSchema: z.object({
      provider: z.string().describe("云厂商标识"),
      productId: z.string().describe("产品文档 ID"),
      keyword: z.string().describe("搜索关键词"),
    }).strict(),
  },
  async ({ provider, productId, keyword }: { provider: string; productId: string; keyword: string }) => {
    const adapter = getAdapter(provider);
    const results = await adapter.searchDocuments(productId, keyword);
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  }
);

server.registerTool(
  "get_page_metadata",
  {
    description: "获取文档页面的元信息，包括标题和 contentPath",
    inputSchema: z.object({
      provider: z.string().describe("云厂商标识"),
      pageId: z.string().describe("文档页面 ID"),
    }).strict(),
  },
  async ({ provider, pageId }: { provider: string; pageId: string }) => {
    const adapter = getAdapter(provider);
    const metadata = await adapter.getPageMetadata(pageId);
    return { content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }] };
  }
);

server.registerTool(
  "get_page_content",
  {
    description: "获取文档页面的完整 Markdown 正文",
    inputSchema: z.object({
      provider: z.string().describe("云厂商标识"),
      contentPath: z.string().describe("文档正文 URL"),
    }).strict(),
  },
  async ({ provider, contentPath }: { provider: string; contentPath: string }) => {
    const adapter = getAdapter(provider);
    const content = await adapter.getPageContent(contentPath);
    return { content: [{ type: "text", text: content }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

- [ ] **Step 2: 提交**

```bash
git add src/stdio.ts
git commit -m "refactor: use adapter pattern in stdio entry"
```

---

### Task 8: 删除旧文件并确保构建通过

**Files:**
- Delete: `src/api.ts`

- [ ] **Step 1: 删除旧 API 文件**

```bash
rm src/api.ts
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
npx tsc --noEmit
```

Expected: 无错误输出，退出码 0

- [ ] **Step 3: 提交**

```bash
git add src/api.ts
git commit -m "refactor: remove legacy api.ts, fully migrated to adapter pattern"
```

---

### Task 9: 更新 CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新项目文档中的架构描述**

```markdown
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
```

- [ ] **Step 2: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with adapter architecture"
```