import * as cheerio from "cheerio";
import type {
  ListForHelpResponse,
  ContentQueryResponse,
  PageMetadataResponse,
} from "../types.js";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata } from "./base.js";

const BASE_URL = "https://www.ctyun.cn";

export class CtyunAdapter extends CloudDocAdapter {
  readonly provider = "ctyun";
  readonly name = "天翼云";

  private async request<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(`API request failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async listProducts(): Promise<Product[]> {
    const url = `${BASE_URL}/v2/portal/book/ListForHelp?bookClassDomain=product&_t=${Date.now()}`;
    const raw = await this.request<ListForHelpResponse>(url);
    const result: Product[] = [];
    for (const cat of raw.data?.list ?? []) {
      for (const p of cat.list) {
        result.push({
          productId: p.bookId,
          name: this.clean(p.bookName),
          description: this.clean(p.note),
        });
      }
    }
    return result;
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
    const res = await fetch(`${BASE_URL}/document/${productId}/`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: TocItem[] = [];
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

    return items;
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const url = `${BASE_URL}/v2/portal/book/ContentQuery?bookId=${productId}&keyword=${encodeURIComponent(keyword)}&_t=${Date.now()}`;
    const raw = await this.request<ContentQueryResponse>(url);
    return (raw.data?.pages ?? []).map((p) => ({
      pageId: p.pageId,
      title: p.title,
      description: p.note,
    }));
  }

  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    const url = `${BASE_URL}/v2/portal/book/page/Get?pageId=${pageId}&_t=${Date.now()}`;
    const raw = await this.request<PageMetadataResponse>(url);
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
    const res = await fetch(contentPath, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(`Content fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.text();
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
}