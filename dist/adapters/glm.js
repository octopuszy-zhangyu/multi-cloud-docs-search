import * as cheerio from "cheerio";
import { CloudDocAdapter } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";
const BASE_URL = "https://docs.bigmodel.cn";
const LLMS_TXT_URL = `${BASE_URL}/llms.txt`;
const LLMS_FULL_TXT_URL = `${BASE_URL}/llms-full.txt`;
/**
 * 智谱 GLM 文档适配器
 *
 * 文档站基于 Mintlify 构建，页面为客户端渲染 SPA。
 * - 文档目录和搜索通过 llms.txt 解析
 * - 页面正文通过 llms-full.txt 获取完整内容
 * - 页面元信息通过 HTML 页面提取
 */
export class GlmAdapter extends CloudDocAdapter {
    provider = "glm";
    name = "智谱 GLM";
    llmsEntriesCache = null;
    llmsFullContentCache = null;
    /**
     * 解析 llms.txt，提取所有文档条目
     *
     * llms.txt 格式：
     * - [标题](URL): 描述
     */
    async parseLlmsTxt() {
        if (this.llmsEntriesCache) {
            return this.llmsEntriesCache;
        }
        const text = await this.fetchText(LLMS_TXT_URL);
        const entries = [];
        const lines = text.split("\n");
        for (const line of lines) {
            // 匹配格式: - [标题](URL): 描述
            const match = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)(?:\s*:\s*(.*))?$/);
            if (match) {
                const title = match[1].trim();
                const url = match[2].trim();
                const description = match[3]?.trim();
                // 提取路径部分（去掉域名）
                let path;
                if (url.startsWith("http")) {
                    const urlObj = new URL(url);
                    path = urlObj.pathname;
                }
                else {
                    path = url;
                }
                entries.push({ title, path, description });
            }
        }
        this.llmsEntriesCache = entries;
        return entries;
    }
    /**
     * 获取 llms-full.txt 的完整内容
     */
    async getLlmsFullContent() {
        if (this.llmsFullContentCache) {
            return this.llmsFullContentCache;
        }
        const content = await this.fetchText(LLMS_FULL_TXT_URL);
        this.llmsFullContentCache = content;
        return content;
    }
    /**
     * 按关键词过滤项目（AND 逻辑）
     */
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
    /**
     * 分页处理
     */
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
    /**
     * 从 llms-full.txt 中提取指定页面的内容
     *
     * llms-full.txt 格式：
     * # 标题
     * Source: URL
     *
     * 正文内容...
     *
     * # 下一个标题
     * ...
     */
    async extractPageContentFromLlmsFull(targetPath) {
        const fullContent = await this.getLlmsFullContent();
        // 构建 Source 行匹配模式（llms-full.txt 中的 Source URL 不带 .md 扩展名）
        const cleanPath = targetPath.replace(/\.md$/, "");
        const sourceUrl = cleanPath.startsWith("http") ? cleanPath : `${BASE_URL}${cleanPath}`;
        const escapedSource = sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // 匹配 Source 行及其后的内容，直到下一个 # 标题或文件末尾
        const regex = new RegExp(`^Source:\\s*${escapedSource}\\s*\\n\\n([\\s\\S]*?)(?=\\n^#\\s|\\n^Source:\\s|\\z)`, "m");
        const match = fullContent.match(regex);
        if (match) {
            return match[1].trim();
        }
        return null;
    }
    async listProducts(options) {
        const allProducts = [
            {
                productId: "bigmodel",
                name: "智谱 GLM API 文档",
                description: "智谱开放平台 API 文档",
            },
        ];
        const filtered = this.filterByKeywords(allProducts, options?.keyword);
        return this.paginate(filtered, options?.page ?? 1, options?.pageSize ?? 100);
    }
    async getDocumentToc(productId, options) {
        const entries = await this.parseLlmsTxt();
        // 构建目录列表（按 llms.txt 原始顺序，去重）
        const allToc = [];
        const seen = new Set();
        for (const entry of entries) {
            if (!seen.has(entry.path)) {
                seen.add(entry.path);
                allToc.push({
                    pageId: entry.path,
                    title: entry.title,
                });
            }
        }
        let filtered = this.filterByKeywords(allToc, options?.keyword);
        // If topOnly is true, strip children (none of our items have children, but honor the flag)
        if (options?.topOnly) {
            filtered = filtered.map(item => ({ ...item, children: undefined }));
        }
        return this.paginate(filtered, options?.page ?? 1, options?.pageSize ?? 200);
    }
    async searchDocuments(productId, keyword) {
        const entries = await this.parseLlmsTxt();
        const lowerKeyword = keyword.toLowerCase();
        const results = [];
        for (const entry of entries) {
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
    async getPageMetadata(pageId) {
        // pageId 是路径，如 /cn/guide/start/quick-start
        // llms.txt 中的 URL 可能有 .md 扩展名，需要去掉
        const cleanPath = pageId.replace(/\.md$/, "");
        const url = `${BASE_URL}${cleanPath}`;
        const html = await this.fetchHtml(url);
        const $ = cheerio.load(html);
        const title = $("title").text().replace(/\s*-\s*智谱AI开放文档\s*$/, "").trim();
        const description = $('meta[name="description"]').attr("content") ||
            $('meta[property="og:description"]').attr("content") ||
            "";
        return {
            pageId,
            title: title || cleanPath,
            note: description,
            contentPath: cleanPath,
        };
    }
    async getPageContent(contentPath) {
        // 先尝试从 llms-full.txt 提取完整内容
        const fullContent = await this.extractPageContentFromLlmsFull(contentPath);
        if (fullContent) {
            // llms-full.txt 中的内容是 MDX 格式，包含 JSX 组件标签
            // 使用 htmlToMarkdown 进行转换
            return htmlToMarkdown(fullContent);
        }
        // 回退方案：抓取 HTML 页面并转换
        const cleanPath = contentPath.replace(/\.md$/, "");
        const url = cleanPath.startsWith("http") ? cleanPath : `${BASE_URL}${cleanPath}`;
        const html = await this.fetchHtml(url);
        if (html.length <= 1) {
            return "(页面为客户端渲染 SPA，无法获取服务端内容)";
        }
        return htmlToMarkdown(html);
    }
    /**
     * 从 Markdown 表格中解析价格数据
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
        // 先尝试从 llms-full.txt 中查找定价相关内容
        try {
            const fullContent = await this.getLlmsFullContent();
            // 查找包含 "pricing" 或 "价格" 的页面内容
            const lines = fullContent.split("\n");
            let inPricingSection = false;
            let pricingContent = "";
            for (const line of lines) {
                if (line.toLowerCase().includes("pricing") || line.includes("价格")) {
                    inPricingSection = true;
                }
                if (inPricingSection) {
                    pricingContent += line + "\n";
                    // 如果遇到下一个 Source 行，停止收集
                    if (line.startsWith("Source:") && pricingContent.length > 100) {
                        break;
                    }
                }
            }
            if (pricingContent.length > 50) {
                const prices = this.parsePriceTable(pricingContent);
                if (prices.length > 0) {
                    return {
                        provider: this.provider,
                        name: this.name,
                        prices,
                        source: "https://open.bigmodel.cn/pricing",
                    };
                }
            }
        }
        catch {
            // 继续尝试其他方式
        }
        // 回退：返回提示信息
        return {
            provider: this.provider,
            name: this.name,
            prices: [],
            source: "https://open.bigmodel.cn/pricing",
            message: "智谱 GLM 定价页面（open.bigmodel.cn/pricing）为 JS 动态渲染的 SPA，无法通过普通 HTTP 请求抓取。建议直接访问 https://open.bigmodel.cn/pricing 查看最新价格。如需程序化获取，可尝试通过 get_page_content 获取定价相关文档页面。",
            note: "定价页面为 SPA，需浏览器渲染，无法直接抓取",
        };
    }
}
