import * as cheerio from "cheerio";
import type {
  ListForHelpResponse,
  ContentQueryResponse,
  PageMetadataResponse,
} from "../types.js";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type PaginatedResult, type ListProductsOptions, type TocOptions, type PriceQueryOptions } from "./base.js";

const BASE_URL = "https://www.ctyun.cn";

export class CtyunAdapter extends CloudDocAdapter {
  readonly provider = "ctyun";
  readonly name = "天翼云";

  async listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>> {
    const url = `${BASE_URL}/v2/portal/book/ListForHelp?bookClassDomain=product&_t=${Date.now()}`;
    const raw = await this.fetchJson<ListForHelpResponse>(url);
    let result: Product[] = [];
    for (const cat of raw.data?.list ?? []) {
      for (const p of cat.list) {
        result.push({
          productId: p.bookId,
          name: this.clean(p.bookName),
          description: this.clean(p.note),
        });
      }
    }
    result = this.filterByKeywords(result, options?.keyword);
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 100;
    return this.paginate(result, page, pageSize);
  }

  async getDocumentToc(productId: string, options?: TocOptions): Promise<PaginatedResult<TocItem>> {
    const html = await this.fetchHtml(`${BASE_URL}/document/${productId}/`);
    const $ = cheerio.load(html);
    let items: TocItem[] = [];
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

    items = this.filterByKeywords(items, options?.keyword);

    if (options?.topOnly) {
      items = items.map(({ children, ...rest }) => rest);
    }

    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 200;
    return this.paginate(items, page, pageSize);
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const url = `${BASE_URL}/v2/portal/book/ContentQuery?bookId=${productId}&keyword=${encodeURIComponent(keyword)}&_t=${Date.now()}`;
    const raw = await this.fetchJson<ContentQueryResponse>(url);
    return (raw.data?.pages ?? []).map((p) => ({
      pageId: p.pageId,
      title: p.title,
      description: p.note,
    }));
  }

  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    const url = `${BASE_URL}/v2/portal/book/page/Get?pageId=${pageId}&_t=${Date.now()}`;
    const raw = await this.fetchJson<PageMetadataResponse>(url);
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
    const res = await this.fetchWithRetry(contentPath, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(`Content fetch failed: ${res.status} ${res.statusText}`);
    }
    // 天翼云页面可能使用 GBK 编码，需要检测并正确解码
    const contentType = res.headers.get("content-type") || "";
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // 检测 HTML 中声明的编码
    const decoder = new TextDecoder("utf-8");
    const htmlStart = decoder.decode(bytes.slice(0, 1024));
    const charsetMatch = htmlStart.match(/charset\s*=\s*["']?([^"'\s>]+)/i);
    const encoding = charsetMatch ? charsetMatch[1].toLowerCase() : contentType.includes("charset=")
      ? contentType.split("charset=")[1].split(";")[0].trim().toLowerCase()
      : "utf-8";

    try {
      return new TextDecoder(encoding === "gbk" || encoding === "gb2312" || encoding === "gb18030" ? "gbk" : encoding).decode(bytes);
    } catch {
      // 如果指定编码不支持，回退到 utf-8
      return decoder.decode(bytes);
    }
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

  /** 按关键词过滤项目（AND 逻辑） */
  private filterByKeywords<T extends { name?: string; title?: string }>(items: T[], keyword?: string): T[] {
    if (!keyword) return items;
    const keywords = keyword.trim().split(/\s+/).filter(Boolean);
    if (keywords.length === 0) return items;
    return items.filter((item) => {
      const text = (item.name || item.title || "").toLowerCase();
      return keywords.every((kw) => text.includes(kw.toLowerCase()));
    });
  }

  /** 分页处理 */
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
   * 当文档中只有组件单价（CPU、内存单价）时，自动计算常见规格的总价。
   */
  async getProductPrice(productId?: string, _options?: PriceQueryOptions): Promise<PriceResult> {
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

      // 自动计算常见规格总价（当文档只有组件单价时）
      result.prices.push(...this.calculateCommonSpecs(result.prices, result.source));
    } catch {
      // 如果搜索失败，返回空结果
    }

    return result;
  }

  /**
   * 从组件单价自动计算常见规格的总价
   *
   * 天翼云文档通常以组件单价形式展示（CPU 单价、内存单价），
   * 此方法自动计算常见规格（2C4G、4C8G、8C16G 等）的总价。
   */
  private calculateCommonSpecs(prices: PriceItem[], source: string): PriceItem[] {
    const calculatedPrices: PriceItem[] = [];

    // 查找 CPU 单价和内存单价
    let cpuPrice = 0;
    let memPrice = 0;
    let cpuUnit = "";
    let memUnit = "";
    let billingMode = "包年包月";

    for (const p of prices) {
      const spec = (p.specification || "").toLowerCase();
      const unit = p.unit || "";

      // 匹配 CPU 单价（包含 "cpu" 或 "核"）
      if (spec.includes("cpu") || spec.includes("核")) {
        cpuPrice = p.price;
        cpuUnit = unit;
        billingMode = p.billingMode;
      }

      // 匹配内存单价（包含 "内存" 或 "mem" 或 "gb"）
      if (spec.includes("内存") || spec.includes("mem") || spec.includes("gb")) {
        memPrice = p.price;
        memUnit = unit;
      }
    }

    // 如果找到了 CPU 和内存单价，计算常见规格
    if (cpuPrice > 0 && memPrice > 0) {
      // 常见规格配置
      const commonSpecs = [
        { cpu: 1, mem: 1, name: "1C1G" },
        { cpu: 1, mem: 2, name: "1C2G" },
        { cpu: 2, mem: 2, name: "2C2G" },
        { cpu: 2, mem: 4, name: "2C4G" },
        { cpu: 2, mem: 8, name: "2C8G" },
        { cpu: 4, mem: 4, name: "4C4G" },
        { cpu: 4, mem: 8, name: "4C8G" },
        { cpu: 4, mem: 16, name: "4C16G" },
        { cpu: 8, mem: 8, name: "8C8G" },
        { cpu: 8, mem: 16, name: "8C16G" },
        { cpu: 8, mem: 32, name: "8C32G" },
        { cpu: 16, mem: 16, name: "16C16G" },
        { cpu: 16, mem: 32, name: "16C32G" },
        { cpu: 16, mem: 64, name: "16C64G" },
      ];

      // 统一单位为 "元/月"
      let cpuMonthlyPrice = cpuPrice;
      let memMonthlyPrice = memPrice;

      // 如果是按小时价格，转换为按月价格（假设 30 天 * 24 小时 = 720 小时）
      if (cpuUnit.includes("小时")) {
        cpuMonthlyPrice = cpuPrice * 720;
      } else if (cpuUnit.includes("年")) {
        cpuMonthlyPrice = cpuPrice / 12;
      }

      if (memUnit.includes("小时")) {
        memMonthlyPrice = memPrice * 720;
      } else if (memUnit.includes("年")) {
        memMonthlyPrice = memPrice / 12;
      }

      for (const spec of commonSpecs) {
        const totalPrice = cpuMonthlyPrice * spec.cpu + memMonthlyPrice * spec.mem;
        calculatedPrices.push({
          productName: `云主机 ${spec.name}`,
          specification: spec.name,
          billingMode,
          price: Math.round(totalPrice * 100) / 100,
          unit: "元/月",
          currency: "CNY",
          source,
          note: `由组件单价计算得出（CPU ${cpuPrice}${cpuUnit} × ${spec.cpu}核 + 内存 ${memPrice}${memUnit} × ${spec.mem}GB）`,
        });
      }
    }

    return calculatedPrices;
  }
}