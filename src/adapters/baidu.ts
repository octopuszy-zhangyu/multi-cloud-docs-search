import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type PaginatedResult, type ListProductsOptions, type TocOptions, type PriceQueryOptions } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const BASE_URL = "https://cloud.baidu.com";

export class BaiduAdapter extends CloudDocAdapter {
  readonly provider = "baidu";
  readonly name = "百度云";

  async listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>> {
    const url = `${BASE_URL}/doc/index.html`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const products: Product[] = [];
    const seen = new Set<string>();

    // 从首页提取产品链接，格式: <a href="https://cloud.baidu.com/doc/BCC/index.html" data-track-category="文档中心产品目录" data-track-value="云服务器 BCC">
    $("a[data-track-category='文档中心产品目录'][data-track-value]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const name = $(el).attr("data-track-value") || "";

      // 匹配 https://cloud.baidu.com/doc/PRODUCT_ID/index.html 或 /doc/PRODUCT_ID/index.html
      const match = href.match(/(?:\/doc\/([A-Za-z0-9_-]+)\/index\.html)/);
      if (match && name && !seen.has(match[1])) {
        seen.add(match[1]);
        products.push({
          productId: match[1],
          name,
        });
      }
    });

    // 过滤关键词
    const filtered = this.filterByKeywords(products, options?.keyword);

    // 分页
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 100;
    return this.paginate(filtered, page, pageSize);
  }

  async getDocumentToc(productId: string, options?: TocOptions): Promise<PaginatedResult<TocItem>> {
    const url = `${BASE_URL}/doc/${productId}/index.html`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const items: TocItem[] = [];
    const seen = new Set<string>();

    // 提取产品文档页中的所有文档链接
    // 格式: /doc/BCC/s/SLUG 或 https://cloud.baidu.com/doc/BCC/s/SLUG
    const pattern = new RegExp(`^(${BASE_URL})?/doc/${productId}/s/([^"#\\s]+)`);
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const title = $(el).text().trim();

      const match = href.match(pattern);
      if (match && title && !seen.has(match[2])) {
        seen.add(match[2]);
        // pageId 格式: productId/s/SLUG (如 BCC/s/8kbbkwg4p)
        items.push({
          pageId: `${productId}/s/${match[2]}`,
          title,
        });
      }
    });

    // 过滤关键词
    let filtered = this.filterByKeywords(items, options?.keyword);

    // 如果 topOnly 为 true，移除 children
    if (options?.topOnly) {
      filtered = filtered.map(item => ({ ...item, children: undefined }));
    }

    // 分页
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 200;
    return this.paginate(filtered, page, pageSize);
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    // 百度云没有公开搜索 API，通过遍历文档目录做本地关键词匹配
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
    // pageId 格式: productId/s/SLUG (如 BCC/s/8kbbkwg4p)
    const url = `${BASE_URL}/doc/${pageId}`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    // 标题格式: "创建实例导航 - 云服务器BCC | 百度智能云文档"
    const rawTitle = $("title").text().trim();
    const title = rawTitle.split("|")[0].trim() || "";

    // 描述
    const description = $('meta[name="description"]').attr("content") || "";

    return {
      pageId,
      title,
      note: description,
      contentPath: url,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    const html = await this.fetchHtml(contentPath);
    const $ = cheerio.load(html);
    // 提取 post__body 区域的内容，去除页头页脚等无关信息
    const content = $(".post__body").first();
    if (content.length > 0) {
      return htmlToMarkdown(content.html() || "");
    }
    return htmlToMarkdown(html);
  }

  private parsePriceTable(markdown: string): PriceItem[] {
    const prices: PriceItem[] = [];
    const lines = markdown.split("\n");
    let inTable = false;

    for (const line of lines) {
      if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        const cells = line.split("|").map((c) => c.trim()).filter(Boolean);

        if (!inTable) {
          inTable = true;
          continue;
        }

        if (cells.every((c) => /^[-:\s]+$/.test(c))) {
          continue;
        }

        if (cells.length >= 2) {
          const productName = cells[0] || "";
          const priceStr = cells[cells.length - 1] || "0";
          const price = parseFloat(priceStr.replace(/[^0-9.]/g, ""));
          const spec = cells.length > 2 ? cells.slice(1, -1).join(" / ") : "";

          if (!isNaN(price)) {
            prices.push({
              productName,
              specification: spec,
              billingMode: "按量",
              price,
              unit: "元/月",
              currency: "CNY",
              source: "文档定价页面",
            });
          }
        }
        continue;
      }

      if (inTable && line.trim() !== "") {
        inTable = false;
      }
    }

    return prices;
  }

  async getProductPrice(productId?: string, _options?: PriceQueryOptions): Promise<PriceResult> {
    const prices: PriceItem[] = [];

    if (productId) {
      // 先通过 searchDocuments 搜索"价格"关键词，定位定价页面
      try {
        const searchResults = await this.searchDocuments(productId, "价格");
        for (const result of searchResults) {
          try {
            const url = `${BASE_URL}/doc/${result.pageId}`;
            const html = await this.fetchHtml(url);
            const $ = cheerio.load(html);
            const content = $(".post__body").first();
            const markdown = htmlToMarkdown(content.length > 0 ? content.html() || "" : html);
            const parsed = this.parsePriceTable(markdown);
            if (parsed.length > 0) {
              prices.push(...parsed);
              break;
            }
          } catch {
            continue;
          }
        }
      } catch {
        // fall through to direct URL attempts
      }

      // 如果搜索没找到，尝试直接访问已知的定价页面 URL
      if (prices.length === 0) {
        const priceUrls = [
          `${BASE_URL}/doc/${productId}/pricing`,
          `${BASE_URL}/doc/${productId}/price`,
          `${BASE_URL}/doc/${productId}/index.html`,
          `${BASE_URL}/doc/${productId}/s/`,  // 百度云定价页面可能是 /doc/BCC/s/xxx 格式
        ];

        for (const url of priceUrls) {
          try {
            const html = await this.fetchHtml(url);
            const $ = cheerio.load(html);
            const content = $(".post__body").first();
            const markdown = htmlToMarkdown(content.length > 0 ? content.html() || "" : html);
            const parsed = this.parsePriceTable(markdown);
            if (parsed.length > 0) {
              prices.push(...parsed);
              break;
            }
          } catch {
            continue;
          }
        }
      }
    }

    // 对于 BCC 产品，如果文档中未找到具体价格，添加明确的提示信息
    if (prices.length === 0 && productId === "BCC") {
      return {
        provider: this.provider,
        name: this.name,
        prices: [],
        source: `${BASE_URL}/publicity/bccplus.html`,
        updateDate: undefined,
        note: "百度云 BCC 文档中无具体实例价格，定价页面在外部（cloud.baidu.com/publicity/bccplus.html）。请访问该页面获取具体价格，或使用 get_product_price_quick 获取定价页面 URL。",
        dataStatus: "no_price",
      };
    }

    // 标记数据状态
    let dataStatus: "complete" | "partial" | "no_price" | "no_data" = "no_data";
    if (prices.length > 0 && prices[0].price > 0) {
      dataStatus = "complete";
    } else if (prices.length > 0 && prices[0].price === 0) {
      dataStatus = "no_price";
    }

    return {
      provider: this.provider,
      name: this.name,
      prices,
      source: productId ? `${BASE_URL}/doc/${productId}/pricing` : `${BASE_URL}/doc/index.html`,
      updateDate: undefined,
      dataStatus,
    };
  }
}