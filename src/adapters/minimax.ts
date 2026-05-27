import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata } from "./base.js";

const BASE_URL = "https://platform.minimaxi.com";
const LLMS_URL = `${BASE_URL}/docs/llms.txt`;

/** MiniMax 文档适配器 */
export class MinimaxAdapter extends CloudDocAdapter {
  readonly provider = "minimax";
  readonly name = "MiniMax";

  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/plain,text/markdown,*/*",
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.text();
  }

  async listProducts(): Promise<Product[]> {
    // MiniMax 只有一个产品
    return [
      {
        productId: "minimax-api",
        name: "MiniMax API 文档",
        description: "MiniMax 开放平台 API 文档",
      },
    ];
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
    const text = await this.fetchText(LLMS_URL);
    const lines = text.split("\n");

    const items: TocItem[] = [];
    let currentGroup: TocItem | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

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
        } else if (url.startsWith("http")) {
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
        } else {
          items.push({
            pageId: path,
            title: title,
          });
        }
      }
    }

    // 清理空分组
    return items.filter((item) => {
      if (item.pageId === "" && item.children && item.children.length === 0) {
        return false;
      }
      return true;
    });
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const toc = await this.getDocumentToc(productId);
    const lowerKeyword = keyword.toLowerCase();

    const results: SearchResult[] = [];

    const searchToc = (items: TocItem[]) => {
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

  async getPageMetadata(pageId: string): Promise<PageMetadata> {
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

  async getPageContent(contentPath: string): Promise<string> {
    // MiniMax 文档直接返回 Markdown，无需 HTML 转换
    const content = await this.fetchText(contentPath);
    return content;
  }
}
