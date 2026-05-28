import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type PaginatedResult, type ListProductsOptions, type TocOptions } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const SUPPORT_URL = "https://support.cucloud.cn";
const SEARCH_API = "https://gateway.cucloud.cn/search";

interface SearchDoc {
  document_id: number;
  title: string;
  product_name: string;
  content: string;
  update_date: string;
  path: string;
  product_id: string;
  breadcrumb?: { class_id: number; class_name: string; doc_id?: number }[];
}

interface SearchResponse {
  code: number;
  data: {
    docList: SearchDoc[];
    totalSize: number;
    aggregation: string[];
  };
}

interface ProductInfo {
  productId: string;
  name: string;
}

export class CucloudAdapter extends CloudDocAdapter {
  readonly provider = "cucloud";
  readonly name = "联通云";

  private productListCache: ProductInfo[] | null = null;

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

  private async getProductsFromSearch(): Promise<ProductInfo[]> {
    if (this.productListCache) return this.productListCache;

    const productMap = new Map<string, string>();
    const keywords = ["云", "服务器", "存储", "数据库", "网络", "安全", "容器", "AI", "监控", "负载均衡"];

    for (const keyword of keywords) {
      const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=20&keyword=${encodeURIComponent(keyword)}&referrer=${encodeURIComponent(SUPPORT_URL)}`;
      try {
        const data = await this.fetchJson<SearchResponse>(url);
        if (data.data?.docList) {
          for (const doc of data.data.docList) {
            if (doc.product_id && doc.product_name && !productMap.has(doc.product_id)) {
              productMap.set(doc.product_id, doc.product_name);
            }
          }
        }
      } catch {
        // 忽略单个关键词的错误
      }
    }

    this.productListCache = Array.from(productMap.entries()).map(([id, name]) => ({
      productId: id,
      name,
    }));

    return this.productListCache;
  }

  private paginate<T>(items: T[], page: number = 1, pageSize: number = 100): PaginatedResult<T> {
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);
    return {
      items: paged,
      total: items.length,
      page,
      pageSize,
      hasMore: start + pageSize < items.length,
    };
  }

  async listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>> {
    const products = await this.getProductsFromSearch();
    let mapped = products.map((p) => ({
      productId: p.productId,
      name: p.name,
      description: "",
    }));

    // Keyword filtering
    if (options?.keyword) {
      const keywords = options.keyword.trim().split(/\s+/).filter(Boolean);
      if (keywords.length > 0) {
        mapped = mapped.filter(item => {
          const text = (item.name || "").toLowerCase();
          return keywords.every(kw => text.includes(kw.toLowerCase()));
        });
      }
    }

    // Pagination
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 100;
    return this.paginate(mapped, page, pageSize);
  }

  async getDocumentToc(productId: string, options?: TocOptions): Promise<PaginatedResult<TocItem>> {
    // 搜索 API 需要 keyword 参数才能返回数据
    // 使用产品名称作为关键词搜索来获取文档列表
    const products = await this.getProductsFromSearch();
    const product = products.find((p) => p.productId === productId);
    if (!product) {
      return { items: [], total: 0, page: 1, pageSize: 200, hasMore: false };
    }

    const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=50&keyword=${encodeURIComponent(product.name)}&productId=${productId}&referrer=${encodeURIComponent(SUPPORT_URL)}`;
    const data = await this.fetchJson<SearchResponse>(url);

    if (!data.data?.docList) {
      return { items: [], total: 0, page: 1, pageSize: 200, hasMore: false };
    }

    const tocMap = new Map<string, TocItem>();

    for (const doc of data.data.docList) {
      if (!doc.breadcrumb || doc.breadcrumb.length === 0) continue;

      for (const crumb of doc.breadcrumb) {
        if (!tocMap.has(String(crumb.class_id))) {
          tocMap.set(String(crumb.class_id), {
            pageId: String(crumb.class_id),
            title: crumb.class_name,
            children: [],
          });
        }
      }

      const lastCrumb = doc.breadcrumb[doc.breadcrumb.length - 1];
      if (lastCrumb.doc_id) {
        const parentId = String(lastCrumb.class_id);
        const parent = tocMap.get(parentId);
        if (parent) {
          if (!parent.children) parent.children = [];
          parent.children.push({
            pageId: String(lastCrumb.doc_id),
            title: doc.title.replace(/<[^>]+>/g, ""),
          });
        }
      }
    }

    let items = Array.from(tocMap.values());

    // Keyword filtering
    if (options?.keyword) {
      const keywords = options.keyword.trim().split(/\s+/).filter(Boolean);
      if (keywords.length > 0) {
        items = items.filter(item => {
          const text = (item.title || "").toLowerCase();
          return keywords.every(kw => text.includes(kw.toLowerCase()));
        });
      }
    }

    // Top-only: strip children
    if (options?.topOnly) {
      items = items.map(item => ({ pageId: item.pageId, title: item.title }));
    }

    // Pagination
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 200;
    return this.paginate(items, page, pageSize);
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=50&keyword=${encodeURIComponent(keyword)}&productId=${productId}&referrer=${encodeURIComponent(SUPPORT_URL)}`;
    const data = await this.fetchJson<SearchResponse>(url);

    if (!data.data?.docList) return [];

    return data.data.docList.map((doc) => ({
      pageId: String(doc.document_id),
      title: doc.title.replace(/<[^>]+>/g, ""),
      description: doc.content.replace(/<[^>]+>/g, "").substring(0, 200),
    }));
  }

  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    // 通过搜索 API 搜索文档 ID 获取元信息
    const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=1&keyword=${pageId}&referrer=${encodeURIComponent(SUPPORT_URL)}`;
    const data = await this.fetchJson<SearchResponse>(url);

    if (data.data?.docList && data.data.docList.length > 0) {
      const doc = data.data.docList[0];
      return {
        pageId,
        title: doc.title.replace(/<[^>]+>/g, ""),
        note: doc.update_date || "",
        contentPath: `${SUPPORT_URL}/document/${pageId}.html`,
      };
    }

    return {
      pageId,
      title: "",
      note: "",
      contentPath: `${SUPPORT_URL}/document/${pageId}.html`,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    const pageId = contentPath.match(/\/(\d+)\.html/)?.[1] || contentPath;

    // 通过搜索 API 用 pageId 作为关键词获取文档内容
    const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=50&keyword=${encodeURIComponent(pageId)}&referrer=${encodeURIComponent(SUPPORT_URL)}`;
    const data = await this.fetchJson<SearchResponse>(url);

    if (data.data?.docList) {
      const doc = data.data.docList.find((d) => String(d.document_id) === pageId);
      if (doc) {
        const title = doc.title.replace(/<[^>]+>/g, "");
        const content = doc.content.replace(/<[^>]+>/g, "");
        return `# ${title}\n\n${content}`;
      }
    }

    // 备用：从 HTML 页面提取
    try {
      const html = await this.fetchHtml(contentPath);
      const $ = cheerio.load(html);
      const content = $(".doc-content").first();
      if (content.length > 0) {
        content.find("script, style, .doc-adv, .rno-title-module-operate, .rno-document-details-side").remove();
        return htmlToMarkdown(content.html() || "");
      }
      return htmlToMarkdown(html);
    } catch {
      return "无法获取文档内容";
    }
  }

