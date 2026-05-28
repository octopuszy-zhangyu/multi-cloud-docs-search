import { CloudDocAdapter } from "./base.js";
import { CtyunAdapter } from "./ctyun.js";
import { AliyunAdapter } from "./aliyun.js";
import { VolcengineAdapter } from "./volcengine.js";
import { TencentAdapter } from "./tencent.js";
import { HuaweiAdapter } from "./huawei.js";
import { EcloudAdapter } from "./ecloud.js";
import { CucloudAdapter } from "./cucloud.js";
import { MinimaxAdapter } from "./minimax.js";
import { KimiAdapter } from "./kimi.js";
import { GlmAdapter } from "./glm.js";
import { BaiduAdapter } from "./baidu.js";
import { BailianAdapter } from "./bailian.js";
import { DeepseekAdapter } from "./deepseek.js";

const adapters: Record<string, CloudDocAdapter> = {
  ctyun: new CtyunAdapter(),
  aliyun: new AliyunAdapter(),
  volcengine: new VolcengineAdapter(),
  tencent: new TencentAdapter(),
  huawei: new HuaweiAdapter(),
  ecloud: new EcloudAdapter(),
  cucloud: new CucloudAdapter(),
  minimax: new MinimaxAdapter(),
  kimi: new KimiAdapter(),
  glm: new GlmAdapter(),
  baidu: new BaiduAdapter(),
  bailian: new BailianAdapter(),
  deepseek: new DeepseekAdapter(),
};

/** 云厂商别名映射 */
const providerAliases: Record<string, string> = {
  // 腾讯云别名
  tencentcloud: "tencent",
  // 华为云别名
  huaweicloud: "huawei",
  // 阿里云别名
  alibaba: "aliyun",
  // 火山引擎别名
  bytedance: "volcengine",
  // 移动云别名
  cmcc: "ecloud",
  // 联通云别名
  chinaunicom: "cucloud",
  // 百度云别名
  baiducloud: "baidu",
  qianfan: "baidu",
  // 阿里云百炼别名
  dashscope: "bailian",
  // 智谱别名
  zhipu: "glm",
  // Kimi 别名
  moonshot: "kimi",
};

/** 获取指定云厂商的适配器实例 */
export function getAdapter(provider: string): CloudDocAdapter {
  // 先尝试直接匹配
  let normalizedProvider = provider.toLowerCase().replace(/[\s_-]/g, "");
  let adapter = adapters[normalizedProvider];

  // 再尝试别名映射
  if (!adapter) {
    const alias = providerAliases[normalizedProvider];
    if (alias) {
      adapter = adapters[alias];
    }
  }

  if (!adapter) {
    const supported = Object.keys(adapters).join(", ");
    const suggestions = Object.entries(providerAliases)
      .filter(([k]) => k.includes(normalizedProvider) || normalizedProvider.includes(k))
      .map(([k, v]) => `${k} → ${v}`)
      .slice(0, 3);
    const suggestionText = suggestions.length > 0 ? `\n\n您是否在找: ${suggestions.join(", ")}` : "";
    throw new Error(`不支持的云厂商: ${provider}，当前支持的厂商: ${supported}${suggestionText}`);
  }
  return adapter;
}

/** 获取所有已注册的云厂商列表 */
export function getSupportedProviders(): { provider: string; name: string }[] {
  return Object.values(adapters).map((a) => ({
    provider: a.provider,
    name: a.name,
  }));
}
