import * as cheerio from "cheerio";
import { CloudDocAdapter } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";
const BASE_URL = "https://cloud.baidu.com";
export class BaiduAdapter extends CloudDocAdapter {
    provider = "baidu";
    name = "百度云";
    async fetchHtml(url) {
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
    async listProducts() {
        const url = `${BASE_URL}/doc/index.html`;
        const html = await this.fetchHtml(url);
        const $ = cheerio.load(html);
        const products = [];
        const seen = new Set();
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
        return products;
    }
    async getDocumentToc(productId) {
        const url = `${BASE_URL}/doc/${productId}/index.html`;
        const html = await this.fetchHtml(url);
        const $ = cheerio.load(html);
        const items = [];
        const seen = new Set();
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
        return items;
    }
    async searchDocuments(productId, keyword) {
        // 百度云没有公开搜索 API，通过遍历文档目录做本地关键词匹配
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
    async getPageMetadata(pageId) {
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
            note: description,
            contentPath: url,
        };
    }
    async getPageContent(contentPath) {
        const html = await this.fetchHtml(contentPath);
        const $ = cheerio.load(html);
        // 提取 post__body 区域的内容，去除页头页脚等无关信息
        const content = $(".post__body").first();
        if (content.length > 0) {
            return htmlToMarkdown(content.html() || "");
        }
        return htmlToMarkdown(html);
    }
}
