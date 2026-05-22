import * as cheerio from "cheerio";
import type {
  ListForHelpResponse,
  ContentQueryResponse,
  PageMetadataResponse,
  TocItem,
} from "./types";

const BASE_URL = "https://www.ctyun.cn";

export class CtyunApi {
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

  /** 获取所有产品文档列表 */
  async listProducts(): Promise<ListForHelpResponse> {
    const url = `${BASE_URL}/v2/portal/book/ListForHelp?bookClassDomain=product&_t=${Date.now()}`;
    return this.request<ListForHelpResponse>(url);
  }

  /** 从 HTML 提取产品文档目录 */
  async getDocumentToc(bookId: string): Promise<TocItem[]> {
    const res = await fetch(`${BASE_URL}/document/${bookId}/`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const html = await res.text();

    const $ = cheerio.load(html);
    const items: TocItem[] = [];
    const linkPattern = new RegExp(`^/document/${bookId}/(\\d+)$`);

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

  /** 在产品文档中搜索关键词 */
  async searchDocuments(
    bookId: string,
    keyword: string
  ): Promise<ContentQueryResponse> {
    const url = `${BASE_URL}/v2/portal/book/ContentQuery?bookId=${bookId}&keyword=${encodeURIComponent(keyword)}&_t=${Date.now()}`;
    return this.request<ContentQueryResponse>(url);
  }

  /** 获取文档页面元信息 */
  async getPageMetadata(pageId: string): Promise<PageMetadataResponse> {
    const url = `${BASE_URL}/v2/portal/book/page/Get?pageId=${pageId}&_t=${Date.now()}`;
    return this.request<PageMetadataResponse>(url);
  }

  /** 获取文档 Markdown 正文 */
  async getPageContent(contentPath: string): Promise<string> {
    const res = await fetch(contentPath, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(
        `Content fetch failed: ${res.status} ${res.statusText}`
      );
    }
    return res.text();
  }
}