/** 默认请求头 */
const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};
/** 云厂商文档适配器抽象基类 */
export class CloudDocAdapter {
    /** 带超时的 fetch 请求，默认 15 秒超时 */
    async fetchWithTimeout(url, options = {}) {
        const { timeout = 15000, ...fetchOptions } = options;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
            return response;
        }
        finally {
            clearTimeout(timer);
        }
    }
    /** 带超时和指数退避重试的 fetch 请求，默认重试 2 次 */
    async fetchWithRetry(url, options = {}, retries = 2) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                return await this.fetchWithTimeout(url, options);
            }
            catch (error) {
                if (attempt === retries)
                    throw error;
                const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
                await new Promise(r => setTimeout(r, delay));
            }
        }
        throw new Error("Unreachable");
    }
    /** 获取 HTML 文本 */
    async fetchHtml(url) {
        const res = await this.fetchWithRetry(url, {
            headers: { ...DEFAULT_HEADERS, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
        });
        if (res.status === 404) {
            throw new Error(`页面不存在 (404): ${url}`);
        }
        if (!res.ok) {
            throw new Error(`请求失败: ${res.status} ${res.statusText} — ${url}`);
        }
        return res.text();
    }
    /** 获取 JSON 数据 */
    async fetchJson(url) {
        const res = await this.fetchWithRetry(url, {
            headers: { ...DEFAULT_HEADERS, "Accept": "application/json" },
        });
        if (!res.ok) {
            throw new Error(`请求失败: ${res.status} ${res.statusText} — ${url}`);
        }
        return res.json();
    }
    /** 获取纯文本内容 */
    async fetchText(url) {
        const res = await this.fetchWithRetry(url, {
            headers: { ...DEFAULT_HEADERS, "Accept": "text/plain,text/html,*/*" },
        });
        if (!res.ok) {
            throw new Error(`请求失败: ${res.status} ${res.statusText} — ${url}`);
        }
        return res.text();
    }
    // ========== 可重用的辅助方法 ==========
    /**
     * 按关键词过滤列表（AND 逻辑，关键词以空格分隔，大小写不敏感）
     */
    filterByKeywords(items, keyword) {
        if (!keyword)
            return items;
        const keywords = keyword.trim().split(/\s+/).filter(Boolean);
        if (keywords.length === 0)
            return items;
        return items.filter(item => {
            const text = ((item.name || item.title || "") + " " + (item.description || "")).toLowerCase();
            return keywords.every(kw => text.includes(kw.toLowerCase()));
        });
    }
    /**
     * 数组分页包装
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
     * 合并 filterByKeywords + paginate 的快捷方法
     */
    paginateProducts(products, options) {
        const filtered = this.filterByKeywords(products, options?.keyword);
        return this.paginate(filtered, options?.page ?? 1, options?.pageSize ?? 100);
    }
    /**
     * 根据价格数组判断数据状态
     */
    determineDataStatus(prices) {
        if (prices.length > 0 && prices[0].price > 0)
            return "complete";
        if (prices.length > 0 && prices[0].price === 0)
            return "no_price";
        return "no_data";
    }
    /**
     * 构造 PriceResult 的快捷方法
     */
    makePriceResult(prices, extra) {
        return {
            provider: this.provider,
            name: this.name,
            prices,
            dataStatus: this.determineDataStatus(prices),
            ...extra,
        };
    }
    /**
     * 解析 Markdown 表格行，返回二维字符串数组
     * 子类可基于此构建 PriceItem
     */
    parseMarkdownTable(markdown) {
        const lines = markdown.split("\n");
        const headers = [];
        const rows = [];
        let inTable = false;
        for (const line of lines) {
            if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
                const cells = line.split("|").map(c => c.trim()).filter(Boolean);
                if (!inTable) {
                    headers.push(...cells);
                    inTable = true;
                    continue;
                }
                if (cells.every(c => /^[-:\s]+$/.test(c)))
                    continue;
                if (cells.length >= 2) {
                    rows.push(cells);
                }
                continue;
            }
            if (inTable && line.trim() !== "") {
                inTable = false;
            }
        }
        return { headers, rows };
    }
}
