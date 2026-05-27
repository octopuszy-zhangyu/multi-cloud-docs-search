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
}
