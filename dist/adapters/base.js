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
}
