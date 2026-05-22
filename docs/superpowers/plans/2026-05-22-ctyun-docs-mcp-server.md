# 天翼云文档搜索 MCP Server 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将天翼云文档搜索 SKILL 改造成 MCP Server，部署在 Cloudflare Pages 上

**Architecture:** Cloudflare Pages Function 使用 McpAgent 处理 streamable HTTP，注册 5 个只读工具，每个工具调用天翼云公开 REST API

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `agents` (Cloudflare McpAgent), `zod`, `cheerio` (HTML 解析)

---

### Task 1: 初始化项目和安装依赖

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "ctyun-docs-search",
  "version": "1.0.0",
  "description": "MCP Server for 天翼云(CTYUN) documentation search",
  "main": "src/index.ts",
  "scripts": {
    "dev": "wrangler pages dev",
    "build": "wrangler pages functions build",
    "deploy": "wrangler pages deploy"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.18.0",
    "agents": "^0.12.13",
    "zod": "^3.24.0",
    "cheerio": "^1.0.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250301.0",
    "typescript": "^5.7.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "functions/**/*.ts"]
}
```

- [ ] **Step 3: 创建 wrangler.toml**

```toml
name = "ctyun-docs-search"
pages_build_output_dir = ".vercel/output/static"

[compatibility_date]
compatibility_date = "2025-03-10"

[compatibility_flags]
compatibility_flags = ["nodejs_compat"]

