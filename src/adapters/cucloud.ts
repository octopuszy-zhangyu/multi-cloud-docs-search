import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata } from "./base";
import { htmlToMarkdown } from "../utils/html-to-md";

const SUPPORT_URL = "https://support.cucloud.cn";
const SEARCH_API = "https://gateway.cucloud.cn/search";

interface CatalogNode {
  classId: string;
  className: string;
  level: number;
  path: string;
  childList?: CatalogNode[];
}

interface SearchDoc {
  document_id: number;
  title: string;
  product_name: string;
  content: string;
  update_date: string;
  path: string;
  product_id: string;
}

interface SearchResponse {
  code: number;
  data: {
    docList: SearchDoc[];
    totalSize: number;
    aggregation: string[];
  };
}

export class CucloudAdapter extends CloudDocAdapter {
  readonly provider = "cucloud";
  readonly name = "联通云";

  private catalogData: CatalogNode[] | null = null;

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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": SUPPORT_URL,
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  private async getCatalog(): Promise<CatalogNode[]> {
    if (this.catalogData) return this.catalogData;

    const html = await this.fetchHtml(SUPPORT_URL);

    // 用栈匹配提取 listData JSON
    const marker = "listData = [";
    const start = html.indexOf(marker);
    if (start === -1) return [];

    let stack = 0;
    let end = -1;
    for (let i = start + marker.length; i < html.length; i++) {
      if (html[i] === "[") stack++;
      else if (html[i] === "]") {
        stack--;
        if (stack === 0) { end = i + 1; break; }
      }
    }

    if (end === -1) return [];

    try {
      const parsed = JSON.parse(html.substring(start + marker.length, end));
      this.catalogData = parsed.childList || (Array.isArray(parsed) ? parsed : []);
      return this.catalogData;
    } catch {
      // HTML中的JSON可能不完整（缺少闭合括号），尝试修复
      let jsonStr = html.substring(start + marker.length, end);
      let brace = 0, bracket = 0;
      let inStr = false, esc = false;
      for (let i = 0; i < jsonStr.length; i++) {
        const c = jsonStr[i];
        if (esc) { esc = false; continue; }
        if (c === "\\" && inStr) { esc = true; continue; }
        if (c === '"' && !esc) { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "{") brace++;
        else if (c === "}") brace--;
        else if (c === "[") bracket++;
        else if (c === "]") bracket--;
      }
      jsonStr += "}".repeat(brace) + "]".repeat(bracket);
      try {
        const parsed = JSON.parse(jsonStr);
        this.catalogData = parsed.childList || (Array.isArray(parsed) ? parsed : []);
        return this.catalogData;
      } catch {
        return [];
      }
    }
  }

  async listProducts(): Promise<Product[]> {
    const catalog = await this.getCatalog();
    const products: Product[] = [];
    const seen = new Set<string>();

    const extractProducts = (nodes: CatalogNode[]) => {
      for (const node of nodes) {
        if (node.level === 3 && !seen.has(node.classId)) {
          seen.add(node.classId);
          products.push({
            productId: node.classId,
            name: node.className,
            description: "",
          });
        }
        if (node.childList) {
          extractProducts(node.childList);
        }
      }
    };

    extractProducts(catalog);
    return products;
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
    const catalog = await this.getCatalog();
    const items: TocItem[] = [];
    const seen = new Set<string>();

    const findProduct = (nodes: CatalogNode[]): CatalogNode | null => {
      for (const node of nodes) {
        if (node.classId === productId) return node;
        if (node.childList) {
          const found = findProduct(node.childList);
          if (found) return found;
        }
      }
      return null;
    };

    const product = findProduct(catalog);
    if (!product?.childList) return items;

    const extractToc = (nodes: CatalogNode[], parentPath: string): TocItem[] => {
      const result: TocItem[] = [];
      for (const node of nodes) {
        if (!seen.has(node.classId)) {
          seen.add(node.classId);
          const tocItem: TocItem = {
            pageId: node.classId,
            title: node.className,
          };
          if (node.childList && node.childList.length > 0) {
            tocItem.children = extractToc(node.childList, node.path);
          }
          result.push(tocItem);
        }
      }
      return result;
    };

    return extractToc(product.childList, product.path);
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=50&keyword=${encodeURIComponent(keyword)}&referrer=${encodeURIComponent(SUPPORT_URL)}`;
    const data = await this.fetchJson<SearchResponse>(url);

    if (!data.data?.docList) return [];

    return data.data.docList
      .filter((doc) => doc.product_id === productId)
      .map((doc) => ({
        pageId: String(doc.document_id),
        title: doc.title.replace(/<[^>]+>/g, ""),
        description: doc.content.replace(/<[^>]+>/g, "").substring(0, 200),
      }));
  }

  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    // 通过搜索API获取文档信息
    const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=1&keyword=&referrer=${encodeURIComponent(SUPPORT_URL)}`;
    const data = await this.fetchJson<SearchResponse>(url);

    // 搜索API不支持按document_id查询，返回基础信息
    const docUrl = `${SUPPORT_URL}/document/${pageId}.html`;

    return {
      pageId,
      title: "",
      note: "",
      contentPath: docUrl,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    // 联通云文档是Vue SPA，直接fetch HTML拿不到内容
    // 通过搜索API获取文档内容
    const pageId = contentPath.match(/\/(\d+)\.html/)?.[1] || contentPath;
    const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=50&keyword=&referrer=${encodeURIComponent(SUPPORT_URL)}`;
    const data = await this.fetchJson<SearchResponse>(url);

    if (data.data?.docList) {
      const doc = data.data.docList.find((d) => String(d.document_id) === pageId);
      if (doc) {
        const title = doc.title.replace(/<[^>]+>/g, "");
        const content = doc.content.replace(/<[^>]+>/g, "");
        return `# ${title}\n\n${content}`;
      }
    }

    // 备用：从HTML页面提取
    const html = await this.fetchHtml(contentPath);
    const $ = cheerio.load(html);
    const content = $(".doc-content").first();
    if (content.length > 0) {
      content.find("script, style, .doc-adv, .rno-title-module-operate, .rno-document-details-side").remove();
      return htmlToMarkdown(content.html() || "");
    }

    return htmlToMarkdown(html);
  }
}
