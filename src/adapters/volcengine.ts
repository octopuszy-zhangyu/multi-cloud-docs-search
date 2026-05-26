import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata } from "./base";

const BASE_URL = "https://www.volcengine.com";

interface VolcDocItem {
  DocumentID: number;
  DocumentCode: string;
  LibraryID: number;
  LibraryCode: string;
  ParentID: number;
  ParentCode: string;
  Title: string;
  EnTitle: string;
  ContentType: string;
  Type: number;
  SecondNav: any;
  Status: number;
  Childrens: any;
  Language: string;
  Index: number;
}

interface VolcLibItem {
  LibraryID: number;
  LibraryCode: string;
  Name: string;
  EnName: string;
  Category: string;
  SubProductID: string;
  SecondNav: any[];
}

interface GetLibListResponse {
  ResponseMetadata: {
    RequestId: string;
    Region: string;
    HasPass: boolean;
    Service: string;
  };
  Result: VolcLibItem[];
}

interface GetDocListResponse {
  ResponseMetadata: {
    RequestId: string;
    Region: string;
    HasPass: boolean;
    Service: string;
  };
  Result: Record<string, VolcDocItem[]>;
}

interface GetDocDetailResponse {
  ResponseMetadata: {
    RequestId: string;
    Region: string;
    HasPass: boolean;
    Service: string;
  };
  Result: {
    DocumentID: number;
    Title: string;
    Content: string;
    MDContent: string;
    ContentType: string;
    UpdatedTime: string;
  };
}

export class VolcengineAdapter extends CloudDocAdapter {
  readonly provider = "volcengine";
  readonly name = "火山引擎";

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
    const url = `${BASE_URL}/api/doc/getLibList?Limit=999`;
    const raw = await this.fetchJson<GetLibListResponse>(url);

    const products: Product[] = [];
    const libs = raw.Result || [];

    for (const lib of libs) {
      products.push({
        productId: String(lib.LibraryID),
        name: lib.Name,
        description: lib.EnName,
      });
    }

    return products;
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
    const url = `${BASE_URL}/api/doc/getDocList?LibraryID=${productId}&DataSchema=all_second_nav&type=online`;
    const raw = await this.fetchJson<GetDocListResponse>(url);

    const items: TocItem[] = [];
    const result = raw.Result || {};

    // 遍历所有 SecondNav（章节）
    for (const [navId, docs] of Object.entries(result)) {
      for (const doc of docs) {
        if (doc.Type === 1 && doc.ParentID === 0) {
          // 这是一个顶级目录节点
          const children = this.buildTocTree(result, doc.DocumentID);
          items.push({
            pageId: `${productId}/${doc.DocumentID}`,
            title: doc.Title,
            children: children.length > 0 ? children : undefined,
          });
        }
      }
    }

    return items;
  }

  private buildTocTree(result: Record<string, VolcDocItem[]>, parentId: number): TocItem[] {
    const children: TocItem[] = [];

    for (const docs of Object.values(result)) {
      for (const doc of docs) {
        if (doc.ParentID === parentId) {
          const subChildren = this.buildTocTree(result, doc.DocumentID);
          children.push({
            pageId: doc.LibraryID + "/" + doc.DocumentID,
            title: doc.Title,
            children: subChildren.length > 0 ? subChildren : undefined,
          });
        }
      }
    }

    return children;
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
    // pageId 格式: "productId/docId"
    const [productId, docId] = pageId.split("/");

    const url = `${BASE_URL}/api/doc/getDocDetail?LibraryID=${productId}&DocumentID=${docId}&AuditDocumentID=&type=online`;
    const raw = await this.fetchJson<GetDocDetailResponse>(url);

    const doc = raw.Result;

    return {
      pageId,
      title: doc.Title,
      note: "",
      contentPath: pageId,
      bookId: productId,
      updateDate: doc.UpdatedTime,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    // contentPath 实际上是 pageId: "productId/docId"
    const [productId, docId] = contentPath.split("/");

    const url = `${BASE_URL}/api/doc/getDocDetail?LibraryID=${productId}&DocumentID=${docId}&AuditDocumentID=&type=online`;
    const raw = await this.fetchJson<GetDocDetailResponse>(url);

    const doc = raw.Result;
    // 返回 Markdown 内容
    return doc.MDContent || doc.Content || "";
  }
}