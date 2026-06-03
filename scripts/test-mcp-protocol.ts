#!/usr/bin/env npx tsx
/**
 * MCP 协议层测试脚本
 *
 * 独立启动 MCP Server 进程，通过 JSON-RPC 协议通信。
 * 避免与 Claude 已加载的 MCP Server 冲突。
 *
 * 用法: npm run test:mcp
 */

import { McpClient } from "./lib/mcp-client.js";
import { TEST_PROVIDERS, colors, log, type TestResult, type TestReport } from "./lib/types.js";
import { printTerminalReport, saveJsonReport, saveMarkdownReport, saveFailureRecord } from "./lib/reporter.js";

async function runMcpTests() {
  const startTime = Date.now();
  const allResults: TestResult[] = [];

  log("\n" + "=".repeat(60), "cyan");
  log("MCP 协议层测试", "cyan");
  log("=".repeat(60) + "\n", "cyan");

  // 启动 MCP Server
  log("启动 MCP Server...", "yellow");
  const client = new McpClient();
  try {
    await client.start();
    log("MCP Server 已启动\n", "green");
  } catch (error) {
    log(`MCP Server 启动失败: ${error}`, "red");
    process.exit(1);
  }

  try {
    for (const config of TEST_PROVIDERS) {
      log(`\n测试 ${config.name} (${config.provider}):`, "cyan");

      for (const product of config.products) {
        log(`\n  产品: ${product.name} (${product.id}) [${product.category}]`, "yellow");

        // 测试 list_products
        if (product === config.products[0]) {
          const result = await testMcpTool(client, config.provider, "-", "list_products", {
            provider: config.provider,
            keyword: "ecs",
          });
          allResults.push(result);
        }

        // 测试 get_document_toc
        const tocResult = await testMcpTool(client, config.provider, product.id, "get_document_toc", {
          provider: config.provider,
          productId: product.id,
          pageSize: 5,
        });
        allResults.push(tocResult);

        // 测试 search_documents
        const searchResult = await testMcpTool(client, config.provider, product.id, "search_documents", {
          provider: config.provider,
          productId: product.id,
          keyword: "价格",
        });
        allResults.push(searchResult);

        // 测试 get_product_price
        const priceResult = await testMcpTool(client, config.provider, product.id, "get_product_price", {
          provider: config.provider,
          productId: product.id,
        });
        allResults.push(priceResult);
      }
    }
  } finally {
    // 停止 MCP Server
    await client.stop();
    log("\nMCP Server 已停止", "yellow");
  }

  // 生成报告
  const duration = Date.now() - startTime;
  const report: TestReport = {
    timestamp: new Date().toISOString(),
    summary: {
      total: allResults.length,
      pass: allResults.filter(r => r.status === "pass").length,
      fail: allResults.filter(r => r.status === "fail").length,
      skip: allResults.filter(r => r.status === "skip").length,
      duration,
    },
    qualitySummary: { totalSampled: 0, issuesFound: 0 },
    results: allResults,
    qualityReports: [],
  };

  printTerminalReport(report);
  saveJsonReport(report);
  saveMarkdownReport(report);
  saveFailureRecord(allResults);

  const hasFailures = allResults.some(r => r.status === "fail");
  process.exit(hasFailures ? 1 : 0);
}

async function testMcpTool(
  client: McpClient,
  provider: string,
  productId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<TestResult> {
  const start = Date.now();

  try {
    const response = await client.callTool(tool, args);
    const duration = Date.now() - start;

    // 验证 MCP 响应格式
    const validation = client.validateResponse(response);
    if (!validation.valid) {
      return {
        provider,
        productId,
        tool,
        status: "fail",
        duration,
        result: "MCP 响应格式错误",
        error: validation.error,
        debug: { request: args, response },
      };
    }

    // 解析 JSON 内容
    try {
      const data = client.parseResult(response);
      return {
        provider,
        productId,
        tool,
        status: "pass",
        duration,
        result: `MCP 响应正常, 数据已解析`,
        debug: { request: args, response: data },
      };
    } catch {
      // 内容不是 JSON（如 get_page_content 返回纯文本）
      return {
        provider,
        productId,
        tool,
        status: "pass",
        duration,
        result: `MCP 响应正常 (非 JSON 内容)`,
        debug: { request: args },
      };
    }
  } catch (error) {
    const duration = Date.now() - start;
    return {
      provider,
      productId,
      tool,
      status: "fail",
      duration,
      result: "MCP 调用失败",
      error: error instanceof Error ? error.message : String(error),
      debug: { request: args },
    };
  }
}

runMcpTests().catch(error => {
  log(`\nMCP 测试脚本执行失败: ${error}`, "red");
  console.error(error);
  process.exit(1);
});
