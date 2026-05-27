import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const BASE_URL = "https://help.aliyun.com";

export class BailianAdapter extends CloudDocAdapter {
  readonly provider = "bailian";
  readonly name = "阿里云百炼";

  private async fetchHtml(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.text();
  }

  async listProducts(): Promise<Product[]> {
    // 百炼产品在阿里云帮助中心的 alias 为 /model-studio
    return [
      {
        productId: "model-studio",
        name: "大模型服务平台百炼",
        description: "阿里云百炼大模型服务平台文档",
      },
    ];
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
    // 百炼的 product.json API 返回 302 重定向，需从首页 HTML 解析目录
    const url = `${BASE_URL}/zh/model-studio/`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const items: TocItem[] = [];

    // 阿里云帮助中心左侧导航通常在 .sidebar 或 .nav 容器中
    // 查找所有导航链接，提取目录结构
    const extractNavLinks = ($: cheerio.CheerioAPI, container: any): TocItem[] => {
      const result: TocItem[] = [];
      const $container = $(container);

      // 查找所有 a 标签，筛选帮助中心内的链接
      $container.find("a").each((_, el) => {
        const $el = $(el);
        const href = $el.attr("href");
        const text = $el.text().trim();

        if (href && text && href.startsWith("/zh/model-studio/")) {
          // 过滤掉外部链接和锚点链接
          const pageId = href;
          result.push({
            pageId,
            title: text,
          });
        }
      });

      return result;
    };

    // 尝试多种选择器找到导航区域
    const sidebarSelectors = [
      ".sidebar-nav",
      ".sidebar",
      ".nav-sidebar",
      ".help-sidebar",
      "[class*='sidebar']",
      "nav",
      ".menu",
    ];

    for (const selector of sidebarSelectors) {
      const container = $(selector).first();
      if (container.length > 0) {
        const extracted = extractNavLinks($, container[0]);
        if (extracted.length > 0) {
          // 去重
          const seen = new Set<string>();
          for (const item of extracted) {
            if (!seen.has(item.pageId)) {
              seen.add(item.pageId);
              items.push(item);
            }
          }
          break;
        }
      }
    }

    // 如果上述选择器都没找到，尝试更通用的方式
    if (items.length === 0) {
      $("a").each((_, el) => {
        const $el = $(el);
        const href = $el.attr("href");
        const text = $el.text().trim();

        if (href && text && href.startsWith("/zh/model-studio/") && !href.includes("#")) {
          // 过滤掉可能的面包屑和页脚链接
          const parent = $el.parent();
          const parentTag = parent[0]?.tagName?.toLowerCase();
          if (parentTag === "li" || parentTag === "div" || parentTag === "span") {
            const pageId = href;
            if (!items.some((item) => item.pageId === pageId)) {
              items.push({
                pageId,
                title: text,
              });
            }
          }
        }
      });
    }

    return items;
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    // 遍历目录做本地关键词匹配
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
    // pageId 是文档路径，如 /zh/model-studio/what-is-model-studio
    const url = `${BASE_URL}${pageId}`;
    const html = await this.fetchHtml(url);
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

  async getPageContent(contentPath: string): Promise<string> {
    const html = await this.fetchHtml(contentPath);
    return htmlToMarkdown(html);
  }

  /**
   * 从 Markdown 文本中解析价格表格
   */
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

  async getProductPrice(productId?: string, _options?: { region?: string; billingMode?: string }): Promise<PriceResult> {
    const url = `${BASE_URL}/zh/model-studio/billing`;
    const html = await this.fetchHtml(url);
    const markdown = htmlToMarkdown(html);
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
