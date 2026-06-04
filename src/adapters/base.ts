/** 统一产品接口 */
export interface Product {
  productId: string;
  name: string;
  description?: string;
}

/** 文档目录项 */
export interface TocItem {
  pageId: string;
  title: string;
  children?: TocItem[];
}

/** 搜索结果项 */
export interface SearchResult {
  pageId: string;
  title: string;
  description?: string;
}

/** 页面元信息 */
export interface PageMetadata {
  pageId: string;
  title: string;
  note?: string;
  contentPath: string;
  chapterId?: string;
  bookId?: string;
  updateDate?: string;
}

/** 价格条目 */
export interface PriceItem {
  productName: string;
  region?: string;
  billingMode: string;
  price: number;
  unit: string;
  /** 组件类型（可选）：如云电脑=vm, 系统盘=sysDisk, 数据盘=dataDisk */
  componentType?: string;
}

/**
 * 规格-配置-价格联合条目
 * 将规格名称、CPU/内存配置、价格信息 JOIN 成一条记录
 */
export interface SpecPriceItem {
  /** 规格名称，如 "ecs.c7.xlarge"、"S5.LARGE8" */
  specName: string;
  /** CPU 核数 */
  cpu: number;
  /** 内存大小（GB） */
  mem: number;
  /** 用户友好的显示名，如 "4C8G" */
  displayName: string;
  /** 地域 */
  region?: string;
  /** 计费模式 */
  billingMode: string;
  /** 价格数值 */
  price: number;
  /** 价格单位 */
  unit: string;
  /** 规格族名称（可选），如 "计算型 c7" */
  familyName?: string;
}

/** 价格查询结果 */
export interface PriceResult {
  provider: string;
  name: string;
  prices: PriceItem[];
  updateDate?: string;
  message?: string;
  total?: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  /** 数据完整性标记：complete=有完整价格数据, partial=部分数据, no_price=文档无价格, no_data=无数据 */
  dataStatus?: "complete" | "partial" | "no_price" | "no_data";
}

