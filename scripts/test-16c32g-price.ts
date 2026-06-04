/**
 * 查询 16C32G 云服务器价格
 * 模拟 MCP 工具 get_product_price 的调用
 */
import { getAdapter } from "../src/adapters/index.js";

const SPEC = "16C32G";

const providers = [
  { provider: "aliyun", name: "阿里云", productId: "ecs" },
  { provider: "tencent", name: "腾讯云", productId: "213" },
  { provider: "ctyun", name: "天翼云", productId: "10026730" },
  { provider: "volcengine", name: "火山引擎", productId: "6396" },
  { provider: "huawei", name: "华为云", productId: "ecs" },
  { provider: "ecloud", name: "移动云", productId: "706" },
  { provider: "cucloud", name: "联通云", productId: "128" },
  { provider: "baidu", name: "百度云", productId: "BCC" },
];

console.log("=".repeat(85));
console.log(`  🔍 查询 ${SPEC} 云服务器价格 - 规格-配置-价格联合表`);
console.log("=".repeat(85));

const results: Array<{
  provider: string;
  name: string;
  specTable: any[];
  bestRegion: any[];
  error?: string;
}> = [];

for (const p of providers) {
  console.log(`\n📦 ${p.name} (${p.provider}) 正在查询...`);

  try {
    const adapter = getAdapter(p.provider) as any;

    // Step 1: 构建规格价格表
    const specTable = await adapter.buildSpecPriceTable(p.productId);
    console.log(`   规格价格表: ${specTable.length} 条（${new Set(specTable.map(i => i.region)).size} 个region）`);

    // Step 2: 自动选规格最全的 region + 按16C32G过滤
    const bestRegion = adapter.pickBestRegion(specTable, SPEC);
    const selectedRegion = bestRegion[0]?.region || "默认";
    console.log(`   最佳region: ${selectedRegion}, 匹配到 ${bestRegion.length} 条`);

    results.push({
      provider: p.provider,
      name: p.name,
      specTable,
      bestRegion
    });

  } catch (err) {
    console.log(`   ❌ 错误: ${err instanceof Error ? err.message : String(err)}`);
    results.push({
      provider: p.provider,
      name: p.name,
      specTable: [],
      bestRegion: [],
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

// 汇总输出
console.log("\n\n" + "=".repeat(85));
console.log(`  📊 ${SPEC} 价格汇总表`);
console.log("=".repeat(85));

console.log(`\n${"厂商".padEnd(10)} ${"规格".padEnd(28)} ${"包月(元/月)".padEnd(14)} ${"按量(元/时)".padEnd(14)} ${"地域".padEnd(12)}`);
console.log("-".repeat(85));

for (const r of results) {
  if (r.error) {
    console.log(`${r.name.padEnd(10)} ❌ 查询失败: ${r.error}`);
    continue;
  }

  const filtered = r.bestRegion;

  if (filtered.length === 0) {
    console.log(`${r.name.padEnd(10)} ⚠️ 未匹配到 ${SPEC} 数据`);
    continue;
  }

  // 按规格名去重，展示不同规格的价格
  const bySpec = new Map<string, { specName: string; monthly?: number; hourly?: number; region: string }>();
  for (const item of filtered) {
    // 跳过纯包年（不包含"包年包月"）
    if (item.billingMode.includes("年") && !item.billingMode.includes("包年包月")) continue;

    if (!bySpec.has(item.specName)) {
      bySpec.set(item.specName, { specName: item.specName, region: item.region || "", monthly: undefined, hourly: undefined });
    }
    const entry = bySpec.get(item.specName)!;
    if (item.billingMode.includes("包月") || item.billingMode.includes("包年包月")) {
      entry.monthly = item.price;
    } else if (item.billingMode.includes("按量") || item.billingMode.includes("时")) {
      entry.hourly = item.price;
    }
  }

  // 显示前5个规格
  const specs = Array.from(bySpec.values()).slice(0, 5);
  for (let i = 0; i < specs.length; i++) {
    const s = specs[i];
    const monthly = s.monthly ? `${s.monthly}` : "-";
    const hourly = s.hourly ? `${s.hourly}` : "-";
    const name = i === 0 ? r.name : "".padEnd(10);
    console.log(`${name.padEnd(10)} ${s.specName.substring(0, 25).padEnd(28)} ${monthly.padEnd(14)} ${hourly.padEnd(14)} ${s.region.substring(0, 10).padEnd(12)}`);
  }
  if (bySpec.size > 5) {
    console.log(`${"".padEnd(10)} ... 还有 ${bySpec.size - 5} 个规格`);
  }
}

console.log("\n" + "=".repeat(85));
console.log("  💡 说明: 价格数据来自各云厂商官方定价，仅供参考");
console.log("=".repeat(85));

// 额外：AI 厂商价格（Token 服务）
console.log("\n\n" + "=".repeat(85));
console.log("  🤖 AI 厂商 API 价格（Token计费）");
console.log("=".repeat(85));

const aiProviders = [
  { provider: "deepseek", name: "DeepSeek" },
  { provider: "glm", name: "智谱GLM" },
  { provider: "minimax", name: "MiniMax" },
  { provider: "kimi", name: "Kimi" },
  { provider: "bailian", name: "百炼" },
];

for (const p of aiProviders) {
  try {
    const adapter = getAdapter(p.provider);
    const priceResult = await adapter.getProductPrice();
    const prices = priceResult.prices || [];
    
    if (prices.length === 0) {
      console.log(`${p.name}: ⚠️ 无价格数据`);
      continue;
    }

    // 查找 input/output 价格
    const inputPrice = prices.find(i => i.productName?.toLowerCase().includes("input") || i.productName?.toLowerCase().includes("输入"));
    const outputPrice = prices.find(i => i.productName?.toLowerCase().includes("output") || i.productName?.toLowerCase().includes("输出"));
    
    console.log(`${p.name}:`);
    if (inputPrice) console.log(`  输入: ${inputPrice.price} ${inputPrice.unit}`);
    if (outputPrice) console.log(`  输出: ${outputPrice.price} ${outputPrice.unit}`);
    if (!inputPrice && !outputPrice) {
      // 显示前2个价格
      for (const pr of prices.slice(0, 2)) {
        console.log(`  ${pr.productName}: ${pr.price} ${pr.unit}`);
      }
    }
  } catch (err) {
    console.log(`${p.name}: ❌ ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("\n✅ 查询完成");
