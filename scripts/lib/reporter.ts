/**
 * 报告生成器 - 终端 + JSON + Markdown 三种输出
 */

import * as fs from "fs";
import * as path from "path";
import type { TestReport, TestResult, QualityReport, QualityIssue } from "./types.js";
import { colors, log } from "./types.js";

const REPORTS_DIR = path.resolve(import.meta.dirname, "reports");

// ============= 终端输出 =============

export function printTerminalReport(report: TestReport): void {
  log("\n" + "=".repeat(60), "cyan");
  log("多云文档搜索 MCP Server - 全流程穿测报告", "cyan");
  log("=".repeat(60) + "\n", "cyan");

  // 按厂商分组输出
  const byProvider = groupByProvider(report.results);
  for (const [provider, results] of Object.entries(byProvider)) {
    log(`\n${provider}:`, "cyan");
    for (const r of results) {
      const statusColor = r.status === "pass" ? "green" : r.status === "fail" ? "red" : "yellow";
      const status = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "⊘";
      const duration = r.duration > 1000 ? ` (${(r.duration / 1000).toFixed(1)}s)` : ` (${r.duration}ms)`;
      log(`  ${status} ${r.tool}: ${r.result}${duration}`, statusColor);
      if (r.status === "fail" && r.error) {
        log(`    错误: ${r.error}`, "red");
        if (r.debug?.stack) {
          log(`    堆栈: ${r.debug.stack.split("\n").slice(0, 2).join(" → ")}`, "red");
        }
      }
    }
  }

  // 质量报告
  if (report.qualityReports.length > 0) {
    log("\n" + "-".repeat(40), "magenta");
    log("数据质量报告", "magenta");
    log("-".repeat(40), "magenta");
    for (const qr of report.qualityReports) {
      if (qr.issues.length > 0) {
        log(`  ${qr.tool}: ${qr.issues.length} 个问题`, "yellow");
        for (const issue of qr.issues.slice(0, 5)) {
          const sevColor = issue.severity === "error" ? "red" : "yellow";
          log(`    [${issue.severity}] ${issue.message}`, sevColor);
        }
        if (qr.issues.length > 5) {
          log(`    ... 还有 ${qr.issues.length - 5} 个问题`, "yellow");
        }
      }
    }
  }

  // 总结
  log("\n" + "=".repeat(60), "cyan");
  log("测试总结", "cyan");
  log("=".repeat(60), "cyan");
  log(`\n通过: ${report.summary.pass}`, "green");
  log(`失败: ${report.summary.fail}`, report.summary.fail > 0 ? "red" : "green");
  log(`跳过: ${report.summary.skip}`, "yellow");
  log(`总计: ${report.summary.total}`, "reset");
  log(`耗时: ${(report.summary.duration / 1000).toFixed(1)}s`, "reset");
  log(`数据质量: ${report.qualitySummary.totalSampled} 条抽样, ${report.qualitySummary.issuesFound} 个异常`, "reset");

  // 失败详情
  const failures = report.results.filter(r => r.status === "fail");
  if (failures.length > 0) {
    log("\n失败详情:", "red");
    for (const f of failures) {
      log(`  - ${f.provider}/${f.productId}/${f.tool}`, "red");
      log(`    错误: ${f.error}`, "red");
      if (f.debug?.request) {
        log(`    请求参数: ${JSON.stringify(f.debug.request)}`, "red");
      }
    }
  }

  log("\n");
}

// ============= JSON 报告 =============

export function saveJsonReport(report: TestReport): string {
  ensureReportsDir();
  const filename = `test-report-${formatTimestamp(report.timestamp)}.json`;
  const filepath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2), "utf-8");
  log(`JSON 报告已保存: ${filepath}`, "cyan");
  return filepath;
}

// ============= Markdown 报告 =============

export function saveMarkdownReport(report: TestReport): string {
  ensureReportsDir();
  const filename = `test-report-${formatTimestamp(report.timestamp)}.md`;
  const filepath = path.join(REPORTS_DIR, filename);

  const md = generateMarkdown(report);
  fs.writeFileSync(filepath, md, "utf-8");
  log(`Markdown 报告已保存: ${filepath}`, "cyan");
  return filepath;
}

