import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type SpecPriceItem, type PaginatedResult, type ListProductsOptions, type TocOptions, type PriceQueryOptions } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const BASE_URL = "https://cloud.baidu.com";

export class BaiduAdapter extends CloudDocAdapter {
  readonly provider = "baidu";
  readonly name = "百度云";

  async listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>> {
    const url = `${BASE_URL}/doc/index.html`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const products: Product[] = [];
    const seen = new Set<string>();

    // 从首页提取产品链接，格式: <a href="https://cloud.baidu.com/doc/BCC/index.html" data-track-category="文档中心产品目录" data-track-value="云服务器 BCC">
    $("a[data-track-category='文档中心产品目录'][data-track-value]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const name = $(el).attr("data-track-value") || "";

      // 匹配 https://cloud.baidu.com/doc/PRODUCT_ID/index.html 或 /doc/PRODUCT_ID/index.html
      const match = href.match(/(?:\/doc\/([A-Za-z0-9_-]+)\/index\.html)/);
      if (match && name && !seen.has(match[1])) {
        seen.add(match[1]);
        products.push({
          productId: match[1],
          name,
        });
      }
    });

    // 过滤关键词
    const filtered = this.filterByKeywords(products, options?.keyword);

    // 分页
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 100;
    return this.paginate(filtered, page, pageSize);
  }

  async getDocumentToc(productId: string, options?: TocOptions): Promise<PaginatedResult<TocItem>> {
    const url = `${BASE_URL}/doc/${productId}/index.html`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const items: TocItem[] = [];
    const seen = new Set<string>();

    // 提取产品文档页中的所有文档链接
    // 格式: /doc/BCC/s/SLUG 或 https://cloud.baidu.com/doc/BCC/s/SLUG
    const pattern = new RegExp(`^(${BASE_URL})?/doc/${productId}/s/([^"#\\s]+)`);
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const title = $(el).text().trim();

      const match = href.match(pattern);
      if (match && title && !seen.has(match[2])) {
        seen.add(match[2]);
        // pageId 格式: productId/s/SLUG (如 BCC/s/8kbbkwg4p)
        items.push({
          pageId: `${productId}/s/${match[2]}`,
          title,
        });
      }
    });

    // 过滤关键词
    let filtered = this.filterByKeywords(items, options?.keyword);

    // 如果 topOnly 为 true，移除 children
    if (options?.topOnly) {
      filtered = filtered.map(item => ({ ...item, children: undefined }));
    }

    // 分页
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 200;
    return this.paginate(filtered, page, pageSize);
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    // 百度云没有公开搜索 API，通过遍历文档目录做本地关键词匹配
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
    // pageId 格式: productId/s/SLUG (如 BCC/s/8kbbkwg4p)
    const url = `${BASE_URL}/doc/${pageId}`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    // 标题格式: "创建实例导航 - 云服务器BCC | 百度智能云文档"
    const rawTitle = $("title").text().trim();
    const title = rawTitle.split("|")[0].trim() || "";

    // 描述
    const description = $('meta[name="description"]').attr("content") || "";

    return {
      pageId,
      title,
      contentPath: url,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    const html = await this.fetchHtml(contentPath);
    const $ = cheerio.load(html);
    // 提取 post__body 区域的内容，去除页头页脚等无关信息
    const content = $(".post__body").first();
    if (content.length > 0) {
      return htmlToMarkdown(content.html() || "");
    }
    return htmlToMarkdown(html);
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
          const productName = cells[0].trim();
          // 跳过 productName 为空的行（如空行被解析为表格行）
          if (!productName) {
            continue;
          }

          const priceStr = cells[cells.length - 1] || "0";
          const price = parseFloat(priceStr.replace(/[^0-9.]/g, ""));

          if (!isNaN(price)) {
            prices.push({
              productName,
              billingMode: "按量",
              price,
              unit: "元/月",
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

    if (!productId) {
      return this.makePriceResult([], {
        message: "百度云价格查询：请指定 productId。常用产品：BCC（云服务器）、BML（全功能AI开发平台）。示例：get_product_price({ provider: \"baidu\", productId: \"BCC\" })",
      });
    }

    if (productId) {
      // 先通过 searchDocuments 搜索"价格"关键词，定位定价页面
      try {
        const searchResults = await this.searchDocuments(productId, "价格");
        for (const result of searchResults) {
          try {
            const url = `${BASE_URL}/doc/${result.pageId}`;
            const html = await this.fetchHtml(url);
            const $ = cheerio.load(html);
            const content = $(".post__body").first();
            const markdown = htmlToMarkdown(content.length > 0 ? content.html() || "" : html);
            const parsed = this.parsePriceTable(markdown);
            if (parsed.length > 0) {
              prices.push(...parsed);
              break;
            }
          } catch {
            continue;
          }
        }
      } catch {
        // fall through to direct URL attempts
      }

      // 如果搜索没找到，尝试直接访问已知的定价页面 URL
      if (prices.length === 0) {
        const priceUrls = [
          `${BASE_URL}/doc/${productId}/pricing`,
          `${BASE_URL}/doc/${productId}/price`,
          `${BASE_URL}/doc/${productId}/index.html`,
          `${BASE_URL}/doc/${productId}/s/`,  // 百度云定价页面可能是 /doc/BCC/s/xxx 格式
        ];

        for (const url of priceUrls) {
          try {
            const html = await this.fetchHtml(url);
            const $ = cheerio.load(html);
            const content = $(".post__body").first();
            const markdown = htmlToMarkdown(content.length > 0 ? content.html() || "" : html);
            const parsed = this.parsePriceTable(markdown);
            if (parsed.length > 0) {
              prices.push(...parsed);
              break;
            }
          } catch {
            continue;
          }
        }
      }
    }

    // 对于 BCC 产品，如果文档中未找到具体价格，添加明确的提示信息
    if (prices.length === 0 && productId === "BCC") {
      return {
        provider: this.provider,
        name: this.name,
        prices: [],
        updateDate: undefined,
        dataStatus: "no_price",
      };
    }

    // 标记数据状态
    let dataStatus: "complete" | "partial" | "no_price" | "no_data" = "no_data";
    if (prices.length > 0 && prices[0].price > 0) {
      dataStatus = "complete";
    } else if (prices.length > 0 && prices[0].price === 0) {
      dataStatus = "no_price";
    }

    return {
      provider: this.provider,
      name: this.name,
      prices,
      updateDate: undefined,
      dataStatus,
    };
  }

  /**
   * 构建百度云 BCC 规格-配置-价格联合表
   * 从价格计算器 API 获取规格和价格数据
   */
  async buildSpecPriceTable(productId?: string): Promise<SpecPriceItem[]> {
    // 只处理 BCC 产品
    if (!productId || productId.toUpperCase() !== "BCC") {
      return super.buildSpecPriceTable(productId);
    }

    const specItems: SpecPriceItem[] = [];
    const seen = new Set<string>();

    try {
      // Step 1: 获取可用规格列表
      const flavorRes = await this.fetchWithRetry("https://cloud.baidu.com/api/calculator/bccFlavor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=UTF-8",
          "Accept": "application/json",
          "Referer": "https://cloud.baidu.com/price/calculator?product=bcc",
        },
        body: JSON.stringify({ region: "su", ignoreReservedInstanceProductType: true }),
      });

      if (!flavorRes.ok) {
        console.error(`百度云规格列表获取失败: ${flavorRes.status}`);
        return specItems;
      }

      const flavorData = await flavorRes.json() as Record<string, unknown>;
      const flavorResult = flavorData?.result as Record<string, unknown> | undefined;
      const zoneResources = flavorResult?.zoneResources as Array<Record<string, unknown>> | undefined;

      if (!flavorData?.success || !zoneResources) {
        console.error("百度云规格列表解析失败");
        return specItems;
      }

      // 收集所有规格
      const allFlavors: Array<{ spec: string; cpu: number; mem: number; instanceType: number; family: string; familyName: string }> = [];
      for (const zone of zoneResources) {
        const bccResources = zone?.bccResources as Record<string, unknown> | undefined;
        const flavorGroups = bccResources?.flavorGroups as Array<Record<string, unknown>> | undefined || [];
        for (const group of flavorGroups) {
          const groupName = group?.groupName as string || "";
          const flavors = group?.flavors as Array<Record<string, unknown>> | undefined || [];
          for (const flavor of flavors) {
            const spec = flavor?.spec as string | undefined;
            const cpuCount = flavor?.cpuCount as number | undefined;
            const memoryCapacityInGB = flavor?.memoryCapacityInGB as number | undefined;
            if (spec && cpuCount && memoryCapacityInGB) {
              allFlavors.push({
                spec,
                cpu: cpuCount,
                mem: memoryCapacityInGB,
                instanceType: (flavor?.instanceType as number) || 0,
                family: (flavor?.instanceFamily as string) || "",
                familyName: (flavor?.specFamily as string) || groupName,
              });
            }
          }
        }
      }

      console.log(`百度云找到 ${allFlavors.length} 个规格`);

      // Step 2: 批量查询价格（每批最多 10 个规格）
      const batchSize = 10;
      for (let i = 0; i < allFlavors.length; i += batchSize) {
        const batch = allFlavors.slice(i, i + batchSize);

        try {
          const bccList = batch.map(f => ({
            productType: "prepay",
            instanceType: f.instanceType,
            cpu: f.cpu,
            memory: f.mem,
            ephemeralSizeGb: 0,
            fpgaCard: "",
            fpgaCount: 0,
            containsFpga: true,
            gpuCard: "",
            gpuCount: 0,
            kunlunCard: "",
            kunlunCount: 0,
            spec: f.spec,
            specId: f.family.toLowerCase(),
          }));

          const priceRes = await this.fetchWithRetry("https://cloud.baidu.com/api/calculator/bcc/instance/priceV2", {
            method: "POST",
            headers: {
              "Content-Type": "application/json;charset=UTF-8",
              "Accept": "application/json",
              "Referer": "https://cloud.baidu.com/price/calculator?product=bcc",
            },
            body: JSON.stringify({
              purchaseLengthList: [1, 12],
              purchaseNum: 1,
              region: "su",
              bccList,
            }),
          });

          if (priceRes.ok) {
            const priceData = await priceRes.json() as Record<string, unknown>;
            const priceResult = priceData?.result as Record<string, unknown> | undefined;
            const bccPayResults = priceResult?.bccPayResults as Record<string, unknown> | undefined;
            const bccResults = bccPayResults?.bccResults as Array<Record<string, unknown>> | undefined;

            if (priceData?.success && bccResults && bccResults.length > 0) {
              // bccResults 按输入顺序返回，每批有 2 * batchSize 个结果（1个月 + 12个月）
              const purchaseLengthList = [1, 12]; // 购买时长列表
              const resultsPerDuration = batch.length; // 每个时长的结果数

              // 合并规格和价格
              for (let i = 0; i < batch.length; i++) {
                const flavor = batch[i];
                const displayName = `${flavor.cpu}C${flavor.mem}G`;

                // 遍历每个购买时长
                for (let d = 0; d < purchaseLengthList.length; d++) {
                  const resultIndex = d * resultsPerDuration + i;
                  const result = bccResults[resultIndex];
                  if (!result) continue;

                  const price = result?.price as number | undefined;
                  if (!price || price <= 0) continue;

                  const duration = purchaseLengthList[d];
                  const key = `${flavor.spec}_${duration}月`;

                  if (!seen.has(key)) {
                    seen.add(key);
                    specItems.push({
                      specName: flavor.spec,
                      cpu: flavor.cpu,
                      mem: flavor.mem,
                      displayName,
                      region: "苏州",
                      billingMode: duration === 1 ? "包月" : `包${duration}月`,
                      price,
                      unit: "元/月",
                      familyName: flavor.familyName,
                    });
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error(`百度云价格批量查询失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      console.error(`百度云规格价格表构建失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    return specItems;
  }
}