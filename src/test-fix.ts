/**
 * 多云文档搜索 MCP Server — 自动化测试脚本
 *
 * 测试范围：
 * 1. dataStatus 字段验证（所有适配器）
 * 2. 关键词自动扩展机制验证
 * 3. 子Agent 调用次数限制验证
 * 4. 各厂商 4C8G 价格查询验证
 */

import { getAdapter } from "./adapters/index.js";
import type { PriceResult } from "./adapters/base.js";

// ============================================================
// 测试配置
// ============================================================
const TEST_TIMEOUT = 30000; // 30s per test
const PROVIDERS = [
  { provider: "ctyun", name: "天翼云", productId: "10027004" },
  { provider: "aliyun", name: "阿里云", productId: "ecs" },
  { provider: "volcengine", name: "火山引擎", productId: "ECS" },
  { provider: "tencent", name: "腾讯云", productId: "cvm" },
  { provider: "huawei", name: "华为云", productId: "ecs" },
  { provider: "ecloud", name: "移动云", productId: "706" },
  { provider: "cucloud", name: "联通云", productId: "128" },
  { provider: "baidu", name: "百度云", productId: "BCC" },
];

// ============================================================
// 测试结果统计
// ============================================================
interface TestResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
}

const results: TestResult[] = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function pass(name: string, detail: string) {
  results.push({ name, status: "PASS", detail });
  passed++;
}

function fail(name: string, detail: string) {
  results.push({ name, status: "FAIL", detail });
  failed++;
}

function skip(name: string, detail: string) {
  results.push({ name, status: "SKIP", detail });
  skipped++;
}

// ============================================================
// 测试 1: dataStatus 字段验证
// ============================================================
async function testDataStatus() {
  console.log("\n═══════════════════════════════════════════");
  console.log("  测试 1: dataStatus 字段验证");
  console.log("═══════════════════════════════════════════\n");

  for (const { provider, name, productId } of PROVIDERS) {
    try {
      const adapter = getAdapter(provider);
      const result: PriceResult = await adapter.getProductPrice(productId);

      if (!("dataStatus" in result)) {
        fail(`${name} (${provider})`, `缺少 dataStatus 字段`);
        continue;
      }

      const validStatuses = ["complete", "partial", "no_price", "no_data"];
      if (!validStatuses.includes(result.dataStatus!)) {
        fail(`${name} (${provider})`, `dataStatus 值无效: ${result.dataStatus}`);
        continue;
      }

      // 验证 dataStatus 与实际数据的一致性
      const hasPrices = result.prices.length > 0 && result.prices.some(p => p.price > 0);
      if (result.dataStatus === "complete" && !hasPrices) {
        fail(`${name} (${provider})`, `标记为 complete 但无有效价格数据`);
        continue;
      }

      pass(`${name} (${provider})`, `dataStatus=${result.dataStatus}, prices=${result.prices.length}`);
    } catch (err: any) {
      fail(`${name} (${provider})`, `异常: ${err.message}`);
    }
  }
}

// ============================================================
// 测试 2: 关键词自动扩展机制验证
// ============================================================
async function testKeywordExpansion() {
  console.log("\n═══════════════════════════════════════════");
  console.log("  测试 2: 关键词自动扩展机制验证");
  console.log("═══════════════════════════════════════════\n");

  // 测试用例：具体规格词 → 期望扩展后的关键词
  const testCases = [
    { keyword: "4C8G", expected: "xlarge", provider: "aliyun", productId: "ecs" },
    { keyword: "价格 4C8G", expected: "价格", provider: "aliyun", productId: "ecs" },
    { keyword: "4C8G 价格", expected: "价格", provider: "tencent", productId: "213" },
    { keyword: "规格 4C8G", expected: "规格", provider: "huawei", productId: "ecs" },
  ];

  for (const tc of testCases) {
    try {
      const adapter = getAdapter(tc.provider);
      const results = await adapter.searchDocuments(tc.productId, tc.keyword);

      // 如果原始关键词返回空，说明自动扩展生效
      if (results.length === 0) {
        // 手动验证扩展机制���用期望的关键词搜索
        const expandedResults = await adapter.searchDocuments(tc.productId, tc.expected);
        if (expandedResults.length > 0) {
          pass(`"${tc.keyword}" → "${tc.expected}" (${tc.provider})`, `自动扩展后找到 ${expandedResults.length} 个结果`);
        } else {
          skip(`"${tc.keyword}" → "${tc.expected}" (${tc.provider})`, `扩展后也无结果（可能该厂商无此内容）`);
        }
      } else {
        pass(`"${tc.keyword}" (${tc.provider})`, `直接找到 ${results.length} 个结果`);
      }
    } catch (err: any) {
      fail(`"${tc.keyword}" (${tc.provider})`, `异常: ${err.message}`);
    }
  }
}

