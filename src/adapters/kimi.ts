import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type PaginatedResult, type ListProductsOptions, type TocOptions } from "./base.js";

const BASE_URL = "https://platform.kimi.com";
const LLMS_TXT_URL = `${BASE_URL}/docs/llms.txt`;

/**
 * 月之暗面 Kimi 开放平台文档适配器
 *
 * Kimi 文档站基于 Mintlify 框架，文档页面以 .md 格式提供原始 Markdown 内容。
 * 文档索引通过 llms.txt 文件获取，该文件列出所有文档页面的标题和路径。
 */
export class KimiAdapter extends CloudDocAdapter {
  readonly provider = "kimi";
  readonly name = "月之暗面 Kimi";

  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/plain, text/markdown, text/html",
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText} for ${url}`);
    }
    return res.text();
  }

  /**
   * Kimi 只有一个产品：Kimi API 文档
   */
  async listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>> {
    const allProducts: Product[] = [
      {
        productId: "kimi-api",
        name: "Kimi API 文档",
        description: "月之暗面 Kimi 开放平台 API 文档",
      },
    ];

    const filtered = this.filterByKeywords(allProducts, options?.keyword);
    return this.paginate(filtered, options?.page ?? 1, options?.pageSize ?? 100);
  }

  /**
   * 从 llms.txt 解析文档目录
   *
   * llms.txt 格式：
   *   # 分类标题
   *   - 页面标题: /docs/page-path
   *   - 页面标题: /docs/page-path: 描述
   */
  async getDocumentToc(productId: string, options?: TocOptions): Promise<PaginatedResult<TocItem>> {
    const text = await this.fetchText(LLMS_TXT_URL);
    const lines = text.split("\n");

    const items: TocItem[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      // 页面条目行: - [标题](URL) 或 - [标题](URL): 描述
      // URL 可能是完整 URL (https://platform.kimi.com/docs/...) 或相对路径 (/docs/...)
      const itemMatch = trimmed.match(/^-\s+\[([^\]]+)\]\(([^)]+)\)(?::\s*(.*))?$/);
      if (itemMatch) {
        const title = itemMatch[1].trim();
        const url = itemMatch[2].trim();

        // 提取路径部分（去掉域名）
        let path: string;
        if (url.startsWith("http")) {
          try {
            path = new URL(url).pathname;
          } catch {
            path = url;
          }
        } else {
          path = url;
        }

        items.push({
          pageId: path,
          title,
        });
      }
    }

    const filtered = this.filterByKeywords(items, options?.keyword);

    // 如果 topOnly 为 true，剥离 children
    const topItems = options?.topOnly
      ? filtered.map(({ children: _, ...item }) => item)
      : filtered;

    return this.paginate(topItems, options?.page ?? 1, options?.pageSize ?? 200);
  }

  /**
   * 遍历文档目录，按标题匹配关键词
   */
  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const toc = await this.getDocumentToc(productId);
    const lowerKeyword = keyword.toLowerCase();

    const results: SearchResult[] = [];

    for (const item of toc.items) {
      if (item.title.toLowerCase().includes(lowerKeyword)) {
        results.push({
          pageId: item.pageId,
          title: item.title,
        });
      }
    }

    return results;
  }

  /**
   * 获取页面元信息
   *
   * 通过请求 .md 页面获取原始 Markdown 内容，从第一个 # 标题提取页面标题。
   * pageId 格式为 /docs/page-path（如 /docs/api/overview.md）。
   */
  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    // 确保 pageId 以 .md 结尾
    const mdPath = pageId.endsWith(".md") ? pageId : `${pageId}.md`;
    const url = `${BASE_URL}${mdPath}`;

    const content = await this.fetchText(url);

    // 从 Markdown 内容中提取标题（第一个 # 开头的行）
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : pageId.split("/").pop()?.replace(/\.md$/, "") || pageId;

    // 提取描述（# 标题后的第一段非空文本）
    const descMatch = content.match(/^#\s+.+?\n\n(.+?)(?:\n\n|\n#)/s);
    const description = descMatch ? descMatch[1].trim().replace(/\n/g, " ") : undefined;

    return {
      pageId,
      title,
      note: description,
      contentPath: url,
      updateDate: undefined,
    };
  }

  /**
   * 获取文档页面 Markdown 正文
   *
   * Kimi 文档站直接返回原始 Markdown 内容，无需 HTML 转换。
   * contentPath 为完整的 .md 页面 URL。
   */
  async getPageContent(contentPath: string): Promise<string> {
    // 如果 contentPath 是相对路径，补全为完整 URL
    const url = contentPath.startsWith("http") ? contentPath : `${BASE_URL}${contentPath}`;

    const content = await this.fetchText(url);

    // 移除 llms.txt 风格的索引提示行（以 > 开头的行）
    const cleaned = content
      .split("\n")
      .filter((line) => !line.trim().startsWith("> ##"))
      .join("\n")
      .trim();

    return cleaned || "(空内容)";
  }

  /**
   * 按关键词过滤条目（AND 逻辑，大小写不敏感）
   */
  private filterByKeywords<T extends { name?: string; title?: string }>(items: T[], keyword?: string): T[] {
    if (!keyword) return items;
    const keywords = keyword.trim().split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return items;
    return items.filter((item) => {
      const text = (item.name || item.title || "").toLowerCase();
      return keywords.every((kw) => text.includes(kw.toLowerCase()));
    });
  }

  /**
   * 对数组进行分页包装
   */
  private paginate<T>(items: T[], page: number = 1, pageSize: number = 100): PaginatedResult<T> {
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
   * 从 Markdown 表格中解析价格数据
   */
  private parsePriceTable(markdown: string): PriceItem[] {
    const prices: PriceItem[] = [];
    const lines = markdown.split("\n");
    let inTable = false;
    let headers: string[] = [];

    for (const line of lines) {
      if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        const cells = line.split("|").map((c) => c.trim()).filter(Boolean);

        if (!inTable) {
          headers = cells;
          inTable = true;
          continue;
        }

        if (cells.every((c) => /^[-:\s]+$/.test(c))) {
          continue;
        }

        if (cells.length >= 2) {
          const productName = cells[0] || "";
          const priceStr = cells[cells.length - 1] || "0";
          const price = parseFloat(priceStr.replace(/[^0-9.]/g, ""));
          const spec = cells.length > 2 ? cells.slice(1, -1).join(" / ") : "";

          if (!isNaN(price)) {
            prices.push({
              productName,
              specification: spec,
              billingMode: "按量",
              price,
              unit: "元/百万Token",
              currency: "CNY",
              source: "文档定价页面",
            });
          }
        }
        continue;
      }

      if (inTable && line.trim() !== "") {
        inTable = false;
      }
    }

    return prices;
  }

  async getProductPrice(productId?: string): Promise<PriceResult> {
    const url = `${BASE_URL}/docs/pricing.md`;
    const markdown = await this.fetchText(url);
    const prices = this.parsePriceTable(markdown);

    return {
      provider: this.provider,
      name: this.name,
      prices,
      source: url,
      updateDate: undefined,
    };
  }
}
