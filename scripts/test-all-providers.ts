#!/usr/bin/env npx tsx
/**
 * 全云厂商全流程穿测脚本
 *
 * 用法:
 *   npm run test              # 适配器层测试 + 数据质量验证
 *   npm run test:mcp          # MCP 协议层测试（独立启动 Server）
 *   npm run test:retest       # 修复复测（只测上次失败的用例）
 *
 * 测试所有云厂商的 6 个 MCP 工具函数:
 * - list_products
 * - get_document_toc
 * - search_documents
 * - get_page_metadata
 * - get_page_content
 * - get_product_price
 *
 * 测试覆盖三种核心产品:
 * - ECS (弹性云服务器)
 * - 云电脑/云桌面
 * - Token/模型服务
 */

import { getAdapter } from "../src/adapters/index.js";
import type { CloudDocAdapter } from "../src/adapters/base.js";
import {
  TEST_PROVIDERS,
  colors,
  log,
  type TestResult,
  type TestReport,
  type DebugInfo,
  type ProviderTestConfig,
  type ProductTestConfig,
} from "./lib/types.js";
import { sampleCheck } from "./lib/quality.js";
import {
  printTerminalReport,
  saveJsonReport,
  saveMarkdownReport,
  saveFailureRecord,
  loadFailureRecord,
} from "./lib/reporter.js";

// ============= 命令行参数 =============

const args = process.argv.slice(2);
const isRetest = args.includes("--retest") || process.env.npm_lifecycle_event === "test:retest";
const isMcpMode = args.includes("--mcp") || process.env.npm_lifecycle_event === "test:mcp";
const filterProvider = args.find(a => a.startsWith("--provider="))?.split("=")[1];
const filterProduct = args.find(a => a.startsWith("--product="))?.split("=")[1];
const filterTool = args.find(a => a.startsWith("--tool="))?.split("=")[1];

// ============= 测试执行 =============

async function runTests() {
  const startTime = Date.now();
  const allResults: TestResult[] = [];
  const qualityReports: any[] = [];

  log("\n" + "=".repeat(60), "cyan");
  log(isRetest ? "修复复测模式" : isMcpMode ? "MCP 协议测试模式" : "多云文档搜索 MCP Server - 全流程穿测", "cyan");
  log("=".repeat(60) + "\n", "cyan");

  // 获取测试配置
  let providers = TEST_PROVIDERS;

  // 复测模式：只测上次失败的
  if (isRetest) {
    const failures = loadFailureRecord();
    if (failures.length === 0) {
      log("没有找到上次失败的记录，执行全量测试", "yellow");
    } else {
      log(`复测模式: 将重测 ${failures.length} 个失败用例`, "yellow");
      // 只测试失败的厂商
      const failedProviders = [...new Set(failures.map(f => f.provider))];
      providers = providers.filter(p => failedProviders.includes(p.provider));
    }
  }

  // 过滤指定厂商
  if (filterProvider) {
    providers = providers.filter(p => p.provider === filterProvider);
    log(`过滤厂商: ${filterProvider}`, "yellow");
  }

  for (const config of providers) {
    log(`\n测试 ${config.name} (${config.provider}):`, "cyan");

    let adapter: CloudDocAdapter;
    try {
      adapter = getAdapter(config.provider);
    } catch (error) {
      log(`  ✗ 适配器加载失败: ${error instanceof Error ? error.message : String(error)}`, "red");
      continue;
    }

    for (const product of config.products) {
      // 过滤指定产品
      if (filterProduct && product.id !== filterProduct) continue;

      log(`\n  产品: ${product.name} (${product.id}) [${product.category}]`, "yellow");

      // 测试 list_products (每个厂商只需测一次)
      if (product === config.products[0]) {
        const result = await runTest("list_products", config, product, adapter, async () => {
          const result = await adapter.listProducts({ keyword: "ecs" });
          if (!result || result.total === undefined || !Array.isArray(result.items)) {
            throw new Error("PaginatedResult 结构不完整: 缺少 items/total/page/pageSize/hasMore");
          }
          return { summary: `返回 ${result.total} 个产品`, data: result.items };
        });
        allResults.push(result);
      }

      // 测试 get_document_toc
      const tocResult = await runTest("get_document_toc", config, product, adapter, async () => {
        const result = await adapter.getDocumentToc(product.id, { pageSize: 5 });
        if (!result || result.total === undefined || !Array.isArray(result.items)) {
          throw new Error("PaginatedResult 结构不完整");
        }
        // 数据质量检查
        const qr = sampleCheck(result.items, "get_document_toc");
        qr.provider = config.provider;
        qr.productId = product.id;
        qualityReports.push(qr);
        return { summary: `返回 ${result.total} 个目录项`, data: result.items, quality: qr };
      });
      allResults.push(tocResult);

      // 测试 search_documents
      const searchResult = await runTest("search_documents", config, product, adapter, async () => {
        const result = await adapter.searchDocuments(product.id, "价格");
        if (!Array.isArray(result)) {
          throw new Error("应返回 SearchResult[]");
        }
        const qr = sampleCheck(result, "search_documents");
        qr.provider = config.provider;
        qr.productId = product.id;
        qualityReports.push(qr);
        return { summary: `返回 ${result.length} 个结果`, data: result, quality: qr };
      });
      allResults.push(searchResult);

      // 测试 get_page_metadata
      const metadataResult = await runTest("get_page_metadata", config, product, adapter, async () => {
        const toc = await adapter.getDocumentToc(product.id, { pageSize: 10 });
        const firstItem = findFirstPageId(toc.items);
        if (!firstItem) {
          throw new Error("目录为空，无法获取 pageId");
        }
        const result = await adapter.getPageMetadata(firstItem);
        if (!result || result.title === undefined || result.contentPath === undefined) {
          throw new Error("PageMetadata 缺少 title 或 contentPath");
        }
        return { summary: `title: ${result.title.substring(0, 30)}...`, data: result };
      });
      allResults.push(metadataResult);

      // 测试 get_page_content
      const contentResult = await runTest("get_page_content", config, product, adapter, async () => {
        const toc = await adapter.getDocumentToc(product.id, { pageSize: 10 });
        const firstItem = findFirstPageId(toc.items);
        if (!firstItem) {
          throw new Error("目录为空，无法获取 pageId");
        }
        const metadata = await adapter.getPageMetadata(firstItem);
        const result = await adapter.getPageContent(metadata.contentPath);
        if (typeof result !== "string") {
          throw new Error("应返回字符串");
        }
        if (result.length === 0) {
          throw new Error("返回内容为空");
        }
        // 检查内容质量
        if (result.length < 50) {
          return { summary: `返回 ${result.length} 字符 (内容过短)`, data: result.substring(0, 100) };
        }
        return { summary: `返回 ${result.length} 字符`, data: result.substring(0, 100) };
      });
      allResults.push(contentResult);

      // 测试 get_product_price
      const priceResult = await runTest("get_product_price", config, product, adapter, async () => {
        const result = await adapter.getProductPrice(product.id);
        if (!result || result.dataStatus === undefined || !Array.isArray(result.prices)) {
          throw new Error("PriceResult 缺少 dataStatus 或 prices");
        }
        // 数据质量检查
        const qr = sampleCheck(result.prices, "get_product_price");
        qr.provider = config.provider;
        qr.productId = product.id;
        qualityReports.push(qr);
        return { summary: `dataStatus: ${result.dataStatus}, prices: ${result.prices.length}`, data: result, quality: qr };
      });
      allResults.push(priceResult);
    }
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
    qualitySummary: {
      totalSampled: qualityReports.reduce((s, q) => s + q.sampleCount, 0),
      issuesFound: qualityReports.reduce((s, q) => s + q.issues.length, 0),
    },
    results: allResults,
    qualityReports,
  };

  // 输出报告
  printTerminalReport(report);
  saveJsonReport(report);
  saveMarkdownReport(report);
  saveFailureRecord(allResults);

  // 返回退出码
  const hasFailures = allResults.some(r => r.status === "fail");
  process.exit(hasFailures ? 1 : 0);
}

