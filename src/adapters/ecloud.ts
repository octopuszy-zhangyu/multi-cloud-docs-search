import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata } from "./base";
import { htmlToMarkdown } from "../utils/html-to-md";

const BASE_URL = "https://ecloud.10086.cn";
const HELP_CENTER_URL = `${BASE_URL}/op-help-center`;
const CATEGORY_TREE_API = `${HELP_CENTER_URL}/request-api/service-api/category/tree`;
const OUTLINE_TREE_API = `${HELP_CENTER_URL}/request-api/service-api/outline/tree`;

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

export class EcloudAdapter extends CloudDocAdapter {
  readonly provider = "ecloud";
  readonly name = "移动云";

  private async fetchHtml(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.text();
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "categoryrootparent": "0",
        "ispreview": "false",
        "tentid": "0",
        "Referer": HELP_CENTER_URL,
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async listProducts(): Promise<Product[]> {
    const data = await this.fetchJson<CategoryTreeResponse>(CATEGORY_TREE_API);
    const products: Product[] = [];
    const seen = new Set<string>();

    // 递归提取所有叶子节点（产品）
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

    if (data.data?.children) {
      extractProducts(data.data.children, "");
    }

    return products;
  }

  private async getOutlineId(productId: string): Promise<number | null> {
    const data = await this.fetchJson<CategoryTreeResponse>(CATEGORY_TREE_API);
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

    if (data.data?.children) {
      findOutlineId(data.data.children);
    }

    return outlineId;
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
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

      return items;
    }

    const url = `${OUTLINE_TREE_API}?outlineId=${outlineId}`;
    const data = await this.fetchJson<OutlineTreeResponse>(url);

    const items: TocItem[] = [];
    const seen = new Set<string>();

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

    return items;
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    // 移动云没有公开的搜索API，通过遍历文档目录做本地关键词匹配
    const toc = await this.getDocumentToc(productId);
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
    const url = `${HELP_CENTER_URL}/doc/article/${pageId}`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $("h1").first().text().trim() || $("title").text().trim() || "";

    // 从页面中提取更新时间
    const updateTime = $("body").text().match(/更新时间[：:]\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/)?.[1] || "";

    return {
      pageId,
      title,
      note: updateTime ? `更新时间：${updateTime}` : "",
      contentPath: url,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    const html = await this.fetchHtml(contentPath);
    const $ = cheerio.load(html);

    // 提取文档正文内容区域
    // 主要内容在 .main-container 中
    const content = $(".main-container").first();
    if (content.length > 0) {
      // 去除不需要的元素
      content.find("script, style, .breadcrumb, .top-banner, .cloud-header, .engine-drawer-container, .top-btn, footer").remove();
      return htmlToMarkdown(content.html() || "");
    }

    // 备用方案：提取 article 或 main 标签
    const article = $("article").first();
    if (article.length > 0) {
      return htmlToMarkdown(article.html() || "");
    }

    return htmlToMarkdown(html);
  }
}
