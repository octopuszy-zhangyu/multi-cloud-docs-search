import * as cheerio from "cheerio";
import type {
  ListForHelpResponse,
  ContentQueryResponse,
  PageMetadataResponse,
} from "../types.js";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type PaginatedResult, type ListProductsOptions, type TocOptions, type PriceQueryOptions } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const BASE_URL = "https://www.ctyun.cn";

export class CtyunAdapter extends CloudDocAdapter {
  readonly provider = "ctyun";
  readonly name = "天翼云";

  // 价格 API 缓存
  private ctTgcCache: string | null = null;
  private cookieExpiry: number = 0;
  private regionCache: Array<{ id: string; name: string }> | null = null;
  private regionExpiry: number = 0;
  private flavorMapCache: Map<string, { spec_name: string; cpu: number; mem: number; flavor_uuid: string; flavorType: string; cpuinfo: string }> | null = null;
  private flavorExpiry: number = 0;

  async listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>> {
    const url = `${BASE_URL}/v2/portal/book/ListForHelp?bookClassDomain=product&_t=${Date.now()}`;
    const raw = await this.fetchJson<ListForHelpResponse>(url);
    let result: Product[] = [];
    for (const cat of raw.data?.list ?? []) {
      for (const p of cat.list) {
        result.push({
          productId: p.bookId,
          name: this.clean(p.bookName),
        });
      }
    }
    result = this.filterByKeywords(result, options?.keyword);
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 100;
    return this.paginate(result, page, pageSize);
  }

