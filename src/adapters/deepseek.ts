import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type PaginatedResult, type ListProductsOptions, type TocOptions, type PriceQueryOptions } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const BASE_URL = "https://api-docs.deepseek.com";

interface SitemapUrl {
  loc: string;
}

interface SitemapXml {
  urlset?: {
    url?: SitemapUrl | SitemapUrl[];
  };
}

export class DeepseekAdapter extends CloudDocAdapter {
  readonly provider = "deepseek";
  readonly name = "DeepSeek";

  /**
   * 从 sitemap.xml 解析所有文档页面 URL
   */
  private async fetchSitemapUrls(): Promise<{ path: string; title: string }[]> {
    const xml = await this.fetchText(`${BASE_URL}/sitemap.xml`);
    const $ = cheerio.load(xml, { xmlMode: true });

    const urls: { path: string; title: string }[] = [];

    $("url > loc").each((_, el) => {
      const loc = $(el).text().trim();
      if (!loc) return;

      // 只保留 api-docs.deepseek.com 下的页面，过滤掉外部链接
      if (!loc.startsWith(BASE_URL)) return;

      const path = loc.replace(BASE_URL, "");
      if (!path || path === "/") return;

      // 从路径中提取标题：去除后缀，将路径分段，取最后一段
      const segments = path.replace(/\.html?$/, "").split("/").filter(Boolean);
      const lastSegment = segments[segments.length - 1] || "";
      // 将 kebab-case 或 snake_case 转为可读标题
      const title = lastSegment
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      urls.push({ path, title });
    });

    return urls;
  }

  async listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>> {
    return this.paginateProducts([
      {
        productId: "api-docs",
        name: "DeepSeek API 文档",
      },
    ], options);
  }

  async getDocumentToc(productId: string, options?: TocOptions): Promise<PaginatedResult<TocItem>> {
    const urls = await this.fetchSitemapUrls();

    // 按路径深度构建树形结构
    const items: TocItem[] = [];
    const pathMap = new Map<string, TocItem>();

    for (const { path, title } of urls) {
      const segments = path.replace(/\.html?$/, "").split("/").filter(Boolean);
      const pageId = "/" + segments.join("/");

      const tocItem: TocItem = {
        pageId,
        title,
      };

      pathMap.set(pageId, tocItem);

      // 找到父级路径
      if (segments.length > 1) {
        const parentPath = "/" + segments.slice(0, -1).join("/");
        const parent = pathMap.get(parentPath);
        if (parent) {
          if (!parent.children) {
            parent.children = [];
          }
          parent.children.push(tocItem);
          continue;
        }
      }

      items.push(tocItem);
    }

    // Apply keyword filter
    let filtered = items;
    if (options?.keyword) {
      filtered = this.filterByKeywords(items, options.keyword);
    }

    // Strip children if topOnly
    if (options?.topOnly) {
      filtered = filtered.map(item => ({ pageId: item.pageId, title: item.title }));
    }

    return this.paginate(filtered, options?.page, options?.pageSize ?? 200);
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const tocResult = await this.getDocumentToc(productId);
    const toc = tocResult.items;
    const lowerKeyword = keyword.toLowerCase();

    const results: SearchResult[] = [];

    const searchToc = (items: TocItem[]) => {
      for (const item of items) {
        if (item.title.toLowerCase().includes(lowerKeyword)) {
          results.push({
            pageId: item.pageId,
            title: item.title,
          });
        }
        if (item.children) {
          searchToc(item.children);
        }
      }
    };

    searchToc(toc);
    return results;
  }

  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    const url = `${BASE_URL}${pageId}`;
    const html = await this.fetchText(url);
    const $ = cheerio.load(html);

    const title =
      $("title").first().text().trim() ||
      $("h1").first().text().trim() ||
      pageId.split("/").filter(Boolean).pop() ||
      "";

    const description =
      $('meta[name="description"]').attr("content")?.trim() || "";

    return {
      pageId,
      title,
      contentPath: url,
      updateDate: undefined,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    // contentPath 可能是完整 URL 或相对路径
    const url = contentPath.startsWith("http") ? contentPath : `${BASE_URL}${contentPath}`;
    const html = await this.fetchText(url);
    const $ = cheerio.load(html);

    // Docusaurus 站点内容通常在 main 或 article 标签内，或 .markdown 类中
    const mainContent =
      $("article").html() ||
      $("main").html() ||
      $(".markdown").html() ||
      $(".theme-doc-markdown").html() ||
      $("body").html() ||
      "";

    if (!mainContent) {
      return "(空内容)";
    }

    return htmlToMarkdown(mainContent);
  }

