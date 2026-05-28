import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type PaginatedResult, type ListProductsOptions, type TocOptions, type PriceQueryOptions } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const BASE_URL = "https://ecloud.10086.cn";
const HELP_CENTER_URL = `${BASE_URL}/op-help-center`;
const CATEGORY_TREE_API = `${HELP_CENTER_URL}/request-api/service-api/category/tree`;
const OUTLINE_TREE_API = `${HELP_CENTER_URL}/request-api/service-api/outline/tree`;
const ARTICLE_INFO_API = `${HELP_CENTER_URL}/request-api/service-api/article/info`;
const ARTICLE_CONTENT_API = `${HELP_CENTER_URL}/request-api/service-api/article/content`;

interface CategoryNode {
  id: number;
  parentId: number;
  name: string;
  outlineId?: number;
  children?: CategoryNode[];
}

interface CategoryTreeResponse {
  code: number;
  data: CategoryNode;
}

interface OutlineNode {
  id: number;
  name: string;
  articleId: number | null;
  children?: OutlineNode[];
}

interface OutlineTreeResponse {
  code: number;
  data: OutlineNode;
}

interface ArticleInfo {
  id: number;
  title: string;
  gmtModify: number;
  content: string;
}

interface ArticleInfoResponse {
  code: number;
  data: ArticleInfo;
}

export class EcloudAdapter extends CloudDocAdapter {
  readonly provider = "ecloud";
  readonly name = "移动云";

