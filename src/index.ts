import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import * as cheerio from "cheerio";
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

export class CtyunDocsMCP extends McpAgent<Env, unknown> {
  server = new McpServer(
    {
      name: "ctyun-docs-search",
      version: "1.0.0",
    },
    {
      instructions: `天翼云文档搜索 MCP Server。

## 工作流程
1. 先调用 list_products 获取所有产品列表，匹配用户关心的产品获取 bookId
2. 调用 get_document_toc 获取产品文档目录，或 search_documents 按关键词搜索
3. 调用 get_page_metadata 获取页面元信息和 contentPath
4. 调用 get_page_content 获取文档 Markdown 正文

## 常用产品 bookId
- 天翼云电脑（政企版）：10027004
- 弹性云主机 ECS：10026730

## 工具参数规范（必须严格遵守）
| 工具 | 参数 | 说明 |
|------|------|------|
| list_products | 无参数 | 调用时传空对象 {} |
| get_document_toc | bookId: string | 产品文档 ID，如 "10027004" |
| search_documents | bookId: string, keyword: string | bookId 为产品 ID，keyword 为搜索词 |
| get_page_metadata | pageId: string | 文档页面 ID，如 "10028086" |
| get_page_content | contentPath: string | 文档正文 URL，来自 get_page_metadata 返回的 contentPath 字段 |

## 常见错误
- get_page_content 不需要 bookId 或 pageId，只需要 contentPath（一个 URL 字符串）
- get_page_metadata 不需要 bookId，只需要 pageId
- 所有参数都是字符串类型`,
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
        const raw = await this.api.listProducts();
        const categories = raw.data?.list?.map((cat) => ({
          categoryName: cat.bookClassName,
          products: cat.list.map((p) => ({
            bookId: p.bookId,
            name: p.bookName,
            description: p.note,
          })),
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(categories, null, 2),
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
        const result = items.map((item) => ({
          pageId: item.pageId,
          title: item.title,
        }));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
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
        const raw = await this.api.searchDocuments(bookId, keyword);
        const result = {
          bookName: raw.data?.bookName,
          pages: (raw.data?.pages ?? []).map((p) => ({
            pageId: p.pageId,
            title: p.title,
            description: p.note,
          })),
        };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
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
        const raw = await this.api.getPageMetadata(pageId);
        const d = raw.data;
        const result = {
          pageId: d.pageId,
          title: d.title,
          note: d.note,
          contentPath: d.contentPath,
          chapterId: d.chapterId,
          bookId: String(d.bookId),
          updateDate: d.updateDateShow,
        };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
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
        const html = await this.api.getPageContent(contentPath);
        const $ = cheerio.load(html);

        // 移除不需要的标签，但保留表格、列表、代码块等结构化内容
        $("script, style, img, nav, footer, header, aside, .ad, .advertisement").remove();

        // 将表格转换为 Markdown 格式
        $("table").each((_, table) => {
          const $table = $(table);
          const rows: string[] = [];

          $table.find("tr").each((_, tr) => {
            const cells: string[] = [];
            $(tr).find("th, td").each((_, cell) => {
              let text = $(cell).text().trim().replace(/\s+/g, " ");
              // 处理单元格中的换行
              text = text.replace(/\n/g, " ");
              cells.push(text);
            });
            if (cells.length > 0) {
              rows.push("| " + cells.join(" | ") + " |");
            }
          });

          // 添加分隔行
          if (rows.length > 1) {
            const headerCells = rows[0].split("|").filter((_, i, arr) => i > 0 && i < arr.length - 1);
            const separator = "| " + headerCells.map(() => "---").join(" | ") + " |";
            rows.splice(1, 0, separator);
          }

          $table.after("\n" + rows.join("\n") + "\n");
          $table.remove();
        });

        // 清理空行和多余空白
        let text = $("body").html() || "";
        // 移除空标签
        text = text.replace(/<(\w+)[^>]*>\s*<\/\1>/g, "");
        // 将剩余 HTML 标签替换为换行
        text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|td|th|blockquote|pre|section)[^>]*>/gi, "\n");
        // 移除其他标签但保留内容
        text = text.replace(/<[^>]+>/g, "");
        // 清理多余空白
        text = text.replace(/[ \t]+/g, " ");
        text = text.replace(/\n\s*\n/g, "\n\n");
        text = text.trim();

        return {
          content: [
            {
              type: "text",
              text: text || "(空内容)",
            },
          ],
        };
      }
    );
  }
}