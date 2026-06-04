import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata, type PriceItem, type PriceResult, type SpecPriceItem, type PaginatedResult, type ListProductsOptions, type TocOptions, type PriceQueryOptions } from "./base.js";
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
  async listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>> {
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
          });
        }
      }
    }

    const filtered = this.filterByKeywords(products, options?.keyword);
    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 100;
    return this.paginate(filtered, page, pageSize);
  }

  /**
   * 从产品级 llms.txt 获取文档目录
   */
  async getDocumentToc(productId: string, options?: TocOptions): Promise<PaginatedResult<TocItem>> {
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
        return this.paginate(items.filter(item => {
          const text = (item.title || "").toLowerCase();
          return keywords.every(kw => text.includes(kw.toLowerCase()));
        }), options?.page, options?.pageSize);
      }
    }

    const page = options?.page ?? 1;
    const pageSize = options?.pageSize ?? 200;
    return this.paginate(items, page, pageSize);
  }

  /**
   * 从产品级 llms.txt 搜索文档（标题+描述匹配，支持别名扩展）
   * 当搜索结果为空时，自动尝试去掉具体规格词后重试
   */
  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const text = await this.fetchText(`${BASE_URL}/zh/${productId}/llms.txt`);
    const entries = this.parseLlmsTxt(text);

    // 使用别名扩展关键词
    const expandedGroups = this.expandKeyword(keyword);

    const results: SearchResult[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);

      const entryText = (entry.title + " " + (entry.description || "")).toLowerCase();

      // 每个关键词组（OR 逻辑）必须至少有一个匹配
      const match = expandedGroups.every(synonymGroup => {
        // 先尝试精确匹配（别名扩展）
        const exactMatch = synonymGroup.some(syn => entryText.includes(syn));
        if (exactMatch) return true;

        // 再尝试模糊匹配：如果原始关键词较短（如 "服务器"），检查是否包含该词
        const originalKw = synonymGroup[0];
        if (originalKw.length >= 2 && entryText.includes(originalKw)) return true;

        return false;
      });

      if (match) {
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

  /**
   * 阿里云价格计算器 API
   */
  private static readonly PRICE_API_BASE = "https://buy-api.aliyun.com/pricingDetail";

  /**
   * 从阿里云价格计算器 API 获取 ECS 价格
   * 主要返回实例规格（instance_type）价格，附带系统盘、数据盘和带宽的参考价格
   */
  private async fetchEcsPriceFromApi(region: string = "cn-beijing"): Promise<PriceItem[]> {
    const prices: PriceItem[] = [];
    const defaultRegion = region || "cn-beijing";

    // 先查询实例规格价格（核心数据）
    const instancePrices = await this.queryPricingDetailList("instance_type", defaultRegion).catch((err) => {
      console.error(`查询实例规格价格失败: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    });
    prices.push(...instancePrices);

    // 再并行查询其他计费项（系统盘、数据盘、带宽），每种只取少量数据作为参考
    const otherItems = ["systemdisk", "datadisk", "vm_bandwidth"];
    const otherResults = await Promise.all(
      otherItems.map((billItemCode) =>
        this.queryPricingDetailList(billItemCode, defaultRegion, 5).catch((err) => {
          console.error(`查询 ${billItemCode} 价格失败: ${err instanceof Error ? err.message : String(err)}`);
          return [];
        })
      )
    );

    for (const result of otherResults) {
      prices.push(...result);
    }

    return prices;
  }

  /**
   * 调用价格查询 API（支持分页）
   * @param billItemCode 计费项代码
   * @param region 地域代码
   * @param maxItems 最大返回条数（默认不限，但限制最大 500 条）
   */
  private async queryPricingDetailList(billItemCode: string, region: string, maxItems?: number): Promise<PriceItem[]> {
    const url = `${AliyunAdapter.PRICE_API_BASE}/queryPricingDetailList.json`;
    const allPrices: PriceItem[] = [];
    let nextToken: string | null = null;
    const pageSize = maxItems ?? 100;

    do {
      const requestBody: Record<string, unknown> = {
        saleProductCode: "ecs",
        billItemCode,
        priceDetailType: "general_discount_price",
        limit: pageSize,
        lang: "zh",
        conditionFilterList: [],
        regionList: [region],
        billModel: "",
        priceType: "yearPrice",
        nextToken,
      };

      const res = await this.fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        console.error(`价格查询 API 请求失败: ${res.status} ${res.statusText}`);
        break;
      }

      const response = await res.json() as { success?: boolean; data?: Record<string, unknown>; code?: string };

      if (!response.success || !response.data) {
        break;
      }

      const prices = this.parsePricingDetailResponse(response.data, billItemCode);
      allPrices.push(...prices);

      // 检查是否有下一页
      nextToken = (response.data as Record<string, unknown>).nextToken as string | null;
      if (!nextToken) break;

      // 如果指定了 maxItems，达到后停止
      if (maxItems !== undefined && allPrices.length >= maxItems) break;

      // 限制最大页数，防止无限循环
      if (allPrices.length > 500) break;
    } while (nextToken);

    return allPrices;
  }

  /**
   * 解析价格查询响应
   */
  private parsePricingDetailResponse(data: Record<string, unknown>, billItemCode: string): PriceItem[] {
    const prices: PriceItem[] = [];
    const values = data.values as Array<Record<string, unknown>> | undefined;

    if (!values || values.length === 0) {
      return prices;
    }

    for (const value of values) {
      // 提取地域信息
      const regionObj = (value["$priceDetailRegionCode$"] || value["region"]) as { name?: string; value?: string } | undefined;
      const regionName = regionObj?.name || "华北2（北京）";

      // 提取按量付费价格
      const postPay = value.postPay as { price?: string; priceUnit?: string; currency?: string } | undefined;
      if (postPay && postPay.price && postPay.price !== "NA") {
        const price = parseFloat(postPay.price);
        if (!isNaN(price)) {
          const productName = this.buildProductName(billItemCode, value);
          // 标准化单位格式
          const unit = this.normalizeUnit(postPay.priceUnit, "按量");
          prices.push({
            productName,
            region: regionName,
            billingMode: "按量",
            price,
            unit,
            componentType: this.getComponentType(billItemCode),
          });
        }
      }

      // 提取包年包月价格
      const prePay = value.prePay as Record<string, { price?: string; priceUnit?: string; currency?: string }> | undefined;
      if (prePay) {
        const durationMap: Record<string, string> = {
          "1:Month": "包月",
          "1:Year": "包年",
          "3:Year": "3年",
          "5:Year": "5年",
        };

        for (const [duration, priceInfo] of Object.entries(prePay)) {
          if (priceInfo?.price && priceInfo.price !== "NA") {
            const price = parseFloat(priceInfo.price);
            if (!isNaN(price)) {
              const productName = this.buildProductName(billItemCode, value);
              const unit = this.normalizeUnit(priceInfo.priceUnit, "包年包月");
              prices.push({
                productName,
                region: regionName,
                billingMode: durationMap[duration] || "包年包月",
                price,
                unit,
                componentType: this.getComponentType(billItemCode),
              });
            }
          }
        }
      }
    }

    return prices;
  }

  /**
   * 标准化单位格式
   */
  private normalizeUnit(rawUnit: string | undefined, billingMode: string): string {
    if (!rawUnit) return "元/月";

    // 已经是完整格式
    if (rawUnit.startsWith("元/")) return rawUnit;

    // 处理 "1月" → "月", "1年" → "年", "3年" → "3年", "5年" → "5年"
    const normalized = rawUnit
      .replace(/^1月$/, "月")
      .replace(/^1年$/, "年")
      .replace(/^GiB\/1月$/, "GiB/月")
      .replace(/^GiB\/1年$/, "GiB/年")
      .replace(/^GiB\/3年$/, "GiB/3年")
      .replace(/^GiB\/5年$/, "GiB/5年")
      .replace(/^Mbps\/小时$/, "Mbps/小时");

    return `元/${normalized}`;
  }

  /**
   * 构建产品名称
   */
  private buildProductName(billItemCode: string, value: Record<string, unknown>): string {
    const parts: string[] = [];

    switch (billItemCode) {
      case "instance_type": {
        // instance_type 的 value 中直接包含规格信息
        const instanceType = value.instance_type as { name?: string; value?: string } | undefined;
        const cpu = value.cpu as { name?: string } | undefined;
        const mem = value.mem as { name?: string } | undefined;
        const family = value.instance_type_family as { name?: string } | undefined;

        if (instanceType?.name) {
          parts.push(instanceType.name);
        } else if (family?.name) {
          parts.push(family.name);
        }

        // 添加 CPU 和内存信息
        if (cpu?.name && mem?.name) {
          parts.push(`${cpu.name} ${mem.name}`);
        }
        break;
      }
      case "systemdisk": {
        parts.push("系统盘");
        const category = value.systemdisk_category as { name?: string } | undefined;
        const level = value.systemdisk_performance_level as { name?: string } | undefined;
        const size = value.systemdisk_size as { name?: string } | undefined;
        if (category?.name) parts.push(category.name);
        if (level?.name && level.name !== "不区分") parts.push(level.name);
        if (size?.name) parts.push(size.name);
        break;
      }
      case "datadisk": {
        parts.push("数据盘");
        const category = value.datadisk_category as { name?: string } | undefined;
        const level = value.datadisk_performance_level as { name?: string } | undefined;
        const size = value.datadisk_size as { name?: string } | undefined;
        if (category?.name) parts.push(category.name);
        if (level?.name && level.name !== "不区分") parts.push(level.name);
        if (size?.name) parts.push(size.name);
        break;
      }
      case "vm_bandwidth": {
        parts.push("公网带宽");
        const bandwidth = value.vm_bandwidth as { name?: string } | undefined;
        if (bandwidth?.name) parts.push(bandwidth.name);
        break;
      }
      default:
        parts.push(billItemCode);
    }

    return parts.join(" - ");
  }

  /**
   * 获取组件类型
   */
  private getComponentType(billItemCode: string): string | undefined {
    switch (billItemCode) {
      case "instance_type":
        return "vm";
      case "systemdisk":
        return "sysDisk";
      case "datadisk":
        return "dataDisk";
      case "vm_bandwidth":
        return "network";
      default:
        return undefined;
    }
  }

  /**
   * 构建阿里云 ECS 规格-配置-价格联合表
   * 阿里云价格 API 直接返回 cpu/mem 字段，可精确映射
   */
  async buildSpecPriceTable(productId?: string): Promise<SpecPriceItem[]> {
    if (!productId || productId.toLowerCase() !== "ecs") {
      return super.buildSpecPriceTable(productId);
    }

    const specItems: SpecPriceItem[] = [];
    const seen = new Set<string>();

    try {
      // 从价格 API 获取实例规格数据
      const url = `${AliyunAdapter.PRICE_API_BASE}/queryPricingDetailList.json`;
      const requestBody = {
        saleProductCode: "ecs",
        billItemCode: "instance_type",
        priceDetailType: "general_discount_price",
        limit: 500,
        lang: "zh",
        conditionFilterList: [],
        regionList: ["cn-beijing"],
        billModel: "",
        priceType: "yearPrice",
        nextToken: null,
      };

      const res = await this.fetchWithRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) return specItems;

      const response = await res.json() as { success?: boolean; data?: Record<string, unknown> };
      if (!response.success || !response.data) return specItems;

      const values = response.data.values as Array<Record<string, unknown>> | undefined;
      if (!values) return specItems;

      for (const value of values) {
        const instanceType = value.instance_type as { name?: string; value?: string } | undefined;
        const cpu = value.cpu as { name?: string } | undefined;
        const mem = value.mem as { name?: string } | undefined;
        const family = value.instance_type_family as { name?: string } | undefined;
        const regionObj = (value["$priceDetailRegionCode$"] || value.region) as { name?: string; value?: string } | undefined;

        const specName = instanceType?.name || family?.name || "";
        const cpuCount = cpu?.name ? parseInt(cpu.name) : 0;
        const memGB = mem?.name ? parseInt(mem.name) : 0;
        const regionName = regionObj?.name || "华北2（北京）";
        const familyName = family?.name;

        if (!specName || cpuCount === 0 || memGB === 0) continue;

        const displayName = `${cpuCount}C${memGB}G`;

        // 提取按量价格
        const postPay = value.postPay as { price?: string; priceUnit?: string } | undefined;
        if (postPay?.price && postPay.price !== "NA") {
          const price = parseFloat(postPay.price);
          if (!isNaN(price) && price > 0) {
            const key = `${specName}_${regionName}_按量`;
            if (!seen.has(key)) {
              seen.add(key);
              specItems.push({
                specName,
                cpu: cpuCount,
                mem: memGB,
                displayName,
                region: regionName,
                billingMode: "按量",
                price,
                unit: "元/小时",
                familyName,
              });
            }
          }
        }

        // 提取包月价格
        const prePay = value.prePay as Record<string, { price?: string; priceUnit?: string }> | undefined;
        if (prePay) {
          const monthPrice = prePay["1:Month"];
          if (monthPrice?.price && monthPrice.price !== "NA") {
            const price = parseFloat(monthPrice.price);
            if (!isNaN(price) && price > 0) {
              const key = `${specName}_${regionName}_包月`;
              if (!seen.has(key)) {
                seen.add(key);
                specItems.push({
                  specName,
                  cpu: cpuCount,
                  mem: memGB,
                  displayName,
                  region: regionName,
                  billingMode: "包月",
                  price,
                  unit: "元/月",
                  familyName,
                });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`阿里云规格价格表构建失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    return specItems;
  }

  async getProductPrice(productId?: string, _options?: PriceQueryOptions): Promise<PriceResult> {
    const prices: PriceItem[] = [];
    let updateDate: string | undefined;

    // 无 productId 时，返回定价概览提示
    if (!productId) {
      return this.makePriceResult([], {
        updateDate: new Date().toISOString().split("T")[0],
        message: "阿里云价格查询：请指定 productId。常用产品：ecs（云服务器）、rds（云数据库）、oss（对象存储）。示例：get_product_price({ provider: \"aliyun\", productId: \"ecs\" })",
      });
    }

    if (productId) {
      // 特殊处理 ECS 产品，使用价格计算器 API
      if (productId.toLowerCase() === "ecs") {
        try {
          const ecsPrices = await this.fetchEcsPriceFromApi();
          if (ecsPrices.length > 0) {
            prices.push(...ecsPrices);
            updateDate = new Date().toISOString().split("T")[0];
          }
        } catch (err) {
          console.error(`ECS 价格查询失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 如果 API 没有返回价格，尝试从文档获取
      if (prices.length === 0) {
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
                      billingMode: unit.includes("小时") || unit.includes("h") ? "按量" : "包年包月",
                      price,
                      unit: `元/${unit}`,
                    });
                  }
                }
              }
            }
          } catch {
            // 定价页面抓取失败不影响结果
          }
        }
      }

      // 如果仍然没有价格数据，不添加空条目（避免质量检查报错）
      // 价格查询失败时返回空 prices 数组即可
    }

    return this.makePriceResult(prices, { updateDate });
  }

}
