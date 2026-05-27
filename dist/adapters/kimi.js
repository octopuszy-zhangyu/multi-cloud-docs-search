import { CloudDocAdapter } from "./base.js";
const BASE_URL = "https://platform.kimi.com";
const LLMS_TXT_URL = `${BASE_URL}/docs/llms.txt`;
/**
 * 月之暗面 Kimi 开放平台文档适配器
 *
 * Kimi 文档站基于 Mintlify 框架，文档页面以 .md 格式提供原始 Markdown 内容。
 * 文档索引通过 llms.txt 文件获取，该文件列出所有文档页面的标题和路径。
 */
export class KimiAdapter extends CloudDocAdapter {
    provider = "kimi";
    name = "月之暗面 Kimi";
    async fetchText(url) {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "text/plain, text/markdown, text/html",
            },
        });
        if (!res.ok) {
            throw new Error(`Fetch failed: ${res.status} ${res.statusText} for ${url}`);
        }
        return res.text();
    }
    /**
     * Kimi 只有一个产品：Kimi API 文档
     */
    async listProducts() {
        return [
            {
                productId: "kimi-api",
                name: "Kimi API 文档",
                description: "月之暗面 Kimi 开放平台 API 文档",
            },
        ];
    }
    /**
     * 从 llms.txt 解析文档目录
     *
     * llms.txt 格式：
     *   # 分类标题
     *   - 页面标题: /docs/page-path
     *   - 页面标题: /docs/page-path: 描述
     */
    async getDocumentToc(productId) {
        const text = await this.fetchText(LLMS_TXT_URL);
        const lines = text.split("\n");
        const items = [];
        for (const line of lines) {
            const trimmed = line.trim();
            // 页面条目行: - [标题](URL) 或 - [标题](URL): 描述
            // URL 可能是完整 URL (https://platform.kimi.com/docs/...) 或相对路径 (/docs/...)
            const itemMatch = trimmed.match(/^-\s+\[([^\]]+)\]\(([^)]+)\)(?::\s*(.*))?$/);
            if (itemMatch) {
                const title = itemMatch[1].trim();
                const url = itemMatch[2].trim();
                // 提取路径部分（去掉域名）
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
                items.push({
                    pageId: path,
                    title,
                });
            }
        }
        return items;
    }
    /**
     * 遍历文档目录，按标题匹配关键词
     */
    async searchDocuments(productId, keyword) {
        const toc = await this.getDocumentToc(productId);
        const lowerKeyword = keyword.toLowerCase();
        const results = [];
        for (const item of toc) {
            if (item.title.toLowerCase().includes(lowerKeyword)) {
                results.push({
                    pageId: item.pageId,
                    title: item.title,
                });
            }
        }
        return results;
    }
    /**
     * 获取页面元信息
     *
     * 通过请求 .md 页面获取原始 Markdown 内容，从第一个 # 标题提取页面标题。
     * pageId 格式为 /docs/page-path（如 /docs/api/overview.md）。
     */
    async getPageMetadata(pageId) {
        // 确保 pageId 以 .md 结尾
        const mdPath = pageId.endsWith(".md") ? pageId : `${pageId}.md`;
        const url = `${BASE_URL}${mdPath}`;
        const content = await this.fetchText(url);
        // 从 Markdown 内容中提取标题（第一个 # 开头的行）
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : pageId.split("/").pop()?.replace(/\.md$/, "") || pageId;
        // 提取描述（# 标题后的第一段非空文本）
        const descMatch = content.match(/^#\s+.+?\n\n(.+?)(?:\n\n|\n#)/s);
        const description = descMatch ? descMatch[1].trim().replace(/\n/g, " ") : undefined;
        return {
            pageId,
            title,
            note: description,
            contentPath: url,
            updateDate: undefined,
        };
    }
    /**
     * 获取文档页面 Markdown 正文
     *
     * Kimi 文档站直接返回原始 Markdown 内容，无需 HTML 转换。
     * contentPath 为完整的 .md 页面 URL。
     */
    async getPageContent(contentPath) {
        // 如果 contentPath 是相对路径，补全为完整 URL
        const url = contentPath.startsWith("http") ? contentPath : `${BASE_URL}${contentPath}`;
        const content = await this.fetchText(url);
        // 移除 llms.txt 风格的索引提示行（以 > 开头的行）
        const cleaned = content
            .split("\n")
            .filter((line) => !line.trim().startsWith("> ##"))
            .join("\n")
            .trim();
        return cleaned || "(空内容)";
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
            if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
                const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
                if (!inTable) {
                    headers = cells;
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
    async getProductPrice(productId, _options) {
        const url = `${BASE_URL}/docs/pricing.md`;
        const markdown = await this.fetchText(url);
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
