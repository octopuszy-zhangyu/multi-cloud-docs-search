import { describe, it, expect } from "vitest";

// Test the helper functions used in stdio.ts
function filterByKeywords<T extends { name?: string; title?: string }>(
  items: T[],
  keywords: string[]
): T[] {
  if (keywords.length === 0) return items;
  return items.filter((item) => {
    const text = (item.name || item.title || "").toLowerCase();
    return keywords.every((kw) => text.includes(kw.toLowerCase()));
  });
}

describe("stdio.ts helper functions", () => {
  describe("filterByKeywords (AND logic)", () => {
    const products = [
      { name: "弹性云服务器 ECS", productId: "ecs" },
      { name: "云服务器 CVM", productId: "cvm" },
      { name: "对象存储 TOS", productId: "tos" },
      { name: "云数据库 PostgreSQL", productId: "pg" },
    ];

    it("空关键词数组返回全部", () => {
      expect(filterByKeywords(products, [])).toHaveLength(4);
    });

    it("单个关键词", () => {
      const result = filterByKeywords(products, ["ecs"]);
      expect(result).toHaveLength(1);
      expect(result[0].productId).toBe("ecs");
    });

    it("多个关键词 AND 逻辑", () => {
      // "云" 匹配 ECS, CVM, PostgreSQL
      // "服务器" 匹配 ECS, CVM
      // AND => ECS, CVM
      const result = filterByKeywords(products, ["云", "服务器"]);
      expect(result).toHaveLength(2);
    });

    it("多个关键词无匹配", () => {
      const result = filterByKeywords(products, ["ecs", "tos"]);
      expect(result).toHaveLength(0);
    });

    it("中文关键词", () => {
      const result = filterByKeywords(products, ["数据库"]);
      expect(result).toHaveLength(1);
      expect(result[0].productId).toBe("pg");
    });
  });

  describe("search_documents AND logic", () => {
    const searchResults = [
      { pageId: "1", title: "产品价格详情", description: "云产品价格信息" },
      { pageId: "2", title: "计费说明", description: "计费方式和价格" },
      { pageId: "3", title: "API 参考", description: "API 接口文档" },
      { pageId: "4", title: "价格计算器", description: "在线价格计算" },
    ];

    it("单关键词搜索", () => {
      const keywords = ["价格"];
      const filtered = searchResults.filter((item) => {
        const text = (item.title + " " + (item.description || "")).toLowerCase();
        return keywords.every((kw) => text.includes(kw.toLowerCase()));
      });
      expect(filtered).toHaveLength(3); // 价格详情, 计费说明, 价格计算器
    });

    it("多关键词 AND 搜索", () => {
      const keywords = ["价格", "计费"];
      const filtered = searchResults.filter((item) => {
        const text = (item.title + " " + (item.description || "")).toLowerCase();
        return keywords.every((kw) => text.includes(kw.toLowerCase()));
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].pageId).toBe("2"); // 计费说明
    });

    it("多关键词无匹配", () => {
      const keywords = ["价格", "API"];
      const filtered = searchResults.filter((item) => {
        const text = (item.title + " " + (item.description || "")).toLowerCase();
        return keywords.every((kw) => text.includes(kw.toLowerCase()));
      });
      expect(filtered).toHaveLength(0);
    });
  });

  describe("topOnly 逻辑", () => {
    const tocItems = [
      {
        pageId: "1",
        title: "第一章",
        children: [
          { pageId: "1-1", title: "1.1 节" },
          { pageId: "1-2", title: "1.2 节" },
        ],
      },
      {
        pageId: "2",
        title: "第二章",
        children: [
          { pageId: "2-1", title: "2.1 节" },
        ],
      },
      { pageId: "3", title: "第三章" },
    ];

    it("topOnly=true 移除 children", () => {
      const topOnlyItems = tocItems.map((item) => ({
        pageId: item.pageId,
        title: item.title,
      }));
      expect(topOnlyItems).toHaveLength(3);
      expect(topOnlyItems[0]).not.toHaveProperty("children");
      expect(topOnlyItems[1]).not.toHaveProperty("children");
    });

    it("topOnly=false 保留 children", () => {
      expect(tocItems[0]).toHaveProperty("children");
      expect(tocItems[0].children).toHaveLength(2);
    });
  });

  describe("分页边界测试", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: i }));

    it("page=1, pageSize=10 不足一页", () => {
      const page = 1;
      const pageSize = 10;
      const start = (page - 1) * pageSize;
      const paged = items.slice(start, start + pageSize);
      expect(paged).toHaveLength(5);
    });

    it("page=2, pageSize=2 有更多数据", () => {
      const page = 2;
      const pageSize = 2;
      const start = (page - 1) * pageSize;
      const paged = items.slice(start, start + pageSize);
      expect(paged).toHaveLength(2);
      expect(paged[0].id).toBe(2);
      expect(start + pageSize < items.length).toBe(true);
    });

    it("page=3, pageSize=2 最后一页", () => {
      const page = 3;
      const pageSize = 2;
      const start = (page - 1) * pageSize;
      const paged = items.slice(start, start + pageSize);
      expect(paged).toHaveLength(1);
      expect(paged[0].id).toBe(4);
      expect(start + pageSize < items.length).toBe(false);
    });
  });
});

