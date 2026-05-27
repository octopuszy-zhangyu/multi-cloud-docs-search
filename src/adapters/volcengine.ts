import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult } from "./base.js";

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

  /**
   * 从 Markdown 文本中解析价格表格
   */
  private parsePriceTable(markdown: string): PriceItem[] {
    const prices: PriceItem[] = [];
    const lines = markdown.split("\n");
    let inTable = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean);

        if (!inTable) {
          inTable = true;
          continue;
        }

        // 跳过分隔行 (如 |---|---|)
        if (cells.every((c) => /^[-:\s]+$/.test(c))) {
          continue;
        }

        if (cells.length >= 2) {
          const productName = cells[0] || "";
          const lastCell = cells[cells.length - 1] || "";

          // 尝试从最后一个单元格提取价格
          const priceMatch = lastCell.match(/([0-9.]+)\s*(元|\$|美元|USD|CNY|\/)/i);
          let price = 0;
          if (priceMatch) {
            price = parseFloat(priceMatch[1]);
          } else {
            // 尝试直接解析数字
            const directPrice = parseFloat(lastCell.replace(/[^0-9.]/g, ""));
            if (!isNaN(directPrice)) {
              price = directPrice;
            }
          }

          const spec = cells.length > 2 ? cells.slice(1, -1).join(" / ") : "";

          // 尝试检测货币单位
          let currency = "CNY";
          let unit = "";
          if (lastCell.includes("$") || lastCell.includes("USD") || lastCell.includes("美元")) {
            currency = "USD";
          }

          // 尝试提取单位
          const unitMatch = lastCell.match(/\/(年|月|日|小时|Token|请求|GB|MB|次)/);
          if (unitMatch) {
            unit = unitMatch[0];
          }

          if (!isNaN(price) && price > 0) {
            prices.push({
              productName,
              specification: spec,
              billingMode: "按量",
              price,
              unit: unit || "元",
              currency,
              source: "火山引擎定价文档",
            });
          }
        }
        continue;
      }

      if (inTable && trimmed !== "") {
        inTable = false;
      }
    }

    return prices;
  }

  async getProductPrice(productId?: string): Promise<PriceResult> {
    let prices: PriceItem[] = [];
    let source = `${BASE_URL}/docs`;

    try {
      if (productId) {
        // 尝试获取产品的文档目录，查找定价相关页面
        const toc = await this.getDocumentToc(productId);

        // 递归搜索包含"价格"或"定价"的文档
        const findPricingDocs = (items: TocItem[]): TocItem[] => {
          const results: TocItem[] = [];
          for (const item of items) {
            if (item.title.includes("价格") || item.title.includes("定价") || item.title.includes("计费")) {
              results.push(item);
            }
            if (item.children) {
              results.push(...findPricingDocs(item.children));
            }
          }
          return results;
        };

        const pricingDocs = findPricingDocs(toc);

        // 获取定价文档内容
        for (const doc of pricingDocs.slice(0, 3)) { // 最多处理3个定价文档
          const content = await this.getPageContent(doc.pageId);
          const docPrices = this.parsePriceTable(content);
          prices.push(...docPrices);
        }

        if (pricingDocs.length > 0) {
          source = `${BASE_URL}/docs/${productId}`;
        }
      }

      // 如果没有找到特定产品的定价，尝试获取通用定价信息
      if (prices.length === 0) {
        // 尝试获取产品列表，找到定价相关的库
        const products = await this.listProducts();

        // 查找定价相关产品
        const pricingProducts = products.filter(
          (p) =>
            p.name.includes("价格") ||
            p.name.includes("定价") ||
            p.name.includes("计费") ||
            p.name.includes("Billing")
        );

        for (const product of pricingProducts.slice(0, 2)) {
          const toc = await this.getDocumentToc(product.productId);
          for (const item of toc.slice(0, 5)) {
            const content = await this.getPageContent(item.pageId);
            const docPrices = this.parsePriceTable(content);
            prices.push(...docPrices);
          }
        }

        if (pricingProducts.length > 0) {
          source = `${BASE_URL}/docs/${pricingProducts[0].productId}`;
        }
      }
    } catch (error) {
      // 出错时返回空价格列表，不抛出异常
      console.error("获取火山引擎价格信息失败:", error);
    }

    return {
      provider: this.provider,
      name: this.name,
      prices,
      source,
      updateDate: undefined,
    };
  }
}