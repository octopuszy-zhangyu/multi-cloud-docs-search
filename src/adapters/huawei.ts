import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata } from "./base";
import { htmlToMarkdown } from "../utils/html-to-md";

const BASE_URL = "https://support.huaweicloud.com";
const PRODUCTS_API = "https://portal.huaweicloud.com/rest/cbc/portaldocdataservice/v1/books/items?appId=CHINA-ZH_CN";

interface HuaweiProduct {
  code: string;
  title: string;
  uri: string;
  description: string;
}

interface HuaweiCategory {
  code: string;
  name: string;
  cnName: string;
  products: HuaweiProduct[];
}

export class HuaweiAdapter extends CloudDocAdapter {
  readonly provider = "huawei";
  readonly name = "华为云";

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
        "Accept": "application/json",
        "Referer": "https://support.huaweicloud.com/",
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async listProducts(): Promise<Product[]> {
    const data = await this.fetchJson<{ data: HuaweiCategory[] }>(PRODUCTS_API);
    const products: Product[] = [];
    const seen = new Set<string>();

    for (const category of data.data) {
      for (const product of category.products) {
        if (product.code && !seen.has(product.code)) {
          seen.add(product.code);
          products.push({
            productId: product.code,
            name: product.title,
            description: product.description,
          });
        }
      }
    }

    return products;
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
    const url = `${BASE_URL}/${productId}/v3_support_leftmenu_fragment.html`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const items: TocItem[] = [];
    const seen = new Set<string>();

    // 从侧边栏目录提取链接
    // 格式: <a target="_self" href="https://support.huaweicloud.com/productdesc-ecs/ecs_01_0073.html" ...>
    $(".side-nav a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const title = $(el).text().trim();

      // 匹配文档链接: /productdesc-ecs/ecs_01_0073.html
      const match = href.match(/\/([\w-]+)\/([\w-]+\.html)/);
      if (match && title && !seen.has(href)) {
        seen.add(href);
        // pageId 格式: productId/docId (如 ecs/ecs_01_0073)
        const docId = match[1] + "/" + match[2].replace(".html", "");
        items.push({
          pageId: `${productId}/${docId}`,
          title,
        });
      }
    });

    return items;
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    // 华为云没有公开的搜索 API，通过遍历文档目录做本地关键词匹配
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
    // pageId 格式: productId/docPath (如 ecs/productdesc-ecs/ecs_01_0073)
    // URL: https://support.huaweicloud.com/productdesc-ecs/ecs_01_0073.html
    const parts = pageId.split("/");
    const productId = parts[0];
    const docPath = parts.slice(1).join("/");

    const url = `${BASE_URL}/${docPath}.html`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $("title").text().trim() || $("h1").first().text().trim() || "";
    const description = $('meta[name="description"]').attr("content") || "";

    // 从页面中提取更新时间
    const updateTime = $(".updateTime .updateInfo, .updateInfo").text().trim() || "";

    return {
      pageId,
      title,
      note: description || updateTime,
      contentPath: url,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    const html = await this.fetchHtml(contentPath);
    return htmlToMarkdown(html);
  }
}