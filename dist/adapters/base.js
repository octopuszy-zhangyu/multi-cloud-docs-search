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
}
