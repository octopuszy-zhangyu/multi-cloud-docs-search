import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type SpecPriceItem, type PaginatedResult, type ListProductsOptions, type TocOptions, type PriceQueryOptions } from "./base.js";
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

  private async fetchSearchApi<T>(url: string): Promise<T> {
    const res = await this.fetchWithRetry(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": SUPPORT_URL,
      },
    });
    if (!res.ok) {
      throw new Error(`请求失败: ${res.status} ${res.statusText}`);
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
        const data = await this.fetchSearchApi<SearchResponse>(url);
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

  async listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>> {
    const products = await this.getProductsFromSearch();
    let mapped = products.map((p) => ({
      productId: p.productId,
      name: p.name,
      
    }));

    // Keyword filtering
    mapped = this.filterByKeywords(mapped, options?.keyword);

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

    // 尝试多个关键词变体，确保能够获取到文档列表
    const keywords = [
      product.name,
      product.name.replace(/[（].*[）]/, ""),
      ...product.name.split(/[（]/).filter(s => s.trim().length > 0),
    ].filter((v, i, a) => v && a.indexOf(v) === i);

    let data: SearchResponse | null = null;
    for (const kw of keywords) {
      try {
        const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=50&keyword=${encodeURIComponent(kw)}&productId=${productId}&referrer=${encodeURIComponent(SUPPORT_URL)}`;
        data = await this.fetchSearchApi<SearchResponse>(url);
        if (data?.data?.docList && data.data.docList.length > 0) {
          break;
        }
      } catch {
        continue;
      }
    }

    if (!data?.data?.docList) {
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

    // 过滤掉 pageId 为空的条（class_id 是分类 ID，不是文档 ID）
    items = items.filter((item) => item.pageId && item.pageId.trim().length > 0);

    // Keyword filtering
    items = this.filterByKeywords(items, options?.keyword);

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
    const data = await this.fetchSearchApi<SearchResponse>(url);

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
    const data = await this.fetchSearchApi<SearchResponse>(url);

    if (data.data?.docList && data.data.docList.length > 0) {
      const doc = data.data.docList[0];
      return {
        pageId,
        title: doc.title.replace(/<[^>]+>/g, ""),
        contentPath: `${SUPPORT_URL}/document/${pageId}.html`,
      };
    }

    return {
      pageId,
      title: "",
      contentPath: `${SUPPORT_URL}/document/${pageId}.html`,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    const pageId = contentPath.match(/\/(\d+)\.html/)?.[1] || contentPath;

    // 通过搜索 API 用 pageId 作为关键词获取文档内容
    const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=50&keyword=${encodeURIComponent(pageId)}&referrer=${encodeURIComponent(SUPPORT_URL)}`;
    const data = await this.fetchSearchApi<SearchResponse>(url);

    if (data.data?.docList) {
      const doc = data.data.docList.find((d) => String(d.document_id) === pageId);
      if (doc) {
        const title = doc.title.replace(/<[^>]+>/g, "");
        const content = doc.content.replace(/<[^>]+>/g, "");
        return `# ${title}\n\n${content}`;
      }

      // 如果精确匹配失败，尝试使用第一个搜索结果
      if (data.data.docList.length > 0) {
        const firstDoc = data.data.docList[0];
        const title = firstDoc.title.replace(/<[^>]+>/g, "");
        const content = firstDoc.content.replace(/<[^>]+>/g, "");
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

  private parsePriceTable(markdown: string): PriceItem[] {
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
            billingMode,
            price,
            unit,
          });
        }
      } else {
        inTable = false;
        headers = [];
      }
    }

    return prices;
  }

  async getProductPrice(productId?: string, _options?: PriceQueryOptions): Promise<PriceResult> {
    const result: PriceResult = {
      provider: this.provider,
      name: this.name,
      prices: [],
    };

    if (!productId) {
      return this.makePriceResult([], {
        message: "联通云价格查询：请指定 productId。常用产品：128（云服务器 ECS）、357（AI服务平台 AISP）、398（AICP）。示例：get_product_price({ provider: \"cucloud\", productId: \"128\" })",
      });
    }

    try {
      // Try to fetch pricing documentation via search API
      const priceKeywords = ["价格", "计费", "定价", "费用"];
      for (const keyword of priceKeywords) {
        try {
          const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=10&keyword=${encodeURIComponent(keyword)}&productId=${productId}&referrer=${encodeURIComponent(SUPPORT_URL)}`;
          const data = await this.fetchSearchApi<SearchResponse>(url);
          if (data.data?.docList && data.data.docList.length > 0) {
            const doc = data.data.docList[0];
            const content = doc.content.replace(/<[^>]+>/g, "");
            const prices = this.parsePriceTable(content);
            if (prices.length > 0) {
              result.prices = prices;
              break;
            }
          }
        } catch {
          continue;
        }
      }

      // If no structured price table found, try to extract daily unit prices from search results
      if (result.prices.length === 0) {
        const dailyPrices = await this.extractDailyUnitPrices(productId);
        if (dailyPrices.length > 0) {
          result.prices = dailyPrices;
        }
      }
    } catch {
      // Return empty prices if unable to fetch
    }

    // 设置数据完整性标记
    result.dataStatus = result.prices.length > 0 ? "partial" : "no_data";

    return result;
  }

  /** 从搜索结果中提取按日单价 */
  private async extractDailyUnitPrices(productId: string): Promise<PriceItem[]> {
    const prices: PriceItem[] = [];

    try {
      // Search for ECS pricing with "日单价" keyword to find the actual pricing document
      const keywords = ["日单价", "vcpu", "价格", "计费"];

      for (const keyword of keywords) {
        const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=20&keyword=${encodeURIComponent(keyword)}&productId=${productId}&referrer=${encodeURIComponent(SUPPORT_URL)}`;
        const data = await this.fetchSearchApi<SearchResponse>(url);

        if (data.data?.docList && data.data.docList.length > 0) {
          for (const doc of data.data.docList) {
            const content = doc.content.replace(/<[^>]+>/g, "");

            // Extract vCPU price - pattern: vcpu核按量（日）55.89
            const vcpuMatch = content.match(/vcpu\s*核\s*按量.*?日.*?([\d.]+)|CPU\s*核\s*按量.*?([\d.]+)/i);
            // Extract memory price - pattern: 内存1G按量（日）1.50
            const memMatch = content.match(/内存\s*\d+G\s*按量.*?日.*?([\d.]+)/i);

            if (vcpuMatch || memMatch) {
              const vcpuPrice = vcpuMatch ? parseFloat(vcpuMatch[1] || vcpuMatch[2]) : 0;
              const memPrice = memMatch ? parseFloat(memMatch[1]) : 0;

              if (vcpuPrice > 0) {
                prices.push({
                  productName: "云服务器 ECS",
                  billingMode: "按量计费（日单价）",
                  price: vcpuPrice,
                  unit: "核/日",
                });
              }

              if (memPrice > 0) {
                prices.push({
                  productName: "云服务器 ECS",
                  billingMode: "按量计费（日单价）",
                  price: memPrice,
                  unit: "GB/日",
                });
              }

              if (prices.length > 0) break;
            }
          }
        }

        if (prices.length > 0) break;
      }
    } catch {
      // Ignore errors
    }

    return prices;
  }

  /**
   * 构建联通云 ECS 规格-配置-价格联合表
   * 从定价文档中解析规格表，获取 specName, cpu, mem, price 信息
   */
  async buildSpecPriceTable(productId?: string): Promise<SpecPriceItem[]> {
    // 只处理 ECS (productId = "128")
    if (!productId || productId !== "128") {
      return super.buildSpecPriceTable(productId);
    }

    const specItems: SpecPriceItem[] = [];
    const seen = new Set<string>();

    try {
      // 搜索包含规格价格表的文档
      const keywords = ["规格", "价格", "云服务器", "配置", "CPU", "内存"];
      
      for (const keyword of keywords) {
        const url = `${SEARCH_API}/product/queryAll?index=cms_document&pageNo=1&pageSize=20&keyword=${encodeURIComponent(keyword)}&productId=${productId}&referrer=${encodeURIComponent(SUPPORT_URL)}`;
        
        try {
          const data = await this.fetchSearchApi<SearchResponse>(url);
          
          if (data.data?.docList && data.data.docList.length > 0) {
            for (const doc of data.data.docList) {
              const content = doc.content.replace(/<[^>]+>/g, "");
              
              // 解析规格表 - 尝试匹配常见的规格表格格式
              // 格式1: 规格名称 | CPU | 内存 | 价格
              // 格式2: 2C4G | 2核 | 4GB | xxx元/月
              const specItemsFromContent = this.parseSpecTableFromContent(content);
              
              for (const item of specItemsFromContent) {
                const key = `${item.specName}_${item.billingMode}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  specItems.push(item);
                }
              }
              
              if (specItems.length > 0) break;
            }
          }
        } catch {
          continue;
        }
        
        if (specItems.length > 0) break;
      }

      // 如果从搜索结果中没找到足够的规格，尝试直接访问定价页面
      if (specItems.length === 0) {
        const pricePageUrls = [
          `${SUPPORT_URL}/document/12831001.html`,  // 常见的价格文档页面
          `${SUPPORT_URL}/document/12831002.html`,
        ];

        for (const url of pricePageUrls) {
          try {
            const html = await this.fetchHtml(url);
            const $ = cheerio.load(html);
            const bodyText = $("body").text();
            
            const specItemsFromPage = this.parseSpecTableFromContent(bodyText);
            
            for (const item of specItemsFromPage) {
              const key = `${item.specName}_${item.billingMode}`;
              if (!seen.has(key)) {
                seen.add(key);
                specItems.push(item);
              }
            }
            
            if (specItems.length > 0) break;
          } catch {
            continue;
          }
        }
      }
    } catch (err) {
      console.error(`联通云规格价格表构建失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    return specItems;
  }

  /**
   * 从文档内容中解析规格表
   * 尝试匹配多种格式：
   * 1. 规格名称 CPU核数 内存 价格
   * 2. 2C4G 2核 4GB xxx元/月
   * 3. ecs.s5.large 2 4 xxx
   */
  private parseSpecTableFromContent(content: string): SpecPriceItem[] {
    const specItems: SpecPriceItem[] = [];
    const lines = content.split(/[\n\r]+/);
    
    // 匹配规格行的模式
    // 模式1: 规格名 CPU核 内存 价格 (如: 2C4G 2核 4GB 100元/月)
    const specPattern1 = /([\d]+C[\d]+G)\s*([\d]+)\s*核\s*([\d]+)\s*[Gg][Bb]?\s*([\d.]+)\s*(?:元\/月|元\/小时|元\/日|元\/年)?/i;
    
    // 模式2: 规格名 CPU 内存 价格 (如: ecs.s5.large 2 4 100)
    const specPattern2 = /(ecs\.[a-z0-9.]+)\s+(\d+)\s+(\d+)\s+([\d.]+)/i;
    
    // 模式3: 通用规格格式 (如: 2核4GB 100元/月)
    const specPattern3 = /([\d]+)\s*核\s*([\d]+)\s*[Gg][Bb]?\s*([\d.]+)\s*(?:元\/月|元\/小时|元\/日|元\/年)?/i;
    
    // 模式4: 表格格式 | 规格 | CPU | 内存 | 价格 |
    const tablePattern = /\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|/;
    
    for (const line of lines) {
      // 尝试模式1
      let match = line.match(specPattern1);
      if (match) {
        const displayName = match[1];
        const cpu = parseInt(match[2]);
        const mem = parseInt(match[3]);
        const price = parseFloat(match[4]);
        
        if (cpu > 0 && mem > 0 && price > 0) {
          specItems.push({
            specName: displayName,
            cpu,
            mem,
            displayName,
            billingMode: "包月",
            price,
            unit: "元/月",
          });
          
          // 同时添加按量价格（如果价格看起来是按量价格）
          if (price < 10) {  // 按量价格通常较小
            specItems.push({
              specName: displayName,
              cpu,
              mem,
              displayName,
              billingMode: "按量",
              price,
              unit: "元/小时",
            });
          }
        }
        continue;
      }
      
      // 尝试模式2
      match = line.match(specPattern2);
      if (match) {
        const specName = match[1];
        const cpu = parseInt(match[2]);
        const mem = parseInt(match[3]);
        const price = parseFloat(match[4]);
        
        if (cpu > 0 && mem > 0 && price > 0) {
          const displayName = `${cpu}C${mem}G`;
          specItems.push({
            specName,
            cpu,
            mem,
            displayName,
            billingMode: "包月",
            price,
            unit: "元/月",
          });
        }
        continue;
      }
      
      // 尝试模式3
      match = line.match(specPattern3);
      if (match) {
        const cpu = parseInt(match[1]);
        const mem = parseInt(match[2]);
        const price = parseFloat(match[3]);
        
        if (cpu > 0 && mem > 0 && price > 0) {
          const displayName = `${cpu}C${mem}G`;
          const specName = `ecs.${cpu}c${mem}g`;
          
          specItems.push({
            specName,
            cpu,
            mem,
            displayName,
            billingMode: "包月",
            price,
            unit: "元/月",
          });
        }
      }
    }
    
    // 尝试解析表格格式
    const tableLines = content.split('\n').filter(l => l.trim().startsWith('|'));
    for (const tableLine of tableLines) {
      const cells = tableLine.split('|').filter(c => c.trim().length > 0).map(c => c.trim());
      
      if (cells.length >= 4) {
        // 尝试从第一列提取规格信息
        const firstCol = cells[0];
        
        // 匹配 "2C4G" 或 "2核4GB" 格式
        const displayMatch = firstCol.match(/(\d+)C(\d+)G/i) || firstCol.match(/(\d+)\s*核\s*(\d+)\s*[Gg][Bb]?/i);
        
        if (displayMatch) {
          const cpu = parseInt(displayMatch[1]);
          const mem = parseInt(displayMatch[2]);
          
          // 从最后一列获取价格
          const lastCol = cells[cells.length - 1];
          const priceMatch = lastCol.match(/([\d.]+)/);
          
          if (priceMatch && cpu > 0 && mem > 0) {
            const price = parseFloat(priceMatch[1]);
            const displayName = `${cpu}C${mem}G`;
            
            // 检查是否有计费模式信息
            let billingMode = "包月";
            let unit = "元/月";
            
            // 查找包含"按量"或"小时"的列
            for (let i = 1; i < cells.length - 1; i++) {
              if (cells[i].includes("按量") || cells[i].includes("小时")) {
                billingMode = "按量";
                unit = "元/小时";
                break;
              }
            }
            
            const key = `${displayName}_${billingMode}`;
            if (!specItems.some(s => `${s.displayName}_${s.billingMode}` === key)) {
              specItems.push({
                specName: displayName,
                cpu,
                mem,
                displayName,
                billingMode,
                price,
                unit,
              });
            }
          }
        }
      }
    }
    
    return specItems;
  }
}
