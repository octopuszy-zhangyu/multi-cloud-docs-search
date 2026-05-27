# 多云价格获取功能设计

## 概述

在现有多云文档搜索 MCP Server 中新增价格获取能力，支持获取各云厂商的产品价格数据，由大模型进行横向比对分析。

## 架构

### 方案：扩展现有适配器

在 `CloudDocAdapter` 基类中新增 `getProductPrice()` 方法，每个厂商适配器实现各自的价格获取逻辑。

### 新增 MCP 工具

```typescript
get_product_price({
  provider: string,    // 云厂商标识
  productId?: string,  // 产品 ID（可选，不传则返回所有产品价格概览）
})
```

### 返回格式

```typescript
interface PriceItem {
  productName: string;      // 产品名称
  specification: string;    // 规格描述
  region?: string;          // 地域
  billingMode: string;      // 计费方式（按量/包年包月/按 Token）
  price: number;            // 价格数值
  unit: string;             // 单位（元/月、元/小时、元/百万Token）
  currency: string;         // 币种（CNY/USD）
  source: string;           // 数据来源（文档/价格计算器）
  note?: string;            // 备注
}

interface PriceResult {
  provider: string;
  name: string;
  prices: PriceItem[];
  source: string;           // 数据来源描述
  updateDate?: string;      // 价格更新时间
}
```

## 各厂商价格获取策略

### AI 厂商（文档中有价格表）

| 厂商 | 价格页面 | 策略 |
|------|---------|------|
| 百炼 | `/zh/model-studio/billing` | 文档抓取，HTML 转 Markdown 后解析价格表 |
| DeepSeek | `/quick_start/pricing` | 文档抓取，解析 Markdown 表格 |
| GLM | `open.bigmodel.cn/pricing` | SPA 页面，需特殊处理 |
| MiniMax | `/docs/guides/pricing-paygo` | 文档抓取，解析 Markdown 表格 |
| Kimi | `/docs/pricing/` | 文档抓取，解析 Markdown 表格 |

### 传统云厂商

| 厂商 | 价格来源 | 策略 |
|------|---------|------|
| 天翼云 | 文档计费说明 + `ctyun.cn/pricing/` | 文档抓取 + 价格计算器 |
| 阿里云 | 文档计费说明 + `aliyun.com/price` | 文档抓取 + 价格计算器 |
| 火山引擎 | 文档计费规则 | 文档抓取（无具体单价） |
| 腾讯云 | 文档计费说明 + `buy.cloud.tencent.com/price` | 文档抓取 + 价格计算器 |
| 华为云 | 文档计费说明 + `huaweicloud.com/pricing` | 文档抓取 + 价格计算器 |
| 移动云 | 文档价格页面 | 文档抓取 |
| 联通云 | 文档价格页面 | 文档抓取 |
| 百度云 | 产品页内嵌数据 | 产品页抓取 |

## 基类方法定义

```typescript
abstract getProductPrice(productId?: string): Promise<PriceResult>;
```

## 实现步骤

1. ✅ 在 `base.ts` 中新增 `PriceItem`、`PriceResult` 类型和 `getProductPrice` 抽象方法
2. ✅ 逐个厂商实现 `getProductPrice` 方法
3. ✅ 在 `stdio.ts` 中注册 `get_product_price` 工具
4. ✅ 验证测试

## 验证结果

### AI 厂商
| 厂商 | 状态 | 说明 |
|------|------|------|
| DeepSeek | ✅ | 成功获取 7 条价格，含 DeepSeek-V4-Flash |
| MiniMax | ✅ | 成功获取 28 条价格，含文本/语音/视频/音乐模型 |
| 百炼 | ✅ | 成功获取 1157 条价格，含 deepseek-v4-pro/flash |
| Kimi | ⚠️ | 定价页面路径待确认，返回空 |
| GLM | ⚠️ | SPA 页面，llms-full.txt 中未找到定价内容 |

### 传统云厂商
| 厂商 | 状态 | 说明 |
|------|------|------|
| 天翼云 | ✅ | Token服务（11061839）获取 119 条价格，含 DeepSeek V4 |
| 阿里云 | ✅ | 百炼（model-studio）获取 1157 条价格，含 DeepSeek V4 |
| 火山引擎 | ⚠️ | 返回空，定价信息不在文档中 |
| 腾讯云 | ⚠️ | 返回空，定价信息在价格计算器 |
| 华为云 | ⚠️ | 返回空，定价信息在价格计算器 |
| 移动云 | ⚠️ | 返回空，待完善 |
| 联通云 | ⚠️ | 返回空，待完善 |
| 百度云 | ⚠️ | 返回空，待完善 |

### 已知问题
1. Kimi 定价页面路径 `/docs/pricing.md` 可能不正确
2. GLM 价格页面为 SPA，llms-full.txt 中未包含定价内容
3. 火山引擎/腾讯云/华为云/移动云/联通云/百度云的 AI 产品定价信息不在文档中，需通过价格计算器或其他方式获取
4. 部分价格表解析时 billingMode 显示为"未知"，表头检测逻辑需优化
