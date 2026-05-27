import type { Product, TocItem, SearchResult, PageMetadata, PriceItem, PriceResult } from "./adapters/base.js";

// ===== 天翼云 API 响应类型（与现有逻辑兼容） =====

export interface ProductCategory {
  bookClassId: string;
  bookClassName: string;
  list: ProductItem[];
}

export interface ProductItem {
  bookId: string;
  name: string;
  bookName: string;
  note: string;
  productId: string;
}

export interface ListForHelpResponse {
  code: string;
  data: {
    list: ProductCategory[];
  };
}

export interface SearchPageItem {
  pageId: string;
  name: string;
  title: string;
  note?: string;
  contentType?: string;
}

export interface ContentQueryResponse {
  code: string;
  data: {
    bookName: string;
    pages: SearchPageItem[];
  };
}

export interface PageMetadataResponse {
  code: string;
  data: {
    pageId: string;
    name: string;
    title: string;
    contentType: string;
    note?: string;
    contentPath: string;
    chapterId: string;
    bookId: number;
    updateDateShow: string;
  };
}

// ===== 重新导出适配器基础类型 =====
export type { Product, TocItem, SearchResult, PageMetadata, PriceItem, PriceResult };
