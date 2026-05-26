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
- aliyun - 阿里云
- volcengine - 火山引擎
- tencent - 腾讯云

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
- 弹性云主机 ECS：10026730

## 常用腾讯云产品 productId
- 云服务器 CVM：213
- 大模型服务平台 TokenHub：1823`,
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
