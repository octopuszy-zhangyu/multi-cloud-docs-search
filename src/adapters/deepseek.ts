import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult } from "./base.js";
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

  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.text();
  }

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

  async listProducts(): Promise<Product[]> {
    return [
      {
        productId: "api-docs",
        name: "DeepSeek API 文档",
        description: "DeepSeek API 官方文档",
      },
    ];
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
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

    return items;
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const toc = await this.getDocumentToc(productId);
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
      note: description,
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
  private parsePriceTable(markdown: string): PriceItem[] {
    const prices: PriceItem[] = [];
    const lines = markdown.split("\n");
    let inTable = false;
    let headers: string[] = [];

    for (const line of lines) {
      // 检测表格开始（包含 | 的行）
      if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        const cells = line.split("|").map((c) => c.trim()).filter(Boolean);

        if (!inTable) {
          // 表头行
          headers = cells;
          inTable = true;
          continue;
        }

        // 跳过分隔行（|---|）
        if (cells.every((c) => /^[-:\s]+$/.test(c))) {
          continue;
        }

        // 数据行
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
              unit: priceStr.includes("$") ? "元/百万Token" : "元/百万Token",
              currency: priceStr.includes("$") ? "USD" : "CNY",
              source: "文档定价页面",
            });
          }
        }
        continue;
      }

      // 非表格行，重置表格状态
      if (inTable && line.trim() !== "") {
        // 表格结束
        inTable = false;
      }
    }

    return prices;
  }

  async getProductPrice(productId?: string, _options?: { region?: string; billingMode?: string }): Promise<PriceResult> {
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

    return {
      provider: this.provider,
      name: this.name,
      prices,
      source: "https://api-docs.deepseek.com/quick_start/pricing",
      updateDate: undefined,
    };
  }
}
