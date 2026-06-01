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
  private deskRegionCache: Array<{ id: string; name: string }> | null = null;
  private deskRegionExpiry: number = 0;
  private deskProductsCache: Map<string, any> | null = null;
  private deskProductsExpiry: number = 0;

  async listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>> {
    const url = `${BASE_URL}/v2/portal/book/ListForHelp?bookClassDomain=product&_t=${Date.now()}`;
    const raw = await this.fetchJson<ListForHelpResponse>(url);
    let result: Product[] = [];
    for (const cat of raw.data?.list ?? []) {
      for (const p of cat.list) {
        result.push({
          productId: p.bookId,
          name: this.clean(p.bookName),
          description: p.note ? this.clean(p.note) : undefined,
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
        regions.push({ id: r.id, name: `${cat.name} ${r.name}` });
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

  /**
   * 从地域列表中查找包含关键字的地域
   */
  private findRegionByKeyword(regions: Array<{ id: string; name: string }>, keyword?: string): { id: string; name: string } | null {
    if (!keyword) return null;
    const kw = keyword.toLowerCase();
    for (const r of regions) {
      if (r.name.toLowerCase().includes(kw) || r.id.toLowerCase().includes(kw)) {
        return r;
      }
    }
    return null;
  }

  /**
   * 获取天翼云电脑可用地域列表
   */
  private async getDeskRegionList(): Promise<Array<{ id: string; name: string }>> {
    if (this.deskRegionCache && Date.now() < this.deskRegionExpiry) {
      return this.deskRegionCache;
    }
    const url = "https://desk.ctyun.cn:8816/api/selforder/region/queryPoolList";
    const res = await this.fetchWithRetry(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.ctyun.cn/",
        "Accept": "application/json",
      },
    });
    const raw = await res.json() as { code: number; data: Array<{ regionId: string; regionName: string; zoneId: string[]; regionProperties: Record<string, any> }> };
    const regions: Array<{ id: string; name: string }> = [];
    for (const r of raw.data || []) {
      regions.push({ id: r.regionId, name: r.regionName });
    }
    this.deskRegionCache = regions;
    this.deskRegionExpiry = Date.now() + 5 * 60 * 1000;
    return regions;
  }

  /**
   * 获取天翼云电脑产品规格
   */
  private async getDesktopProducts(regionUuid: string): Promise<any> {
    const cacheKey = regionUuid;
    if (this.deskProductsCache && this.deskProductsCache.has(cacheKey) && Date.now() < this.deskProductsExpiry) {
      return this.deskProductsCache.get(cacheKey);
    }
    const cookie = await this.getCtyunCookie();
    const url = `https://desk.ctyun.cn:8816/api/selforder/prod/get?regionUuid=${regionUuid}&prodCode=BUSIDESKTOP`;
    const res = await this.fetchWithRetry(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.ctyun.cn/",
        "Accept": "application/json",
        "Cookie": `ct_tgc=${cookie}`,
      },
    });
    const raw = await res.json() as { code: number; data: any[] };
    const products = raw.data || [];
    if (!this.deskProductsCache) {
      this.deskProductsCache = new Map();
    }
    this.deskProductsCache.set(cacheKey, products);
    this.deskProductsExpiry = Date.now() + 5 * 60 * 1000;
    return products;
  }

  /**
   * 查询天翼云电脑价格
   */
  private async queryDesktopPrice(regionUuid: string, skuConfig: any): Promise<{ finalPrice: number; items: Array<{ ctyunName: string; finalPrice: number; resourceType: string }> }[]> {
    const cookie = await this.getCtyunCookie();
    const url = "https://desk.ctyun.cn:8816/api/selforder/paas/queryPrice";
    const res = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.ctyun.cn/",
        "Accept": "application/json",
        "Cookie": `ct_tgc=${cookie}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        busiChannel: "010",
        orderType: 1,
        regionUuid,
        sku: [skuConfig],
      }),
    });
    const raw = await res.json() as { statusCode: number; returnObj: { totalPrice: number; finalPrice: number; subOrderPrices: Array<{ serviceTag: string; finalPrice: number; orderItemPrices: Array<{ ctyunName: string; finalPrice: number; resourceType: string }> }> } };
    if (raw.statusCode !== 800 || !raw.returnObj) {
      return [];
    }
    const results: { finalPrice: number; items: Array<{ ctyunName: string; finalPrice: number; resourceType: string }> }[] = [];
    const subOrders = raw.returnObj.subOrderPrices || [];
    for (const sub of subOrders) {
      results.push({
        finalPrice: sub.finalPrice,
        items: sub.orderItemPrices || [],
      });
    }
    return results;
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

      prices.push({
        productName,
        billingMode,
        price,
        unit,
      });
    }

    return prices;
  }

  /**
   * 获取产品价格信息
   *
   * 支持 ECS（productId=10026730）和云电脑政企版（productId=10027004）。
   *
   * ECS 流程：
   * 1. 获取 ct_tgc cookie
   * 2. 获取地域列表（默认使用华东1地域）
   * 3. 获取 flavor UUID 映射
   * 4. 构造 flavorsInfo 数组，调用 proxyv3/querynew API
   * 5. 解析响应，输出为 PriceItem[]
   *
   * 云电脑流程：
   * 1. 获取云电脑地域列表
   * 2. 获取云电脑产品规格
   * 3. 构造 SKU 配置，调用 queryPrice API
   * 4. 解析响应，输出为 PriceItem[]
   *
   * options.keyword 支持地域过滤，当包含地域名称时只返回该地域价格。
   */
  async getProductPrice(productId?: string, options?: PriceQueryOptions): Promise<PriceResult> {
    const result: PriceResult = {
      provider: this.provider,
      name: this.name,
      prices: [],
      updateDate: new Date().toISOString().split("T")[0],
    };

    if (!productId) {
      return this.makePriceResult([], {
        updateDate: new Date().toISOString().split("T")[0],
        message: "天翼云价格查询：请指定 productId。常用产品：10027004（云电脑政企版）、10026730（弹性云主机 ECS）、11061839（Token 服务）。示例：get_product_price({ provider: \"ctyun\", productId: \"10027004\" })",
      });
    }

    try {
      // 云电脑政企版（productId=10027004）
      if (productId === "10027004") {
        return await this.getDesktopPrice(options);
      }

      // ECS（productId=10026730）
      if (productId !== "10026730") {
        result.dataStatus = "no_data";
        return result;
      }

      return await this.getEcsPrice(options);
    } catch (error) {
      result.dataStatus = "no_data";
    }

    return result;
  }

  /**
   * 查询 ECS 价格（默认地域为华东1）
   */
  private async getEcsPrice(options?: PriceQueryOptions): Promise<PriceResult> {
    const result: PriceResult = {
      provider: this.provider,
      name: this.name,
      prices: [],
      updateDate: new Date().toISOString().split("T")[0],
    };

    // 1. 获取 cookie
    const cookie = await this.getCtyunCookie();

    // 2. 获取地域列表，优先使用华东1
    const regions = await this.getRegionList();
    // 从 keyword 中提取地域关键词（支持多关键字，如 "南京3 按需" 提取 "南京3"）
    let keywordRegion: { id: string; name: string } | null = null;
    if (options?.keyword) {
      const keywords = options.keyword.split(/\s+/).filter(k => k.length > 0);
      for (const kw of keywords) {
        keywordRegion = this.findRegionByKeyword(regions, kw);
        if (keywordRegion) break;
      }
    }
    const targetRegion = keywordRegion || this.findRegionByKeyword(regions, "华东1") || regions[0];
    if (!targetRegion) {
      result.dataStatus = "no_data";
      return result;
    }
    // 如果 keyword 是地域名但没匹配到，在 message 中提示
    const regionHint = options?.keyword && !keywordRegion && /[一-龥]/.test(options.keyword)
      ? `未找到地域"${options.keyword}"，默认使用 ${targetRegion.name}` : undefined;

    // 3. 获取 flavor 映射
    const flavorMap = await this.getFlavorMap(targetRegion.id);
    if (flavorMap.size === 0) {
      result.dataStatus = "no_data";
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

    // 5. 并行查询包月和按量价格
    const [monthlyRes, hourlyRes] = await Promise.all([
      this.fetchWithRetry("https://console.ctyun.cn/console/compute/api/proxyv3/querynew/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Referer": `${BASE_URL}/`,
          "Accept": "application/json",
          "Cookie": `ct_tgc=${cookie}`,
        },
        body: JSON.stringify({
          billMode: 1,
          regionId: targetRegion.id,
          resourceType: "ecs_flavor",
          flavorsInfo,
          cycleCnt: 1,
          cycleType: "M",
        }),
      }),
      this.fetchWithRetry("https://console.ctyun.cn/console/compute/api/proxyv3/querynew/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Referer": `${BASE_URL}/`,
          "Accept": "application/json",
          "Cookie": `ct_tgc=${cookie}`,
        },
        body: JSON.stringify({
          billMode: 2,
          regionId: targetRegion.id,
          resourceType: "ecs_flavor",
          flavorsInfo,
          cycleCnt: 1,
          cycleType: "H",
        }),
      }),
    ]);

    const [monthlyRaw, hourlyRaw] = await Promise.all([
      monthlyRes.json() as Promise<any>,
      hourlyRes.json() as Promise<any>,
    ]);

    // 6. 解析包月价格
    const parsePrices = (raw: any, billingMode: string, unit: string) => {
      const returnObj = raw?.returnObj;
      if (!returnObj || raw.statusCode !== 800) return;
      for (const sub of returnObj.subOrderPrices || []) {
        const flavorInfo = flavorMap.get(sub.flavor_uuid);
        if (!flavorInfo) continue;
        const vmPrice = (sub.orderItemPrices || []).find((p: any) => p.resourceType === "VM");
        result.prices.push({
          productName: `弹性云主机 ${flavorInfo.spec_name}`,
          billingMode,
          price: vmPrice ? vmPrice.finalPrice : sub.finalPrice,
          unit,
          region: targetRegion.name,
        });
      }
    };

    parsePrices(monthlyRaw, "包月", "元/月");
    parsePrices(hourlyRaw, "按量", "元/小时");

    if (result.prices.length === 0) {
      result.dataStatus = "no_data";
      return result;
    }

    result.dataStatus = result.prices.length > 0 ? "complete" : "no_data";
    return result;
  }

  /**
   * 查询天翼云电脑价格（默认地域为扬州）
   */
  private async getDesktopPrice(options?: PriceQueryOptions): Promise<PriceResult> {
    const result: PriceResult = {
      provider: this.provider,
      name: this.name,
      prices: [],
      updateDate: new Date().toISOString().split("T")[0],
    };

    try {
      // 1. 获取云电脑地域列表
      const deskRegions = await this.getDeskRegionList();
      let keywordRegion: { id: string; name: string } | null = null;
      if (options?.keyword) {
        const keywords = options.keyword.split(/\s+/).filter(k => k.length > 0);
        for (const kw of keywords) {
          keywordRegion = this.findRegionByKeyword(deskRegions, kw);
          if (keywordRegion) break;
        }
      }
      const targetRegion = keywordRegion || this.findRegionByKeyword(deskRegions, "扬州") || deskRegions[0];
      if (!targetRegion) {
        result.dataStatus = "no_data";
        return result;
      }

      // 2. 获取云电脑产品规格
      const products = await this.getDesktopProducts(targetRegion.id);
      if (!products || products.length === 0) {
        result.dataStatus = "no_data";
        return result;
      }

      // 3. 构造所有价格查询任务
      // cycleType=3=包月, cycleType=5=包年（API 测试显示 5 返回的是年价 91*12=1092，非按小时）
      const cycleTypes = [3, 5];
      const cycleLabels: Record<number, string> = { 3: "包月", 5: "包年" };
      const cycleUnits: Record<number, string> = { 3: "元/月", 5: "元/年" };

      interface PriceTask {
        skuConfig: any;
        seriesName: string;
        tplName: string;
        cycleType: number;
        diskType?: string; // SAS/SSD
      }

      const tasks: PriceTask[] = [];

      for (const product of products) {
        for (const series of product.series || []) {
          for (const sku of series.sku || []) {
            const tplAttr = (series.attrs || []).find((a: any) => a.attrKey === "tplId");
            const tplVals = tplAttr?.attrVals || [];
            const sysDiskSizeAttr = (series.attrs || []).find((a: any) => a.attrKey === "sysDiskSize");
            const sysDiskTypeAttr = (series.attrs || []).find((a: any) => a.attrKey === "sysDiskType");
            const sysDiskSize = sysDiskSizeAttr?.attrVal || "80";
            const sysDiskType = sysDiskTypeAttr?.attrVal || "SAS";
            const dataDiskTypeAttr = (series.attrs || []).find((a: any) => a.attrKey === "dataDiskType");
            const dataDiskSizeAttr = (series.attrs || []).find((a: any) => a.attrKey === "dataDiskSize");
            const dataDiskSize = dataDiskSizeAttr?.attrVal || "0";

            for (const tpl of tplVals) {
              for (const cycleType of cycleTypes) {
                const baseConfig = {
                  attrs: [
                    { attrKey: "cycleType", attrVal: cycleType },
                    { attrKey: "cycleCnt", attrVal: 1 },
                  ],
                  prodId: sku.prodId,
                  prodType: "busidesktop",
                  execSort: 1,
                  resItems: [{
                    resType: "ecs",
                    tag: "master",
                    itemDefName: tpl.attrVal,
                    size: 1,
                    attrs: [],
                    resItems: [{
                      resType: "ebs",
                      tag: "sysDisk",
                      itemDefName: sysDiskType,
                      size: parseInt(sysDiskSize),
                    }],
                  }],
                };

                if (dataDiskTypeAttr && dataDiskSizeAttr) {
                  const dataDiskTypes = dataDiskTypeAttr.attrVals || [{ attrVal: dataDiskTypeAttr.attrVal || "SAS", attrName: dataDiskTypeAttr.attrVal || "高IO" }];
                  for (const ddType of dataDiskTypes) {
                    tasks.push({
                      skuConfig: {
                        ...baseConfig,
                        resItems: [{
                          ...baseConfig.resItems[0],
                          resItems: [
                            ...baseConfig.resItems[0].resItems,
                            { resType: "ebs", tag: "dataDisk", itemDefName: ddType.attrVal, size: parseInt(dataDiskSize) },
                          ],
                        }],
                      },
                      seriesName: series.prodName,
                      tplName: tpl.attrName,
                      cycleType,
                      diskType: ddType.attrName || ddType.attrVal,
                    });
                  }
                } else {
                  tasks.push({
                    skuConfig: baseConfig,
                    seriesName: series.prodName,
                    tplName: tpl.attrName,
                    cycleType,
                  });
                }
              }
            }
          }
        }
      }

      // 4. 分批并发执行，每批最多 10 个请求
      const BATCH_SIZE = 10;
      // 去重 key：云电脑按 seriesName + tplName + cycleType 去重，磁盘按 cycleType 去重
      const priceSeen = new Set<string>();

      for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
        const batch = tasks.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map((task) =>
            this.queryDesktopPrice(targetRegion.id, task.skuConfig).then((prices) => ({
              task,
              prices,
            }))
          )
        );

        for (const { task, prices } of batchResults) {
          for (const sub of prices) {
            for (const item of sub.items) {
              const isDisk = item.resourceType === "BUSINESS_CPC_EBS";
              const isVm = item.resourceType === "BUSINESS_CPC_VM";

              // 去重
              const dedupKey = isDisk
                ? `disk_${task.cycleType}_${task.diskType || ""}`
                : `vm_${task.seriesName}_${task.tplName}_${task.cycleType}`;
              if (priceSeen.has(dedupKey)) {
                continue;
              }
              priceSeen.add(dedupKey);

              // 根据 resourceType 映射组件类型
              const componentTypeMap: Record<string, string> = {
                "BUSINESS_CPC_VM": "云电脑",
                "BUSINESS_CPC_EBS": "磁盘",
              };
              const componentType = componentTypeMap[item.resourceType] || item.resourceType || "未知";

              // 云电脑显示规格，磁盘显示统一名称（含磁盘类型）
              const productName = isDisk
                ? `磁盘（系统盘+数据盘${task.diskType ? " " + task.diskType : ""}）`
                : `${task.seriesName} ${task.tplName}`;

              result.prices.push({
                productName,
                billingMode: cycleLabels[task.cycleType],
                price: item.finalPrice,
                unit: cycleUnits[task.cycleType],
                region: targetRegion.name,
                componentType,
              });
            }
          }
        }
      }

      result.dataStatus = result.prices.length > 0 ? "complete" : "no_data";
      result.message = `天翼云电脑（政企版）价格查询完成，共 ${result.prices.length} 条价格记录（地域：${targetRegion.name}）`;
    } catch (error) {
      result.dataStatus = "no_data";
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
  private parseUnitPrices(markdown: string): PriceItem[] {
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
          billingMode: "包年包月",
          price: parseFloat(cpuMatch[1]),
          unit: "元/核/月",
        });
        prices.push({
          productName: `${familyName} CPU`,
          billingMode: "按量计费",
          price: parseFloat(cpuMatch[2]),
          unit: "元/核/小时",
        });
      }

      if (memMatch) {
        prices.push({
          productName: `${familyName} 内存`,
          billingMode: "包年包月",
          price: parseFloat(memMatch[1]),
          unit: "元/GB/月",
        });
        prices.push({
          productName: `${familyName} 内存`,
          billingMode: "按量计费",
          price: parseFloat(memMatch[2]),
          unit: "元/GB/小时",
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
  private calculateCommonSpecs(prices: PriceItem[]): PriceItem[] {
    const calculatedPrices: PriceItem[] = [];

    // 查找 CPU 单价和内存单价
    let cpuPrice = 0;
    let memPrice = 0;
    let cpuUnit = "";
    let memUnit = "";
    let billingMode = "包年包月";

    for (const p of prices) {
      const spec = (p.productName || "").toLowerCase();
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
          billingMode,
          price: Math.round(totalPrice * 100) / 100,
          unit: "元/月",
        });
      }
    }

    return calculatedPrices;
  }
}