  private parsePriceTable(markdown: string, source: string): PriceItem[] {
    const lines = markdown.split("\n");
    const prices: PriceItem[] = [];
    let inTable = false;
    let headers: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith("|") && line.endsWith("|")) {
        const cells = line.split("|").filter((c) => c.trim().length > 0).map((c) => c.trim());

        if (!inTable) {
          inTable = true;
          headers = cells;
          i++;
          if (i < lines.length && lines[i].trim().match(/^[\s|:-]+$/)) {
            i++;
          }
          continue;
        }

        if (line.match(/^[\s|:-]+$/)) {
          continue;
        }

        if (cells.length >= 2) {
          const productName = cells[0];
          const lastCell = cells[cells.length - 1];
          const priceMatch = lastCell.match(/(\d+(?:\.\d+)?)/);
          const price = priceMatch ? parseFloat(priceMatch[1]) : 0;

          let billingMode = "按量计费";
          const billingHeader = headers.find((h) => h.includes("计费") || h.includes("方式") || h.includes("模式"));
          if (billingHeader) {
            const billingIdx = headers.indexOf(billingHeader);
            if (billingIdx < cells.length) {
              billingMode = cells[billingIdx];
            }
          }

          const specification = cells.length >= 2 ? cells.slice(1, -1).join(" ") : cells[0];

          let unit = "小时";
          const unitHeader = headers.find((h) => h.includes("单位") || h.includes("周期"));
          if (unitHeader) {
            const unitIdx = headers.indexOf(unitHeader);
            if (unitIdx < cells.length) {
              unit = cells[unitIdx];
            }
          }

          prices.push({
            productName,
            specification,
            billingMode,
            price,
            unit,
            currency: "CNY",
            source,
          });
        }
      } else {
        inTable = false;
        headers = [];
      }
    }

    return prices;
  }

  async getProductPrice(productId?: string): Promise<PriceResult> {
    const result: PriceResult = {
      provider: this.provider,
      name: this.name,
      prices: [],
      source: `${SUPPORT_URL}/document/${productId || ""}.html`,
    };

    if (!productId) {
      return result;
    }

    try {
      // Try to fetch pricing documentation via search API
      const priceKeywords = ["价格", "计费", "定价", "费用"];
      for (const keyword of priceKeywords) {
        try {
          const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=10&keyword=${encodeURIComponent(keyword)}&productId=${productId}&referrer=${encodeURIComponent(SUPPORT_URL)}`;
          const data = await this.fetchJson<SearchResponse>(url);
          if (data.data?.docList && data.data.docList.length > 0) {
            const doc = data.data.docList[0];
            const content = doc.content.replace(/<[^>]+>/g, "");
            const prices = this.parsePriceTable(content, `${SUPPORT_URL}/document/${doc.document_id}.html`);
            if (prices.length > 0) {
              result.prices = prices;
              result.source = `${SUPPORT_URL}/document/${doc.document_id}.html`;
              break;
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Return empty prices if unable to fetch
    }

    return result;
  }
}
