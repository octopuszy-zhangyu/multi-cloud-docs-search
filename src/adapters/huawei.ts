import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const BASE_URL = "https://support.huaweicloud.com";
const PRODUCTS_API = "https://portal.huaweicloud.com/rest/cbc/portaldocdataservice/v1/books/items?appId=CHINA-ZH_CN";

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
   * 从 Markdown 文本中解析价格表格
   */
  private parsePriceTable(markdown: string, sourceUrl: string): PriceItem[] {
    const lines = markdown.split("\n");
    const prices: PriceItem[] = [];
    let inTable = false;
    let headers: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 检测表格行（以 | 开头和结尾）
      if (line.startsWith("|") && line.endsWith("|")) {
        const cells = line.split("|").map((c) => c.trim()).filter((c) => c !== "");

        if (!inTable) {
          headers = cells;
          inTable = true;
          continue;
        }

        // 跳过分隔行
        if (cells.every((c) => /^-+\s*$/.test(c))) {
          continue;
        }

        // 解析数据行
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

  async getProductPrice(productId?: string): Promise<PriceResult> {
    const name = this.name;
    const pricingBaseUrl = "https://www.huaweicloud.com/pricing";

    if (!productId) {
      // 无 productId，尝试获取通用定价页面
      try {
        const html = await this.fetchHtml(pricingBaseUrl);
        const md = htmlToMarkdown(html);
        const prices = this.parsePriceTable(md, pricingBaseUrl);

        return {
          provider: this.provider,
          name,
          prices,
          source: pricingBaseUrl,
        };
      } catch {
        return {
          provider: this.provider,
          name,
          prices: [],
          source: pricingBaseUrl,
        };
      }
    }

    // 有 productId，尝试多个可能的定价页面
    const urls = [
      `${BASE_URL}/${productId}/price_fragment.html`,
      `${pricingBaseUrl}?productCode=${productId}`,
      `${BASE_URL}/${productId}/billing_fragment.html`,
    ];

    for (const url of urls) {
      try {
        const html = await this.fetchHtml(url);
        const $ = cheerio.load(html);
        // 尝试提取定价相关的内容区域
        const content = $(".help-content.help-center-document, .pricing-content, .price-table, table").first();
        const md = content.length > 0
          ? htmlToMarkdown(content.html() || "")
          : htmlToMarkdown(html);
        const prices = this.parsePriceTable(md, url);

        if (prices.length > 0) {
          let updateDate: string | undefined;
          const updateMatch = md.match(/(?:更新|发布|修改)(?:时间|日期)[：:]\s*([\d-]+)/);
          if (updateMatch) {
            updateDate = updateMatch[1];
          }

          return {
            provider: this.provider,
            name,
            prices,
            source: url,
            updateDate,
          };
        }
      } catch {
        continue;
      }
    }

    return {
      provider: this.provider,
      name,
      prices: [],
      source: pricingBaseUrl,
    };
  }
}