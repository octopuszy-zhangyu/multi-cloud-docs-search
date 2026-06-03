#!/usr/bin/env npx tsx
/**
 * 修复复测脚本
 *
 * 只测试上次失败的用例，快速验证修复是否有效。
 *
 * 用法:
 *   npm run test:retest           # 复测所有失败的用例
 *   npm run test:retest -- --provider=ctyun  # 只复测指定厂商
 */

import { loadFailureRecord } from "./lib/reporter.js";
import { colors, log } from "./lib/types.js";

function runRetest() {
  log("\n" + "=".repeat(60), "cyan");
  log("修复复测模式", "cyan");
  log("=".repeat(60) + "\n", "cyan");

  const failures = loadFailureRecord();

  if (failures.length === 0) {
    log("没有找到上次失败的记录", "yellow");
    log("请先运行: npm run test", "yellow");
    process.exit(0);
  }

  log(`上次失败用例: ${failures.length} 个\n`, "yellow");

  // 按厂商分组
  const byProvider: Record<string, typeof failures> = {};
  for (const f of failures) {
    if (!byProvider[f.provider]) byProvider[f.provider] = [];
    byProvider[f.provider].push(f);
  }

  // 显示失败用例
  for (const [provider, items] of Object.entries(byProvider)) {
    log(`${provider}:`, "cyan");
    for (const f of items) {
      log(`  - ${f.productId}/${f.tool}`, "red");
      log(`    错误: ${f.error}`, "red");
    }
  }

  log("\n" + "=".repeat(60), "cyan");
  log("修复后，运行以下命令复测:", "cyan");
  log("=".repeat(60), "cyan");
  log("\n  npm run test", "green");
  log("\n或指定厂商复测:", "green");
  for (const provider of Object.keys(byProvider)) {
    log(`  npm run test -- --provider=${provider}`, "green");
  }

  log("\n");
}

runRetest();