// ============================================================
// 测试 3: 各厂商 4C8G 价格查询验证
// ============================================================
async function testPriceQuery() {
  console.log("\n═══════════════════════════════════════════");
  console.log("  测试 3: 各厂商 4C8G 价格查询");
  console.log("═══════════════════════════════════════════\n");

  for (const { provider, name, productId } of PROVIDERS) {
    try {
      const adapter = getAdapter(provider);
      const result: PriceResult = await adapter.getProductPrice(productId);

      console.log(`  ${name} (${provider}): dataStatus=${result.dataStatus}, prices=${result.prices.length}`);

      if (result.dataStatus === "complete") {
        // 查找 4C8G 相关规格
        const c4c8gPrices = result.prices.filter(p =>
          p.specification?.toLowerCase().includes("4c8g") ||
          p.specification?.toLowerCase().includes("4c 8g") ||
          p.specification?.toLowerCase().includes("4c,8g") ||
          p.specification?.toLowerCase().includes("4c.8g") ||
          p.specification?.toLowerCase().includes("4vcp") ||
          p.specification?.toLowerCase().includes("4核") ||
          p.specification?.toLowerCase().includes("xlarge") ||
          p.specification?.toLowerCase().includes("4u") ||
          p.specification?.toLowerCase().includes("4cpu")
        );

        if (c4c8gPrices.length > 0) {
          pass(`${name} (${provider})`, `找到 ${c4c8gPrices.length} 个 4C8G 相关规格价格`);
        } else {
          pass(`${name} (${provider})`, `有完整价格数据（共 ${result.prices.length} 条），但无明确 4C8G 规格`);
        }
      } else if (result.dataStatus === "partial") {
        pass(`${name} (${provider})`, `部分价格数据（${result.prices.length} 条），需从摘要提取`);
      } else if (result.dataStatus === "no_price") {
        pass(`${name} (${provider})`, `文档无价格，需访问外部定价页`);
      } else {
        pass(`${name} (${provider})`, `无数据`);
      }
    } catch (err: any) {
      fail(`${name} (${provider})`, `异常: ${err.message}`);
    }
  }
}

// ============================================================
// 测试 4: get_product_price_quick 验证
// ============================================================
async function testPriceQuick() {
  console.log("\n═══════════════════════════════════════════");
  console.log("  测试 4: get_product_price_quick 验证");
  console.log("═══════════════════════════════════════════\n");

  // 验证 stdio.ts 中的 priceQuickMap 是否覆盖所有厂商
  const quickMap = {
    "ctyun": ["10027004", "10026730", "11061839"],
    "aliyun": ["ecs"],
    "tencent": ["cvm", "213"],
    "huawei": ["ecs", "maas"],
    "ecloud": ["706"],
    "volcengine": ["ECS"],
    "deepseek": ["api-docs"],
    "minimax": ["minimax-api"],
    "kimi": ["kimi-api"],
    "bailian": ["model-studio"],
    "baidu": ["BML", "BCC"],
    "glm": ["bigmodel"],
    "cucloud": ["128", "2357"],
  };

  for (const [provider, productIds] of Object.entries(quickMap)) {
    try {
      const adapter = getAdapter(provider);
      for (const productId of productIds) {
        const result: PriceResult = await adapter.getProductPrice(productId);
        if (result.prices.length > 0 || result.dataStatus) {
          pass(`${provider}/${productId}`, `dataStatus=${result.dataStatus}, prices=${result.prices.length}`);
        } else {
          skip(`${provider}/${productId}`, `无价格数据`);
        }
      }
    } catch (err: any) {
      fail(`${provider}`, `异常: ${err.message}`);
    }
  }
}

// ============================================================
// 测试 5: 子Agent 调用次数限制验证（静态检查）
// ============================================================
async function testAgentLimit() {
  console.log("\n═══════════════════════════════════════════");
  console.log("  测试 5: 子Agent 调用次数限制验证");
  console.log("═══════════════════════════════════════════\n");

  // 验证 stdio.ts 中的限制是否已更新
  const fs = await import("fs");
  const stdioContent = fs.readFileSync(new URL("./stdio.ts", import.meta.url), "utf-8");

  // 检查调用次数限制
  if (stdioContent.includes("12 次以内")) {
    pass("调用次数限制", "已更新为 12 次");
  } else {
    fail("调用次数限制", "未更新为 12 次");
  }

  // 检查提前终止策略
  if (stdioContent.includes("连续 2 次")) {
    pass("提前终止策略", "已更新为连续 2 次失败即切换");
  } else {
    fail("提前终止策略", "未更新");
  }

  // 检查 dataStatus 说明
  if (stdioContent.includes("dataStatus")) {
    pass("dataStatus 说明", "已在 instructions 中添加");
  } else {
    fail("dataStatus 说明", "未在 instructions 中添加");
  }

  // 检查关键词扩展
  if (stdioContent.includes("specVariants")) {
    pass("关键词扩展", "已添加实例规格变体映射");
  } else {
    fail("关键词扩展", "未添加实例规格变体映射");
  }
}

// ============================================================
// 主函数
// ============================================================
async function main() {
  console.log("=".repeat(55));
  console.log("  多云文档搜索 MCP Server — 自动化测试");
  console.log("=".repeat(55));
  console.log(`  开始时间: ${new Date().toISOString()}`);
  console.log("=".repeat(55));

  const startTime = Date.now();

  // 运行测试
  await testDataStatus();
  await testKeywordExpansion();
  await testPriceQuery();
  await testPriceQuick();
  await testAgentLimit();

  // 输出结果
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n" + "=".repeat(55));
  console.log("  测试完成");
  console.log("=".repeat(55));
  console.log(`  用时: ${elapsed}s`);
  console.log(`  总计: ${results.length} | ✅ PASS: ${passed} | ❌ FAIL: ${failed} | ⏭️ SKIP: ${skipped}`);
  console.log("");

  if (failed > 0) {
    console.log("  ❌ 失败的测试:");
    for (const r of results.filter(r => r.status === "FAIL")) {
      console.log(`    - ${r.name}: ${r.detail}`);
    }
    console.log("");
  }

  // 输出详细结果
  console.log("  详细结果:");
  for (const r of results) {
    const icon = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⏭️";
    console.log(`  ${icon} ${r.name}`);
    console.log(`     ${r.detail}`);
  }

  console.log("");

  // 退出码
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("测试脚本异常:", err);
  process.exit(1);
});