function generateMarkdown(report: TestReport): string {
  const lines: string[] = [];
  const date = new Date(report.timestamp);

  lines.push(`# 全量穿测报告`);
  lines.push(``);
  lines.push(`**时间**: ${date.toLocaleString("zh-CN")}`);
  lines.push(`**耗时**: ${(report.summary.duration / 1000).toFixed(1)}s`);
  lines.push(``);

  // 总体统计
  lines.push(`## 总体统计`);
  lines.push(``);
  lines.push(`| 指标 | 值 |`);
  lines.push(`|------|-----|`);
  lines.push(`| 通过 | ${report.summary.pass}/${report.summary.total} (${((report.summary.pass / report.summary.total) * 100).toFixed(1)}%) |`);
  lines.push(`| 失败 | ${report.summary.fail} |`);
  lines.push(`| 跳过 | ${report.summary.skip} |`);
  lines.push(`| 数据质量 | ${report.qualitySummary.totalSampled} 条抽样, ${report.qualitySummary.issuesFound} 个异常 |`);
  lines.push(``);

  // 按厂商统计
  lines.push(`## 各厂商测试结果`);
  lines.push(``);
  lines.push(`| 厂商 | 通过 | 失败 | 通过率 |`);
  lines.push(`|------|------|------|--------|`);

  const byProvider = groupByProvider(report.results);
  for (const [provider, results] of Object.entries(byProvider)) {
    const pass = results.filter(r => r.status === "pass").length;
    const fail = results.filter(r => r.status === "fail").length;
    const total = results.length;
    const rate = ((pass / total) * 100).toFixed(1);
    lines.push(`| ${provider} | ${pass} | ${fail} | ${rate}% |`);
  }
  lines.push(``);

  // 失败详情
  const failures = report.results.filter(r => r.status === "fail");
  if (failures.length > 0) {
    lines.push(`## 失败详情`);
    lines.push(``);
    for (const f of failures) {
      lines.push(`### ${f.provider}/${f.productId}/${f.tool}`);
      lines.push(``);
      lines.push(`- **错误**: ${f.error}`);
      lines.push(`- **耗时**: ${f.duration}ms`);
      if (f.debug?.request) {
        lines.push(`- **请求参数**: \`${JSON.stringify(f.debug.request)}\``);
      }
      if (f.debug?.response) {
        lines.push(`- **响应**: \`\`\`json\n${JSON.stringify(f.debug.response, null, 2)}\n\`\`\``);
      }
      if (f.debug?.stack) {
        lines.push(`- **堆栈**: \`${f.debug.stack}\``);
      }
      lines.push(``);
    }
  }

  // 数据质量报告
  const qualityIssues = report.qualityReports.filter(q => q.issues.length > 0);
  if (qualityIssues.length > 0) {
    lines.push(`## 数据质量报告`);
    lines.push(``);
    for (const qr of qualityIssues) {
      lines.push(`### ${qr.tool}`);
      lines.push(``);
      lines.push(`| 类型 | 严重度 | 描述 |`);
      lines.push(`|------|--------|------|`);
      for (const issue of qr.issues) {
        lines.push(`| ${issue.type} | ${issue.severity} | ${issue.message} |`);
      }
      lines.push(``);
    }
  }

  // 修复建议
  if (failures.length > 0) {
    lines.push(`## 修复建议`);
    lines.push(``);
    for (const f of failures) {
      lines.push(`### ${f.provider}/${f.productId}/${f.tool}`);
      lines.push(``);
      lines.push(`**问题**: ${f.error}`);
      lines.push(``);
      lines.push(`**复测命令**: \`npm run test:retest -- --provider=${f.provider}\``);
      lines.push(``);
    }
  }

  return lines.join("\n");
}

// ============= 工具函数 =============

function groupByProvider(results: TestResult[]): Record<string, TestResult[]> {
  const groups: Record<string, TestResult[]> = {};
  for (const r of results) {
    const key = `${r.provider} (${r.productId})`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  return groups;
}

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

function formatTimestamp(ts: string): string {
  return ts.replace(/[:.]/g, "-").replace("T", "_").substring(0, 19);
}

// ============= 失败记录（用于复测） =============

const FAILURE_RECORD_PATH = path.join(REPORTS_DIR, ".last-failures.json");

export function saveFailureRecord(results: TestResult[]): void {
  const failures = results.filter(r => r.status === "fail");
  ensureReportsDir();
  fs.writeFileSync(FAILURE_RECORD_PATH, JSON.stringify(failures, null, 2), "utf-8");
}

export function loadFailureRecord(): TestResult[] {
  if (fs.existsSync(FAILURE_RECORD_PATH)) {
    return JSON.parse(fs.readFileSync(FAILURE_RECORD_PATH, "utf-8"));
  }
  return [];
}
