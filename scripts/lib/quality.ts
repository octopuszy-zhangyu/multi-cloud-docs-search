/**
 * 数据质量验证 - 内容抽样 + 异常检测
 *
 * 测试不只看数据返回条数，更要进行抽样检查，避免有数据但是异常数据。
 */

import type { QualityIssue, QualityReport } from "./types.js";

// ============= 内容抽样检查 =============

/**
 * 对返回的数据进行抽样检查
 * @param items 数据数组
 * @param tool 工具名称
 * @param sampleSize 抽样数量
 */
export function sampleCheck(items: unknown[], tool: string, sampleSize = 3): QualityReport {
  const issues: QualityIssue[] = [];

  if (items.length === 0) {
    return { tool, sampleCount: 0, issues: [], anomalies: [] };
  }

  const sampleCount = Math.min(sampleSize, items.length);
  const sampled = getRandomSample(items, sampleCount);

  for (let i = 0; i < sampled.length; i++) {
    const item = sampled[i] as Record<string, unknown>;
    const globalIndex = items.indexOf(item);

    // 1. 检查字段完整性
    checkMissingFields(item, issues, globalIndex);

    // 2. 检查字段值合理性
    checkFieldValues(item, issues, globalIndex);

    // 3. 检查 HTML 残留
    checkHtmlResidue(item, issues, globalIndex);

    // 4. 检查编码问题
    checkEncoding(item, issues, globalIndex);
  }

  // 5. 检查重复数据
  checkDuplicates(items, issues);

  // 6. 检查格式一致性
  checkConsistency(items, issues);

  const anomalies = issues.map(i => `[${i.severity}] ${i.message}`);

  return { tool, sampleCount, issues, anomalies };
}

// ============= 检查函数 =============

function checkMissingFields(item: Record<string, unknown>, issues: QualityIssue[], index: number): void {
  // 检查常见必填字段
  const requiredFields = ["pageId", "title", "productName", "billingMode", "price", "unit"];
  for (const field of requiredFields) {
    if (field in item && (item[field] === undefined || item[field] === null || item[field] === "")) {
      issues.push({
        type: "missing_field",
        severity: "error",
        message: `字段 "${field}" 为空`,
        field,
        value: item[field],
        itemIndex: index,
      });
    }
  }
}

function checkFieldValues(item: Record<string, unknown>, issues: QualityIssue[], index: number): void {
  // 检查价格字段
  if ("price" in item) {
    const price = Number(item.price);
    if (isNaN(price)) {
      issues.push({
        type: "invalid_value",
        severity: "error",
        message: `price 字段不是有效数字: ${item.price}`,
        field: "price",
        value: item.price,
        itemIndex: index,
      });
    } else if (price < 0) {
      issues.push({
        type: "invalid_value",
        severity: "error",
        message: `price 为负数: ${price}`,
        field: "price",
        value: price,
        itemIndex: index,
      });
    }
  }

  // 检查 title 长度
  if ("title" in item && typeof item.title === "string") {
    if (item.title.length > 500) {
      issues.push({
        type: "invalid_value",
        severity: "warning",
        message: `title 过长 (${item.title.length} 字符): ${item.title.substring(0, 50)}...`,
        field: "title",
        value: item.title.substring(0, 100),
        itemIndex: index,
      });
    }
  }

  // 检查 productName 长度
  if ("productName" in item && typeof item.productName === "string") {
    if (item.productName.length > 200) {
      issues.push({
        type: "invalid_value",
        severity: "warning",
        message: `productName 过长 (${item.productName.length} 字符): ${item.productName.substring(0, 50)}...`,
        field: "productName",
        value: item.productName.substring(0, 100),
        itemIndex: index,
      });
    }
  }
}

function checkHtmlResidue(item: Record<string, unknown>, issues: QualityIssue[], index: number): void {
  const htmlTagRegex = /<[a-z][\s\S]*?>/i;
  for (const [key, value] of Object.entries(item)) {
    if (typeof value === "string" && htmlTagRegex.test(value)) {
      issues.push({
        type: "html_residue",
        severity: "warning",
        message: `字段 "${key}" 包含 HTML 标签残留: ${value.substring(0, 80)}`,
        field: key,
        value: value.substring(0, 100),
        itemIndex: index,
      });
    }
  }
}

function checkEncoding(item: Record<string, unknown>, issues: QualityIssue[], index: number): void {
  const garbledRegex = /[��]/; // 乱码字符
  for (const [key, value] of Object.entries(item)) {
    if (typeof value === "string" && garbledRegex.test(value)) {
      issues.push({
        type: "encoding",
        severity: "error",
        message: `字段 "${key}" 包含乱码字符`,
        field: key,
        value: value.substring(0, 100),
        itemIndex: index,
      });
    }
  }
}

function checkDuplicates(items: unknown[], issues: QualityIssue[]): void {
  const seen = new Map<string, number[]>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    // 用 pageId 或 title 作为去重 key
    const key = item.pageId || item.title || item.productName;
    if (key && typeof key === "string") {
      if (!seen.has(key)) {
        seen.set(key, []);
      }
      seen.get(key)!.push(i);
    }
  }

  for (const [key, indices] of seen.entries()) {
    if (indices.length > 1) {
      issues.push({
        type: "duplicate",
        severity: "warning",
        message: `发现 ${indices.length} 条重复数据 (key: ${key.substring(0, 50)})`,
        value: key,
        itemIndex: indices[0],
      });
    }
  }
}

function checkConsistency(items: unknown[], issues: QualityIssue[]): void {
  if (items.length < 2) return;

  // 检查所有条目的字段结构是否一致
  const fieldSets = items.map(item => new Set(Object.keys(item as Record<string, unknown>)));
  const firstFields = fieldSets[0];

  for (let i = 1; i < fieldSets.length; i++) {
    const diff = new Set([...firstFields].filter(x => !fieldSets[i].has(x)));
    if (diff.size > 0) {
      issues.push({
        type: "inconsistent",
        severity: "warning",
        message: `条目 ${i} 缺少字段: ${[...diff].join(", ")}`,
        itemIndex: i,
      });
      break; // 只报告一次
    }
  }
}

// ============= 工具函数 =============

function getRandomSample<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
