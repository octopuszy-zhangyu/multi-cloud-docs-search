import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type SpecPriceItem, type PaginatedResult, type ListProductsOptions, type TocOptions, type PriceQueryOptions } from "./base.js";

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

    // 先访问文档页面获取 cookie（用于反爬虫验证）
    const cookies = await this.fetchVolcengineDocCookies(productId, docId);

    // 使用 cookie 调用 API 获取文档元数据
    const url = `${BASE_URL}/api/doc/getDocDetail?LibraryID=${productId}&DocumentID=${docId}&AuditDocumentID=&type=online`;
    const res = await this.fetchWithRetry(url, {
      headers: {
        ...cookies,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        Accept: "application/json",
        "x-language": "zh",
        "x-use-bff-version": "1",
        Referer: `${BASE_URL}/docs/${productId}/${docId}`,
      },
    });
    const raw = await res.json() as GetDocDetailResponse;

    return {
      pageId,
      title: raw.Result?.Title || "",
      contentPath: pageId,
      bookId: productId,
      updateDate: raw.Result?.UpdatedTime,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    // contentPath 实际上是 pageId: "productId/docId"
    const [productId, docId] = contentPath.split("/");

    // 先访问文档页面获取 cookie（用于反爬虫验证）
    const cookies = await this.fetchVolcengineDocCookies(productId, docId);

    // 使用 cookie 调用 API 获取文档内容
    const url = `${BASE_URL}/api/doc/getDocDetail?LibraryID=${productId}&DocumentID=${docId}&AuditDocumentID=&type=online`;
    const res = await this.fetchWithRetry(url, {
      headers: {
        ...cookies,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        Accept: "application/json",
        "x-language": "zh",
        "x-use-bff-version": "1",
        Referer: `${BASE_URL}/docs/${productId}/${docId}`,
      },
    });
    const raw = await res.json() as GetDocDetailResponse;

    const doc = raw.Result;
    return doc?.MDContent || doc?.Content || "";
  }

  /**
   * 先访问文档页面获取反爬虫验证 cookie，再调用 API
   * 火山引擎的 API 需要 acw_tc + s_v_web_id 等 cookie 才能返回内容
   */
  private async fetchVolcengineDocCookies(productId: string, docId: string): Promise<Record<string, string>> {
    const docUrl = `${BASE_URL}/docs/${productId}/${docId}`;
    const res = await this.fetchWithRetry(docUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    // 提取 set-cookie 中的 cookie
    const setCookie = res.headers.get("set-cookie") || "";
    const cookieParts: string[] = [];
    for (const part of setCookie.split(",")) {
      const trimmed = part.split(";")[0].trim();
      if (trimmed) cookieParts.push(trimmed);
    }

    const cookie = cookieParts.join("; ");

    return {
      Cookie: cookie,
    };
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
  /** 规格配置映射缓存（从文档提取） */
  private specConfigCache: Map<string, { cpu: number; mem: number }> | null = null;
  private specConfigExpiry: number = 0;

  /**
   * 从官方文档提取规格配置映射
   * 火山引擎规格文档中包含实例规格和 vCPU/内存的对应表格
   */
  private async getSpecConfigMap(): Promise<Map<string, { cpu: number; mem: number }>> {
    // 缓存 1 小时
    if (this.specConfigCache && Date.now() < this.specConfigExpiry) {
      return this.specConfigCache;
    }

    const specMap = new Map<string, { cpu: number; mem: number }>();

    // 需要抓取的规格文档页面
    const specDocIds = [
      "6396/1895261",  // 通用型(新)
      "6396/1913966",  // 计算型(新)
      "6396/68528",    // 计算型
      "6396/68527",    // 通用型
      "6396/1134015",  // 计算型弹性裸金属
      "6396/69763",    // 通用型弹性裸金属
    ];

    for (const pageId of specDocIds) {
      try {
        const meta = await this.getPageMetadata(pageId);
        const content = await this.getPageContent(meta.contentPath);
        if (!content) continue;

        const lines = content.split("\n");
        let inTable = false;
        let headers: string[] = [];
        let cpuCol = -1, memCol = -1, specCol = -1;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("|")) { inTable = false; continue; }

          const cells = trimmed.split("|").slice(1, -1).map(c => c.trim().replace(/<[^>]+>/g, ""));

          if (!inTable) {
            inTable = true;
            headers = cells;
            cpuCol = headers.findIndex(h => /vCPU|cpu/.test(h));
            memCol = headers.findIndex(h => /内存|memory|mem/i.test(h));
            specCol = headers.findIndex(h => /实例规格|规格名称/.test(h));
            continue;
          }

          if (cells.every(c => /^-+$/.test(c.trim()))) continue;
          if (specCol < 0 || cpuCol < 0 || memCol < 0) continue;
          if (cells.length <= Math.max(specCol, cpuCol, memCol)) continue;

          const specName = cells[specCol].trim().replace(/\\/g, "");
          const cpu = parseInt(cells[cpuCol]);
          const mem = parseInt(cells[memCol]);

          if (specName && !isNaN(cpu) && !isNaN(mem) && cpu > 0 && mem > 0) {
            // 标准化规格名：去掉 -lm 等内部后缀
            // ecs.g2i-lm.xlarge → g2i.xlarge
            let normalized = specName.replace(/^ecs\./, "");
            normalized = normalized.replace(/-lm\./, ".");
            if (!specMap.has(normalized)) {
              specMap.set(normalized, { cpu, mem });
            }
          }
        }
      } catch {
        continue;
      }
    }

    this.specConfigCache = specMap;
    this.specConfigExpiry = Date.now() + 60 * 60 * 1000;
    return specMap;
  }

  /**
   * 从文档获取的规格配置映射中查找规格的 CPU/内存
   * 支持精确匹配和前缀匹配
   */
  private lookupSpecConfig(specName: string): { cpu: number; mem: number } | null {
    if (!this.specConfigCache) return null;

    // 1. 精确匹配
    if (this.specConfigCache.has(specName)) {
      return this.specConfigCache.get(specName)!;
    }

    // 2. 尝试带 ecs. 前缀
    if (this.specConfigCache.has(`ecs.${specName}`)) {
      return this.specConfigCache.get(`ecs.${specName}`)!;
    }

    // 3. 模糊匹配：找同规格族同大小的规格
    // g3i.xlarge → 在文档中找 *.xlarge 且规格族前缀匹配
    const parts = specName.split(".");
    if (parts.length === 2) {
      const familyBase = parts[0]; // g3i
      const size = parts[1];       // xlarge
      for (const [docSpec, config] of this.specConfigCache) {
        const docParts = docSpec.split(".");
        if (docParts.length === 2 && docParts[1] === size) {
          // 规格族前缀相似
          if (docParts[0].startsWith(familyBase) || familyBase.startsWith(docParts[0])) {
            return config;
          }
        }
      }
    }

    return null;
  }

  /**
   * 构建火山引擎 ECS 规格-配置-价格联合表
   * 从 GetTable API 获取价格，从文档提取的规格配置映射中获取 CPU/内存
   */
  async buildSpecPriceTable(productId?: string): Promise<SpecPriceItem[]> {
    const specItems: SpecPriceItem[] = [];
    const seen = new Set<string>();

    try {
      // 先获取价格数据（GetTable API），再获取规格配置映射（文档）
      // 顺序重要：先调 API 再调 getPageContent，避免状态干扰
      const productCodes = this.resolveProductCodes(productId);
      const allRows: Array<{ productName: string; configCode: string; chargeItemCode: string; priceInfoList: any[] }> = [];

      for (const productCode of productCodes) {
        const templateCode = await this.getTemplateCode(productCode);
        if (!templateCode) continue;

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

        for (const table of tableList) {
          const rows = table.Rows || [];
          for (const row of rows) {
            const productName = row.Product || "";
            if (productCode && !productName.toLowerCase().includes(productCode.toLowerCase())) continue;
            allRows.push({
              productName,
              configCode: row.ConfigurationCode || "",
              chargeItemCode: row.ChargeItemCode || "",
              priceInfoList: row.PriceInfoList || [],
            });
          }
        }
      }

      if (allRows.length === 0) return specItems;

      // 再从文档加载规格配置映射
      const specConfigMap = await this.getSpecConfigMap();

      // JOIN：将价格数据和规格配置映射合并
      for (const row of allRows) {
        const spec = this.parseConfigCode(row.configCode);
        if (!spec) continue;

        // 优先从文档映射查找，找不到则用 inferSpecFromName 推断
        let config = specConfigMap.size > 0 ? this.lookupSpecConfig(spec) : null;
        if (!config) {
          const inferred = this.inferSpecFromName(spec);
          if (!inferred) continue;
          config = inferred;
        }

        const displayName = `${config.cpu}C${config.mem}G`;

        const lastUnderscore = row.chargeItemCode.lastIndexOf("_");
        const region = lastUnderscore > 0 ? row.chargeItemCode.substring(lastUnderscore + 1) : undefined;

        for (const pi of row.priceInfoList) {
          const period = pi.Period || "";
          const price = parseFloat(pi.Price) || 0;
          const times = pi.Times || 1;

          if (price <= 0) continue;

          const { unit, billingMode } = this.parsePeriod(period, times);
          const key = `${spec}_${region || ""}_${billingMode}`;
          if (!seen.has(key)) {
            seen.add(key);
            specItems.push({
              specName: spec,
              cpu: config.cpu,
              mem: config.mem,
              displayName,
              region,
              billingMode,
              price,
              unit,
            });
          }
        }
      }
    } catch (err) {
      console.error(`火山引擎规格价格表构建失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    return specItems;
  }

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

            // 如果指定了 productId，用解析后的 productCode 匹配，而不是用原始 productId
            // 因为 productId(如 6396) 和实际产品的名称(如 ECS) 不匹配
            if (productCode && !productName.toLowerCase().includes(productCode.toLowerCase())) {
              continue;
            }

            for (const pi of priceInfoList) {
              const period = pi.Period || "";
              const price = parseFloat(pi.Price) || 0;
              const times = pi.Times || 1;

              if (price <= 0) continue;

              // 从 ChargeItemCode 提取地域信息
              // ChargeItemCode 格式: ecs.g3a_32xlarge_ap-southeast-1 或 ecs.g3a_32xlarge_cn-beijing
              // 取最后一个 _ 后面的部分作为地域
              const lastUnderscore = chargeItemCode.lastIndexOf("_");
              const region = lastUnderscore > 0 ? chargeItemCode.substring(lastUnderscore + 1) : undefined;

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
      const templates = activeProductInfo?.TemplateInfoList || [];
      // 优先选 Type=1 且有 TableCodeList 的模板
      const withTables = templates.find((t: any) => t.Type === 1 && t.TableCodeList?.length > 0);
      if (withTables) return withTables.TemplateCode;
      // 回退到第一个
      return templates[0]?.TemplateCode || null;
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