  async getDocumentToc(productId: string, options?: TocOptions): Promise<PaginatedResult<TocItem>> {
    const html = await this.fetchHtml(`${BASE_URL}/document/${productId}/`);
    const $ = cheerio.load(html);
    let items: TocItem[] = [];
    const linkPattern = new RegExp(`^/document/${productId}/(\\d+)$`);

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const match = href.match(linkPattern);
      if (match) {
        const pageId = match[1];
        const title = $(el).text().trim();
        if (title && !items.some((i) => i.pageId === pageId)) {
          items.push({ pageId, title });
        }
      }
    });

    items = this.filterByKeywords(items, options?.keyword);

    if (options?.topOnly) {
      items = items.map(({ children, ...rest }) => rest);
    }

    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 200;
    return this.paginate(items, page, pageSize);
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const url = `${BASE_URL}/v2/portal/book/ContentQuery?bookId=${productId}&keyword=${encodeURIComponent(keyword)}&_t=${Date.now()}`;
    const raw = await this.fetchJson<ContentQueryResponse>(url);
    return (raw.data?.pages ?? []).map((p) => ({
      pageId: p.pageId,
      title: p.title,
      description: p.note,
    }));
  }

  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    const url = `${BASE_URL}/v2/portal/book/page/Get?pageId=${pageId}&_t=${Date.now()}`;
    const raw = await this.fetchJson<PageMetadataResponse>(url);
    const d = raw.data;
    return {
      pageId: d.pageId,
      title: d.title,
      note: d.note,
      contentPath: d.contentPath,
      chapterId: d.chapterId,
      bookId: String(d.bookId),
      updateDate: d.updateDateShow,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    const res = await this.fetchWithRetry(contentPath, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(`Content fetch failed: ${res.status} ${res.statusText}`);
    }
    // 天翼云页面可能使用 GBK 编码，需要检测并正确解码
    const contentType = res.headers.get("content-type") || "";
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // 检测 HTML 中声明的编码
    const decoder = new TextDecoder("utf-8");
    const htmlStart = decoder.decode(bytes.slice(0, 1024));
    const charsetMatch = htmlStart.match(/charset\s*=\s*["']?([^"'\s>]+)/i);
    const encoding = charsetMatch ? charsetMatch[1].toLowerCase() : contentType.includes("charset=")
      ? contentType.split("charset=")[1].split(";")[0].trim().toLowerCase()
      : "utf-8";

    let html: string;
    try {
      html = new TextDecoder(encoding === "gbk" || encoding === "gb2312" || encoding === "gb18030" ? "gbk" : encoding).decode(bytes);
    } catch {
      // 如果指定编码不支持，回退到 utf-8
      html = decoder.decode(bytes);
    }

    // 将 HTML 转换为 Markdown
    return htmlToMarkdown(html);
  }

  // ========== 价格 API 辅助方法 ==========

  /**
   * 获取天翼云 ct_tgc cookie
   * 调用 GetTree API 获取 cookie，缓存到类变量中（5 分钟有效期）
   */
  private async getCtyunCookie(): Promise<string> {
    if (this.ctTgcCache && Date.now() < this.cookieExpiry) {
      return this.ctTgcCache;
    }
    const url = `${BASE_URL}/v1/portal/menu/GetTree?domain=portal.header-left-menu&topic=portal&qryMode=reduce`;
    const res = await this.fetchWithRetry(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": `${BASE_URL}/pricing/ecs`,
      },
    });
    const setCookie = res.headers.get("set-cookie") || "";
    const match = setCookie.match(/ct_tgc=([^;]+)/);
    if (!match) {
      throw new Error("获取天翼云 cookie 失败：响应中未包含 ct_tgc");
    }
    this.ctTgcCache = match[1];
    this.cookieExpiry = Date.now() + 5 * 60 * 1000;
    return this.ctTgcCache!;
  }

  /**
   * 获取天翼云可用地域列表
   */
  private async getRegionList(): Promise<Array<{ id: string; name: string }>> {
    if (this.regionCache && Date.now() < this.regionExpiry) {
      return this.regionCache;
    }
    const cookie = await this.getCtyunCookie();
    const url = `${BASE_URL}/v2/portal/region/regionList?productId=10000000`;
    const res = await this.fetchWithRetry(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": `${BASE_URL}/pricing/ecs`,
        "Accept": "application/json",
        "Cookie": `ct_tgc=${cookie}`,
      },
    });
    const raw = await res.json() as { code: string; data: { all: Array<{ category: string; id: string; name: string; list: Array<{ id: string; name: string; isRegionV4: string }> }> } };
    const regions: Array<{ id: string; name: string }> = [];
    for (const cat of raw.data?.all || []) {
      for (const r of cat.list || []) {
        if (r.isRegionV4 === "true") {
          regions.push({ id: r.id, name: `${cat.name} ${r.name}` });
        }
      }
    }
    // 如果没有 V4 地域，回退到所有地域
    if (regions.length === 0) {
      for (const cat of raw.data?.all || []) {
        for (const r of cat.list || []) {
          regions.push({ id: r.id, name: `${cat.name} ${r.name}` });
        }
      }
    }
    this.regionCache = regions;
    this.regionExpiry = Date.now() + 5 * 60 * 1000;
    return regions;
  }

  /**
   * 获取规格 UUID 映射
   * 从 serverextenddata API 获取所有规格的 flavor_id（即 flavor_uuid）
   */
  private async getFlavorMap(regionId: string): Promise<Map<string, { spec_name: string; cpu: number; mem: number; flavor_uuid: string; flavorType: string; cpuinfo: string }>> {
    if (this.flavorMapCache && Date.now() < this.flavorExpiry) {
      return this.flavorMapCache;
    }
    const cookie = await this.getCtyunCookie();
    const url = `https://console.ctyun.cn/console/compute/ecm/ecs/serverextenddata/?ctyunid=${regionId}&type=os&regionid=${regionId}`;
    const res = await this.fetchWithRetry(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": `${BASE_URL}/`,
        "Accept": "application/json",
        "Cookie": `ct_tgc=${cookie}`,
      },
    });
    const raw = await res.json() as any;
    const specList = raw.spec_list || [];
    const map = new Map<string, { spec_name: string; cpu: number; mem: number; flavor_uuid: string; flavorType: string; cpuinfo: string }>();

    // 去重：同一个规格名在不同可用区有不同 flavor_id，取第一个
    const seenSpec = new Set<string>();
    for (const item of specList) {
      const key = `${item.spec_name}_${item.flavor_type}`;
      if (seenSpec.has(key)) continue;
      seenSpec.add(key);

      map.set(item.flavor_id, {
        spec_name: item.spec_name || "",
        cpu: item.vcpu || 0,
        mem: item.ram || 0,
        flavor_uuid: item.flavor_id,
        flavorType: item.flavor_type || "",
        cpuinfo: item.cpuinfo || "x86",
      });
    }

    this.flavorMapCache = map;
    this.flavorExpiry = Date.now() + 5 * 60 * 1000;
    return map;
  }

  /** 清理字符串中的 HTML 标签和特殊字符 */
  private clean(str: string): string {
    if (!str) return "";
    let result = str.replace(/<[^>]*>/g, "");
    result = result.replace(/&[a-zA-Z]+;/g, " ");
    result = result.replace(/[\n\r\t]/g, " ");
    result = result.replace(/\\/g, "");
    result = result.replace(/\s+/g, " ").trim();
    return result;
  }

  /**
   * 从 Markdown 文本中解析价格表格
   *
   * 识别 Markdown 表格行（以 | 开头和结尾），
   * 跳过表头行和分隔行，将第一列作为产品名，最后一列作为价格。
   */
  private parsePriceTable(markdown: string, source: string): PriceItem[] {
    const prices: PriceItem[] = [];
    const lines = markdown.split("\n");
    let inTable = false;
    let headerLine = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 检测 Markdown 表格行：以 | 开头和结尾
      if (!line.startsWith("|") || !line.endsWith("|")) {
        inTable = false;
        continue;
      }

      // 跳过分隔行（如 | --- | --- |）
      if (/^\|[\s\-:]+\|$/.test(line) || line.replace(/[^|]/g, "").length <= 2) {
        continue;
      }

      if (!inTable) {
        // 第一行是表头
        headerLine = line;
        inTable = true;
        continue;
      }

      // 数据行
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cells.length < 2) continue;

      const productName = cells[0];
      const lastCell = cells[cells.length - 1];

      // 尝试从最后一列提取价格数字
      const priceMatch = lastCell.match(/[\d,]+(?:\.\d+)?/);
      if (!priceMatch) continue;

      const price = parseFloat(priceMatch[0].replace(/,/g, ""));
      if (isNaN(price)) continue;

      // 判断计费模式
      const billingMode = lastCell.includes("包") || lastCell.includes("月") || lastCell.includes("年")
        ? "包年包月"
        : lastCell.includes("按量") || lastCell.includes("小时") || lastCell.includes("秒")
          ? "按量计费"
          : "未知";

      // 判断单位
      let unit = "月";
      if (lastCell.includes("小时") || lastCell.includes("/h")) unit = "小时";
      else if (lastCell.includes("天")) unit = "天";
      else if (lastCell.includes("年")) unit = "年";
      else if (lastCell.includes("次")) unit = "次";
      else if (lastCell.includes("GB") || lastCell.includes("G")) unit = "GB";

      // 判断币种
      const currency = lastCell.includes("$") || lastCell.includes("美元") ? "USD" : "CNY";

      prices.push({
        productName,
        specification: cells.length > 2 ? cells.slice(1, -1).join(" / ") : "",
        billingMode,
        price,
        unit,
        currency,
        source,
      });
    }

    return prices;
  }

  /**
   * 获取产品价格信息
   *
   * 通过调用天翼云内部价格计算器 API 获取精确价格。
   * 当前仅支持 ECS（productId=10026730）。
   *
   * 流程：
   * 1. 获取 ct_tgc cookie
   * 2. 获取地域列表（默认使用第一个）
   * 3. 获取 flavor UUID 映射
   * 4. 构造 flavorsInfo 数组，调用 proxyv3/querynew API
   * 5. 解析响应，输出为 PriceItem[]
   */
  async getProductPrice(productId?: string, options?: PriceQueryOptions): Promise<PriceResult> {
    const result: PriceResult = {
      provider: this.provider,
      name: this.name,
      prices: [],
      source: "https://console.ctyun.cn/console/compute/api/proxyv3/querynew/",
      updateDate: new Date().toISOString().split("T")[0],
    };

    if (!productId) {
      return result;
    }

    try {
      // 仅支持 ECS（productId=10026730）
      if (productId !== "10026730") {
        result.dataStatus = "no_data";
        result.note = `暂不支持 productId=${productId} 的价格查询，当前仅支持 ECS（productId=10026730）`;
        return result;
      }

      // 1. 获取 cookie
      const cookie = await this.getCtyunCookie();

      // 2. 获取地域列表，默认使用第一个
      const regions = await this.getRegionList();
      const defaultRegion = regions.length > 0 ? regions[0] : { id: "bb9fdb42056f11eda1610242ac110002", name: "华东1" };

      // 3. 获取 flavor 映射
      const flavorMap = await this.getFlavorMap(defaultRegion.id);
      if (flavorMap.size === 0) {
        result.dataStatus = "no_data";
        result.note = "获取规格映射失败，无法查询价格";
        return result;
      }

      // 4. 构造 flavorsInfo 数组
      const flavorsInfo: Array<{
        spec_name: string;
        cpu: number;
        mem: number;
        flavor_uuid: string;
        flavorType: string;
        cpuinfo: string;
      }> = [];
      for (const [_, info] of flavorMap) {
        flavorsInfo.push(info);
      }

      // 5. 调用 proxyv3/querynew 获取价格
      const priceUrl = "https://console.ctyun.cn/console/compute/api/proxyv3/querynew/";
      const priceRes = await this.fetchWithRetry(priceUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Referer": `${BASE_URL}/`,
          "Accept": "application/json",
          "Cookie": `ct_tgc=${cookie}`,
        },
        body: JSON.stringify({
          billMode: 1,
          regionId: defaultRegion.id,
          resourceType: "ecs_flavor",
          flavorsInfo,
          cycleCnt: 1,
          cycleType: "M",
        }),
      });
      const priceRaw = await priceRes.json() as any;

      // 6. 解析响应
      const returnObj = priceRaw.returnObj;
      if (!returnObj || priceRaw.statusCode !== 800) {
        result.dataStatus = "no_data";
        result.note = `价格查询失败：${priceRaw.message || "未知错误"}`;
        return result;
      }

      const subOrders = returnObj.subOrderPrices || [];
      for (const sub of subOrders) {
        const flavorInfo = flavorMap.get(sub.flavor_uuid);
        if (!flavorInfo) continue;

        // 查找 VM 类型的价格（不含系统盘和网络）
        const vmPrice = (sub.orderItemPrices || []).find(
          (p: any) => p.resourceType === "VM"
        );

        result.prices.push({
          productName: `弹性云主机 ${flavorInfo.spec_name}`,
          specification: `${flavorInfo.cpu}核 ${flavorInfo.mem}GB ${flavorInfo.cpuinfo} ${flavorInfo.flavorType}`,
          billingMode: "包年包月",
          price: vmPrice ? vmPrice.finalPrice : sub.finalPrice,
          unit: "元/月",
          currency: "CNY",
          region: defaultRegion.name,
          source: priceUrl,
          note: "仅计算实例费用，不含系统盘和网络",
        });
      }

      result.dataStatus = result.prices.length > 0 ? "complete" : "no_data";
    } catch (error) {
      result.dataStatus = "no_data";
      result.note = `价格查询失败：${error instanceof Error ? error.message : String(error)}`;
    }

    return result;
  }

  /**
   * 解析组件单价（CPU 单价、内存单价）
   *
   * 天翼云价格总览页面的格式：
   * 产品名称  包月标准价格（元/核/月） 按需标准价格（元/核/小时）
   * vCPU     46                       0.096
   * 产品名称  包月标准价格（元/G/月）   按需标准价格（元/G/小时）
   * 内存     17                       0.035
   */
  private parseUnitPrices(markdown: string, source: string): PriceItem[] {
    const prices: PriceItem[] = [];
    // 分段处理，每个 ## 标题为一个规格族
    const sections = markdown.split(/(?=^## )/m);

    for (const section of sections) {
      // 提取规格族名称
      const familyMatch = section.match(/^##\s+(.+)/m);
      const familyName = familyMatch ? familyMatch[1].trim() : "通用";

      // 解析 CPU 单价：行中包含 vCPU 或 "核"，并且有价格数字
      const cpuMatch = section.match(/vCPU\s+([\d.]+)\s+([\d.]+)/);
      // 解析内存单价：行中包含 "内存" 或 "G/月"，并且有价格数字
      const memMatch = section.match(/内存\s+([\d.]+)\s+([\d.]+)/);

      if (cpuMatch) {
        prices.push({
          productName: `${familyName} CPU`,
          specification: `${familyName} CPU`,
          billingMode: "包年包月",
          price: parseFloat(cpuMatch[1]),
          unit: "元/核/月",
          currency: "CNY",
          source,
          note: `${familyName} vCPU 包月单价`,
        });
        prices.push({
          productName: `${familyName} CPU`,
          specification: `${familyName} CPU`,
          billingMode: "按量计费",
          price: parseFloat(cpuMatch[2]),
          unit: "元/核/小时",
          currency: "CNY",
          source,
          note: `${familyName} vCPU 按需单价`,
        });
      }

      if (memMatch) {
        prices.push({
          productName: `${familyName} 内存`,
          specification: `${familyName} 内存`,
          billingMode: "包年包月",
          price: parseFloat(memMatch[1]),
          unit: "元/GB/月",
          currency: "CNY",
          source,
          note: `${familyName} 内存包月单价`,
        });
        prices.push({
          productName: `${familyName} 内存`,
          specification: `${familyName} 内存`,
          billingMode: "按量计费",
          price: parseFloat(memMatch[2]),
          unit: "元/GB/小时",
          currency: "CNY",
          source,
          note: `${familyName} 内存按需单价`,
        });
      }
    }

    return prices;
  }

  /**
   * 从组件单价自动计算常见规格的总价
   *
   * 天翼云文档通常以组件单价形式展示（CPU 单价、内存单价），
   * 此方法自动计算常见规格（2C4G、4C8G、8C16G 等）的总价。
   */
  private calculateCommonSpecs(prices: PriceItem[], source: string): PriceItem[] {
    const calculatedPrices: PriceItem[] = [];

    // 查找 CPU 单价和内存单价
    let cpuPrice = 0;
    let memPrice = 0;
    let cpuUnit = "";
    let memUnit = "";
    let billingMode = "包年包月";

    for (const p of prices) {
      const spec = (p.specification || "").toLowerCase();
      const unit = p.unit || "";

      // 匹配 CPU 单价（包含 "cpu" 或 "核"）
      if (spec.includes("cpu") || spec.includes("核")) {
        cpuPrice = p.price;
        cpuUnit = unit;
        billingMode = p.billingMode;
      }

      // 匹配内存单价（包含 "内存" 或 "mem" 或 "gb"）
      if (spec.includes("内存") || spec.includes("mem") || spec.includes("gb")) {
        memPrice = p.price;
        memUnit = unit;
      }
    }

    // 如果找到了 CPU 和内存单价，计算常见规格
    if (cpuPrice > 0 && memPrice > 0) {
      // 常见规格配置
      const commonSpecs = [
        { cpu: 1, mem: 1, name: "1C1G" },
        { cpu: 1, mem: 2, name: "1C2G" },
        { cpu: 2, mem: 2, name: "2C2G" },
        { cpu: 2, mem: 4, name: "2C4G" },
        { cpu: 2, mem: 8, name: "2C8G" },
        { cpu: 4, mem: 4, name: "4C4G" },
        { cpu: 4, mem: 8, name: "4C8G" },
        { cpu: 4, mem: 16, name: "4C16G" },
        { cpu: 8, mem: 8, name: "8C8G" },
        { cpu: 8, mem: 16, name: "8C16G" },
        { cpu: 8, mem: 32, name: "8C32G" },
        { cpu: 16, mem: 16, name: "16C16G" },
        { cpu: 16, mem: 32, name: "16C32G" },
        { cpu: 16, mem: 64, name: "16C64G" },
      ];

      // 统一单位为 "元/月"
      let cpuMonthlyPrice = cpuPrice;
      let memMonthlyPrice = memPrice;

      // 如果是按小时价格，转换为按月价格（假设 30 天 * 24 小时 = 720 小时）
      if (cpuUnit.includes("小时")) {
        cpuMonthlyPrice = cpuPrice * 720;
      } else if (cpuUnit.includes("年")) {
        cpuMonthlyPrice = cpuPrice / 12;
      }

      if (memUnit.includes("小时")) {
        memMonthlyPrice = memPrice * 720;
      } else if (memUnit.includes("年")) {
        memMonthlyPrice = memPrice / 12;
      }

      for (const spec of commonSpecs) {
        const totalPrice = cpuMonthlyPrice * spec.cpu + memMonthlyPrice * spec.mem;
        calculatedPrices.push({
          productName: `云主机 ${spec.name}`,
          specification: spec.name,
          billingMode,
          price: Math.round(totalPrice * 100) / 100,
          unit: "元/月",
          currency: "CNY",
          source,
          note: `由组件单价计算得出（CPU ${cpuPrice}${cpuUnit} × ${spec.cpu}核 + 内存 ${memPrice}${memUnit} × ${spec.mem}GB）`,
        });
      }
    }

    return calculatedPrices;
  }
}