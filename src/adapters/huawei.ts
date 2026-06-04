import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type SpecPriceItem, type PaginatedResult, type ListProductsOptions, type TocOptions, type PriceQueryOptions } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const BASE_URL = "https://support.huaweicloud.com";
const PRODUCTS_API = "https://portal.huaweicloud.com/rest/cbc/portaldocdataservice/v1/books/items?appId=CHINA-ZH_CN";
const CALCULATOR_API = "https://portal.huaweicloud.com/api/calculator/rest/cbc/portalcalculatornodeservice/v4/api";

interface HuaweiProduct {
  code: string;
  title: string;
  uri: string;
  description: string;
}

interface HuaweiCategory {
  code: string;
  name: string;
  cnName: string;
  products: HuaweiProduct[];
}

export class HuaweiAdapter extends CloudDocAdapter {
  readonly provider = "huawei";
  readonly name = "华为云";

  // 中国大陆地域列表（用于过滤海外地域）
  private readonly CN_REGIONS = new Set([
    "cn-north-4", "cn-north-5", "cn-north-6", "cn-north-9", "cn-north-10", "cn-north-12",
    "cn-east-2", "cn-east-3", "cn-east-4", "cn-east-5",
    "cn-south-1", "cn-south-2", "cn-south-4",
    "cn-southwest-2",
  ]);

