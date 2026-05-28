import { CloudDocAdapter } from "./base.js";
const BASE_URL = "https://platform.minimaxi.com";
const LLMS_URL = `${BASE_URL}/docs/llms.txt`;
/** MiniMax 文档适配器 */
export class MinimaxAdapter extends CloudDocAdapter {
    provider = "minimax";
    name = "MiniMax";
    filterByKeywords(items, keyword) {
        if (!keyword)
            return items;
        const keywords = keyword.trim().split(/\s+/).filter(Boolean);
        if (keywords.length === 0)
            return items;
        return items.filter((item) => {
            const text = (item.name || item.title || "").toLowerCase();
            return keywords.every((kw) => text.includes(kw.toLowerCase()));
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
    async listProducts(options) {
        // MiniMax 只有一个产品
        const allProducts = [
            {
                productId: "minimax-api",
                name: "MiniMax API 文档",
                description: "MiniMax 开放平台 API 文档",
            },
        ];
        const filtered = this.filterByKeywords(allProducts, options?.keyword);
        return this.paginate(filtered, options?.page, options?.pageSize);
    }
    async getDocumentToc(productId, options) {
        const text = await this.fetchText(LLMS_URL);
        const lines = text.split("\n");
        const items = [];
        let currentGroup = null;
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            // 跳过顶级标题
            if (trimmed.startsWith("# ")) {
                continue;
            }
            // 解析格式: ## 章节标题（二级分类）
            if (trimmed.startsWith("## ")) {
                const title = trimmed.substring(3).trim();
                currentGroup = {
                    pageId: "",
                    title: title,
                    children: [],
                };
                items.push(currentGroup);
                continue;
            }
            // 解析文档项: - [标题](https://platform.minimaxi.com/docs/path.md): 描述
            // 或者: - [标题](path.md): 描述
            const match = trimmed.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)(?::\s*(.*))?$/);
            if (match) {
                const title = match[1].trim();
                const url = match[2].trim();
                // 从 URL 中提取路径，如 https://platform.minimaxi.com/docs/api-reference/xxx.md -> /docs/api-reference/xxx
                let path = url;
                if (url.startsWith(BASE_URL)) {
                    path = url.substring(BASE_URL.length);
                }
                else if (url.startsWith("http")) {
                    // 其他域名的 URL 跳过
                    continue;
                }
                // 移除 .md 扩展名
                if (path.endsWith(".md")) {
                    path = path.substring(0, path.length - 3);
                }
                // 添加到当前分组或顶层
                if (currentGroup && currentGroup.children !== undefined) {
                    currentGroup.children.push({
                        pageId: path,
                        title: title,
                    });
                }
                else {
                    items.push({
                        pageId: path,
                        title: title,
                    });
                }
            }
        }
        // 清理空分组
        let result = items.filter((item) => {
            if (item.pageId === "" && item.children && item.children.length === 0) {
                return false;
            }
            return true;
        });
        // Apply topOnly: strip children from items
        if (options?.topOnly) {
            result = result.map((item) => ({ ...item, children: undefined }));
        }
        // Apply keyword filtering
        const filtered = this.filterByKeywords(result, options?.keyword);
        return this.paginate(filtered, options?.page, options?.pageSize ?? 200);
    }
    async searchDocuments(productId, keyword) {
        const tocResult = await this.getDocumentToc(productId);
        const toc = tocResult.items;
        const lowerKeyword = keyword.toLowerCase();
        const results = [];
        const searchToc = (items) => {
            for (const item of items) {
                if (item.title.toLowerCase().includes(lowerKeyword)) {
                    // 跳过分组标题（无 pageId），但分组标题本身也可能匹配
                    if (item.pageId) {
                        results.push({
                            pageId: item.pageId,
                            title: item.title,
                        });
                    }
                }
                // 递归搜索子节点
                if (item.children) {
                    searchToc(item.children);
                }
            }
        };
        searchToc(toc);
        return results;
    }
    async getPageMetadata(pageId) {
        // pageId 就是路径，如 /docs/api-reference/models/openai/list-models
        const url = `${BASE_URL}${pageId}`;
        // 获取 Markdown 内容
        const content = await this.fetchText(url);
        // 从 Markdown 中提取标题（第一行 # 标题）
        let title = "MiniMax 文档";
        const lines = content.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("# ")) {
                title = trimmed.substring(2).trim();
                break;
            }
        }
        return {
            pageId,
            title,
            note: "",
            contentPath: url,
        };
    }
    async getPageContent(contentPath) {
        // MiniMax 文档直接返回 Markdown，无需 HTML 转换
        const content = await this.fetchText(contentPath);
        return content;
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
                            unit: "元/千Token",
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
        const url = `${BASE_URL}/docs/guides/pricing-paygo.md`;
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