[durable_objects]
bindings = [
  { class_name = "CtyunDocsMCP", name = "MCP_OBJECT" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["CtyunDocsMCP"]
```

- [ ] **Step 4: 安装依赖**

Run: `npm install`
Expected: `node_modules` 目录生成，无错误

- [ ] **Step 5: 创建 .gitignore**

```
node_modules/
dist/
.wrangler/
```

- [ ] **Step 6: 提交**

```bash
git add package.json tsconfig.json wrangler.toml .gitignore
git commit -m "chore: init project with deps and config"
```

---

### Task 2: 创建类型定义

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: 定义天翼云 API 返回类型**

```typescript
/** ListForHelp API 返回的产品分类 */
export interface ProductCategory {
  bookClassId: string;
  bookClassName: string;
  list: ProductItem[];
}

/** 单个产品文档 */
export interface ProductItem {
  bookId: string;
  name: string;
  bookName: string;
  note: string;
  productId: string;
}

/** ListForHelp API 完整响应 */
export interface ListForHelpResponse {
  code: string;
  data: {
    list: ProductCategory[];
  };
}

/** ContentQuery API 返回的单个页面 */
export interface SearchPageItem {
  pageId: string;
  name: string;
  title: string;
  note?: string;
  contentType?: string;
}

/** ContentQuery API 完整响应 */
export interface ContentQueryResponse {
  code: string;
  data: {
    bookName: string;
    pages: SearchPageItem[];
  };
}

/** page/Get API 返回的页面元信息 */
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

/** 文档目录项 */
export interface TocItem {
  pageId: string;
  title: string;
}
```

- [ ] **Step 2: 提交**

```bash
git add src/types.ts
git commit -m "feat: add API type definitions"
```

---

### Task 3: 实现天翼云 API 封装

**Files:**
- Create: `src/api.ts`

- [ ] **Step 1: 实现 API 封装类**

```typescript
import * as cheerio from "cheerio";
import type {
  ListForHelpResponse,
  ContentQueryResponse,
  PageMetadataResponse,
  TocItem,
} from "./types";

const BASE_URL = "https://www.ctyun.cn";

export class CtyunApi {
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

  /** 获取所有产品文档列表 */
  async listProducts(): Promise<ListForHelpResponse> {
    const url = `${BASE_URL}/v2/portal/book/ListForHelp?bookClassDomain=product&_t=${Date.now()}`;
    return this.request<ListForHelpResponse>(url);
  }

  /** 从 HTML 提取产品文档目录 */
  async getDocumentToc(bookId: string): Promise<TocItem[]> {
    const res = await fetch(`${BASE_URL}/document/${bookId}/`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const html = await res.text();

    const $ = cheerio.load(html);
    const items: TocItem[] = [];
    const linkPattern = new RegExp(`^/document/${bookId}/(\\d+)$`);

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

  /** 在产品文档中搜索关键词 */
  async searchDocuments(
    bookId: string,
    keyword: string
  ): Promise<ContentQueryResponse> {
    const url = `${BASE_URL}/v2/portal/book/ContentQuery?bookId=${bookId}&keyword=${encodeURIComponent(keyword)}&_t=${Date.now()}`;
    return this.request<ContentQueryResponse>(url);
  }

  /** 获取文档页面元信息 */
  async getPageMetadata(pageId: string): Promise<PageMetadataResponse> {
    const url = `${BASE_URL}/v2/portal/book/page/Get?pageId=${pageId}&_t=${Date.now()}`;
    return this.request<PageMetadataResponse>(url);
  }

  /** 获取文档 Markdown 正文 */
  async getPageContent(contentPath: string): Promise<string> {
    const res = await fetch(contentPath, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(
        `Content fetch failed: ${res.status} ${res.statusText}`
      );
    }
    return res.text();
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/api.ts
git commit -m "feat: add ctyun API wrapper"
```

---

### Task 4: 实现 MCP Server 入口

**Files:**
- Create: `functions/api/[[route]].ts` (Cloudflare Pages Function 处理所有 /api/* 路由)
- Create: `src/index.ts` (McpAgent 定义)

实际上 Cloudflare Pages Functions 使用 `functions/` 目录结构，但 McpAgent 更适合直接作为 Worker 入口。对于 Pages，我们需要把 MCP server 放在一个 Function 路由中。

**Files:**
- Create: `functions/mcp.ts` (Pages Function，处理 /mcp 路径)

- [ ] **Step 1: 创建 Pages Function 入口**

```typescript
// functions/mcp.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { CtyunApi } from "../src/api";

class CtyunDocsMCP extends McpAgent<Env, unknown> {
  server = new McpServer(
    {
      name: "ctyun-docs-search",
      version: "1.0.0",
    },
    {
      instructions: `天翼云文档搜索 MCP Server。

工作流程：
1. 先调用 list_products 获取所有产品列表，匹配用户关心的产品获取 bookId
2. 调用 get_document_toc 获取产品文档目录，或 search_documents 按关键词搜索
3. 调用 get_page_metadata 获取页面元信息和 contentPath
4. 调用 get_page_content 获取文档 Markdown 正文

常用产品 bookId：天翼云电脑（政企版）= 10027004，弹性云主机 ECS = 10026730`,
    }
  );

  private api = new CtyunApi();

  async init() {
    this.server.registerTool(
      "list_products",
      {
        description: "获取天翼云所有产品文档的分类列表，返回产品名称和对应的 bookId",
        inputSchema: { type: "object", properties: {}, required: [] },
        annotations: { readOnlyHint: true },
      },
      async () => {
        const data = await this.api.listProducts();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }
    );

    this.server.registerTool(
      "get_document_toc",
      {
        description:
          "获取指定产品的文档目录树。参数 bookId 来自 list_products 返回的 bookId。返回文档页面的标题和 pageId 列表",
        inputSchema: {
          type: "object",
          properties: {
            bookId: {
              type: "string",
              description: "产品文档 ID，如 '10027004'（天翼云电脑）",
            },
          },
          required: ["bookId"],
        },
        annotations: { readOnlyHint: true },
      },
      async ({ bookId }: { bookId: string }) => {
        const items = await this.api.getDocumentToc(bookId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(items, null, 2),
            },
          ],
        };
      }
    );

    this.server.registerTool(
      "search_documents",
      {
        description:
          "在指定产品的文档中按关键词搜索，返回匹配的页面列表。参数 bookId 来自 list_products，keyword 为用户关心的关键词",
        inputSchema: {
          type: "object",
          properties: {
            bookId: {
              type: "string",
              description: "产品文档 ID",
            },
            keyword: {
              type: "string",
              description: "搜索关键词，如 '登录', '备份', '计费'",
            },
          },
          required: ["bookId", "keyword"],
        },
        annotations: { readOnlyHint: true },
      },
      async ({
        bookId,
        keyword,
      }: {
        bookId: string;
        keyword: string;
      }) => {
        const data = await this.api.searchDocuments(bookId, keyword);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }
    );

    this.server.registerTool(
      "get_page_metadata",
      {
        description:
          "获取文档页面的元信息，包括标题和 contentPath（文档正文地址）。参数 pageId 来自 get_document_toc 或 search_documents 返回的 pageId",
        inputSchema: {
          type: "object",
          properties: {
            pageId: {
              type: "string",
              description: "文档页面 ID",
            },
          },
          required: ["pageId"],
        },
        annotations: { readOnlyHint: true },
      },
      async ({ pageId }: { pageId: string }) => {
        const data = await this.api.getPageMetadata(pageId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      }
    );

    this.server.registerTool(
      "get_page_content",
      {
        description:
          "获取文档页面的完整 Markdown 正文。参数 contentPath 来自 get_page_metadata 返回的 contentPath 字段",
        inputSchema: {
          type: "object",
          properties: {
            contentPath: {
              type: "string",
              description: "文档正文 URL，来自 get_page_metadata 返回的 contentPath",
            },
          },
          required: ["contentPath"],
        },
        annotations: { readOnlyHint: true },
      },
      async ({ contentPath }: { contentPath: string }) => {
        const content = await this.api.getPageContent(contentPath);
        return {
          content: [
            {
              type: "text",
              text: content,
            },
          ],
        };
      }
    );
  }
}

export const onRequest = CtyunDocsMCP.serve("/mcp").fetch;
```

- [ ] **Step 2: 提交**

```bash
git add functions/mcp.ts src/index.ts
git commit -m "feat: implement MCP server with 5 tools"
```

---

### Task 5: 更新 Pages 配置

Cloudflare Pages Functions 使用 `functions/` 目录自动发现路由，但我们需要确保 wrangler.toml 配置正确。

- [ ] **Step 1: 更新 wrangler.toml 适配 Pages Function**

```toml
name = "ctyun-docs-search"

pages_build_output_dir = ".vercel/output/static"

[compatibility_date]
compatibility_date = "2025-03-10"

[compatibility_flags]
compatibility_flags = ["nodejs_compat"]

[durable_objects]
bindings = [
  { class_name = "CtyunDocsMCP", name = "MCP_OBJECT" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["CtyunDocsMCP"]
```

- [ ] **Step 2: 提交**

```bash
git add wrangler.toml
git commit -m "chore: update wrangler config for Pages Functions"
```

---

### Task 6: 更新 CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 CLAUDE.md 为 MCP 项目说明**

```markdown
# CLAUDE.md

## 项目概述

天翼云文档搜索 MCP Server。提供 5 个 MCP 工具用于搜索和获取天翼云官方产品文档。

## 技术栈

- TypeScript + `@modelcontextprotocol/sdk` + Cloudflare `McpAgent`
- 部署在 Cloudflare Pages（Git push 自动构建）

## 核心工具

| 工具 | 用途 |
|------|------|
| `list_products` | 获取所有产品文档列表 |
| `get_document_toc` | 从 HTML 提取产品文档目录 |
| `search_documents` | 在产品文档中按关键词搜索 |
| `get_page_metadata` | 获取文档页面元信息和 contentPath |
| `get_page_content` | 获取文档 Markdown 正文 |

## 常用命令

```bash
npm run dev      # 本地开发
npm run build    # 构建
```

## 常用产品 bookId

| 产品名称 | bookId |
|---------|--------|
| 天翼云电脑（政企版） | 10027004 |
| 弹性云主机 ECS | 10026730 |

## 注意事项

- `GetFolderBook` API 已废弃，目录需从 HTML 页面提取
- 所有工具为只读操作
- 天翼云 API 无需认证
- 详细 API 规范见 `skills/ctyun-docs-search/SKILL.md`
```

- [ ] **Step 2: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for MCP Server"
```

---

### Task 7: 更新 README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新 README.md**

```markdown
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
```

- [ ] **Step 2: 提交**

```bash
git add README.md
git commit -m "docs: update README for MCP Server"
```

---

### Task 8: 本地验证

- [ ] **Step 1: 构建项目**

Run: `npm run build`
Expected: 构建成功，无 TypeScript 错误

- [ ] **Step 2: 启动本地开发服务器**

Run: `npx wrangler pages dev`
Expected: 服务器启动在 `http://localhost:8788`，`/mcp` 路径可用

- [ ] **Step 3: 检查 Durable Objects 迁移**

```bash
npx wrangler deploy --dry-run
```
Expected: 显示 Durable Objects 迁移计划

- [ ] **Step 4: 确保迁移配置正确**

Run: `npx wrangler deploy`
Expected: 部署成功，输出 Pages 部署 URL