  private async fetchApi<T>(url: string): Promise<T | null> {
    try {
      const res = await this.fetchWithRetry(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          "categoryrootparent": "0",
          "ispreview": "false",
          "tentid": "0",
          "Referer": HELP_CENTER_URL,
          "Cookie": "CmLocation=100|100; CmProvid=bj",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
      });
      if (!res.ok) {
        return null;
      }
      return res.json() as Promise<T>;
    } catch {
      return null;
    }
  }

  async listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>> {
    // 优先使用API获取产品列表
    const data = await this.fetchApi<CategoryTreeResponse>(CATEGORY_TREE_API);
    if (data?.data?.children) {
      const products: Product[] = [];
      const seen = new Set<string>();

      const extractProducts = (nodes: CategoryNode[], parentName: string) => {
        for (const node of nodes) {
          if (node.children && node.children.length > 0) {
            extractProducts(node.children, node.name);
          } else if (node.id && !seen.has(String(node.id))) {
            seen.add(String(node.id));
            products.push({
              productId: String(node.id),
              name: node.name,
              description: parentName,
            });
          }
        }
      };

      extractProducts(data.data.children, "");
      const filtered = this.filterByKeywords(products, options?.keyword);
      return this.paginate(filtered, options?.page, options?.pageSize);
    }

    // 备用方案：从HTML页面提取
    const html = await this.fetchHtml(HELP_CENTER_URL);
    const $ = cheerio.load(html);

    const products: Product[] = [];
    const seen = new Set<string>();

    $("a[href*='/doc/category/']").each((_, el) => {
      const href = $(el).attr("href") || "";
      const title = $(el).text().trim();

      const match = href.match(/\/doc\/category\/(\d+)/);
      if (match && title && !seen.has(match[1])) {
        seen.add(match[1]);
        products.push({
          productId: match[1],
          name: title,
          description: "",
        });
      }
    });

    const filtered = this.filterByKeywords(products, options?.keyword);
    return this.paginate(filtered, options?.page, options?.pageSize);
  }

  private async getOutlineId(productId: string): Promise<number | null> {
    const data = await this.fetchApi<CategoryTreeResponse>(CATEGORY_TREE_API);
    if (!data?.data?.children) return null;
    let outlineId: number | null = null;

    const findOutlineId = (nodes: CategoryNode[]) => {
      for (const node of nodes) {
        if (String(node.id) === productId) {
          outlineId = node.outlineId ?? null;
          return;
        }
        if (node.children && node.children.length > 0) {
          findOutlineId(node.children);
        }
      }
    };

    findOutlineId(data.data.children);
    return outlineId;
  }

  async getDocumentToc(productId: string, options?: TocOptions): Promise<PaginatedResult<TocItem>> {
    const outlineId = await this.getOutlineId(productId);
    if (!outlineId) {
      // 备用方案：从HTML页面提取
      const url = `${HELP_CENTER_URL}/doc/category/${productId}`;
      const html = await this.fetchHtml(url);
      const $ = cheerio.load(html);

      const items: TocItem[] = [];
      const seen = new Set<string>();

      $("a[href*='/doc/article/']").each((_, el) => {
        const href = $(el).attr("href") || "";
        const title = $(el).text().trim();

        const match = href.match(/\/doc\/article\/(\d+)/);
        if (match && title && !seen.has(match[1])) {
          seen.add(match[1]);
          items.push({
            pageId: match[1],
            title,
          });
        }
      });

      let filtered = this.filterByKeywords(items, options?.keyword);
      if (options?.topOnly) {
        filtered = filtered.map(item => ({ pageId: item.pageId, title: item.title }));
      }
      return this.paginate(filtered, options?.page, options?.pageSize, 200);
    }

    const url = `${OUTLINE_TREE_API}?outlineId=${outlineId}`;
    const data = await this.fetchApi<OutlineTreeResponse>(url);

    const items: TocItem[] = [];
    const seen = new Set<string>();

    if (!data?.data?.children) return this.paginate([], options?.page, options?.pageSize, 200);

    const extractArticles = (nodes: OutlineNode[]) => {
      for (const node of nodes) {
        if (node.articleId && !seen.has(String(node.articleId))) {
          seen.add(String(node.articleId));
          items.push({
            pageId: String(node.articleId),
            title: node.name,
          });
        }
        if (node.children && node.children.length > 0) {
          extractArticles(node.children);
        }
      }
    };

    if (data.data?.children) {
      extractArticles(data.data.children);
    }

    let filtered = this.filterByKeywords(items, options?.keyword);
    if (options?.topOnly) {
      filtered = filtered.map(item => ({ pageId: item.pageId, title: item.title }));
    }
    return this.paginate(filtered, options?.page, options?.pageSize, 200);
  }

  private filterByKeywords<T extends { name?: string; title?: string }>(items: T[], keyword?: string): T[] {
    if (!keyword) return items;
    const keywords = keyword.trim().split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return items;
    return items.filter(item => {
      const text = (item.name || item.title || "").toLowerCase();
      return keywords.every(kw => text.includes(kw.toLowerCase()));
    });
  }

  private paginate<T>(items: T[], page: number = 1, pageSize: number = 100, defaultPageSize?: number): PaginatedResult<T> {
    const effectivePageSize = pageSize || defaultPageSize || 100;
    const start = (page - 1) * effectivePageSize;
    const paged = items.slice(start, start + effectivePageSize);
    return {
      items: paged,
      total: items.length,
      page,
      pageSize: effectivePageSize,
      hasMore: start + effectivePageSize < items.length,
    };
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    // 移动云没有公开的搜索API，通过遍历文档目录做本地关键词匹配
    const tocResult = await this.getDocumentToc(productId);
    const toc = tocResult.items;
    const lowerKeyword = keyword.toLowerCase();

    return toc
      .filter((item) => item.title.toLowerCase().includes(lowerKeyword))
      .map((item) => ({
        pageId: item.pageId,
        title: item.title,
        description: undefined,
      }));
  }

  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    // 使用API获取文章信息
    const data = await this.fetchApi<ArticleInfoResponse>(`${ARTICLE_INFO_API}/${pageId}`);

    if (data?.code === 200 && data.data) {
      const article = data.data;
      const updateDate = new Date(article.gmtModify).toISOString().split('T')[0].replace(/-/g, '/');

      return {
        pageId,
        title: article.title,
        note: `更新时间：${updateDate}`,
        contentPath: article.content,
      };
    }

    // 备用方案：从HTML页面获取
    const htmlUrl = `${HELP_CENTER_URL}/doc/article/${pageId}`;
    const html = await this.fetchHtml(htmlUrl);
    const $ = cheerio.load(html);

    const title = $("h1").first().text().trim() || $("title").text().trim() || "";

    return {
      pageId,
      title,
      note: "",
      contentPath: htmlUrl,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    let contentHtml: string;

    if (contentPath.startsWith("http")) {
      const match = contentPath.match(/\/article\/(\d+)/);
      if (!match) {
        return htmlToMarkdown(await this.fetchHtml(contentPath));
      }
      const articleId = match[1];
      const infoData = await this.fetchApi<ArticleInfoResponse>(`${ARTICLE_INFO_API}/${articleId}`);
      if (infoData?.code === 200 && infoData.data?.content) {
        contentPath = infoData.data.content;
      } else {
        return htmlToMarkdown(await this.fetchHtml(contentPath));
      }
    }

    const contentUrl = `${ARTICLE_CONTENT_API}/${contentPath}`;
    contentHtml = await this.fetchHtml(contentUrl);

    const $ = cheerio.load(contentHtml);
    const docContent = $("#doc-content-details");

    if (docContent.length > 0) {
      return htmlToMarkdown(docContent.html() || "");
    }

    return htmlToMarkdown(contentHtml);
  }

  /**
   * 从 Markdown 文本中解析价格表格
   * 移动云价格表格格式：
   * | 主机类型 | 规格名称 | vCPU | 内存 | ... | 按量（元/小时） | 包月（元/月） | 包年（元/年） |
   */
  private parsePriceTable(markdown: string, source: string): PriceItem[] {
    const lines = markdown.split("\n");
    const prices: PriceItem[] = [];
    let inTable = false;
    let headers: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith("|") && line.endsWith("|")) {
        const cells = line.split("|").slice(1, -1).map((c) => c.trim());
        while (cells.length > 0 && cells[0] === "") cells.shift();
        while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();

        if (!inTable) {
          inTable = true;
          headers = cells;
          continue;
        }

        if (cells.every((c) => /^-+\s*$/.test(c))) {
          continue;
        }

        if (cells.length < 2) continue;

        // 跳过纯数字行（vCPU 行）
        if (/^\d+$/.test(cells[0]) && cells.length < 3) continue;

        // 确定规格名称：查找包含点号或字母开头的列
        let specName = "";
        let specIdx = -1;
        for (let j = 0; j < cells.length; j++) {
          if (cells[j].includes(".") || /^[a-z]/i.test(cells[j])) {
            specName = cells[j];
            specIdx = j;
            break;
          }
        }
        if (!specName) continue;

        // 计算列偏移：headers 中规格名称的位置 vs cells 中规格名称的位置
        const headerSpecIdx = headers.findIndex(h => h.includes("规格") || h.includes("实例规格"));
        const offset = headerSpecIdx >= 0 ? specIdx - headerSpecIdx : 0;

        // 查找按量、包月、包年价格列
        for (let j = 0; j < headers.length; j++) {
          const cellIdx = j + offset;
          if (cellIdx < 0 || cellIdx >= cells.length) continue;

          const val = cells[cellIdx].replace(/,/g, "");
          const price = parseFloat(val);
          if (isNaN(price) || price <= 0) continue;

          const h = headers[j];
          if (h.includes("按量")) {
            prices.push({
              productName: specName,
              specification: specName,
              billingMode: "按量",
              price,
              unit: "元/小时",
              currency: "CNY",
              source,
            });
          } else if (h.includes("包月")) {
            prices.push({
              productName: specName,
              specification: specName,
              billingMode: "包年包月",
              price,
              unit: "元/月",
              currency: "CNY",
              source,
            });
          } else if (h.includes("包年")) {
            prices.push({
              productName: specName,
              specification: specName,
              billingMode: "包年包月",
              price,
              unit: "元/年",
              currency: "CNY",
              source,
            });
          }
        }
      } else {
        inTable = false;
        headers = [];
      }
    }

    return prices;
  }

  async getProductPrice(productId?: string, options?: PriceQueryOptions): Promise<PriceResult> {
    const result: PriceResult = {
      provider: this.provider,
      name: this.name,
      prices: [],
      source: `${HELP_CENTER_URL}/doc/category/${productId || ""}`,
    };

    if (!productId) {
      return result;
    }

    try {
      // 获取产品的文档目录，查找价格相关页面
      const tocResult = await this.getDocumentToc(productId);
      const toc = tocResult.items;

      // 查找包含"价格"、"计费"、"定价"或"云主机"的页面
      const pricePages = toc.filter(item =>
        item.title.includes("价格") ||
        item.title.includes("计费") ||
        item.title.includes("定价") ||
        item.title.includes("价格总览") ||
        item.title.includes("云主机")
      );

      // 如果没有找到，尝试已知的价格页面 ID
      const knownPricePages = pricePages.length > 0
        ? pricePages
        : [{ pageId: "41800", title: "通用型云主机" }]; // 已知的通用型云主机价格页面

      const pagesToFetch = knownPricePages.slice(0, 5);

      for (const page of pagesToFetch) {
        try {
          const meta = await this.getPageMetadata(page.pageId);
          const content = await this.getPageContent(meta.contentPath);
          const prices = this.parsePriceTable(content, meta.contentPath);
          if (prices.length > 0) {
            result.prices.push(...prices);
          }
        } catch {
          continue;
        }
      }

      if (result.prices.length > 0) {
        result.source = `${HELP_CENTER_URL}/doc/category/${productId}`;
      }

      // 关键词过滤
      let filteredPrices = result.prices;
      if (options?.keyword) {
        const keywords = options.keyword.trim().split(/\s+/).filter(Boolean);
        if (keywords.length > 0) {
          filteredPrices = result.prices.filter(item => {
            const text = (item.productName + " " + item.specification + " " + item.billingMode).toLowerCase();
            return keywords.every(kw => text.includes(kw.toLowerCase()));
          });
        }
      }

      // 分页
      const page = options?.page || 1;
      const pageSize = options?.pageSize || 100;
      const start = (page - 1) * pageSize;
      const paged = filteredPrices.slice(start, start + pageSize);

      result.prices = paged;
      result.total = filteredPrices.length;
      result.page = page;
      result.pageSize = pageSize;
      result.hasMore = start + pageSize < filteredPrices.length;
    } catch {
      // Return empty prices if unable to fetch
    }

    // 标记数据状态
    if (result.prices.length > 0 && result.prices[0].price > 0) {
      result.dataStatus = "complete";
    } else if (result.prices.length > 0 && result.prices[0].price === 0) {
      result.dataStatus = "no_price";
    } else {
      result.dataStatus = "no_data";
    }

    return result;
  }
}
