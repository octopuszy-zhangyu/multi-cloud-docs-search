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

  /** 获取所有产品文档列表 */
  abstract listProducts(options?: ListProductsOptions): Promise<Product[] | PaginatedResult<Product>>;

  /** 获取指定产品的文档目录树 */
  abstract getDocumentToc(productId: string, options?: TocOptions): Promise<TocItem[] | PaginatedResult<TocItem>>;

  /** 在产品文档中搜索关键词 */
  abstract searchDocuments(productId: string, keyword: string): Promise<SearchResult[]>;

  /** 获取页面元信息（含 contentPath） */
  abstract getPageMetadata(pageId: string): Promise<PageMetadata>;

  /** 获取文档页面 Markdown 正文 */
  abstract getPageContent(contentPath: string): Promise<string>;

  /** 获取产品价格信息 */
  abstract getProductPrice(productId?: string): Promise<PriceResult>;
}