// ============= 测试运行器 =============

interface TestReturn {
  summary: string;
  data?: unknown;
  quality?: any;
}

async function runTest(
  tool: string,
  config: ProviderTestConfig,
  product: ProductTestConfig,
  adapter: CloudDocAdapter,
  testFn: () => Promise<TestReturn>,
): Promise<TestResult> {
  // 过滤指定工具
  if (filterTool && tool !== filterTool) {
    return {
      provider: config.provider,
      productId: product.id,
      tool,
      status: "skip",
      duration: 0,
      result: "已过滤",
    };
  }

  const start = Date.now();
  const debug: DebugInfo = { request: { productId: product.id } };

  try {
    const testReturn = await testFn();
    const duration = Date.now() - start;

    return {
      provider: config.provider,
      productId: product.id,
      tool,
      status: "pass",
      duration,
      result: testReturn.summary,
      debug: {
        request: debug.request,
        response: testReturn.data,
      },
    };
  } catch (error) {
    const duration = Date.now() - start;
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      provider: config.provider,
      productId: product.id,
      tool,
      status: "fail",
      duration,
      result: "调用失败",
      error: errorMessage,
      debug: {
        request: debug.request,
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}

// ============= 工具函数 =============

/**
 * 从目录树中递归查找第一个有效的 pageId
 * 跳过无效 pageId（如 "00000000"）
 */
function findFirstPageId(items: any[]): string | null {
  for (const item of items) {
    // 优先递归 children，找到叶子节点
    if (item.children && item.children.length > 0) {
      const found = findFirstPageId(item.children);
      if (found) return found;
    }
    // children 为空或无有效 pageId 时，返回自己的 pageId
    if (item.pageId && item.pageId !== "00000000") {
      return item.pageId;
    }
  }
  return null;
}

// ============= 启动 =============

runTests().catch(error => {
  log(`\n测试脚本执行失败: ${error}`, "red");
  console.error(error);
  process.exit(1);
});
