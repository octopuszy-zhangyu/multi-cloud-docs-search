import * as cheerio from "cheerio";
import type {
  ListForHelpResponse,
  ContentQueryResponse,
  PageMetadataResponse,
} from "../types.js";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult } from "./base.js";

const BASE_URL = "https://www.ctyun.cn";

export class CtyunAdapter extends CloudDocAdapter {
  readonly provider = "ctyun";
  readonly name = "天翼云";

  private async request<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(`API request failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async listProducts(): Promise<Product[]> {
    const url = `${BASE_URL}/v2/portal/book/ListForHelp?bookClassDomain=product&_t=${Date.now()}`;
    const raw = await this.request<ListForHelpResponse>(url);
    const result: Product[] = [];
    for (const cat of raw.data?.list ?? []) {
      for (const p of cat.list) {
        result.push({
          productId: p.bookId,
          name: this.clean(p.bookName),
          description: this.clean(p.note),
        });
      }
    }
    return result;
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
    const res = await fetch(`${BASE_URL}/document/${productId}/`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const items: TocItem[] = [];
    const linkPattern = new RegExp(`^/document/${productId}/(\\d+)$`);

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const match = href.match(linkPattern);
      if (match) {
        const pageId = match[1];
        const title = $(el).text().trim();
        if (title && !items.some((i) => i.pageId === pageId)) {
          items.push({ pageId, title });
        }
      }
    });

    return items;
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const url = `${BASE_URL}/v2/portal/book/ContentQuery?bookId=${productId}&keyword=${encodeURIComponent(keyword)}&_t=${Date.now()}`;
    const raw = await this.request<ContentQueryResponse>(url);
    return (raw.data?.pages ?? []).map((p) => ({
      pageId: p.pageId,
      title: p.title,
      description: p.note,
    }));
  }

  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    const url = `${BASE_URL}/v2/portal/book/page/Get?pageId=${pageId}&_t=${Date.now()}`;
    const raw = await this.request<PageMetadataResponse>(url);
    const d = raw.data;
    return {
      pageId: d.pageId,
      title: d.title,
      note: d.note,
      contentPath: d.contentPath,
      chapterId: d.chapterId,
      bookId: String(d.bookId),
      updateDate: d.updateDateShow,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    const res = await fetch(contentPath, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(`Content fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.text();
  }

  /** 清理字符串中的 HTML 标签和特殊字符 */
  private clean(str: string): string {
    if (!str) return "";
    let result = str.replace(/<[^>]*>/g, "");
    result = result.replace(/&[a-zA-Z]+;/g, " ");
    result = result.replace(/[\n\r\t]/g, " ");
    result = result.replace(/\\/g, "");
    result = result.replace(/\s+/g, " ").trim();
    return result;
  }

  /**
   * 从 Markdown 文本中解析价格表格
   *
   * 识别 Markdown 表格行（以 | 开头和结尾），
   * 跳过表头行和分隔行，将第一列作为产品名，最后一列作为价格。
   */
  private parsePriceTable(markdown: string, source: string): PriceItem[] {
    const prices: PriceItem[] = [];
    const lines = markdown.split("\n");
    let inTable = false;
    let headerLine = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // 检测 Markdown 表格行：以 | 开头和结尾
      if (!line.startsWith("|") || !line.endsWith("|")) {
        inTable = false;
        continue;
      }

      // 跳过分隔行（如 | --- | --- |）
      if (/^\|[\s\-:]+\|$/.test(line) || line.replace(/[^|]/g, "").length <= 2) {
        continue;
      }

      if (!inTable) {
        // 第一行是表头
        headerLine = line;
        inTable = true;
        continue;
      }

      // 数据行
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      if (cells.length < 2) continue;

      const productName = cells[0];
      const lastCell = cells[cells.length - 1];

      // 尝试从最后一列提取价格数字
      const priceMatch = lastCell.match(/[\d,]+(?:\.\d+)?/);
      if (!priceMatch) continue;

      const price = parseFloat(priceMatch[0].replace(/,/g, ""));
      if (isNaN(price)) continue;

      // 判断计费模式
      const billingMode = lastCell.includes("包") || lastCell.includes("月") || lastCell.includes("年")
        ? "包年包月"
        : lastCell.includes("按量") || lastCell.includes("小时") || lastCell.includes("秒")
          ? "按量计费"
          : "未知";

      // 判断单位
      let unit = "月";
      if (lastCell.includes("小时") || lastCell.includes("/h")) unit = "小时";
      else if (lastCell.includes("天")) unit = "天";
      else if (lastCell.includes("年")) unit = "年";
      else if (lastCell.includes("次")) unit = "次";
      else if (lastCell.includes("GB") || lastCell.includes("G")) unit = "GB";

      // 判断币种
      const currency = lastCell.includes("$") || lastCell.includes("美元") ? "USD" : "CNY";

      prices.push({
        productName,
        specification: cells.length > 2 ? cells.slice(1, -1).join(" / ") : "",
        billingMode,
        price,
        unit,
        currency,
        source,
      });
    }

    return prices;
  }

  /**
   * 获取产品价格信息
   *
   * 通过搜索产品文档中的"价格"、"计费"相关页面，
   * 获取页面内容并解析价格表格。
   */
  async getProductPrice(productId?: string, _options?: { region?: string; billingMode?: string }): Promise<PriceResult> {
    const result: PriceResult = {
      provider: this.provider,
      name: this.name,
      prices: [],
      source: `${BASE_URL}/document/`,
      updateDate: new Date().toISOString().split("T")[0],
    };

    if (!productId) {
      return result;
    }

    try {
      // 搜索计费相关文档
      const billingPages = await this.searchDocuments(productId, "价格");
      const billingPages2 = await this.searchDocuments(productId, "计费");
      const allPages = [...billingPages, ...billingPages2];

      // 去重
      const seen = new Set<string>();
      const uniquePages = allPages.filter((p) => {
        if (seen.has(p.pageId)) return false;
        seen.add(p.pageId);
        return true;
      });

      // 优先选择标题包含"价格"或"计费"的页面
      const priorityPages = uniquePages.filter(
        (p) =>
          p.title.includes("价格") ||
          p.title.includes("计费") ||
          p.title.includes("定价") ||
          p.title.includes("收费")
      );

      const pagesToFetch = priorityPages.length > 0 ? priorityPages.slice(0, 3) : uniquePages.slice(0, 3);

      for (const page of pagesToFetch) {
        try {
          const metadata = await this.getPageMetadata(page.pageId);
          if (!metadata.contentPath) continue;

          // 获取页面 HTML 内容
          const html = await this.getPageContent(metadata.contentPath);
          const $ = cheerio.load(html);

          // 提取表格并转换为 Markdown 表格格式
          $("table").each((_, table) => {
            const rows: string[] = [];
            $(table)
              .find("tr")
              .each((_, tr) => {
                const cells: string[] = [];
                $(tr)
                  .find("th, td")
                  .each((_, cell) => {
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
              const parsed = this.parsePriceTable(tableMd, metadata.contentPath);
              result.prices.push(...parsed);
            }
          });
        } catch {
          // 跳过解析失败的页面
          continue;
        }
      }
    } catch {
      // 如果搜索失败，返回空结果
    }

    return result;
  }
}