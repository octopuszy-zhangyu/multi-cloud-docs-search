import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type TocOptions, type PriceQueryOptions } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const BASE_URL = "https://help.aliyun.com";

interface LlmsEntry {
  title: string;
  path: string;
  description?: string;
}

export class AliyunAdapter extends CloudDocAdapter {
  readonly provider = "aliyun";
  readonly name = "阿里云";

  /**
   * 解析 llms.txt 格式的文档索引
   *
   * 格式: - [标题](URL): 描述
   */
  private parseLlmsTxt(text: string): LlmsEntry[] {
    const entries: LlmsEntry[] = [];
    const lines = text.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)(?:\s*:\s*(.*))?$/);
      if (match) {
        const title = match[1].trim();
        const url = match[2].trim();
        const description = match[3]?.trim();

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

        entries.push({ title, path, description });
      }
    }

    return entries;
  }

  /**
   * 从根 llms.txt 获取所有产品列表
   *
   * 根 llms.txt 中产品级条目指向 /zh/{productId}/llms.txt
   */
  async listProducts(): Promise<Product[]> {
    const text = await this.fetchText(`${BASE_URL}/llms.txt`);
    const entries = this.parseLlmsTxt(text);

    const products: Product[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      const productMatch = entry.path.match(/^\/zh\/([^/]+)\/llms\.txt$/);
      if (productMatch) {
        const productId = productMatch[1];
        if (!seen.has(productId)) {
          seen.add(productId);
          products.push({
            productId,
            name: entry.title,
            description: entry.description,
          });
        }
      }
    }

    return products;
  }

  /**
   * 从产品级 llms.txt 获取文档目录
   */
  async getDocumentToc(productId: string, options?: TocOptions): Promise<TocItem[]> {
    const text = await this.fetchText(`${BASE_URL}/zh/${productId}/llms.txt`);
    const entries = this.parseLlmsTxt(text);

    const items: TocItem[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      if (!seen.has(entry.path)) {
        seen.add(entry.path);
        items.push({ pageId: entry.path, title: entry.title });
      }
    }

    // 关键词过滤
    if (options?.keyword) {
      const keywords = options.keyword.trim().split(/\s+/).filter(Boolean);
      if (keywords.length > 0) {
        return items.filter(item => {
          const text = (item.title || "").toLowerCase();
          return keywords.every(kw => text.includes(kw.toLowerCase()));
        });
      }
    }

    return items;
  }

  /**
   * 从产品级 llms.txt 搜索文档（标题+描述匹配）
   * 当搜索结果为空时，自动尝试去掉具体规格词后重试
   */
  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const text = await this.fetchText(`${BASE_URL}/zh/${productId}/llms.txt`);
    const entries = this.parseLlmsTxt(text);
    const lowerKeyword = keyword.toLowerCase();

    const results: SearchResult[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);

      if (
        entry.title.toLowerCase().includes(lowerKeyword) ||
        (entry.description && entry.description.toLowerCase().includes(lowerKeyword))
      ) {
        results.push({
          pageId: entry.path,
          title: entry.title,
          description: entry.description,
        });
      }
    }

    // 关键词自动扩展：当搜索结果为空且关键词包含具体规格时，尝试去掉规格词重试
    if (results.length === 0) {
      const keywords = keyword.trim().split(/\s+/).filter(Boolean);
      if (keywords.length > 1) {
        // 过滤掉看起来像具体规格的词（包含数字+字母组合、纯数字、具体配置描述）
        const specPattern = /^[\d.]+[cCgGmMkKtTbB]*$|^\d+[cC]\d+[gG]$|^\d+Mbps$|^\d+M$/;
        const coreKeywords = keywords.filter(kw => !specPattern.test(kw) && !/^\d+$/.test(kw));

        if (coreKeywords.length > 0 && coreKeywords.length < keywords.length) {
          const coreKeyword = coreKeywords.join(" ");
          const coreResults = await this.searchDocuments(productId, coreKeyword);
          if (coreResults.length > 0) {
            return coreResults;
          }
        }
      }
    }

    return results;
  }

  /**
   * 获取页面元信息
   *
   * pageId 是文档路径（如 /zh/ecs/user-guide/what-is-ecs.md），
   * 去掉 .md 后缀后获取 HTML 页面提取标题和描述。
   */
  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    // 去掉 .md 后缀，获取 HTML 页面
    const htmlPath = pageId.replace(/\.md$/, "");
    const url = `${BASE_URL}${htmlPath}`;
    const html = await this.fetchText(url);
    const $ = cheerio.load(html);

    const title = $("title").text().trim() || $("h1").first().text().trim() || "";
    const description = $('meta[name="description"]').attr("content") || "";

    return {
      pageId,
      title,
      note: description,
      contentPath: url,
    };
  }

  /**
   * 获取文档 Markdown 正文
   *
   * 阿里云的 .md 文件实际包含 HTML 内容，需要 HTML 转 Markdown。
   */
  async getPageContent(contentPath: string): Promise<string> {
    // 尝试获取 .md 文件（阿里云 .md 文件实际是 HTML 内容）
    const mdUrl = contentPath.endsWith(".md") ? contentPath : `${contentPath}.md`;
    const url = mdUrl.startsWith("http") ? mdUrl : `${BASE_URL}${mdUrl}`;

    const content = await this.fetchText(url);
    return htmlToMarkdown(content);
  }

  private parsePriceTable(markdown: string): PriceItem[] {
    const prices: PriceItem[] = [];
    const lines = markdown.split("\n");
    let inTable = false;

    for (const line of lines) {
      if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        const cells = line.split("|").map((c) => c.trim()).filter(Boolean);

        if (!inTable) {
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
              unit: "元/月",
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

  async getProductPrice(productId?: string, _options?: PriceQueryOptions): Promise<PriceResult> {
    const prices: PriceItem[] = [];
    let source = `${BASE_URL}/price`;
    let updateDate: string | undefined;

    if (productId) {
      // 尝试获取产品定价文档
      const priceUrls = [
        `${BASE_URL}/zh/${productId}/billing.md`,
        `${BASE_URL}/zh/${productId}/pricing.md`,
        `${BASE_URL}/zh/${productId}/price.md`,
      ];

      for (const url of priceUrls) {
        try {
          const content = await this.fetchText(url);
          const markdown = htmlToMarkdown(content);
          const parsed = this.parsePriceTable(markdown);
          if (parsed.length > 0) {
            prices.push(...parsed);
            source = url;
            break;
          }
        } catch {
          continue;
        }
      }

      // 如果文档中没有价格表，尝试从阿里云独立定价页面抓取
      if (prices.length === 0) {
        try {
          const pricePageUrl = `${BASE_URL}/zh/${productId}/billing`;
          const html = await this.fetchText(pricePageUrl);
          const $ = cheerio.load(html);

          // 尝试从页面中提取价格表格
          $("table").each((_, table) => {
            const rows: string[] = [];
            $(table).find("tr").each((_, tr) => {
              const cells: string[] = [];
              $(tr).find("th, td").each((_, cell) => {
                cells.push($(cell).text().trim().replace(/\s+/g, " "));
              });
              if (cells.length > 0) {
                rows.push("| " + cells.join(" | ") + " |");
              }
            });

            if (rows.length > 1) {
              const headerCells = rows[0].split("|").filter((_, i, arr) => i > 0 && i < arr.length - 1);
              const separator = "| " + headerCells.map(() => "---").join(" | ") + " |";
              rows.splice(1, 0, separator);
              const tableMd = rows.join("\n");
              const parsed = this.parsePriceTable(tableMd);
              if (parsed.length > 0) {
                prices.push(...parsed);
                source = pricePageUrl;
              }
            }
          });

          // 如果表格解析失败，尝试从页面文本中提取价格信息
          if (prices.length === 0) {
            const bodyText = $("body").text();
            // 匹配类似 "ecs.g7.xlarge：0.42元/小时" 或 "2核4G 251元/月" 的价格模式
            const pricePatterns = [
              /([a-zA-Z0-9_.-]+)[：:]\s*(\d+\.?\d*)\s*元\/([^，,\s]+)/g,
              /(\d+核\d+[Gg])\s*(\d+\.?\d*)\s*元\/([^，,\s]+)/g,
            ];

            for (const pattern of pricePatterns) {
              let match;
              while ((match = pattern.exec(bodyText)) !== null) {
                const spec = match[1].trim();
                const price = parseFloat(match[2]);
                const unit = match[3].trim();

                if (!isNaN(price) && price > 0) {
                  prices.push({
                    productName: productId,
                    specification: spec,
                    billingMode: unit.includes("小时") || unit.includes("h") ? "按量" : "包年包月",
                    price,
                    unit: `元/${unit}`,
                    currency: "CNY",
                    source: pricePageUrl,
                    note: "从文档页面提取的价格，可能为示例价格，实际价格以官网定价页为准",
                  });
                }
              }
            }
          }
        } catch {
          // 定价页面抓取失败不影响结果
        }
      }

      // 如果仍然没有价格数据，添加明确的提示信息
      if (prices.length === 0) {
        prices.push({
          productName: productId,
          specification: "",
          billingMode: "",
          price: 0,
          unit: "",
          currency: "CNY",
          source: "https://www.aliyun.com/price/product",
          note: "【重要】阿里云 ECS 文档中只有计费模式说明（包年包月、按量付费、预留实例券等），不包含具体实例规格价格。ECS 实例价格位于独立的定价计算器页面，请访问 https://www.aliyun.com/price/product 选择地域和实例规格后查询实时价格。",
        });
      }
    }

    return {
      provider: this.provider,
      name: this.name,
      prices,
      source: productId ? `${BASE_URL}/zh/${productId}/billing` : `${BASE_URL}/price`,
      updateDate,
    };
  }
}
