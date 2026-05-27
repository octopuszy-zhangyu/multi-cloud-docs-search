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
}

/** 云厂商文档适配器抽象基类 */
export abstract class CloudDocAdapter {
  /** 厂商标识，如 "ctyun"、"aliyun" */
  abstract readonly provider: string;
  /** 厂商中文名称，如 "天翼云"、"阿里云" */
  abstract readonly name: string;

  /** 获取所有产品文档列表 */
  abstract listProducts(): Promise<Product[]>;

  /** 获取指定产品的文档目录树 */
  abstract getDocumentToc(productId: string): Promise<TocItem[]>;

  /** 在产品文档中搜索关键词 */
  abstract searchDocuments(productId: string, keyword: string): Promise<SearchResult[]>;

  /** 获取页面元信息（含 contentPath） */
  abstract getPageMetadata(pageId: string): Promise<PageMetadata>;

  /** 获取文档页面 Markdown 正文 */
  abstract getPageContent(contentPath: string): Promise<string>;

  /** 获取产品价格信息 */
  abstract getProductPrice(productId?: string): Promise<PriceResult>;
}
