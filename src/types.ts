/** ListForHelp API 返回的产品分类 */
export interface ProductCategory {
  bookClassId: string;
  bookClassName: string;
  list: ProductItem[];
}

/** 单个产品文档 */
export interface ProductItem {
  bookId: string;
  name: string;
  bookName: string;
  note: string;
  productId: string;
}

/** ListForHelp API 完整响应 */
export interface ListForHelpResponse {
  code: string;
  data: {
    list: ProductCategory[];
  };
}

/** ContentQuery API 返回的单个页面 */
export interface SearchPageItem {
  pageId: string;
  name: string;
  title: string;
  note?: string;
  contentType?: string;
}

/** ContentQuery API 完整响应 */
export interface ContentQueryResponse {
  code: string;
  data: {
    bookName: string;
    pages: SearchPageItem[];
  };
}

/** page/Get API 返回的页面元信息 */
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

/** 文档目录项 */
export interface TocItem {
  pageId: string;
  title: string;
}
