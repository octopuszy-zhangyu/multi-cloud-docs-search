import * as cheerio from "cheerio";
import { CloudDocAdapter } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";
const BASE_URL = "https://help.aliyun.com";
export class AliyunAdapter extends CloudDocAdapter {
    provider = "aliyun";
    name = "阿里云";
    async fetchText(url) {
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
    /**
     * 解析 llms.txt 格式的文档索引
     *
     * 格式: - [标题](URL): 描述
     */
    parseLlmsTxt(text) {
        const entries = [];
        const lines = text.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            const match = trimmed.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)(?:\s*:\s*(.*))?$/);
            if (match) {
                const title = match[1].trim();
                const url = match[2].trim();
                const description = match[3]?.trim();
                let path;
                if (url.startsWith("http")) {
                    try {
                        path = new URL(url).pathname;
                    }
                    catch {
                        path = url;
                    }
                }
                else {
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
    async listProducts() {
        const text = await this.fetchText(`${BASE_URL}/llms.txt`);
        const entries = this.parseLlmsTxt(text);
        const products = [];
        const seen = new Set();
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
    async getDocumentToc(productId) {
        const text = await this.fetchText(`${BASE_URL}/zh/${productId}/llms.txt`);
        const entries = this.parseLlmsTxt(text);
        const items = [];
        const seen = new Set();
        for (const entry of entries) {
            if (!seen.has(entry.path)) {
                seen.add(entry.path);
                items.push({ pageId: entry.path, title: entry.title });
            }
        }
        return items;
    }
    /**
     * 从产品级 llms.txt 搜索文档（标题+描述匹配）
     */
    async searchDocuments(productId, keyword) {
        const text = await this.fetchText(`${BASE_URL}/zh/${productId}/llms.txt`);
        const entries = this.parseLlmsTxt(text);
        const lowerKeyword = keyword.toLowerCase();
        const results = [];
        const seen = new Set();
        for (const entry of entries) {
            if (seen.has(entry.path))
                continue;
            seen.add(entry.path);
            if (entry.title.toLowerCase().includes(lowerKeyword) ||
                (entry.description && entry.description.toLowerCase().includes(lowerKeyword))) {
                results.push({
                    pageId: entry.path,
                    title: entry.title,
                    description: entry.description,
                });
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
    async getPageMetadata(pageId) {
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
    async getPageContent(contentPath) {
        // 尝试获取 .md 文件（阿里云 .md 文件实际是 HTML 内容）
        const mdUrl = contentPath.endsWith(".md") ? contentPath : `${contentPath}.md`;
        const url = mdUrl.startsWith("http") ? mdUrl : `${BASE_URL}${mdUrl}`;
        const content = await this.fetchText(url);
        return htmlToMarkdown(content);
    }
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
    async getProductPrice(productId, _options) {
        const prices = [];
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
                        break;
                    }
                }
                catch {
                    continue;
                }
            }
        }
        return {
            provider: this.provider,
            name: this.name,
            prices,
            source: productId ? `${BASE_URL}/zh/${productId}/billing` : `${BASE_URL}/price`,
            updateDate: undefined,
        };
    }
}
