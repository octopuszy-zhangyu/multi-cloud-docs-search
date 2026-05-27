import { CloudDocAdapter } from "./base.js";
import { CtyunAdapter } from "./ctyun.js";
import { AliyunAdapter } from "./aliyun.js";
import { VolcengineAdapter } from "./volcengine.js";
import { TencentAdapter } from "./tencent.js";
import { HuaweiAdapter } from "./huawei.js";
import { EcloudAdapter } from "./ecloud.js";
import { CucloudAdapter } from "./cucloud.js";

const adapters: Record<string, CloudDocAdapter> = {
  ctyun: new CtyunAdapter(),
  aliyun: new AliyunAdapter(),
  volcengine: new VolcengineAdapter(),
  tencent: new TencentAdapter(),
  huawei: new HuaweiAdapter(),
  ecloud: new EcloudAdapter(),
  cucloud: new CucloudAdapter(),
};

/** 获取指定云厂商的适配器实例 */
export function getAdapter(provider: string): CloudDocAdapter {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(`不支持的云厂商: ${provider}，当前支持的厂商: ${Object.keys(adapters).join(", ")}`);
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