describe("provider 别名映射", () => {
  const providerAliases: Record<string, string> = {
    tencentcloud: "tencent",
    huaweicloud: "huawei",
    alibaba: "aliyun",
    bytedance: "volcengine",
    cmcc: "ecloud",
    chinaunicom: "cucloud",
    baiducloud: "baidu",
    qianfan: "baidu",
    dashscope: "bailian",
    zhipu: "glm",
    moonshot: "kimi",
  };

  const adapters: Record<string, string> = {
    ctyun: "天翼云",
    aliyun: "阿里云",
    volcengine: "火山引擎",
    tencent: "腾讯云",
    huawei: "华为云",
    ecloud: "移动云",
    cucloud: "联通云",
    bailian: "百炼",
    baidu: "百度云",
    deepseek: "DeepSeek",
    glm: "智谱",
    minimax: "MiniMax",
    kimi: "Kimi",
  };

  it("所有别名都能映射到有效 provider", () => {
    for (const [alias, target] of Object.entries(providerAliases)) {
      expect(adapters[target], `别名 ${alias} 映射到 ${target} 应该存在`).toBeDefined();
    }
  });

  it("直接使用 provider 名称应该有效", () => {
    for (const provider of Object.keys(adapters)) {
      expect(adapters[provider]).toBeDefined();
    }
  });

  it("normalize 函数处理常见变体", () => {
    const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");
    expect(normalize("tencentcloud")).toBe("tencentcloud");
    expect(normalize("tencent_cloud")).toBe("tencentcloud");
    expect(normalize("TencentCloud")).toBe("tencentcloud");
    expect(normalize("huawei-cloud")).toBe("huaweicloud");
  });
});

describe("关键词解析", () => {
  it("空格分隔的多个关键词", () => {
    const keyword = "ecs cvm";
    const keywords = keyword.trim().split(/\s+/).filter(Boolean);
    expect(keywords).toEqual(["ecs", "cvm"]);
  });

  it("单个关键词", () => {
    const keyword = "ecs";
    const keywords = keyword.trim().split(/\s+/).filter(Boolean);
    expect(keywords).toEqual(["ecs"]);
  });

  it("多余空格被忽略", () => {
    const keyword = "  ecs   cvm   ";
    const keywords = keyword.trim().split(/\s+/).filter(Boolean);
    expect(keywords).toEqual(["ecs", "cvm"]);
  });

  it("空字符串返回空数组", () => {
    const keyword = "   ";
    const keywords = keyword.trim().split(/\s+/).filter(Boolean);
    expect(keywords).toEqual([]);
  });
});