/**
 * 云产品别名同义词组（全局的，所有云商适配器共享）
 *
 * 当用户输入某个关键词时，自动扩展为该组中所有同义词进行匹配。
 * 例如：输入 "ECS" 会自动匹配 "ECS"、"云服务器"、"云主机"、"CVM" 等。
 *
 * 组内 OR 逻辑（匹配任一同义词即可），组间 AND 逻辑（多关键词空格分隔）。
 */
const SYNONYM_GROUPS = [
    // ===== 计算服务 =====
    ["ecs", "cvm", "云服务器", "云主机", "虚拟服务器", "弹性云服务器", "弹性计算", "弹性云主机", "计算实例", "ec2", "弹性计算服务"],
    ["云电脑", "云桌面", "桌面云", "虚拟桌面", "云端桌面", "云终端", "虚拟云桌面", "desktop", "daas"],
    // ===== 存储服务 =====
    ["对象存储", "oss", "obs", "cos", "tos", "eos", "云存储", "对象存储服务", "存储桶", "bucket", "object storage"],
    ["块存储", "云盘", "数据盘", "系统盘", "硬盘", "云硬盘", "cbs", "evs"],
    ["文件存储", "nas", "文件系统", "cfs", "efs", "sfs"],
    // ===== 数据库服务 =====
    ["数据库", "rds", "云数据库", "关系型数据库", "数据库服务", "mysql", "postgresql", "sqlserver", "数据库实例"],
    ["redis", "缓存", "内存数据库", "elasticache", "云缓存"],
    ["mongodb", "文档数据库", "dds", "nosql"],
    ["数据仓库", "大数据", "数据湖", "datalake", "olap", "分析型数据库", "clickhouse", "maxcompute"],
    // ===== 网络服务 =====
    ["vpc", "专有网络", "虚拟私有云", "私有网络", "虚拟网络", "vnet"],
    ["负载均衡", "slb", "elb", "clb", "流量分发", "负载均衡器", "alb", "nlb"],
    ["nat", "公网ip", "弹性ip", "eip", "公网地址"],
    ["cdn", "内容分发网络", "全站加速", "dcdn", "边缘加速", "边缘计算"],
    ["dns", "域名解析", "云解析", "域名服务", "域名系统", "解析服务"],
    // ===== 安全服务 =====
    ["安全", "网络安全", "云安全", "安全服务", "防火墙", "waf", "ddos", "安全组", "入侵检测", "堡垒机", "漏洞扫描"],
    ["iam", "访问控制", "身份认证", "权限管理", "认证服务", "ram", "统一认证"],
    // ===== AI / 大模型 =====
    ["人工智能", "ai", "机器学习", "深度学习", "智能服务", "机器学习平台", "pai", "人工智能平台", "智能平台"],
    ["大模型", "llm", "大语言模型", "模型服务", "生成式ai", "生成式人工智能", "千问", "qwen", "百炼", "通义", "moonshot", "kimi", "glm", "天工"],
    ["语音", "语音识别", "语音合成", "tts", "asr", "智能语音"],
    ["视觉", "图像识别", "ocr", "文字识别", "人脸识别", "图像搜索", "视频分析", "视觉智能"],
    // ===== 容器 / 微服务 =====
    ["容器", "kubernetes", "k8s", "容器服务", "容器编排", "docker", "ack", "cce", "tke", "云容器"],
    ["微服务", "service mesh", "服务网格", "微服务引擎", "mse", "istio"],
    ["消息队列", "mq", "消息服务", "kafka", "rocketmq", "rabbitmq", "消息中间件", "事件总线"],
    // ===== Serverless =====
    ["函数计算", "serverless", "无服务器", "函数服务", "faas", "scf", "lambda", "函数工作流"],
    // ===== 监控 / 日志 =====
    ["日志", "日志服务", "日志分析", "日志采集", "log", "日志查询"],
    ["监控", "云监控", "应用监控", "监控服务", "prometheus", "grafana", "alarm", "告警"],
    // ===== 域名 / 证书 =====
    ["域名", "域名注册", "域名服务", "域名管理"],
    ["证书", "ssl", "https", "数字证书", "证书管理", "cas"],
    // ===== 计费 / 账单 =====
    ["计费", "价格", "定价", "费用", "资费", "账单", "成本", "收费", "付费"],
    // ===== 地域 =====
    ["地域", "区域", "地区", "可用区", "az", "可用区域", "region", "节点"],
];
/** 从同义词组构建 alias 查找表 */
function buildAliasMap() {
    const map = new Map();
    for (const group of SYNONYM_GROUPS) {
        for (const term of group) {
            const aliases = group.filter(a => a !== term);
            map.set(term.toLowerCase(), aliases.map(a => a.toLowerCase()));
        }
    }
    return map;
}
const ALIAS_MAP = buildAliasMap();
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
     * 扩展关键词为同义词集合
     *
     * 输入 "ECS" → ["ecs", "云服务器", "云主机", "cvm", ...]
     * 输入 "云电脑" → ["云电脑", "云桌面", "桌面云", ...]
     * 输入 "ECS 价格" → ["ecs", "云服务器", ...] AND ["价格", "计费", ...]
     */
    expandKeyword(keyword) {
        const keywords = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
        return keywords.map(kw => {
            const aliases = ALIAS_MAP.get(kw);
            if (aliases) {
                // 去重：原始词 + 别名
                return [...new Set([kw, ...aliases])];
            }
            return [kw];
        });
    }
    /**
     * 按关键词过滤列表（AND 逻辑，关键词以空格分隔，大小写不敏感）
     *
     * 增强特性：
     * - 别名扩展：输入 "ECS" 自动匹配 "云服务器"、"云主机"、"CVM" 等
     * - 模糊匹配：输入 "服务器" 匹配 "云服务器"、"虚拟服务器" 等
     * - 组内 OR：每个关键词扩展为一组同义词，匹配任一同义词即可
     * - 组间 AND：多个关键词之间仍为 AND 逻辑
     */
    filterByKeywords(items, keyword) {
        if (!keyword)
            return items;
        const expanded = this.expandKeyword(keyword);
        if (expanded.length === 0)
            return items;
        return items.filter(item => {
            const text = ((item.name || item.title || "") + " " + (item.description || "")).toLowerCase();
            // 每个关键词组（OR 逻辑）必须至少有一个匹配
            return expanded.every(synonymGroup => {
                // 先尝试精确匹配（别名扩展）
                const exactMatch = synonymGroup.some(syn => text.includes(syn));
                if (exactMatch)
                    return true;
                // 再尝试模糊匹配：如果原始关键词较短（如 "服务器"），检查是否包含该词
                // 这可以匹配 "云服务器"、"虚拟服务器" 等包含 "服务器" 的产品名
                const originalKw = synonymGroup[0]; // 第一个是原始关键词
                if (originalKw.length >= 2 && text.includes(originalKw))
                    return true;
                return false;
            });
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
