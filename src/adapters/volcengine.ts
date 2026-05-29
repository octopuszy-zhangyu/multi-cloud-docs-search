import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type PaginatedResult, type ListProductsOptions, type TocOptions, type PriceQueryOptions } from "./base.js";

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

  async listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>> {
    const url = `${BASE_URL}/api/doc/getLibList?Limit=999`;
    const raw = await this.fetchJson<GetLibListResponse>(url);

    const products: Product[] = [];
    const libs = raw.Result || [];

    for (const lib of libs) {
      products.push({
        productId: String(lib.LibraryID),
        name: lib.Name,
      });
    }

    const filtered = this.filterByKeywords(products, options?.keyword);
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 100;
    return this.paginate(filtered, page, pageSize);
  }

  async getDocumentToc(productId: string, options?: TocOptions): Promise<PaginatedResult<TocItem>> {
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
          const item: TocItem = {
            pageId: `${productId}/${doc.DocumentID}`,
            title: doc.Title,
            children: children.length > 0 ? children : undefined,
          };
          items.push(item);
        }
      }
    }

    let filtered = this.filterByKeywords(items, options?.keyword);

    // 如果 topOnly 为 true，移除子节点
    if (options?.topOnly) {
      filtered = filtered.map(item => ({ ...item, children: undefined }));
    }

    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 200;
    return this.paginate(filtered, page, pageSize);
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
    const tocResult = await this.getDocumentToc(productId);
    const toc = tocResult.items;
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
   * 获取火山引擎产品价格
   *
   * 实现方式：
   * 1. 访问 SSR 定价页面（productId → 产品代码映射）获取 TemplateCode
   * 2. 调用 GetTable API 获取完整定价表格（含所有价格数据）
   * 3. 按 Product 字段过滤，解析价格数据
   *
   * 火山引擎定价 API（均可匿名调用，只需基本 cookie）：
   * - GetTable: POST /anonymous-api/trade/price?Action=GetTable&Version=2020-01-01
   *   返回完整定价表格，每行包含 Product、ConfigurationCode、ChargeItemCode、PriceInfoList
   */
  async getProductPrice(productId?: string, _options?: PriceQueryOptions): Promise<PriceResult> {
    let prices: PriceItem[] = [];

    try {
      // 1. 确定要查询的产品代码列表
      const productCodes = this.resolveProductCodes(productId);

      // 2. 遍历每个产品代码，获取定价数据
      for (const productCode of productCodes) {
        const templateCode = await this.getTemplateCode(productCode);
        if (!templateCode) continue;

        // 3. 调用 GetTable API 获取定价表格
        const tableRes = await this.fetchWithRetry(
          `${BASE_URL}/anonymous-api/trade/price?Action=GetTable&Version=2020-01-01`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: JSON.stringify({ TemplateCode: templateCode }),
          }
        );

        if (!tableRes.ok) continue;

        const tableData = await tableRes.json() as any;
        const tableList = tableData?.Result?.TableList || [];

        // 4. 解析定价表格
        for (const table of tableList) {
          const rows = table.Rows || [];
          for (const row of rows) {
            const productName = row.Product || "";
            const configCode = row.ConfigurationCode || "";
            const chargeItemCode = row.ChargeItemCode || "";
            const priceInfoList = row.PriceInfoList || [];

            // 如果指定了 productId，只返回匹配产品的价格
            if (productId && !productName.toLowerCase().includes(productId.toLowerCase())) {
              continue;
            }

            for (const pi of priceInfoList) {
              const period = pi.Period || "";
              const price = parseFloat(pi.Price) || 0;
              const times = pi.Times || 1;

              if (price <= 0) continue;

              // 从 ChargeItemCode 提取地域信息
              const regionMatch = chargeItemCode.match(/_([a-z]{2}-[a-z]+-\d)$/);
              const region = regionMatch ? regionMatch[1] : undefined;

              // 从 ConfigurationCode 提取可读规格
              const spec = this.parseConfigCode(configCode);

              // 确定计费单位和模式
              const { unit, billingMode } = this.parsePeriod(period, times);

              prices.push({
                productName,
                region,
                billingMode,
                price,
                unit,
              });
            }
          }
        }
      }
    } catch (error) {
      console.error("获取火山引擎价格信息失败:", error);
    }

    // 标记数据状态
    let dataStatus: PriceResult["dataStatus"] = "no_data";
    if (prices.length > 0 && prices[0].price > 0) {
      dataStatus = "complete";
    } else if (prices.length > 0 && prices[0].price === 0) {
      dataStatus = "no_price";
    }

    return {
      provider: this.provider,
      name: this.name,
      prices,
      updateDate: undefined,
      dataStatus,
    };
  }

  /**
   * 火山引擎产品代码到定价页面产品代码的映射
   * productId（如文档中的 LibraryID）→ 定价页面的 product 参数值
   */
  private readonly PRODUCT_CODE_MAP: Record<string, string> = {
    "6396": "ECS",
    "86681": "TOS",
    "6349": "TOS",
    "rds": "RDS for MySQL",
    "mysql": "RDS for MySQL",
    "ecs": "ECS",
    "tos": "TOS",
    "ecs_baremetal": "ECS_BareMetal",
    "gpu": "GPU_Server",
    "hpc_gpu": "HPC_GPU",
    "volume": "volume",
    "ims": "IMS",
  };

  /**
   * 解析 productId 为定价页面的产品代码列表
   * 无 productId 时返回常见产品
   */
  private resolveProductCodes(productId?: string): string[] {
    if (!productId) {
      // 默认查询热门产品
      return ["ECS", "TOS", "RDS for MySQL"];
    }

    const lower = productId.toLowerCase();

    // 检查是否有直接映射
    if (this.PRODUCT_CODE_MAP[lower]) {
      return [this.PRODUCT_CODE_MAP[lower]];
    }

    // 尝试模糊匹配
    if (lower.includes("ecs") || lower.includes("cvm") || lower.includes("云服务器") || lower.includes("弹性")) {
      return ["ECS"];
    }
    if (lower.includes("tos") || lower.includes("对象存储") || lower.includes("oss") || lower.includes("存储")) {
      return ["TOS"];
    }
    if (lower.includes("rds") || lower.includes("mysql") || lower.includes("数据库") || lower.includes("数据库")) {
      return ["RDS for MySQL"];
    }
    if (lower.includes("gpu") || lower.includes("gpu")) {
      return ["GPU_Server"];
    }
    if (lower.includes("volume") || lower.includes("云盘") || lower.includes("磁盘")) {
      return ["volume"];
    }

    // 无法匹配，直接使用 productId 作为产品代码
    return [productId];
  }

  /**
   * 从 SSR 定价页面获取 TemplateCode
   */
  private async getTemplateCode(productCode: string): Promise<string | null> {
    const ssrUrl = `${BASE_URL}/pricing?product=${encodeURIComponent(productCode)}&tab=1&__loader=${encodeURIComponent("__ssr_without_user/pricing/page")}&__ssrDirect=true`;

    const ssrRes = await this.fetchWithRetry(ssrUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });

    if (!ssrRes.ok) return null;

    const ssrData = await ssrRes.json() as any;
    const activeProductInfo = ssrData?.activeProductInfo;

    if (typeof activeProductInfo === "object") {
      return activeProductInfo?.TemplateInfoList?.[0]?.TemplateCode || null;
    }

    return null;
  }

  /**
   * 解析配置编码为可读的规格描述
   */
  private parseConfigCode(configCode: string): string {
    if (!configCode) return "";

    // ECS: ecs.g3i.large.month → g3i.large
    const ecsMatch = configCode.match(/^ecs\.(.+?)\.(month|hourly|year)$/);
    if (ecsMatch) return ecsMatch[1];

    // RDS: rds.mysql.d1.n_monthly → mysql d1.n
    const rdsMatch = configCode.match(/^rds\.(.+?)\.(.+?)_(monthly|hourly)$/);
    if (rdsMatch) return `${rdsMatch[1]} ${rdsMatch[2]}`;

    // volume: system-EBS_ESSD_PL0.month → EBS_ESSD_PL0
    const volMatch = configCode.match(/^system-(.+?)\.(month|hourly)$/);
    if (volMatch) return volMatch[1];

    // IMS: SUSE.month → SUSE
    const imsMatch = configCode.match(/^(.+?)\.(month|hourly)$/);
    if (imsMatch) return imsMatch[1];

    return configCode;
  }

  /**
   * 解析计费周期和次数为可读的计费单位和模式
   */
  private parsePeriod(period: string, times: number): { unit: string; billingMode: string } {
    switch (period) {
      case "hourly":
        return { unit: "元/小时", billingMode: "按量" };
      case "monthly":
        if (times === 1) return { unit: "元/月", billingMode: "包年包月" };
        if (times === 12) return { unit: `元/${times}个月`, billingMode: "包年包月" };
        if (times === 24) return { unit: `元/${times}个月`, billingMode: "包年包月" };
        if (times === 36) return { unit: `元/${times}个月`, billingMode: "包年包月" };
        return { unit: `元/${times}个月`, billingMode: "包年包月" };
      case "year":
        return { unit: `元/${times}年`, billingMode: "包年包月" };
      default:
        return { unit: "元", billingMode: period };
    }
  }
}