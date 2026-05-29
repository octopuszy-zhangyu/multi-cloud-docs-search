# 天翼云价格 API 适配设计文档

> **Goal:** 实现天翼云 `getProductPrice` 方法，通过内部价格计算器 API 获取 ECS 等产品的实时价格数据

**Architecture:** 基于天翼云内部 API 的两步获取流程：先获取 `ct_tgc` cookie 和 region/flavor 元数据，再调用 `proxyv3/querynew` 获取价格数据。复用基类 `CloudDocAdapter` 的 `fetchJson`、`fetchWithRetry` 等方法。

**Tech Stack:** TypeScript + cheerio（JSON 解析）

---

## 背景

天翼云的价格数据存储在内部定价系统中，文档页面中的价格总览只包含组件单价（CPU 元/核/月、内存元/G/月），且部分页面为 JavaScript 动态渲染。通过调用内部价格计算器 API，可以直接获取精确的实例规格价格。

## API 流程

### Step 1: 获取 ct_tgc cookie

```
GET https://www.ctyun.cn/v1/portal/menu/GetTree?domain=portal.header-left-menu&topic=portal&qryMode=reduce
Headers: Referer=https://www.ctyun.cn/pricing/ecs
Response Set-Cookie: ct_tgc=<uuid>;Path=/;Domain=.ctyun.cn;Secure;HttpOnly
```

### Step 2: 获取地域列表

```
GET https://www.ctyun.cn/v2/portal/region/regionList?productId=10000000
Headers: Cookie=ct_tgc=<uuid>
Response: 地域列表（含名称和 UUID）
```

### Step 3: 获取 flavor_uuid 映射

从价格计算器页面低代码配置 JSON 中获取：
```
GET https://ctyun-nest-prod.gdoss.xstore.ctyun.cn/static/lowcode/page/56/622ecc9e036f47a4ab63fa764abe21dd.json
```

该 JSON 中包含所有规格的 flavor_uuid、flavorType、cpu、mem 等信息。

### Step 4: 查询价格

```
POST https://console.ctyun.cn/console/compute/api/proxyv3/querynew/
Headers: Cookie=ct_tgc=<uuid>
Body: {
  "billMode": 1,
  "regionId": "<uuid>",
  "resourceType": "ecs_flavor",
  "flavorsInfo": [
    {
      "spec_name": "s6.small.1",
      "cpu": 1,
      "mem": 1,
      "flavor_uuid": "<uuid>",
      "flavorType": "CPU_S6",
      "cpuinfo": "x86"
    }
  ],
  "cycleCnt": 1,
  "cycleType": "M"
}
```

## 参数说明

| 参数 | 含义 | 取值 |
|------|------|------|
| billMode | 计费模式 | 1=包月, 2=按需 |
| regionId | 地域 UUID | 从 regionList API 获取 |
| resourceType | 资源类型 | ecs_flavor |
| flavorsInfo | 规格数组 | 可一次查多个 |
| spec_name | 规格名称 | s6.small.1 等 |
| cpu | vCPU 核数 | 整数 |
| mem | 内存 GB | 整数 |
| flavor_uuid | 规格 UUID | 从低代码 JSON 获取 |
| flavorType | 规格族 | CPU_S6, C8, M8 等 |
| cpuinfo | CPU 架构 | x86, ARM |
| cycleCnt | 周期数量 | 1 |
| cycleType | 周期类型 | M=月, Y=年 |

## 响应解析

```json
{
  "returnObj": {
    "totalPrice": 5807.0,
    "finalPrice": 5807.0,
    "discountRate": 1.0,
    "subOrderPrices": [
      {
        "flavor_uuid": "68b68cf4...",
        "finalPrice": 41.0,
        "orderItemPrices": [
          { "resourceType": "VM", "finalPrice": 41.0 }
        ]
      }
    ]
  },
  "code": 200,
  "statusCode": 800
}
```

- `statusCode=800` 表示成功，`=900` 表示参数错误
- `subOrderPrices` 数组中的 `flavor_uuid` 与请求中的 `flavorsInfo` 一一对应
- `orderItemPrices` 中的 `resourceType` 区分 VM/EBS/NETWORK

## 实现步骤

### Step 1: Cookie 管理

在 `CtyunAdapter` 中添加私有方法 `getCtyunCookie()`，调用 GetTree API 获取 `ct_tgc` cookie，使用类缓存变量存储，减少重复请求。

### Step 2: 地域获取

添加 `getRegionList()` 方法，获取可用地域列表，默认使用第一个可用地域。

### Step 3: Flavor UUID 获取

添加 `getFlavorMap()` 方法，从低代码配置 JSON 中解析所有规格的 flavor_uuid、flavorType、cpu、mem 等信息，缓存到类变量。

### Step 4: 价格查询

重写 `getProductPrice(productId, options)` 方法：
1. 获取 cookie
2. 获取地域
3. 获取 flavor 映射（仅 ECS 场景）
4. 构造 flavorsInfo 数组（所有规格）
5. 调用 proxyv3/querynew 获取价格
6. 解析响应，输出为 PriceItem[]

## 输出格式规范

```typescript
{
  provider: "ctyun",
  name: "天翼云",
  prices: [
    {
      productName: "弹性云主机 s6.small.1",
      specification: "1核 1GB x86 通用型 s6",
      billingMode: "包年包月",
      price: 41.0,
      unit: "元/月",
      currency: "CNY",
      region: "华东1",
      source: "https://console.ctyun.cn/console/compute/api/proxyv3/querynew/",
      note: "仅计算实例费用，不含系统盘和网络"
    }
  ],
  dataStatus: "complete",
  source: "https://console.ctyun.cn/console/compute/api/proxyv3/querynew/",
  updateDate: "2026-05-29"
}
```

## 支持的产品

初始版本仅支持 ECS（productId=10026730），后续可扩展到其他产品。

## 缓存策略

- `ct_tgc` cookie：每次请求前获取（有效期未知）
- region 列表：缓存在类变量中，时效 5 分钟
- flavor UUID 映射：缓存在类变量中，时效 5 分钟