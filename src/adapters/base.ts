/** 统一产品接口 */
export interface Product {
  productId: string;
  name: string;
  description?: string;
}

/** 文档目录项 */
export interface TocItem {
  pageId: string;
  title: string;
  children?: TocItem[];
}

/** 搜索结果项 */
export interface SearchResult {
  pageId: string;
  title: string;
  description?: string;
}

/** 页面元信息 */
export interface PageMetadata {
  pageId: string;
  title: string;
  note?: string;
  contentPath: string;
  chapterId?: string;
  bookId?: string;
  updateDate?: string;
}

/** 价格条目 */
export interface PriceItem {
  productName: string;
  specification: string;
  region?: string;
  billingMode: string;
  price: number;
  unit: string;
  currency: string;
  source: string;
  note?: string;
}

/** 价格查询结果 */
export interface PriceResult {
  provider: string;
  name: string;
  prices: PriceItem[];
  source: string;
  updateDate?: string;
  message?: string;
  note?: string;
  total?: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  /** 数据完整性标记：complete=有完整价格数据, partial=部分数据, no_price=文档无价格, no_data=无数据 */
  dataStatus?: "complete" | "partial" | "no_price" | "no_data";
}

/** 价格查询选项 */
export interface PriceQueryOptions {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

/** 分页结果包装 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** 查询参数 */
export interface ListProductsOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface TocOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  topOnly?: boolean;
}

/** 默认请求头 */
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

/** 云厂商文档适配器抽象基类 */
export abstract class CloudDocAdapter {
  /** 厂商标识，如 "ctyun"、"aliyun" */
  abstract readonly provider: string;
  /** 厂商中文名称，如 "天翼云"、"阿里云" */
  abstract readonly name: string;

  /** 带超时的 fetch 请求，默认 15 秒超时 */
  protected async fetchWithTimeout(url: string, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
    const { timeout = 15000, ...fetchOptions } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 带超时和指数退避重试的 fetch 请求，默认重试 2 次 */
  protected async fetchWithRetry(url: string, options: RequestInit & { timeout?: number } = {}, retries = 2): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.fetchWithTimeout(url, options);
      } catch (error) {
        if (attempt === retries) throw error;
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error("Unreachable");
  }

  /** 获取 HTML 文本 */
  protected async fetchHtml(url: string): Promise<string> {
    const res = await this.fetchWithRetry(url, {
      headers: { ...DEFAULT_HEADERS, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
    if (res.status === 404) {
      throw new Error(`页面不存在 (404): ${url}`);
    }
    if (!res.ok) {
      throw new Error(`请求失败: ${res.status} ${res.statusText} — ${url}`);
    }
    return res.text();
  }

  /** 获取 JSON 数据 */
  protected async fetchJson<T>(url: string): Promise<T> {
    const res = await this.fetchWithRetry(url, {
      headers: { ...DEFAULT_HEADERS, "Accept": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`请求失败: ${res.status} ${res.statusText} — ${url}`);
    }
    return res.json() as Promise<T>;
  }

  /** 获取纯文本内容 */
  protected async fetchText(url: string): Promise<string> {
    const res = await this.fetchWithRetry(url, {
      headers: { ...DEFAULT_HEADERS, "Accept": "text/plain,text/html,*/*" },
    });
    if (!res.ok) {
      throw new Error(`请求失败: ${res.status} ${res.statusText} — ${url}`);
    }
    return res.text();
  }

  /** 获取所有产品文档列表 */
  abstract listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>>;

  /** 获取指定产品的文档目录树 */
  abstract getDocumentToc(productId: string, options?: TocOptions): Promise<PaginatedResult<TocItem>>;

  /** 在产品文档中搜索关键词 */
  abstract searchDocuments(productId: string, keyword: string): Promise<SearchResult[]>;

  /** 获取页面元信息（含 contentPath） */
  abstract getPageMetadata(pageId: string): Promise<PageMetadata>;

  /** 获取文档页面 Markdown 正文 */
  abstract getPageContent(contentPath: string): Promise<string>;

  /** 获取产品价格信息 */
  abstract getProductPrice(productId?: string, options?: PriceQueryOptions): Promise<PriceResult>;

  // ========== 可重用的辅助方法 ==========

  /**
   * 按关键词过滤列表（AND 逻辑，关键词以空格分隔，大小写不敏感）
   */
  protected filterByKeywords<T extends { name?: string; title?: string; description?: string }>(items: T[], keyword?: string): T[] {
    if (!keyword) return items;
    const keywords = keyword.trim().split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return items;
    return items.filter(item => {
      const text = ((item.name || item.title || "") + " " + (item.description || "")).toLowerCase();
      return keywords.every(kw => text.includes(kw.toLowerCase()));
    });
  }

  /**
   * 数组分页包装
   */
  protected paginate<T>(items: T[], page: number = 1, pageSize: number = 100): PaginatedResult<T> {
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

  /**
   * 合并 filterByKeywords + paginate 的快捷方法
   */
  protected paginateProducts(products: Product[], options?: ListProductsOptions): PaginatedResult<Product> {
    const filtered = this.filterByKeywords(products, options?.keyword);
    return this.paginate(filtered, options?.page ?? 1, options?.pageSize ?? 100);
  }

  /**
   * 根据价格数组判断数据状态
   */
  protected determineDataStatus(prices: PriceItem[]): "complete" | "partial" | "no_price" | "no_data" {
    if (prices.length > 0 && prices[0].price > 0) return "complete";
    if (prices.length > 0 && prices[0].price === 0) return "no_price";
    return "no_data";
  }

  /**
   * 构造 PriceResult 的快捷方法
   */
  protected makePriceResult(prices: PriceItem[], source: string, extra?: Partial<PriceResult>): PriceResult {
    return {
      provider: this.provider,
      name: this.name,
      prices,
      source,
      dataStatus: this.determineDataStatus(prices),
      ...extra,
    };
  }

  /**
   * 解析 Markdown 表格行，返回二维字符串数组
   * 子类可基于此构建 PriceItem
   */
  protected parseMarkdownTable(markdown: string): { headers: string[]; rows: string[][] } {
    const lines = markdown.split("\n");
    const headers: string[] = [];
    const rows: string[][] = [];
    let inTable = false;

    for (const line of lines) {
      if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        const cells = line.split("|").map(c => c.trim()).filter(Boolean);
        if (!inTable) {
          headers.push(...cells);
          inTable = true;
          continue;
        }
        if (cells.every(c => /^[-:\s]+$/.test(c))) continue;
        if (cells.length >= 2) {
          rows.push(cells);
        }
        continue;
      }
      if (inTable && line.trim() !== "") {
        inTable = false;
      }
    }

    return { headers, rows };
  }
}
