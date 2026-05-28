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
    /**
     * Kimi 只有一个产品：Kimi API 文档
     */
    async listProducts(options) {
        const allProducts = [
            {
                productId: "kimi-api",
                name: "Kimi API 文档",
                description: "月之暗面 Kimi 开放平台 API 文档",
            },
        ];
        const filtered = this.filterByKeywords(allProducts, options?.keyword);
        return this.paginate(filtered, options?.page ?? 1, options?.pageSize ?? 100);
    }
    /**
     * 从 llms.txt 解析文档目录
     *
     * llms.txt 格式：
     *   # 分类标题
     *   - 页面标题: /docs/page-path
     *   - 页面标题: /docs/page-path: 描述
     */
    async getDocumentToc(productId, options) {
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
        const filtered = this.filterByKeywords(items, options?.keyword);
        // 如果 topOnly 为 true，剥离 children
        const topItems = options?.topOnly
            ? filtered.map(({ children: _, ...item }) => item)
            : filtered;
        return this.paginate(topItems, options?.page ?? 1, options?.pageSize ?? 200);
    }
    /**
     * 遍历文档目录，按标题匹配关键词
     */
    async searchDocuments(productId, keyword) {
        const toc = await this.getDocumentToc(productId);
        const lowerKeyword = keyword.toLowerCase();
        const results = [];
        for (const item of toc.items) {
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
     * 按关键词过滤条目（AND 逻辑，大小写不敏感）
     */
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
    /**
     * 对数组进行分页包装
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
     * 从 React DocTable 组件格式中解析价格数据
     *
     * Kimi 定价页面使用自定义 React 组件 DocTable 渲染表格，格式为：
     * <DocTable
     *   columns={[{ title: "模型", width: "..." }, ...]}
     *   rows={[
     *     ["model-name", "1M tokens", "¥1.10", "¥6.50", "¥27.00", "262,144 tokens"],
     *   ]}
     * />
     *
     * 解析策略：提取 columns 的 title 和 rows 的单元格数据，映射为 PriceItem。
     */
    parseDocTable(markdown) {
        const prices = [];
        // 提取所有 <DocTable .../> 块
        const docTableRegex = /<DocTable\s*[\s\S]*?\/>/g;
        const tables = markdown.match(docTableRegex);
        if (!tables)
            return prices;
        for (const table of tables) {
            // 提取 columns 数组
            const columnsMatch = table.match(/columns\s*=\s*\{(\[[\s\S]*?\])\}/);
            if (!columnsMatch)
                continue;
            // 提取 rows 数组
            const rowsMatch = table.match(/rows\s*=\s*\{(\[[\s\S]*?\])\}/);
            if (!rowsMatch)
                continue;
            // 解析 columns 标题
            const columnTitles = [];
            const colRegex = /\{\s*title:\s*"([^"]*)"[^}]*\}/gs;
            let colMatch;
            while ((colMatch = colRegex.exec(columnsMatch[1])) !== null) {
                columnTitles.push(colMatch[1]);
            }
            if (columnTitles.length < 2)
                continue;
            // 确定各列索引
            const modelIdx = columnTitles.findIndex((t) => /模型/.test(t));
            const unitIdx = columnTitles.findIndex((t) => /计费单位/.test(t));
            // 找到价格列（排除模型名、计费单位、上下文窗口列）
            const priceIndices = [];
            const skipIndices = new Set([modelIdx, unitIdx]);
            // 上下文窗口列
            const ctxIdx = columnTitles.findIndex((t) => /上下文/.test(t));
            if (ctxIdx >= 0)
                skipIndices.add(ctxIdx);
            for (let i = 0; i < columnTitles.length; i++) {
                if (!skipIndices.has(i)) {
                    priceIndices.push(i);
                }
            }
            // 解析 rows 数据
            // 匹配 ["value1", "value2", ...] 格式的数组（支持换行）
            const rowArrayRegex = /\[((?:"[^"]*"\s*,\s*)*"[^"]*")\]/gs;
            let rowMatch;
            while ((rowMatch = rowArrayRegex.exec(rowsMatch[1])) !== null) {
                // 解析数组中的字符串元素
                const cellRegex = /"([^"]*)"/g;
                const cells = [];
                let cellMatch;
                while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
                    cells.push(cellMatch[1]);
                }
                if (cells.length < 2)
                    continue;
                const productName = modelIdx >= 0 && modelIdx < cells.length ? cells[modelIdx] : cells[0];
                const unit = unitIdx >= 0 && unitIdx < cells.length ? cells[unitIdx] : "1M tokens";
                // 提取所有价格
                for (const priceIdx of priceIndices) {
                    if (priceIdx >= cells.length)
                        continue;
                    const priceStr = cells[priceIdx];
                    // 提取价格数字（去掉 ¥ 符号）
                    const priceNum = parseFloat(priceStr.replace(/[¥￥,]/g, ""));
                    if (isNaN(priceNum))
                        continue;
                    // 根据列标题确定价格类型
                    const colTitle = columnTitles[priceIdx] || "";
                    let specification = colTitle;
                    let billingMode = "按量";
                    // 判断是否为缓存命中价格
                    if (/缓存命中/.test(colTitle)) {
                        specification = `${colTitle}`;
                    }
                    else if (/缓存未命中/.test(colTitle)) {
                        specification = `${colTitle}`;
                    }
                    else if (/输出/.test(colTitle)) {
                        specification = `${colTitle}`;
                    }
                    else if (/输入/.test(colTitle)) {
                        specification = `${colTitle}`;
                    }
                    // 统一单位
                    let normalizedUnit = "元/百万Token";
                    if (unit.includes("次")) {
                        normalizedUnit = "元/次";
                    }
                    prices.push({
                        productName,
                        specification,
                        billingMode,
                        price: priceNum,
                        unit: normalizedUnit,
                        currency: "CNY",
                        source: "文档定价页面",
                    });
                }
            }
        }
        return prices;
    }
    /**
     * 从 Markdown 表格中解析价格数据（备用方案）
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
    /**
     * Kimi 定价页面列表
     */
    PRICING_PAGES = [
        { path: "/docs/pricing/chat-k26.md", name: "Kimi K2.6" },
        { path: "/docs/pricing/chat-k25.md", name: "Kimi K2.5" },
        { path: "/docs/pricing/chat-v1.md", name: "Moonshot V1" },
        { path: "/docs/pricing/batch.md", name: "批量推理" },
        { path: "/docs/pricing/tools.md", name: "联网搜索" },
    ];
    async getProductPrice(productId, _options) {
        const allPrices = [];
        for (const page of this.PRICING_PAGES) {
            try {
                const url = `${BASE_URL}${page.path}`;
                const markdown = await this.fetchText(url);
                const prices = this.parseDocTable(markdown);
                allPrices.push(...prices);
            }
            catch {
                // 单个页面失败不影响其他页面
                continue;
            }
        }
        return {
            provider: this.provider,
            name: this.name,
            prices: allPrices,
            source: `${BASE_URL}/docs/pricing`,
            updateDate: undefined,
        };
    }
}
