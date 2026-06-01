import * as cheerio from "cheerio";
import { CloudDocAdapter } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";
const BASE_URL = "https://cloud.tencent.com";
export class TencentAdapter extends CloudDocAdapter {
    provider = "tencent";
    name = "腾讯云";
    async listProducts(options) {
        const url = `${BASE_URL}/document/product`;
        const html = await this.fetchHtml(url);
        const $ = cheerio.load(html);
        const products = [];
        const seen = new Set();
        // 从首页提取产品分类和产品
        // 产品链接格式: /document/product/213
        $("a[href^='/document/product/']").each((_, el) => {
            const href = $(el).attr("href") || "";
            const match = href.match(/^\/document\/product\/(\d+)(?:\/|$)/);
            if (match) {
                const productId = match[1];
                const name = $(el).text().trim();
                if (productId && name && !seen.has(productId)) {
                    seen.add(productId);
                    products.push({
                        productId,
                        name,
                    });
                }
            }
        });
        // 从侧边栏提取产品分类
        $(".rno-column-aside-menu, .doc-aside-wrap a").each((_, el) => {
            const href = $(el).attr("href") || "";
            const match = href.match(/^\/document\/product\/(\d+)(?:\/|$)/);
            if (match) {
                const productId = match[1];
                const name = $(el).text().trim();
                if (productId && name && !seen.has(productId)) {
                    seen.add(productId);
                    products.push({
                        productId,
                        name,
                    });
                }
            }
        });
        // 过滤关键词
        const filtered = this.filterByKeywords(products, options?.keyword);
        // 分页
        const page = options?.page ?? 1;
        const pageSize = options?.pageSize ?? 100;
        return this.paginate(filtered, page, pageSize);
    }
    async getDocumentToc(productId, options) {
        const url = `${BASE_URL}/document/product/${productId}`;
        const html = await this.fetchHtml(url);
        const $ = cheerio.load(html);
        const items = [];
        const seen = new Set();
        // 优先从 __staticRouterHydrationData JSON 中提取完整目录树
        const scriptContent = $("script")
            .filter((_, el) => {
            const text = $(el).text();
            return text.includes("__staticRouterHydrationData");
        })
            .first()
            .text();
        if (scriptContent) {
            try {
                const match = scriptContent.match(/JSON\.parse\("([\s\S]*?)"\)/);
                if (match) {
                    const jsonStr = match[1].replace(/\\"/g, '"');
                    const data = JSON.parse(jsonStr);
                    const catalogue = data?.loaderData?.product?.data?.sidebar?.catalogue;
                    if (catalogue?.list) {
                        const buildToc = (list) => {
                            const result = [];
                            for (const item of list) {
                                if (item.type === "page" && item.link) {
                                    const id = item.link.replace(`/document/product/${productId}/`, "");
                                    if (!seen.has(id)) {
                                        seen.add(id);
                                        result.push({
                                            pageId: `${productId}/${id}`,
                                            title: item.title,
                                        });
                                    }
                                }
                                if (item.children) {
                                    const children = buildToc(item.children);
                                    if (children.length > 0) {
                                        result.push({
                                            pageId: `${productId}/${item.id}`,
                                            title: item.title,
                                            children,
                                        });
                                    }
                                }
                            }
                            return result;
                        };
                        const tocItems = buildToc(catalogue.list);
                        // 过滤关键词
                        const filtered = this.filterByKeywords(tocItems, options?.keyword);
                        // 如果 topOnly，移除 children
                        if (options?.topOnly) {
                            for (const item of filtered) {
                                delete item.children;
                            }
                        }
                        // 分页
                        const page = options?.page ?? 1;
                        const pageSize = options?.pageSize ?? 200;
                        return this.paginate(filtered, page, pageSize);
                    }
                }
            }
            catch {
                // JSON 解析失败，回退到 HTML 解析
            }
        }
        // 回退：从 HTML 中提取文档链接
        $("a[href*='/document/product/" + productId + "/']").each((_, el) => {
            const href = $(el).attr("href") || "";
            const match = href.match(/(?:\/document\/product\/\d+\/(\d+))/);
            if (match) {
                const pageId = match[1];
                const title = $(el).text().trim();
                if (pageId && title && !seen.has(pageId)) {
                    seen.add(pageId);
                    items.push({
                        pageId: `${productId}/${pageId}`,
                        title,
                    });
                }
            }
        });
        // 过滤关键词
        const filtered = this.filterByKeywords(items, options?.keyword);
        // 如果 topOnly，移除 children
        if (options?.topOnly) {
            for (const item of filtered) {
                delete item.children;
            }
        }
        // 分页
        const page = options?.page ?? 1;
        const pageSize = options?.pageSize ?? 200;
        return this.paginate(filtered, page, pageSize);
    }
    async searchDocuments(productId, keyword) {
        // 腾讯云没有公开的搜索 API，通过遍历文档目录做本地关键词匹配
        const tocResult = await this.getDocumentToc(productId);
        const toc = tocResult.items;
        const lowerKeyword = keyword.toLowerCase();
        const results = [];
        const seen = new Set();
        const searchToc = (items) => {
            for (const item of items) {
                if (item.title.toLowerCase().includes(lowerKeyword) && !seen.has(item.pageId)) {
                    seen.add(item.pageId);
                    results.push({
                        pageId: item.pageId,
                        title: item.title,
                    });
                }
                if (item.children) {
                    searchToc(item.children);
                }
            }
        };
        searchToc(toc);
        return results;
    }
    async getPageMetadata(pageId) {
        // pageId 格式: productId/pageId (如 213/44971)
        const parts = pageId.split("/");
        const productId = parts[0];
        const docId = parts[1] || "";
        const url = `${BASE_URL}/document/product/${productId}/${docId}`;
        const html = await this.fetchHtml(url);
        const $ = cheerio.load(html);
        const title = $("title").text().trim() || $("h1").first().text().trim() || "";
        const description = $('meta[name="description"]').attr("content") || "";
        // 从页面中提取更新时间
        const updateDate = $(".rno-title-module-date, .doc-update-time, [class*='update']").text().trim() || "";
        return {
            pageId,
            title,
            contentPath: url,
        };
    }
    async getPageContent(contentPath) {
        const html = await this.fetchHtml(contentPath);
        return htmlToMarkdown(html);
    }
    /**
     * 获取腾讯云产品价格
     *
     * 实现方式：
     * - CVM：调用 DescribeZoneInstanceConfigInfos 获取全量实例配置+价格，
     *       调用 DescribeInternetChargePrices 获取带宽价格
     * - 其他产品：回退到文档解析逻辑
     *
     * 腾讯云 workbench API（可匿名访问，无需登录，只需基本 cookie）：
     * - POST https://workbench.cloud.tencent.com/cgi/api
     *   支持 CVM、VPC 等产品的 API 调用
     */
    async getProductPrice(productId) {
        const name = this.name;
        let prices = [];
        try {
            // 判断是否为 CVM 产品
            const isCvm = !productId ||
                productId === "cvm" ||
                productId === "213" ||
                productId.toLowerCase().includes("cvm") ||
                productId.toLowerCase().includes("云服务器") ||
                productId.toLowerCase().includes("ecs");
            if (isCvm) {
                prices = await this.fetchCvmPrices();
            }
            else {
                // 非 CVM 产品，使用计算器 API 或回退文档解析
                prices = await this.fetchProductPrice(productId);
            }
        }
        catch (error) {
            console.error("获取腾讯云价格信息失败:", error);
        }
        // 如果 API 方式没拿到数据，回退文档解析
        if (prices.length === 0) {
            prices = await this.fallbackParsePrice(productId);
        }
        // 标记数据状态
        let dataStatus = "no_data";
        if (prices.length > 0 && prices[0].price > 0) {
            dataStatus = "complete";
        }
        else if (prices.length > 0 && prices[0].price === 0) {
            dataStatus = "no_price";
        }
        return {
            provider: this.provider,
            name,
            prices,
            dataStatus,
        };
    }
    /**
     * CVM 可用区列表（主要区域）
     */
    CVM_REGIONS = [
        "ap-guangzhou", "ap-shanghai", "ap-beijing", "ap-nanjing",
        "ap-chengdu", "ap-chongqing", "ap-shenzhen-fsi",
        "ap-hongkong", "ap-singapore", "ap-tokyo",
        "ap-seoul", "ap-mumbai", "ap-bangkok",
        "na-siliconvalley", "na-ashburn", "na-toronto",
        "eu-frankfurt", "eu-moscow",
    ];
    /**
     * 调用 workbench API 获取 CVM 实例价格
     */
    async callWorkbenchApi(action, region, data) {
        const res = await this.fetchWithRetry(`https://workbench.cloud.tencent.com/cgi/api?i=${action}&uin=&region=${region}`, {
            method: "POST",
            headers: {
                "accept": "*/*",
                "content-type": "application/json; charset=UTF-8",
                "x-csrfcode": "",
                "x-intl": "false",
                "x-life": Date.now().toString(),
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: JSON.stringify({
                serviceType: action.split("/")[0],
                action: action.split("/")[1],
                region,
                data,
                cgiName: "api",
            }),
        });
        if (!res.ok)
            return null;
        return res.json();
    }
    /**
     * 获取 CVM 全量价格数据
     */
    async fetchCvmPrices() {
        const prices = [];
        const allPrices = new Map();
        // 并行查询所有地域
        const regionPromises = this.CVM_REGIONS.map(async (region) => {
            try {
                const result = await this.callWorkbenchApi("cvm/DescribeZoneInstanceConfigInfos", region, {
                    Filters: [
                        { Name: "instance-charge-type", Values: ["PREPAID", "POSTPAID_BY_HOUR"] },
                    ],
                    Platform: "LINUX",
                    Version: "2017-03-12",
                });
                if (!result?.data?.Response?.InstanceTypeQuotaSet)
                    return;
                for (const config of result.data.Response.InstanceTypeQuotaSet) {
                    const key = `${config.InstanceType}_${config.InstanceChargeType}_${config.Zone}`;
                    if (allPrices.has(key))
                        continue;
                    const price = config.Price || {};
                    const instanceChargeType = config.InstanceChargeType;
                    if (instanceChargeType === "PREPAID") {
                        // 包年包月：按月、1年、3年、5年
                        if (price.OriginalPrice > 0) {
                            allPrices.set(key + "_1m", {
                                productName: "云服务器 CVM",
                                region: config.Zone,
                                billingMode: "包年包月",
                                price: price.OriginalPrice,
                                unit: "元/月",
                            });
                        }
                        if (price.OriginalPriceOneYear > 0) {
                            allPrices.set(key + "_1y", {
                                productName: "云服务器 CVM",
                                region: config.Zone,
                                billingMode: "包年包月",
                                price: price.DiscountPriceOneYear || price.OriginalPriceOneYear,
                                unit: "元/年",
                            });
                        }
                    }
                    else if (instanceChargeType === "POSTPAID_BY_HOUR") {
                        // 按量付费
                        if (price.UnitPrice > 0) {
                            allPrices.set(key + "_hourly", {
                                productName: "云服务器 CVM",
                                region: config.Zone,
                                billingMode: "按量",
                                price: price.UnitPrice,
                                unit: "元/小时",
                            });
                        }
                    }
                }
            }
            catch {
                // 单个地域失败不影响其他地域
            }
        });
        await Promise.all(regionPromises);
        // 添加到结果列表
        for (const item of allPrices.values()) {
            prices.push(item);
        }
        // 获取带宽价格
        try {
            const bwResult = await this.callWorkbenchApi("vpc/DescribeInternetChargePrices", "ap-guangzhou", {
                Filters: [
                    {
                        Name: "internet-charge-type",
                        Values: [
                            "BANDWIDTH_PREPAID_BY_MONTH",
                            "BANDWIDTH_POSTPAID_BY_HOUR",
                            "TRAFFIC_POSTPAID_BY_HOUR",
                            "BANDWIDTH_PACKAGE",
                        ],
                    },
                ],
                Version: "2017-03-12",
            });
            const bwSet = bwResult?.data?.Response?.InternetChargePriceSet || [];
            for (const bw of bwSet) {
                const chargeType = bw.ChargeType;
                const priceType = bw.PriceType;
                if (priceType === "linear" && bw.UnitPrice > 0) {
                    prices.push({
                        productName: "公网带宽",
                        region: "ap-guangzhou",
                        billingMode: chargeType.includes("PREPAID") ? "包年包月" : "按量",
                        price: bw.UnitPrice,
                        unit: chargeType.includes("HOUR") ? "元/小时" : "元/月",
                    });
                }
                else if (priceType === "ladder" && bw.LadderPriceSet) {
                    for (const ladder of bw.LadderPriceSet) {
                        prices.push({
                            productName: "公网带宽",
                            region: "ap-guangzhou",
                            billingMode: chargeType.includes("PREPAID") ? "包年包月" : "按量",
                            price: ladder.UnitPrice,
                            unit: ladder.ChargeUnit === "HOUR" ? "元/小时" : "元/月",
                        });
                    }
                }
            }
        }
        catch {
            // 带宽价格获取失败不影响实例价格
        }
        return prices;
    }
    /**
     * 获取其他产品的价格（通过计算器 API 或配置 API）
     */
    async fetchProductPrice(productId) {
        // 目前使用回退方案
        return [];
    }
    /**
     * 回退方案：从文档页面解析价格
     */
    async fallbackParsePrice(productId) {
        const prices = [];
        if (!productId) {
            try {
                const html = await this.fetchHtml("https://buy.cloud.tencent.com/price");
                const md = htmlToMarkdown(html);
                return this.parsePriceTableFromMd(md);
            }
            catch {
                return prices;
            }
        }
        const urls = [
            `${BASE_URL}/document/product/${productId}/billing`,
            `https://buy.cloud.tencent.com/price/${productId}`,
            `${BASE_URL}/document/product/${productId}`,
        ];
        for (const url of urls) {
            try {
                const html = await this.fetchHtml(url);
                const md = htmlToMarkdown(html);
                const result = this.parsePriceTableFromMd(md);
                if (result.length > 0)
                    return result;
            }
            catch {
                continue;
            }
        }
        return prices;
    }
    /**
     * 从 Markdown 文本中解析价格表格
     */
    parsePriceTableFromMd(markdown) {
        const lines = markdown.split("\n");
        const prices = [];
        let inTable = false;
        let headers = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith("|") && line.endsWith("|")) {
                const cells = line.split("|").map((c) => c.trim()).filter((c) => c !== "");
                if (!inTable) {
                    headers = cells;
                    inTable = true;
                    continue;
                }
                if (cells.every((c) => /^-+\s*$/.test(c))) {
                    continue;
                }
                if (cells.length >= 2) {
                    const productName = cells[0] || "";
                    const lastCell = cells[cells.length - 1] || "";
                    const priceMatch = lastCell.match(/[\d,.]+/);
                    if (priceMatch) {
                        prices.push({
                            productName,
                            billingMode: headers.includes("计费模式") || headers.includes("付费模式") ? cells[headers.indexOf("计费模式")] || cells[headers.indexOf("付费模式")] || "" : "",
                            price: parseFloat(priceMatch[0].replace(/,/g, "")),
                            unit: "",
                        });
                    }
                }
            }
            else {
                inTable = false;
                headers = [];
            }
        }
        return prices;
    }
}
