import { describe, it, expect } from "vitest";
import type { PaginatedResult } from "../src/adapters/base.js";

// Helper functions that mirror the logic in the adapters.
// Since each adapter has its own private implementation, we test the logic patterns directly.

function filterByKeywords<T extends { name?: string; title?: string }>(
  items: T[],
  keyword?: string
): T[] {
  if (!keyword) return items;
  const keywords = keyword.trim().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return items;
  return items.filter((item) => {
    const text = (item.name || item.title || "").toLowerCase();
    return keywords.every((kw) => text.includes(kw.toLowerCase()));
  });
}

function paginate<T>(
  items: T[],
  page: number = 1,
  pageSize: number = 100
): PaginatedResult<T> {
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

describe("filterByKeywords", () => {
  const items = [
    { name: "弹性云服务器 ECS" },
    { name: "云服务器 CVM" },
    { name: "对象存储 TOS" },
    { name: "关系型数据库 RDS" },
    { name: "负载均衡 SLB" },
    { name: "云容器引擎 CCE" },
  ];

  it("不传 keyword 返回全部", () => {
    expect(filterByKeywords(items)).toHaveLength(6);
    expect(filterByKeywords(items, "")).toHaveLength(6);
  });

  it("单个关键词过滤", () => {
    const result = filterByKeywords(items, "ecs");
    expect(result).toHaveLength(1); // 只有 ECS 包含 "ecs"
    expect(result[0].name).toBe("弹性云服务器 ECS");
  });

  it("单个中文关键词过滤", () => {
    const result = filterByKeywords(items, "云服务器");
    expect(result).toHaveLength(2); // 云服务器 ECS + CVM
  });

  it("多个关键词 AND 逻辑", () => {
    // "ecs" 匹配 ECS、CCE；"云服务器" 匹配 ECS、CVM
    // AND 逻辑 => 只有同时包含 "ecs" 和 "云服务器" 的 => ECS
    const result = filterByKeywords(items, "ecs 云服务器");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("弹性云服务器 ECS");
  });

  it("多个关键词无匹配返回空", () => {
    const result = filterByKeywords(items, "ecs 对象存储");
    expect(result).toHaveLength(0);
  });

  it("大小写不敏感", () => {
    const result = filterByKeywords(items, "CVM");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("云服务器 CVM");
  });

  it("title 字段也可匹配", () => {
    const titleItems = [
      { title: "产品价格详情" },
      { title: "计费说明" },
      { title: "API 参考" },
    ];
    expect(filterByKeywords(titleItems, "价格")).toHaveLength(1);
    expect(filterByKeywords(titleItems, "计费 说明")).toHaveLength(1);
    expect(filterByKeywords(titleItems, "价格 计费")).toHaveLength(0);
  });

  it("空字符串或空白字符串返回全部", () => {
    expect(filterByKeywords(items, "   ")).toHaveLength(6);
    expect(filterByKeywords(items, undefined)).toHaveLength(6);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 100 }, (_, i) => ({
    name: `产品${i + 1}`,
    productId: String(i + 1),
  }));

  it("默认页码和每页条数", () => {
    const result = paginate(items);
    expect(result.items).toHaveLength(100);
    expect(result.total).toBe(100);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(100);
    expect(result.hasMore).toBe(false);
  });

  it("第一页", () => {
    const result = paginate(items, 1, 10);
    expect(result.items).toHaveLength(10);
    expect(result.items[0].name).toBe("产品1");
    expect(result.items[9].name).toBe("产品10");
    expect(result.hasMore).toBe(true);
  });

  it("第二页", () => {
    const result = paginate(items, 2, 10);
    expect(result.items).toHaveLength(10);
    expect(result.items[0].name).toBe("产品11");
    expect(result.hasMore).toBe(true);
  });

  it("最后一页（不足 pageSize）", () => {
    const result = paginate(items, 10, 10);
    expect(result.items).toHaveLength(10);
    expect(result.hasMore).toBe(false);
  });

  it("超出范围的页码返回空数组", () => {
    const result = paginate(items, 100, 10);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(100);
    expect(result.hasMore).toBe(false);
  });

  it("空数组", () => {
    const result = paginate([], 1, 10);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it("不同 pageSize 测试", () => {
    const items5 = Array.from({ length: 5 }, (_, i) => ({ name: `x${i}`, productId: String(i) }));
    const result = paginate(items5, 1, 10);
    expect(result.items).toHaveLength(5);
    expect(result.hasMore).toBe(false);
  });
});

describe("filterByKeywords + paginate 组合", () => {
  const products = [
    { name: "弹性云服务器 ECS", productId: "ecs" },
    { name: "云服务器 CVM", productId: "cvm" },
    { name: "对象存储 TOS", productId: "tos" },
    { name: "关系型数据库 RDS", productId: "rds" },
    { name: "云容器引擎 CCE", productId: "cce" },
    { name: "云数据库 MongoDB", productId: "mongodb" },
    { name: "负载均衡 CLB", productId: "clb" },
    { name: "容器镜像服务 SWR", productId: "swr" },
  ];

  it("先过滤再分页", () => {
    const filtered = filterByKeywords(products, "云服务器");
    expect(filtered).toHaveLength(2); // ECS, CVM（CCE 是"云容器引擎"不包含"云服务器"）
    expect(filtered[0].name).toBe("弹性云服务器 ECS");
    expect(filtered[1].name).toBe("云服务器 CVM");

    const paged = paginate(filtered, 1, 2);
    expect(paged.items).toHaveLength(2);
    expect(paged.items[0].name).toBe("弹性云服务器 ECS");
    expect(paged.items[1].name).toBe("云服务器 CVM");
    expect(paged.hasMore).toBe(false);
  });

  it("过滤后只剩一页", () => {
    const filtered = filterByKeywords(products, "对象存储");
    const paged = paginate(filtered, 1, 10);
    expect(paged.items).toHaveLength(1);
    expect(paged.hasMore).toBe(false);
    expect(paged.total).toBe(1);
  });

  it("过滤结果为空时分页", () => {
    const filtered = filterByKeywords(products, "ecs 对象存储");
    const paged = paginate(filtered, 1, 10);
    expect(paged.items).toHaveLength(0);
    expect(paged.total).toBe(0);
    expect(paged.hasMore).toBe(false);
  });
});

describe("PaginatedResult 类型结构", () => {
  it("返回格式正确", () => {
    const result: PaginatedResult<{ name: string }> = {
      items: [{ name: "test" }],
      total: 100,
      page: 1,
      pageSize: 10,
      hasMore: true,
    };

    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("page");
    expect(result).toHaveProperty("pageSize");
    expect(result).toHaveProperty("hasMore");
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe("number");
    expect(typeof result.page).toBe("number");
    expect(typeof result.pageSize).toBe("number");
    expect(typeof result.hasMore).toBe("boolean");
  });
});