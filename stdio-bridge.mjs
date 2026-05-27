/**
 * stdio 桥接脚本 — 通过 Streamable HTTP 连接远程 Worker MCP 端点
 * 用法: node stdio-bridge.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const REMOTE_URL = process.env.REMOTE_URL || "https://mcp.nj-telecom.cn/mcp";

async function main() {
  // 1. 通过 Streamable HTTP 连接到远程 Worker
  const httpTransport = new StreamableHTTPClientTransport(new URL(REMOTE_URL));
  const client = new Client(
    { name: "multi-cloud-docs-search-bridge", version: "1.0.0" },
    { capabilities: {} }
  );
  await client.connect(httpTransport);

  // 2. 获取远程工具列表
  const { tools } = await client.listTools();

  // 3. 创建本地 stdio 服务器
  const server = new Server(
    { name: "multi-cloud-docs-search", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // 注册工具列表
  server.registerCapabilities({ tools: { tools: tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })) } });

  // 注册 listTools 处理器
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })) };
  });

  // 代理工具调用到远程
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await client.callTool({ name, arguments: args });
    return result;
  });

  // 4. 连接 stdio 传输
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
}

main().catch((err) => {
  console.error("Bridge error:", err);
  process.exit(1);
});