import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { CtyunApi } from "./api";

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
        inputSchema: z.object({}).strict(),
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
        inputSchema: z.object({
          bookId: z.string().describe("产品文档 ID，如 '10027004'（天翼云电脑）"),
        }).strict(),
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
        inputSchema: z.object({
          bookId: z.string().describe("产品文档 ID"),
          keyword: z.string().describe("搜索关键词，如 '登录', '备份', '计费'"),
        }).strict(),
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
        inputSchema: z.object({
          pageId: z.string().describe("文档页面 ID"),
        }).strict(),
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
        inputSchema: z.object({
          contentPath: z.string().describe("文档正文 URL，来自 get_page_metadata 返回的 contentPath"),
        }).strict(),
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