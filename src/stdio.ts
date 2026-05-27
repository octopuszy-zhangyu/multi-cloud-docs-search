import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAdapter } from "./adapters/index.js";

const server = new McpServer(
  {
    name: "multi-cloud-docs-search",
    version: "1.0.0",
  },
  {
    instructions: `云厂商文档搜索 MCP Server。

工作流程：
1. 先调用 list_products 获取所有产品列表，匹配用户关心的产品获取 productId
2. 调用 get_document_toc 获取产品文档目录，或 search_documents 按关键词搜索
3. 调用 get_page_metadata 获取页面元信息和 contentPath
4. 调用 get_page_content 获取文档 Markdown 正文

当前支持的云厂商：
- ctyun - 天翼云
- aliyun - 阿里云
- volcengine - 火山引擎
- tencent - 腾讯云
- huawei - 华为云
- ecloud - 移动云`,
  }
);

server.registerTool(
  "list_products",
  {
    description: "获取指定云厂商的所有产品文档列表，返回产品名称和对应的 productId",
    inputSchema: z.object({
      provider: z.string().describe("云厂商标识，如 'ctyun'"),
    }).strict(),
  },
  async ({ provider }: { provider: string }) => {
    const adapter = getAdapter(provider);
    const products = await adapter.listProducts();
    return { content: [{ type: "text", text: JSON.stringify(products) }] };
  }
);

server.registerTool(
  "get_document_toc",
  {
    description: "获取指定产品的文档目录树。参数 productId 来自 list_products 返回的 productId",
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
    description: "在指定云厂商的产品文档中按关键词搜索，返回匹配的页面列表",
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
    description: "获取文档页面的元信息，包括标题和 contentPath。参数 pageId 来自 get_document_toc 或 search_documents",
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
    description: "获取文档页面的完整 Markdown 正文。参数 contentPath 来自 get_page_metadata 返回的 contentPath",
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

export async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
