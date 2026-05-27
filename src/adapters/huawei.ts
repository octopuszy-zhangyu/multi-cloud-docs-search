import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult } from "./base.js";
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

  private async fetchHtml(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.text();
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://support.huaweicloud.com/",
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async listProducts(): Promise<Product[]> {
    const data = await this.fetchJson<{ data: HuaweiCategory[] }>(PRODUCTS_API);
    const products: Product[] = [];
    const seen = new Set<string>();

    for (const category of data.data) {
      for (const product of category.products) {
        if (product.code && !seen.has(product.code)) {
          seen.add(product.code);
          products.push({
            productId: product.code,
            name: product.title,
            description: product.description,
          });
        }
      }
    }

    return products;
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
    const url = `${BASE_URL}/${productId}/v3_support_leftmenu_fragment.html`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const items: TocItem[] = [];
    const seen = new Set<string>();

    // 从侧边栏目录提取链接
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

    return items;
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    // 华为云没有公开的搜索 API，通过遍历文档目录做本地关键词匹配
    const toc = await this.getDocumentToc(productId);
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
      note: description || updateTime,
      contentPath: url,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    const html = await this.fetchHtml(contentPath);
    const $ = cheerio.load(html);
    // 只提取 help-content help-center-document 区域的内容，去除页头页脚等无关信息
    const content = $(".help-content.help-center-document").first();
    if (content.length > 0) {
      return htmlToMarkdown(content.html() || "");
    }
    return htmlToMarkdown(html);
  }

  /**
   * 从 Markdown 文本中解析价格表格（回退方案）
   */
  private parsePriceTable(markdown: string, sourceUrl: string): PriceItem[] {
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
              specification: cells.length > 2 ? cells.slice(1, -1).join(" / ") : "",
              billingMode: headers.includes("计费模式") || headers.includes("付费模式")
                ? cells[headers.indexOf("计费模式")] || cells[headers.indexOf("付费模式")] || ""
                : "",
              price: parseFloat(priceMatch[0].replace(/,/g, "")),
              unit: "",
              currency: "CNY",
              source: sourceUrl,
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
   * 获取华为云产品价格
   *
   * 实现方式：
   * 1. 调用 menuInfo API 获取所有产品的 urlPath
   * 2. 对每个产品调用 export/productlist API 获取全量价格
   * 3. 对 MaaS 等 Token 产品，用 productInfo API 获取详细价格
   *
   * 华为云价格计算器 API（均可匿名调用）：
   * - menuInfo: GET /api/calculator/.../menuInfo — 产品菜单
   * - export/productlist: POST /api/calculator/.../export/productlist — 全量价格导出
   * - productInfo: GET /api/calculator/.../productInfo — 产品配置和价格详情
   */
  async getProductPrice(productId?: string): Promise<PriceResult> {
    const name = this.name;
    let source = "https://www.huaweicloud.com/pricing/calculator.html";
    let prices: PriceItem[] = [];

    try {
      // 1. 获取产品菜单，找到 urlPath
      const menuData = await this.fetchCalculatorApi<{ menuInfos: any[] }>("menuInfo", { sign: "common", language: "zh-cn" });
      if (!menuData?.menuInfos) {
        return { provider: this.provider, name, prices, source };
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
          // 2. 调用 export/productlist 获取全量价格
          const exportData = await this.exportProductList(product.urlPath);
          if (exportData) {
            const productPrices = this.parseExportPrices(exportData, product.name, product.urlPath);
            prices.push(...productPrices);
          }

          // 3. 对 Token 类产品，补充 productInfo 详细价格
          if (product.urlPath === "maas") {
            const tokenPrices = await this.fetchMaasTokenPrices();
            prices.push(...tokenPrices);
          }
        } catch {
          continue;
        }
      }

      if (prices.length > 0) {
        source = "https://www.huaweicloud.com/pricing/calculator.html";
      }
    } catch (error) {
      console.error("获取华为云价格信息失败:", error);
    }

    // 回退到文档解析
    if (prices.length === 0) {
      prices = await this.fallbackParsePrice(productId);
    }

    return {
      provider: this.provider,
      name,
      prices,
      source,
    };
  }

  /**
   * 调用华为云价格计算器 API
   */
  private async fetchCalculatorApi<T>(action: string, params: Record<string, string>): Promise<T | null> {
    const query = new URLSearchParams(params).toString();
    const url = `${CALCULATOR_API}/${action}?${query}`;

    const res = await fetch(url, {
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
   * 调用 export/productlist API 获取全量价格
   */
  private async exportProductList(urlPath: string): Promise<Record<string, any[]> | null> {
    const res = await fetch(`${CALCULATOR_API}/export/productlist`, {
      method: "POST",
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.huaweicloud.com/pricing/calculator.html",
      },
      body: JSON.stringify({
        urlPath,
        sources: [{ param: "hws.resource.type.vm" }],
        type: "JSON",
        language: "zh-cn",
      }),
    });

    if (!res.ok) return null;
    return res.json() as Promise<Record<string, any[]>>;
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
      for (const item of items) {
        const spec = item.resourceSpecCode || "";
        if (!spec) continue;

        // 按需价格
        if (item.ONDEMAND != null && item.ONDEMAND > 0) {
          const key = `${spec}_ondemand_${region}`;
          if (!seen.has(key)) {
            seen.add(key);
            prices.push({
              productName,
              specification: spec,
              region,
              billingMode: "按量",
              price: item.ONDEMAND,
              unit: "元/小时",
              currency: "CNY",
              source: `https://www.huaweicloud.com/pricing/calculator.html#/${urlPath}`,
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
              specification: spec,
              region,
              billingMode: "包年包月",
              price: item.MONTHLY_1,
              unit: "元/月",
              currency: "CNY",
              source: `https://www.huaweicloud.com/pricing/calculator.html#/${urlPath}`,
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
              specification: spec,
              region,
              billingMode: "包年包月",
              price: item.YEARLY_1,
              unit: "元/年",
              currency: "CNY",
              source: `https://www.huaweicloud.com/pricing/calculator.html#/${urlPath}`,
            });
          }
        }
      }
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
              productName: "MaaS 模型即服务",
              specification: `${modelName} (${isInput ? "输入" : isOutput ? "输出" : usageType})`,
              billingMode: "按量",
              price: plan.amount,
              unit: "元/百万 Token",
              currency: "CNY",
              source: "https://www.huaweicloud.com/pricing/calculator.html#/maas",
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
   * 回退方案：从文档页面解析价格
   */
  private async fallbackParsePrice(productId?: string): Promise<PriceItem[]> {
    const pricingBaseUrl = "https://www.huaweicloud.com/pricing";
    const prices: PriceItem[] = [];

    if (!productId) {
      try {
        const html = await this.fetchHtml(pricingBaseUrl);
        const md = htmlToMarkdown(html);
        return this.parsePriceTable(md, pricingBaseUrl);
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
        const result = this.parsePriceTable(md, url);
        if (result.length > 0) return result;
      } catch {
        continue;
      }
    }

    return prices;
  }
}