/** 价格查询选项 */
export interface PriceQueryOptions {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

/** 分页结果包装 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** 查询参数 */
export interface ListProductsOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface TocOptions {
  keyword?: string;
  page?: number;
  pageSize?: number;
  topOnly?: boolean;
}

/**
 * 云产品别名同义词组（全局的，所有云商适配器共享）
 *
 * 当用户输入某个关键词时，自动扩展为该组中所有同义词进行匹配。
 * 例如：输入 "ECS" 会自动匹配 "ECS"、"云服务器"、"云主机"、"CVM" 等。
 *
 * 组内 OR 逻辑（匹配任一同义词即可），组间 AND 逻辑（多关键词空格分隔）。
 */
const SYNONYM_GROUPS: string[][] = [
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
function buildAliasMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
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
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

/** 云厂商文档适配器抽象基类 */
export abstract class CloudDocAdapter {
  /** 厂商标识，如 "ctyun"、"aliyun" */
  abstract readonly provider: string;
  /** 厂商中文名称，如 "天翼云"、"阿里云" */
  abstract readonly name: string;

  /** 带超时的 fetch 请求，默认 15 秒超时 */
  protected async fetchWithTimeout(url: string, options: RequestInit & { timeout?: number } = {}): Promise<Response> {
    const { timeout = 15000, ...fetchOptions } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 带超时和指数退避重试的 fetch 请求，默认重试 2 次 */
  protected async fetchWithRetry(url: string, options: RequestInit & { timeout?: number } = {}, retries = 2): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.fetchWithTimeout(url, options);
      } catch (error) {
        if (attempt === retries) throw error;
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error("Unreachable");
  }

  /** 获取 HTML 文本 */
  protected async fetchHtml(url: string): Promise<string> {
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
  protected async fetchJson<T>(url: string): Promise<T> {
    const res = await this.fetchWithRetry(url, {
      headers: { ...DEFAULT_HEADERS, "Accept": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`请求失败: ${res.status} ${res.statusText} — ${url}`);
    }
    return res.json() as Promise<T>;
  }

  /** 获取纯文本内容 */
  protected async fetchText(url: string): Promise<string> {
    const res = await this.fetchWithRetry(url, {
      headers: { ...DEFAULT_HEADERS, "Accept": "text/plain,text/html,*/*" },
    });
    if (!res.ok) {
      throw new Error(`请求失败: ${res.status} ${res.statusText} — ${url}`);
    }
    return res.text();
  }

  /** 获取所有产品文档列表 */
  abstract listProducts(options?: ListProductsOptions): Promise<PaginatedResult<Product>>;

  /** 获取指定产品的文档目录树 */
  abstract getDocumentToc(productId: string, options?: TocOptions): Promise<PaginatedResult<TocItem>>;

  /** 在产品文档中搜索关键词 */
  abstract searchDocuments(productId: string, keyword: string): Promise<SearchResult[]>;

  /** 获取页面元信息（含 contentPath） */
  abstract getPageMetadata(pageId: string): Promise<PageMetadata>;

  /** 获取文档页面 Markdown 正文 */
  abstract getPageContent(contentPath: string): Promise<string>;

  /** 获取产品价格信息 */
  abstract getProductPrice(productId?: string, options?: PriceQueryOptions): Promise<PriceResult>;

  /**
   * 构建规格-配置-价格联合表
   * 将规格名称、CPU/内存配置、价格信息 JOIN 成一条记录
   * 子类可覆盖此方法以提供更精确的规格映射
   */
  async buildSpecPriceTable(productId?: string): Promise<SpecPriceItem[]> {
    // 默认实现：从 getProductPrice 返回的 PriceItem 中尝试解析规格信息
    const result = await this.getProductPrice(productId);
    return this.parseSpecFromPriceItems(result.prices);
  }

  /**
   * 从 PriceItem 中尝试解析规格信息
   * 默认实现：从 productName 中提取 CPU/内存信息
   * 子类可覆盖以提供更精确的解析
   */
  protected parseSpecFromPriceItems(prices: PriceItem[]): SpecPriceItem[] {
    const specMap = new Map<string, SpecPriceItem>();

    for (const p of prices) {
      const name = p.productName || "";
      const lower = name.toLowerCase();

      // 尝试从 productName 中提取 CPU 和内存信息
      // 常见格式: "ecs.c7.xlarge - 2 vCPU 4 GiB"、"弹性云主机 e.xlarge.2"
      let cpu = 0;
      let mem = 0;

      // 匹配 "N vCPU" 或 "N核" 或 "N Core"
      const cpuMatch = lower.match(/(\d+)\s*(?:v?cpu|核|core)/i);
      if (cpuMatch) cpu = parseInt(cpuMatch[1]);

      // 匹配 "N GiB" 或 "N GB" 或 "N G" 或 "N内存"
      const memMatch = lower.match(/(\d+)\s*(?:gi?b|gb|g|内存)/i);
      if (memMatch) mem = parseInt(memMatch[1]);

      // 如果没找到，尝试从规格名中推断（如 "e.xlarge.2" 中的 xlarge=4C8G）
      if (cpu === 0 || mem === 0) {
        const inferred = this.inferSpecFromName(name);
        if (inferred) {
          if (cpu === 0) cpu = inferred.cpu;
          if (mem === 0) mem = inferred.mem;
        }
      }

      if (cpu === 0 || mem === 0) continue;

      const displayName = `${cpu}C${mem}G`;
      const specName = name.split(" - ")[0].trim(); // 取规格名部分

      const key = `${specName}_${p.region || ""}_${p.billingMode}`;
      if (!specMap.has(key)) {
        specMap.set(key, {
          specName,
          cpu,
          mem,
          displayName,
          region: p.region,
          billingMode: p.billingMode,
          price: p.price,
          unit: p.unit,
        });
      }
    }

    return Array.from(specMap.values());
  }

  /**
   * 从规格名称推断 CPU/内存配置
   * 处理各厂商的规格命名惯例
   */
  protected inferSpecFromName(name: string): { cpu: number; mem: number } | null {
    const lower = name.toLowerCase();

    // 阿里云: ecs.c7.xlarge → xlarge=4C8G
    // 腾讯云: S5.LARGE8 → LARGE8=4C8G
    // 天翼云: e.xlarge.2 → xlarge=4C8G
    // 火山引擎: g3i.large → large=2C4G

    const specMap: Record<string, { cpu: number; mem: number }> = {
      "xlarge2": { cpu: 4, mem: 8 },
      "xlarge.2": { cpu: 4, mem: 8 },
      "xlarge.4": { cpu: 4, mem: 16 },
      "xlarge.8": { cpu: 4, mem: 32 },
      "xlarge": { cpu: 4, mem: 8 },  // 通用 xlarge = 4C8G
      "2xlarge": { cpu: 8, mem: 16 },
      "3xlarge": { cpu: 12, mem: 24 },
      "4xlarge": { cpu: 16, mem: 32 },
      "6xlarge": { cpu: 24, mem: 48 },
      "8xlarge": { cpu: 32, mem: 64 },
      "12xlarge": { cpu: 48, mem: 96 },
      "16xlarge": { cpu: 64, mem: 128 },
      "24xlarge": { cpu: 96, mem: 192 },
      "large": { cpu: 2, mem: 4 },
      "medium": { cpu: 1, mem: 2 },
      "small": { cpu: 1, mem: 1 },
      "large8": { cpu: 4, mem: 8 },
      "large4": { cpu: 4, mem: 4 },
      "large16": { cpu: 4, mem: 16 },
      "medium16": { cpu: 1, mem: 16 },
    };

    // 按 key 长度降序排列，优先匹配更具体的规格名
    const sortedEntries = Object.entries(specMap).sort(([a], [b]) => b.length - a.length);

    for (const [key, spec] of sortedEntries) {
      if (lower.includes(key)) return spec;
    }

    return null;
  }

  /**
   * 按 CPU/内存配置过滤规格价格表
   * 支持 "4C8G"、"4核8G"、"4c8g" 等格式
   */
  filterSpecPriceTable(table: SpecPriceItem[], keyword?: string): SpecPriceItem[] {
    if (!keyword) return table;

    const lower = keyword.toLowerCase().replace(/\s+/g, "");

    // 匹配 "4C8G"、"4核8G"、"4c8g" 等格式
    const match = lower.match(/(\d+)\s*[cC核]\s*(\d+)\s*[gG]/);
    if (match) {
      const targetCpu = parseInt(match[1]);
      const targetMem = parseInt(match[2]);
      return table.filter(item => item.cpu === targetCpu && item.mem === targetMem);
    }

    // 只匹配核数 "4C"、"4核"
    const cpuOnly = lower.match(/(\d+)\s*[cC核]/);
    if (cpuOnly) {
      const targetCpu = parseInt(cpuOnly[1]);
      return table.filter(item => item.cpu === targetCpu);
    }

    // 回退到关键词模糊匹配
    return table.filter(item =>
      item.specName.toLowerCase().includes(lower) ||
      item.displayName.toLowerCase().includes(lower) ||
      item.familyName?.toLowerCase().includes(lower)
    );
  }

  /**
   * 从多 region 的规格价格表中，自动选取规格最全的一个 region
   *
   * 原理：按 region 分组，统计每个 region 的规格数（按 specName 去重），
   * 选规格数最多的 region 返回。如果多个 region 规格数相同，选第一个。
   *
   * @param table 多 region 的规格价格表
   * @param keyword 可选，如果传了 keyword，先过滤再选 region
   * @returns 只包含最佳 region 的规格价格表
   */
  pickBestRegion(table: SpecPriceItem[], keyword?: string): SpecPriceItem[] {
    if (table.length === 0) return table;

    // 先按 keyword 过滤（如果有）
    const filtered = keyword ? this.filterSpecPriceTable(table, keyword) : table;
    if (filtered.length === 0) return table;

    // 如果只有一个 region 或没有 region，直接返回过滤后的结果
    const regions = new Set(filtered.map(i => i.region || ""));
    if (regions.size <= 1) return filtered;

    // 按 region 分组，统计每个 region 的规格数（按 specName 去重）
    const regionStats = new Map<string, { specCount: number; items: SpecPriceItem[] }>();
    for (const item of filtered) {
      const r = item.region || "默认";
      if (!regionStats.has(r)) regionStats.set(r, { specCount: 0, items: [] });
      regionStats.get(r)!.items.push(item);
    }

    // 统计每个 region 的去重规格数
    for (const [r, stats] of regionStats) {
      const uniqueSpecs = new Set(stats.items.map(i => i.specName));
      stats.specCount = uniqueSpecs.size;
    }

    // 选规格数最多的 region
    let bestRegion = "";
    let bestCount = 0;
    for (const [r, stats] of regionStats) {
      if (stats.specCount > bestCount) {
        bestCount = stats.specCount;
        bestRegion = r;
      }
    }

    const bestItems = regionStats.get(bestRegion)?.items || [];
    return bestItems;
  }

  // ========== 可重用的辅助方法 ==========

  /**
   * 扩展关键词为同义词集合
   *
   * 输入 "ECS" → ["ecs", "云服务器", "云主机", "cvm", ...]
   * 输入 "云电脑" → ["云电脑", "云桌面", "桌面云", ...]
   * 输入 "ECS 价格" → ["ecs", "云服务器", ...] AND ["价格", "计费", ...]
   */
  protected expandKeyword(keyword: string): string[][] {
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
  protected filterByKeywords<T extends { name?: string; title?: string; description?: string }>(items: T[], keyword?: string): T[] {
    if (!keyword) return items;
    const expanded = this.expandKeyword(keyword);
    if (expanded.length === 0) return items;

    return items.filter(item => {
      const text = ((item.name || item.title || "") + " " + (item.description || "")).toLowerCase();

      // 每个关键词组（OR 逻辑）必须至少有一个匹配
      return expanded.every(synonymGroup => {
        // 先尝试精确匹配（别名扩展）
        const exactMatch = synonymGroup.some(syn => text.includes(syn));
        if (exactMatch) return true;

        // 再尝试模糊匹配：如果原始关键词较短（如 "服务器"），检查是否包含该词
        // 这可以匹配 "云服务器"、"虚拟服务器" 等包含 "服务器" 的产品名
        const originalKw = synonymGroup[0]; // 第一个是原始关键词
        if (originalKw.length >= 2 && text.includes(originalKw)) return true;

        return false;
      });
    });
  }

  /**
   * 数组分页包装
   */
  protected paginate<T>(items: T[], page: number = 1, pageSize: number = 100): PaginatedResult<T> {
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
  protected paginateProducts(products: Product[], options?: ListProductsOptions): PaginatedResult<Product> {
    const filtered = this.filterByKeywords(products, options?.keyword);
    return this.paginate(filtered, options?.page ?? 1, options?.pageSize ?? 100);
  }

  /**
   * 根据价格数组判断数据状态
   */
  protected determineDataStatus(prices: PriceItem[]): "complete" | "partial" | "no_price" | "no_data" {
    if (prices.length > 0 && prices[0].price > 0) return "complete";
    if (prices.length > 0 && prices[0].price === 0) return "no_price";
    return "no_data";
  }

  /**
   * 构造 PriceResult 的快捷方法
   */
  protected makePriceResult(prices: PriceItem[], extra?: Partial<PriceResult>): PriceResult {
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
  protected parseMarkdownTable(markdown: string): { headers: string[]; rows: string[][] } {
    const lines = markdown.split("\n");
    const headers: string[] = [];
    const rows: string[][] = [];
    let inTable = false;

    for (const line of lines) {
      if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        const cells = line.split("|").map(c => c.trim()).filter(Boolean);
        if (!inTable) {
          headers.push(...cells);
          inTable = true;
          continue;
        }
        if (cells.every(c => /^[-:\s]+$/.test(c))) continue;
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