  /**
   * 从 Markdown 表格中解析价格数据
   */
  /**
   * 从 HTML 表格中解析 DeepSeek 价格数据
   * DeepSeek 定价页面使用 key-value 风格的 HTML 表格，不是标准 Markdown 表格
   */
  /**
   * 从 Markdown 表格中解析 DeepSeek 价格数据
   * DeepSeek 定价页面使用 key-value 风格的表格
   */
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

        // Skip separator rows (|---|)
        if (cells.every((c) => /^[-:\s]+$/.test(c))) {
          continue;
        }

        // DeepSeek pricing table format (3 or 4 columns):
        // | PRICING | 1M INPUT TOKENS (CACHE HIT) | $0.0028 | $0.003625 |  (4 cols - header row)
        // | 1M INPUT TOKENS (CACHE MISS) | $0.14 | $0.435 |              (3 cols - data row)
        // | 1M OUTPUT TOKENS | $0.28 | $0.87 |                           (3 cols - data row)
        if (cells.length >= 3) {
          const key = cells[0].toLowerCase();

          if (key === "pricing" && cells.length >= 4) {
            // PRICING row: PRICING | 1M INPUT TOKENS (CACHE HIT) | $0.0028 | $0.003625
            // This row actually contains the cache hit prices
            const flashPrice = parseFloat(cells[2].replace(/[^0-9.]/g, ""));
            const proPrice = parseFloat(cells[3].replace(/[^0-9.]/g, ""));
            if (!isNaN(flashPrice) && flashPrice > 0) {
              prices.push({ productName: "deepseek-v4-flash 输入(缓存命中)", billingMode: "按量", price: flashPrice, unit: "元/百万Token" });
            }
            if (!isNaN(proPrice) && proPrice > 0) {
              prices.push({ productName: "deepseek-v4-pro 输入(缓存命中)", billingMode: "按量", price: proPrice, unit: "元/百万Token" });
            }
            continue;
          }

          if (key === "1m input tokens (cache hit)" && cells.length >= 3) {
            const flashPrice = parseFloat(cells[1].replace(/[^0-9.]/g, ""));
            const proPrice = cells.length >= 3 ? parseFloat(cells[2].replace(/[^0-9.]/g, "")) : 0;
            if (!isNaN(flashPrice) && flashPrice > 0) {
              prices.push({ productName: "deepseek-v4-flash 输入(缓存命中)", billingMode: "按量", price: flashPrice, unit: "元/百万Token" });
            }
            if (!isNaN(proPrice) && proPrice > 0) {
              prices.push({ productName: "deepseek-v4-pro 输入(缓存命中)", billingMode: "按量", price: proPrice, unit: "元/百万Token" });
            }
          } else if (key === "1m input tokens (cache miss)" && cells.length >= 3) {
            const flashPrice = parseFloat(cells[1].replace(/[^0-9.]/g, ""));
            const proPrice = cells.length >= 3 ? parseFloat(cells[2].replace(/[^0-9.]/g, "")) : 0;
            if (!isNaN(flashPrice) && flashPrice > 0) {
              prices.push({ productName: "deepseek-v4-flash 输入(缓存未命中)", billingMode: "按量", price: flashPrice, unit: "元/百万Token" });
            }
            if (!isNaN(proPrice) && proPrice > 0) {
              prices.push({ productName: "deepseek-v4-pro 输入(缓存未命中)", billingMode: "按量", price: proPrice, unit: "元/百万Token" });
            }
          } else if (key === "1m output tokens" && cells.length >= 3) {
            const flashPrice = parseFloat(cells[1].replace(/[^0-9.]/g, ""));
            const proPrice = cells.length >= 3 ? parseFloat(cells[2].replace(/[^0-9.]/g, "")) : 0;
            if (!isNaN(flashPrice) && flashPrice > 0) {
              prices.push({ productName: "deepseek-v4-flash 输出", billingMode: "按量", price: flashPrice, unit: "元/百万Token" });
            }
            if (!isNaN(proPrice) && proPrice > 0) {
              prices.push({ productName: "deepseek-v4-pro 输出", billingMode: "按量", price: proPrice, unit: "元/百万Token" });
            }
          }
        }
        continue;
      }

      // Non-table line resets table state
      if (inTable && line.trim() !== "") {
        inTable = false;
      }
    }

    return prices;
  }

  async getProductPrice(productId?: string, _options?: PriceQueryOptions): Promise<PriceResult> {
    const url = `${BASE_URL}/quick_start/pricing`;
    const html = await this.fetchText(url);
    const $ = cheerio.load(html);

    const mainContent =
      $("article").html() ||
      $("main").html() ||
      $(".markdown").html() ||
      $(".theme-doc-markdown").html() ||
      $("body").html() ||
      "";

    const markdown = htmlToMarkdown(mainContent);
    const prices = this.parsePriceTable(markdown);

    return this.makePriceResult(prices, { updateDate: undefined });
  }
}