  private async fetchPortalApi<T>(url: string): Promise<T> {
    const res = await this.fetchWithRetry(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://support.huaweicloud.com/",
      },
    });
    if (!res.ok) {
      throw new Error(`请求失败: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>> {
    const data = await this.fetchPortalApi<{ data: HuaweiCategory[] }>(PRODUCTS_API);
    const products: Product[] = [];
    const seen = new Set<string>();

    for (const category of data.data) {
      for (const product of category.products) {
        if (product.code && !seen.has(product.code)) {
          seen.add(product.code);
          products.push({
            productId: product.code,
            name: product.title,
          });
        }
      }
    }

    const filtered = this.filterByKeywords(products, options?.keyword);
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 100;
    return this.paginate(filtered, page, pageSize);
  }

  async getDocumentToc(productId: string, options?: TocOptions): Promise<PaginatedResult<TocItem>> {
    const url = `${BASE_URL}/${productId}/v3_support_leftmenu_fragment.html`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const items: TocItem[] = [];
    const seen = new Set<string>();

    // 从左侧边框目录提取链接
    // 格式: <a target="_self" href="https://support.huaweicloud.com/productdesc-ecs/ecs_01_0073.html" ...>
    $(".side-nav a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const title = $(el).text().trim();

      // 匹配文档链接: /productdesc-ecs/ecs_01_0073.html
      const match = href.match(/\/([\w-]+)\/([\w-]+\.html)/);
      if (match && title && !seen.has(href)) {
        seen.add(href);
        // pageId 格式: productId/docId (如 ecs/ecs_01_0073)
        const docId = match[1] + "/" + match[2].replace(".html", "");
        items.push({
          pageId: `${productId}/${docId}`,
          title,
        });
      }
    });

    // 关键词过滤
    if (options?.keyword) {
      const keywords = options.keyword.trim().split(/\s+/).filter(Boolean);
      if (keywords.length > 0) {
        return this.paginate(items.filter(item => {
          const text = (item.title || "").toLowerCase();
          return keywords.every(kw => text.includes(kw.toLowerCase()));
        }), options?.page, options?.pageSize);
      }
    }

    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 200;
    return this.paginate(items, page, pageSize);
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    // 华为云没有公开的搜索 API，通过遍历文档目录做本地关键词匹配
    const tocResult = await this.getDocumentToc(productId);
    const toc = tocResult.items;
    const lowerKeyword = keyword.toLowerCase();

    return toc
      .filter((item) => item.title.toLowerCase().includes(lowerKeyword))
      .map((item) => ({
        pageId: item.pageId,
        title: item.title,
        description: undefined,
      }));
  }

  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    // pageId 格式: productId/docPath (如 ecs/productdesc-ecs/ecs_01_0073)
    // URL: https://support.huaweicloud.com/productdesc-ecs/ecs_01_0073.html
    const parts = pageId.split("/");
    const productId = parts[0];
    const docPath = parts.slice(1).join("/");

    const url = `${BASE_URL}/${docPath}.html`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $("title").text().trim() || $("h1").first().text().trim() || "";
    const description = $('meta[name="description"]').attr("content") || "";

    // 从页面中提取更新时间
    const updateTime = $(".updateTime .updateInfo, .updateInfo").text().trim() || "";

    return {
      pageId,
      title,
      contentPath: url,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    const html = await this.fetchHtml(contentPath);
    const $ = cheerio.load(html);
    // 仅提取 help-content help-center-document 区域的内容，去除页头页脚等无关信息
    const content = $(".help-content.help-center-document").first();
    if (content.length > 0) {
      return htmlToMarkdown(content.html() || "");
    }
    return htmlToMarkdown(html);
  }

  /**
   * 从 Markdown 文本中解析价格表格（退订方案）
   */
  private parsePriceTable(markdown: string): PriceItem[] {
    const lines = markdown.split("\n");
    const prices: PriceItem[] = [];
    let inTable = false;
    let headers: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith("|") && line.endsWith("|")) {
        const cells = line.split("|").map((c) => c.trim()).filter((c) => c !== "");

        if (!inTable) {
          headers = cells;
          inTable = true;
          continue;
        }

        if (cells.every((c) => /^-+\s*$/.test(c))) {
          continue;
        }

        if (cells.length >= 2) {
          const productName = cells[0] || "";
          const lastCell = cells[cells.length - 1] || "";
          const priceMatch = lastCell.match(/[\d,.]+/);
          if (priceMatch) {
            prices.push({
              productName,
              billingMode: headers.includes("计费模式") || headers.includes("付费模式")
                ? cells[headers.indexOf("计费模式")] || cells[headers.indexOf("付费模式")] || ""
                : "",
              price: parseFloat(priceMatch[0].replace(/,/g, "")),
              unit: "",
            });
          }
        }
      } else {
        inTable = false;
        headers = [];
      }
    }

    return prices;
  }

  /**
   * 构建华为云 ECS 规格-配置-价格联合表
   *
   * resourceSpecCode 格式: x2.8u.8g.linux
   *   - x2 = 规格族
   *   - 8u = 8 vCPU
   *   - 8g = 8GB 内存
   *   - linux = 操作系统
   *
   * 其他格式: s6.large.1.linux
   *   - s6 = 规格族
   *   - large.1 = 规格大小
   *   - linux = 操作系统
   */
  async buildSpecPriceTable(productId?: string): Promise<SpecPriceItem[]> {
    const specItems: SpecPriceItem[] = [];
    const seen = new Set<string>();

    if (!productId || productId !== "ecs") return specItems;

    try {
      const exportData = await this.exportProductList("ecs");
      if (!exportData) return specItems;

      for (const [region, items] of Object.entries(exportData)) {
        // 只保留中国大陆地域
        if (!this.CN_REGIONS.has(region)) continue;

        for (const item of items) {
          const specCode = item.resourceSpecCode || "";
          if (!specCode) continue;

          // 解析 resourceSpecCode 获取 CPU 和内存
          const parsed = this.parseHuaweiSpecCode(specCode);
          if (!parsed) continue;

          const displayName = `${parsed.cpu}C${parsed.mem}G`;

          // 按量价格
          if (item.ONDEMAND != null && item.ONDEMAND > 0) {
            const key = `${specCode}_${region}_按量`;
            if (!seen.has(key)) {
              seen.add(key);
              specItems.push({
                specName: specCode,
                cpu: parsed.cpu,
                mem: parsed.mem,
                displayName,
                region,
                billingMode: "按量",
                price: item.ONDEMAND,
                unit: "元/小时",
                familyName: parsed.family,
              });
            }
          }

          // 包月价格
          if (item.MONTHLY_1 != null && item.MONTHLY_1 > 0) {
            const key = `${specCode}_${region}_包月`;
            if (!seen.has(key)) {
              seen.add(key);
              specItems.push({
                specName: specCode,
                cpu: parsed.cpu,
                mem: parsed.mem,
                displayName,
                region,
                billingMode: "包月",
                price: item.MONTHLY_1,
                unit: "元/月",
                familyName: parsed.family,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error(`华为云规格价格表构建失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    return specItems;
  }

  /**
   * 解析华为云 resourceSpecCode
   *
   * 格式1: x2.8u.8g.linux → { family: "x2", cpu: 8, mem: 8 }
   * 格式2: s6.large.1.linux → 通过 inferSpecFromName 推断
   */
  private parseHuaweiSpecCode(specCode: string): { family: string; cpu: number; mem: number } | null {
    const lower = specCode.toLowerCase();

    // 格式1: x2.8u.8g.linux → 直接包含 u 和 g 标记
    const match1 = lower.match(/^([a-z0-9]+)\.(\d+)u\.(\d+)g\./);
    if (match1) {
      return {
        family: match1[1],
        cpu: parseInt(match1[2]),
        mem: parseInt(match1[3]),
      };
    }

    // 格式2: s6.large.1.linux → 通过规格名推断
    const inferred = this.inferSpecFromName(lower);
    if (inferred) {
      const familyMatch = lower.match(/^([a-z0-9]+)\./);
      return {
        family: familyMatch ? familyMatch[1] : "",
        cpu: inferred.cpu,
        mem: inferred.mem,
      };
    }

    return null;
  }

  /**
   * 获取华为云产品价格
   *
   * 实现方式：
   * 1. 调用 menuInfo API 获取所有产品的 urlPath
   * 2. 对每个产品调用 export/productlist API 获取全部价格
   * 3. 对 MaaS 等 Token 产品，用 productInfo API 获取详细价格
   *
   * 华为云价格计算器 API（均可持续调用）：
   * - menuInfo: GET /api/calculator/.../menuInfo → 产品菜单
   * - export/productlist: POST /api/calculator/.../export/productlist → 全部价格导出
   * - productInfo: GET /api/calculator/.../productInfo → 产品配置和价格详情
   */
  async getProductPrice(productId?: string, options?: PriceQueryOptions): Promise<PriceResult> {
    const name = this.name;
    let prices: PriceItem[] = [];

    try {
      // 1. 获取产品菜单，找到 urlPath
      const menuData = await this.fetchCalculatorApi<{ menuInfos: any[] }>("menuInfo", { sign: "common", language: "zh-cn" });
      if (!menuData?.menuInfos) {
        return {
          provider: this.provider,
          name,
          prices,
          dataStatus: "no_price",
        };
      }

      // 扁平化所有产品
      const allProducts: { name: string; urlPath: string }[] = [];
      for (const category of menuData.menuInfos) {
        for (const sub of category.subCategoryLists || []) {
          if (sub.hasCalculator && sub.urlPath) {
            allProducts.push({ name: sub.categoryName, urlPath: sub.urlPath });
          }
        }
      }

      // 如果指定了 productId，只查询匹配的产品
      const targetProducts = productId
        ? allProducts.filter(p =>
            p.urlPath.toLowerCase().includes(productId.toLowerCase()) ||
            p.name.includes(productId)
          )
        : allProducts;

      // 限制查询数量，避免超时
      const queryProducts = targetProducts.slice(0, 5);

      for (const product of queryProducts) {
        try {
          // 2. 调用 export/productlist 获取全部价格
          const exportData = await this.exportProductList(product.urlPath);
          if (exportData) {
            const productPrices = this.parseExportPrices(exportData, product.name, product.urlPath);
            prices.push(...productPrices);
          }

          // 3. 如果 export/productlist 没数据，就尝试 productInfo API
          if (!exportData || Object.values(exportData).every(arr => !Array.isArray(arr) || arr.length === 0)) {
            const infoPrices = await this.fetchProductInfoPrices(product.urlPath, product.name);
            prices.push(...infoPrices);
          }

          // 4. 对 Token 类别产品，补充 productInfo 详细价格
          if (product.urlPath === "maas") {
            const tokenPrices = await this.fetchMaasTokenPrices();
            prices.push(...tokenPrices);
          }
        } catch {
          continue;
        }
      }
    } catch (error) {
      console.error("获取华为云价格信息失败", error);
    }

    // 退订到文档解析
    if (prices.length === 0) {
      prices = await this.fallbackParsePrice(productId);
    }

    // 应用关键词过滤
    if (options?.keyword && prices.length > 0) {
      const lowerKeyword = options.keyword.toLowerCase();
      prices = prices.filter(p =>
        p.productName?.toLowerCase().includes(lowerKeyword) ||
        p.productName?.toLowerCase().includes(lowerKeyword) ||
        p.region?.toLowerCase().includes(lowerKeyword) ||
        p.billingMode?.toLowerCase().includes(lowerKeyword)
      );
    }

    // 分页（仅在明确指定 page/pageSize 时才截断，否则返回全部数据）
    const total = prices.length;
    const page = options?.page;
    const pageSize = options?.pageSize;
    let pagedPrices = prices;
    let hasMore = false;
    if (page && pageSize) {
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      pagedPrices = prices.slice(start, end);
      hasMore = end < total;
    }

    return {
      provider: this.provider,
      name,
      prices: pagedPrices,
      total,
      page: page || 1,
      pageSize: pageSize || total,
      hasMore,
      dataStatus: prices.length > 0 ? "complete" : "no_price",
    };
  }

  /**
   * 调用华为云价格计算器 API
   */
  private async fetchCalculatorApi<T>(action: string, params: Record<string, string>): Promise<T | null> {
    const query = new URLSearchParams(params).toString();
    const url = `${CALCULATOR_API}/${action}?${query}`;

    const res = await this.fetchWithRetry(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://www.huaweicloud.com/pricing/calculator.html",
      },
    });

    if (!res.ok) return null;
    return res.json() as Promise<T>;
  }

  /**
   * 产品 urlPath 到 source 参数的映射表
   * 不同产品需要不同的 resource type 参数
   * 部分产品可能需要尝试多个 source 参数
   */
  private readonly PRODUCT_SOURCE_MAP: Record<string, { param: string }[]> = {
    "ecs": [{ param: "hws.resource.type.vm" }, { param: "hws.resource.type.ecs" }],
    "ecs-dedicated": [{ param: "hws.resource.type.vm" }],
    "evs": [{ param: "hws.resource.type.volume" }],
    "sfs": [{ param: "hws.resource.type.sfs" }],
    "rds": [{ param: "hws.resource.type.rds" }],
    "dds": [{ param: "hws.resource.type.dds" }],
    "gaussdb": [{ param: "hws.resource.type.gaussdb" }],
    "redis": [{ param: "hws.resource.type.redis" }],
    "elb": [{ param: "hws.resource.type.elb" }],
    "vpc": [{ param: "hws.resource.type.vpc" }],
    "dns": [{ param: "hws.resource.type.dns" }],
    "cdn": [{ param: "hws.resource.type.cdn" }],
    "waf": [{ param: "hws.resource.type.waf" }],
    "dws": [{ param: "hws.resource.type.dws" }],
    "mrs": [{ param: "hws.resource.type.mrs" }],
    "css": [{ param: "hws.resource.type.css" }],
    "dcs": [{ param: "hws.resource.type.dcs" }],
    "cce": [{ param: "hws.resource.type.cce" }],
    "cbr": [{ param: "hws.resource.type.cbr" }],
    "nat": [{ param: "hws.resource.type.nat" }],
    "maas": [{ param: "hws.resource.type.maas" }],
    "modelarts": [{ param: "hws.resource.type.modelarts" }],
  };

  /**
   * 调用 export/productlist API 获取全部价格
   * 会尝试所有可用的 source 参数，直到获取到数据
   */
  private async exportProductList(urlPath: string): Promise<Record<string, any[]> | null> {
    const sourcesList = this.PRODUCT_SOURCE_MAP[urlPath] || [{ param: "hws.resource.type.vm" }];

    // 尝试每个 source 参数，直到获取到数据
    for (const sources of sourcesList.map(s => [s])) {
      try {
        const res = await this.fetchWithRetry(`${CALCULATOR_API}/export/productlist`, {
          method: "POST",
          headers: {
            "accept": "application/json, text/plain, */*",
            "content-type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.huaweicloud.com/pricing/calculator.html",
          },
          body: JSON.stringify({
            urlPath,
            sources,
            type: "JSON",
            language: "zh-cn",
          }),
        });

        if (!res.ok) continue;
        const data = await res.json() as Record<string, any[]>;

        // 检查是否有实际数据
        const hasData = Object.values(data).some(arr => Array.isArray(arr) && arr.length > 0);
        if (hasData) return data;
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * 解析 export/productlist 返回的价格数据
   */
  private parseExportPrices(
    data: Record<string, any[]>,
    productName: string,
    urlPath: string
  ): PriceItem[] {
    const prices: PriceItem[] = [];
    const seen = new Set<string>();

    for (const [region, items] of Object.entries(data)) {
      // 只保留中国大陆地域
      if (!this.CN_REGIONS.has(region)) continue;

      for (const item of items) {
        const spec = item.resourceSpecCode || "";
        if (!spec) continue;

        // 按量价格
        if (item.ONDEMAND != null && item.ONDEMAND > 0) {
          const key = `${spec}_ondemand_${region}`;
          if (!seen.has(key)) {
            seen.add(key);
            prices.push({
              productName,
              region,
              billingMode: "按量",
              price: item.ONDEMAND,
              unit: "元/小时",
            });
          }
        }

        // 包月价格
        if (item.MONTHLY_1 != null && item.MONTHLY_1 > 0) {
          const key = `${spec}_monthly_${region}`;
          if (!seen.has(key)) {
            seen.add(key);
            prices.push({
              productName,
              region,
              billingMode: "包年包月",
              price: item.MONTHLY_1,
              unit: "元/月",
            });
          }
        }

        // 包年价格
        if (item.YEARLY_1 != null && item.YEARLY_1 > 0) {
          const key = `${spec}_yearly_${region}`;
          if (!seen.has(key)) {
            seen.add(key);
            prices.push({
              productName,
              region,
              billingMode: "包年包月",
              price: item.YEARLY_1,
              unit: "元/年",
            });
          }
        }
      }
    }

    return prices;
  }

  /**
   * 通过 productInfo API 获取产品价格（export/productlist 的备选方案）
   */
  private async fetchProductInfoPrices(urlPath: string, productName: string): Promise<PriceItem[]> {
    const prices: PriceItem[] = [];
    try {
      const data = await this.fetchCalculatorApi<{ product: Record<string, any[]> }>(
        "productInfo",
        {
          urlPath,
          tag: "general.online.portal",
          region: "cn-north-4",
          tab: "calc",
          sign: "common",
        }
      );

      if (!data?.product) return prices;

      for (const [, items] of Object.entries(data.product)) {
        for (const item of items) {
          const spec = item.resourceSpecCode || item.specCode || "";
          if (!spec) continue;

          const planList = item.planList || [];
          for (const plan of planList) {
            const billingMode = plan.billingMode === "ONDEMAND" ? "按量" : "包年包月";
            if (plan.amount == null || plan.amount <= 0) continue;

            const period = plan.period || "";
            const unit = period === "hourly" ? "元/小时"
              : period === "monthly" ? "元/月"
              : period === "yearly" ? "元/年"
              : "元";

            prices.push({
              productName,
              region: plan.region || "cn-north-4",
              billingMode,
              price: plan.amount,
              unit,
            });
          }
        }
      }
    } catch {
      // productInfo 获取失败不影响其他产品
    }
    return prices;
  }

  /**
   * 获取 MaaS 模型 Token 价格
   */
  private async fetchMaasTokenPrices(): Promise<PriceItem[]> {
    const prices: PriceItem[] = [];

    try {
      const data = await this.fetchCalculatorApi<{ product: Record<string, any[]> }>(
        "productInfo",
        {
          urlPath: "maas",
          tag: "general.online.portal",
          region: "cn-north-4",
          tab: "calc",
          sign: "common",
        }
      );

      if (!data?.product) return prices;

      for (const [, items] of Object.entries(data.product)) {
        for (const item of items) {
          const modelName = item["Model Name"] || item.resourceSpecCode || "";
          const planList = item.planList || [];

          for (const plan of planList) {
            if (plan.billingMode !== "ONDEMAND") continue;
            if (plan.amount == null || plan.amount <= 0) continue;

            const usageType = plan.usageFactor || "";
            const isInput = usageType.includes("input");
            const isOutput = usageType.includes("output");

            prices.push({
              productName: "MaaS 模型服务",
              billingMode: "按量",
              price: plan.amount,
              unit: "元/百万 Token",
            });
          }
        }
      }
    } catch {
      // MaaS 价格获取失败不影响其他产品
    }

    return prices;
  }

  /**
   * 退订方案：从文档页面解析价格
   */
  private async fallbackParsePrice(productId?: string): Promise<PriceItem[]> {
    const pricingBaseUrl = "https://www.huaweicloud.com/pricing";
    const prices: PriceItem[] = [];

    if (!productId) {
      try {
        const html = await this.fetchHtml(pricingBaseUrl);
        const md = htmlToMarkdown(html);
        return this.parsePriceTable(md);
      } catch {
        return prices;
      }
    }

    const urls = [
      `${BASE_URL}/${productId}/price_fragment.html`,
      `${pricingBaseUrl}?productCode=${productId}`,
      `${BASE_URL}/${productId}/billing_fragment.html`,
    ];

    for (const url of urls) {
      try {
        const html = await this.fetchHtml(url);
        const $ = cheerio.load(html);
        const content = $(".help-content.help-center-document, .pricing-content, .price-table, table").first();
        const md = content.length > 0
          ? htmlToMarkdown(content.html() || "")
          : htmlToMarkdown(html);
        const result = this.parsePriceTable(md);
        if (result.length > 0) return result;
      } catch {
        continue;
      }
    }

    return prices;
  }

}
