import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const BASE_URL = "https://help.aliyun.com";

export class AliyunAdapter extends CloudDocAdapter {
  readonly provider = "aliyun";
  readonly name = "阿里云";

  private async fetchHtml(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async listProducts(): Promise<Product[]> {
    const url = `${BASE_URL}/help/json/mainMenu.json?website=cn&language=zh`;
    const raw = await this.fetchJson<any>(url);

    const products: Product[] = [];
    const children = raw.data?.children;
    if (!children) return products;

    // 遍历 JSON 树结构，提取 level=4 的产品节点
    const extractProducts = (nodes: any[]) => {
      for (const node of nodes) {
        if (node.level === 4 && node.nodeType === 16) {
          products.push({
            productId: node.alias?.replace(/^\//, "") || String(node.id),
            name: node.title,
            description: node.desc,
          });
        }
        if (node.children) {
          extractProducts(node.children);
        }
      }
    };

    extractProducts(children);
    return products;
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
    const url = `${BASE_URL}/help/json/product.json?alias=/${productId}/&website=cn&language=zh`;
    const raw = await this.fetchJson<any>(url);

    const items: TocItem[] = [];
    const learningPath = raw.data?.learningPath;
    if (!learningPath) return items;

    const chapters = learningPath.chapters || [];
    for (const chapter of chapters) {
      const sections = chapter.sections || [];
      for (const section of sections) {
        const sectionItems = section.items || [];
        for (const item of sectionItems) {
          if (item.url) {
            // 从 URL 中提取路径作为 pageId，如 /zh/ecs/product-overview/what-is-ecs
            const pageId = item.url.replace(/^https?:\/\/[^\/]+/, "");
            items.push({
              pageId,
              title: item.title,
            });
          }
        }
      }
    }

    return items;
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    // 阿里云没有公开的搜索 API，通过遍历文档目录做本地关键词匹配
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
    // pageId 是文档路径，如 /zh/ecs/user-guide/after-the-security-group
    const url = `${BASE_URL}${pageId}`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $("title").text().trim() || $("h1").first().text().trim() || "";
    const description = $('meta[name="description"]').attr("content") || "";
    const contentPath = url;

    return {
      pageId,
      title,
      note: description,
      contentPath,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    const html = await this.fetchHtml(contentPath);
    return htmlToMarkdown(html);
  }
}