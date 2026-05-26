import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata } from "./base";

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
    const data = await this.fetchJson<any>(url);

    const products: Product[] = [];

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

    if (data.children) {
      extractProducts(data.children);
    }

    return products;
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
    // TODO: 实现获取文档目录
    return [];
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    // TODO: 实现搜索文档
    return [];
  }

  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    // TODO: 实现获取页面元信息
    throw new Error("Not implemented");
  }

  async getPageContent(contentPath: string): Promise<string> {
    // TODO: 实现获取页面正文
    throw new Error("Not implemented");
  }
}