import * as cheerio from "cheerio";
import { CloudDocAdapter } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";
const BASE_URL = "https://api-docs.deepseek.com";
export class DeepseekAdapter extends CloudDocAdapter {
    provider = "deepseek";
    name = "DeepSeek";
    /**
     * 从 sitemap.xml 解析所有文档页面 URL
     */
    async fetchSitemapUrls() {
        const xml = await this.fetchText(`${BASE_URL}/sitemap.xml`);
        const $ = cheerio.load(xml, { xmlMode: true });
        const urls = [];
        $("url > loc").each((_, el) => {
            const loc = $(el).text().trim();
            if (!loc)
                return;
            // 只保留 api-docs.deepseek.com 下的页面，过滤掉外部链接
            if (!loc.startsWith(BASE_URL))
                return;
            const path = loc.replace(BASE_URL, "");
            if (!path || path === "/")
                return;
            // 从路径中提取标题：去除后缀，将路径分段，取最后一段
            const segments = path.replace(/\.html?$/, "").split("/").filter(Boolean);
            const lastSegment = segments[segments.length - 1] || "";
            // 将 kebab-case 或 snake_case 转为可读标题
            const title = lastSegment
                .replace(/[-_]/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase());
            urls.push({ path, title });
        });
        return urls;
    }
    async listProducts(options) {
        const allProducts = [
            {
                productId: "api-docs",
                name: "DeepSeek API 文档",
                description: "DeepSeek API 官方文档",
            },
        ];
        const filtered = this.filterByKeywords(allProducts, options?.keyword);
        return this.paginate(filtered, options?.page, options?.pageSize);
    }
    async getDocumentToc(productId, options) {
        const urls = await this.fetchSitemapUrls();
        // 按路径深度构建树形结构
        const items = [];
        const pathMap = new Map();
        for (const { path, title } of urls) {
            const segments = path.replace(/\.html?$/, "").split("/").filter(Boolean);
            const pageId = "/" + segments.join("/");
            const tocItem = {
                pageId,
                title,
            };
            pathMap.set(pageId, tocItem);
            // 找到父级路径
            if (segments.length > 1) {
                const parentPath = "/" + segments.slice(0, -1).join("/");
                const parent = pathMap.get(parentPath);
                if (parent) {
                    if (!parent.children) {
                        parent.children = [];
                    }
                    parent.children.push(tocItem);
                    continue;
                }
            }
            items.push(tocItem);
        }
        // Apply keyword filter
        let filtered = items;
        if (options?.keyword) {
            filtered = this.filterByKeywords(items, options.keyword);
        }
        // Strip children if topOnly
        if (options?.topOnly) {
            filtered = filtered.map(item => ({ pageId: item.pageId, title: item.title }));
        }
        return this.paginate(filtered, options?.page, options?.pageSize ?? 200);
    }
    filterByKeywords(items, keyword) {
        if (!keyword)
            return items;
        const keywords = keyword.trim().split(/\s+/).filter(Boolean);
        if (keywords.length === 0)
            return items;
        return items.filter(item => {
            const text = (item.name || item.title || "").toLowerCase();
            return keywords.every(kw => text.includes(kw.toLowerCase()));
        });
    }
    paginate(items, page = 1, pageSize = 100) {
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
    async searchDocuments(productId, keyword) {
        const tocResult = await this.getDocumentToc(productId);
        const toc = tocResult.items;
        const lowerKeyword = keyword.toLowerCase();
        const results = [];
        const searchToc = (items) => {
            for (const item of items) {
                if (item.title.toLowerCase().includes(lowerKeyword)) {
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
        const url = `${BASE_URL}${pageId}`;
        const html = await this.fetchText(url);
        const $ = cheerio.load(html);
        const title = $("title").first().text().trim() ||
            $("h1").first().text().trim() ||
            pageId.split("/").filter(Boolean).pop() ||
            "";
        const description = $('meta[name="description"]').attr("content")?.trim() || "";
        return {
            pageId,
            title,
            note: description,
            contentPath: url,
            updateDate: undefined,
        };
    }
    async getPageContent(contentPath) {
        // contentPath 可能是完整 URL 或相对路径
        const url = contentPath.startsWith("http") ? contentPath : `${BASE_URL}${contentPath}`;
        const html = await this.fetchText(url);
        const $ = cheerio.load(html);
        // Docusaurus 站点内容通常在 main 或 article 标签内，或 .markdown 类中
        const mainContent = $("article").html() ||
            $("main").html() ||
            $(".markdown").html() ||
            $(".theme-doc-markdown").html() ||
            $("body").html() ||
            "";
        if (!mainContent) {
            return "(空内容)";
        }
        return htmlToMarkdown(mainContent);
    }
    /**
     * 从 Markdown 表格中解析价格数据
     */
    parsePriceTable(markdown) {
        const prices = [];
        const lines = markdown.split("\n");
        let inTable = false;
        let headers = [];
        for (const line of lines) {
            // 检测表格开始（包含 | 的行）
            if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
                const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
                if (!inTable) {
                    // 表头行
                    headers = cells;
                    inTable = true;
                    continue;
                }
                // 跳过分隔行（|---|）
                if (cells.every((c) => /^[-:\s]+$/.test(c))) {
                    continue;
                }
                // 数据行
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
                            unit: priceStr.includes("$") ? "元/百万Token" : "元/百万Token",
                            currency: priceStr.includes("$") ? "USD" : "CNY",
                            source: "文档定价页面",
                        });
                    }
                }
                continue;
            }
            // 非表格行，重置表格状态
            if (inTable && line.trim() !== "") {
                // 表格结束
                inTable = false;
            }
        }
        return prices;
    }
    async getProductPrice(productId, _options) {
        const url = `${BASE_URL}/quick_start/pricing`;
        const html = await this.fetchText(url);
        const $ = cheerio.load(html);
        const mainContent = $("article").html() ||
            $("main").html() ||
            $(".markdown").html() ||
            $(".theme-doc-markdown").html() ||
            $("body").html() ||
            "";
        const markdown = htmlToMarkdown(mainContent);
        const prices = this.parsePriceTable(markdown);
        return {
            provider: this.provider,
            name: this.name,
            prices,
            source: "https://api-docs.deepseek.com/quick_start/pricing",
            updateDate: undefined,
        };
    }
}
