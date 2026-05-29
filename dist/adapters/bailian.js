import * as cheerio from "cheerio";
import { CloudDocAdapter } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";
const BASE_URL = "https://help.aliyun.com";
export class BailianAdapter extends CloudDocAdapter {
    provider = "bailian";
    name = "阿里云百炼";
    async listProducts(options) {
        return this.paginateProducts([
            {
                productId: "model-studio",
                name: "大模型服务平台百炼",
            },
        ], options);
    }
    async getDocumentToc(productId, options) {
        // 百炼的 product.json API 返回 302 重定向，需从首页 HTML 解析目录
        const url = `${BASE_URL}/zh/model-studio/`;
        const html = await this.fetchHtml(url);
        const $ = cheerio.load(html);
        const items = [];
        // 阿里云帮助中心左侧导航通常在 .sidebar 或 .nav 容器中
        // 查找所有导航链接，提取目录结构
        const extractNavLinks = ($, container) => {
            const result = [];
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
                    const seen = new Set();
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
    async searchDocuments(productId, keyword) {
        // 遍历目录做本地关键词匹配
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
    async getPageMetadata(pageId) {
        // pageId 是文档路径，如 /zh/model-studio/what-is-model-studio
        const url = `${BASE_URL}${pageId}`;
        const html = await this.fetchHtml(url);
        const $ = cheerio.load(html);
        const title = $("title").text().trim() || $("h1").first().text().trim() || "";
        const description = $('meta[name="description"]').attr("content") || "";
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
     * 从 Markdown 文本中解析价格表格
     */
    parsePriceTable(markdown) {
        const prices = [];
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
                            unit: "元/百万Token",
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
    async getProductPrice(productId, _options) {
        const url = `${BASE_URL}/zh/model-studio/billing`;
        const html = await this.fetchHtml(url);
        const markdown = htmlToMarkdown(html);
        const prices = this.parsePriceTable(markdown);
        return this.makePriceResult(prices, { updateDate: undefined });
    }
}
