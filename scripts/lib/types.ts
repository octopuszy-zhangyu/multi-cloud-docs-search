/**
 * 测试系统 - 共享类型定义
 */

import type { CloudDocAdapter } from "../src/adapters/base.js";

// ============= 测试结果类型 =============

export interface TestResult {
  provider: string;
  productId: string;
  tool: string;
  status: "pass" | "fail" | "skip";
  duration: number; // 毫秒
  result: string;
  error?: string;
  debug?: {
    request: Record<string, unknown>;
    response?: unknown;
    stack?: string;
  };
}

export interface QualityIssue {
  type: "missing_field" | "invalid_value" | "duplicate" | "html_residue" | "encoding" | "inconsistent";
  severity: "error" | "warning";
  message: string;
  field?: string;
  value?: unknown;
  itemIndex?: number;
  sampleData?: unknown;
}

export interface QualityReport {
  tool: string;
  sampleCount: number;
  issues: QualityIssue[];
  anomalies: string[]; // 异常摘要
}

export interface ProviderTestConfig {
  provider: string;
  name: string;
  products: ProductTestConfig[];
}

export interface ProductTestConfig {
  id: string;
  name: string;
  category: "ecs" | "clouddesktop" | "token";
}

export interface TestReport {
  timestamp: string;
  summary: {
    total: number;
    pass: number;
    fail: number;
    skip: number;
    duration: number; // 总耗时
  };
  qualitySummary: {
    totalSampled: number;
    issuesFound: number;
  };
  results: TestResult[];
  qualityReports: QualityReport[];
}

export interface DebugInfo {
  request: Record<string, unknown>;
  response?: unknown;
  stack?: string;
}

// ============= 测试配置 =============

export const TEST_PROVIDERS: ProviderTestConfig[] = [
  // 传统云厂商 - ECS + 云电脑 + Token
  { provider: "ctyun", name: "天翼云", products: [
    { id: "10026730", name: "ECS", category: "ecs" },
    { id: "10027004", name: "云电脑", category: "clouddesktop" },
    { id: "11061839", name: "Token服务", category: "token" },
  ]},
  { provider: "aliyun", name: "阿里云", products: [
    { id: "ecs", name: "ECS", category: "ecs" },
    { id: "wuying-workspace", name: "无影云电脑", category: "clouddesktop" },
  ]},
  { provider: "volcengine", name: "火山引擎", products: [
    { id: "6396", name: "ECS", category: "ecs" },
    // 注：无云桌面产品，Token/模型服务通过定价页获取
  ]},
  { provider: "tencent", name: "腾讯云", products: [
    { id: "213", name: "CVM", category: "ecs" },
    { id: "1291", name: "云桌面", category: "clouddesktop" },
    { id: "1823", name: "TokenHub", category: "token" },
  ]},
  { provider: "huawei", name: "华为云", products: [
    { id: "ecs", name: "ECS", category: "ecs" },
    { id: "workspace", name: "云桌面", category: "clouddesktop" },
    { id: "maas", name: "MaaS", category: "token" },
  ]},
  { provider: "ecloud", name: "移动云", products: [
    { id: "706", name: "ECS", category: "ecs" },
    { id: "1246", name: "云电脑", category: "clouddesktop" },
    { id: "1456", name: "MoMA", category: "token" },
  ]},
  { provider: "cucloud", name: "联通云", products: [
    { id: "128", name: "ECS", category: "ecs" },
    { id: "2267", name: "联通云桌面", category: "clouddesktop" },
    { id: "2357", name: "AISP", category: "token" },
  ]},
  { provider: "baidu", name: "百度云", products: [
    { id: "BCC", name: "BCC", category: "ecs" },
    { id: "BML", name: "BML", category: "token" },
  ]},
  // AI 厂商 - 只有 Token
  { provider: "deepseek", name: "DeepSeek", products: [
    { id: "deepseek", name: "API定价", category: "token" },
  ]},
  { provider: "glm", name: "智谱GLM", products: [
    { id: "glm", name: "API定价", category: "token" },
  ]},
  { provider: "minimax", name: "MiniMax", products: [
    { id: "minimax", name: "API定价", category: "token" },
  ]},
  { provider: "kimi", name: "Kimi", products: [
    { id: "kimi", name: "API定价", category: "token" },
  ]},
  { provider: "bailian", name: "百炼", products: [
    { id: "model-studio", name: "API定价", category: "token" },
  ]},
];

// ============= 颜色输出 =============

export const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  bold: "\x1b[1m",
};

export function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

export function logDebug(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[yellow]}[DEBUG]${colors.reset} ${colors[color]}${message}${colors.reset}`);
}