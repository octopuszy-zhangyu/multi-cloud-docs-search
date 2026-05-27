import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const BASE_URL = "https://cloud.tencent.com";

export class TencentAdapter extends CloudDocAdapter {
  readonly provider = "tencent";
  readonly name = "腾讯云";

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

  async listProducts(): Promise<Product[]> {
    const url = `${BASE_URL}/document/product`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const products: Product[] = [];
    const seen = new Set<string>();

    // 从首页提取产品分类和产品
    // 产品链接格式: /document/product/213
    $("a[href^='/document/product/']").each((_, el) => {
      const href = $(el).attr("href") || "";
      const match = href.match(/^\/document\/product\/(\d+)(?:\/|$)/);
      if (match) {
        const productId = match[1];
        const name = $(el).text().trim();

        if (productId && name && !seen.has(productId)) {
          seen.add(productId);
          products.push({
            productId,
            name,
            description: "",
          });
        }
      }
    });

    // 从侧边栏提取产品分类
    $(".rno-column-aside-menu, .doc-aside-wrap a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const match = href.match(/^\/document\/product\/(\d+)(?:\/|$)/);
      if (match) {
        const productId = match[1];
        const name = $(el).text().trim();

        if (productId && name && !seen.has(productId)) {
          seen.add(productId);
          products.push({
            productId,
            name,
            description: "",
          });
        }
      }
    });

    return products;
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
    const url = `${BASE_URL}/document/product/${productId}`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const items: TocItem[] = [];
    const seen = new Set<string>();

    // 提取页面中所有文档链接
    // 支持相对路径 /document/product/213/495 和绝对路径 https://cloud.tencent.com/document/product/213/495
    $("a[href*='/document/product/" + productId + "/']").each((_, el) => {
      const href = $(el).attr("href") || "";
      // 匹配 /document/product/213/495 或 https://cloud.tencent.com/document/product/213/495
      const match = href.match(/(?:\/document\/product\/\d+\/(\d+))/);
      if (match) {
        const pageId = match[1];
        const title = $(el).text().trim();

        if (pageId && title && !seen.has(pageId)) {
          seen.add(pageId);
          items.push({
            pageId: `${productId}/${pageId}`,
            title,
          });
        }
      }
    });

    return items;
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    // 腾讯云没有公开的搜索 API，通过遍历文档目录做本地关键词匹配
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
    // pageId 格式: productId/pageId (如 213/44971)
    const parts = pageId.split("/");
    const productId = parts[0];
    const docId = parts[1] || "";

    const url = `${BASE_URL}/document/product/${productId}/${docId}`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $("title").text().trim() || $("h1").first().text().trim() || "";
    const description = $('meta[name="description"]').attr("content") || "";

    // 从页面中提取更新时间
    const updateDate = $(".rno-title-module-date, .doc-update-time, [class*='update']").text().trim() || "";

    return {
      pageId,
      title,
      note: description || updateDate,
      contentPath: url,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    const html = await this.fetchHtml(contentPath);
    return htmlToMarkdown(html);
  }
}