import * as cheerio from "cheerio";
import { CloudDocAdapter, type Product, type TocItem, type SearchResult, type PageMetadata } from "./base.js";
import { htmlToMarkdown } from "../utils/html-to-md.js";

const BASE_URL = "https://docs.bigmodel.cn";
const LLMS_TXT_URL = `${BASE_URL}/llms.txt`;
const LLMS_FULL_TXT_URL = `${BASE_URL}/llms-full.txt`;

interface LlmsEntry {
  title: string;
  path: string;
  description?: string;
}

/**
 * 智谱 GLM 文档适配器
 *
 * 文档站基于 Mintlify 构建，页面为客户端渲染 SPA。
 * - 文档目录和搜索通过 llms.txt 解析
 * - 页面正文通过 llms-full.txt 获取完整内容
 * - 页面元信息通过 HTML 页面提取
 */
export class GlmAdapter extends CloudDocAdapter {
  readonly provider = "glm";
  readonly name = "智谱 GLM";

  private llmsEntriesCache: LlmsEntry[] | null = null;
  private llmsFullContentCache: string | null = null;

  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/plain",
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.text();
  }

  private async fetchHtml(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
    });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return res.text();
  }

  /**
   * 解析 llms.txt，提取所有文档条目
   *
   * llms.txt 格式：
   * - [标题](URL): 描述
   */
  private async parseLlmsTxt(): Promise<LlmsEntry[]> {
    if (this.llmsEntriesCache) {
      return this.llmsEntriesCache;
    }

    const text = await this.fetchText(LLMS_TXT_URL);
    const entries: LlmsEntry[] = [];
    const lines = text.split("\n");

    for (const line of lines) {
      // 匹配格式: - [标题](URL): 描述
      const match = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)(?:\s*:\s*(.*))?$/);
      if (match) {
        const title = match[1].trim();
        const url = match[2].trim();
        const description = match[3]?.trim();

        // 提取路径部分（去掉域名）
        let path: string;
        if (url.startsWith("http")) {
          const urlObj = new URL(url);
          path = urlObj.pathname;
        } else {
          path = url;
        }

        entries.push({ title, path, description });
      }
    }

    this.llmsEntriesCache = entries;
    return entries;
  }

  /**
   * 获取 llms-full.txt 的完整内容
   */
  private async getLlmsFullContent(): Promise<string> {
    if (this.llmsFullContentCache) {
      return this.llmsFullContentCache;
    }

    const content = await this.fetchText(LLMS_FULL_TXT_URL);
    this.llmsFullContentCache = content;
    return content;
  }

  /**
   * 从 llms-full.txt 中提取指定页面的内容
   *
   * llms-full.txt 格式：
   * # 标题
   * Source: URL
   *
   * 正文内容...
   *
   * # 下一个标题
   * ...
   */
  private async extractPageContentFromLlmsFull(targetPath: string): Promise<string | null> {
    const fullContent = await this.getLlmsFullContent();

    // 构建 Source 行匹配模式
    const sourceUrl = targetPath.startsWith("http") ? targetPath : `${BASE_URL}${targetPath}`;
    const escapedSource = sourceUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // 匹配 Source 行及其后的内容，直到下一个 # 标题或文件末尾
    const regex = new RegExp(
      `^Source:\\s*${escapedSource}\\s*\\n\\n([\\s\\S]*?)(?=\\n^#\\s|\\n^Source:\\s|\\z)`,
      "m"
    );

    const match = fullContent.match(regex);
    if (match) {
      return match[1].trim();
    }

    return null;
  }

  async listProducts(): Promise<Product[]> {
    return [
      {
        productId: "bigmodel",
        name: "智谱 GLM API 文档",
        description: "智谱开放平台 API 文档",
      },
    ];
  }

  async getDocumentToc(productId: string): Promise<TocItem[]> {
    const entries = await this.parseLlmsTxt();

    // 构建目录列表（按 llms.txt 原始顺序，去重）
    const toc: TocItem[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
      if (!seen.has(entry.path)) {
        seen.add(entry.path);
        toc.push({
          pageId: entry.path,
          title: entry.title,
        });
      }
    }

    return toc;
  }

  async searchDocuments(productId: string, keyword: string): Promise<SearchResult[]> {
    const entries = await this.parseLlmsTxt();
    const lowerKeyword = keyword.toLowerCase();

    const results: SearchResult[] = [];

    for (const entry of entries) {
      if (
        entry.title.toLowerCase().includes(lowerKeyword) ||
        (entry.description && entry.description.toLowerCase().includes(lowerKeyword))
      ) {
        results.push({
          pageId: entry.path,
          title: entry.title,
          description: entry.description,
        });
      }
    }

    return results;
  }

  async getPageMetadata(pageId: string): Promise<PageMetadata> {
    // pageId 是路径，如 /cn/guide/start/quick-start
    const url = `${BASE_URL}${pageId}`;
    const html = await this.fetchHtml(url);
    const $ = cheerio.load(html);

    const title = $("title").text().replace(/\s*-\s*智谱AI开放文档\s*$/, "").trim();
    const description =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";

    return {
      pageId,
      title: title || pageId,
      note: description,
      contentPath: pageId,
    };
  }

  async getPageContent(contentPath: string): Promise<string> {
    // 先尝试从 llms-full.txt 提取完整内容
    const fullContent = await this.extractPageContentFromLlmsFull(contentPath);

    if (fullContent) {
      // llms-full.txt 中的内容是 MDX 格式，包含 JSX 组件标签
      // 使用 htmlToMarkdown 进行转换
      return htmlToMarkdown(fullContent);
    }

    // 回退方案：抓取 HTML 页面并转换
    const url = contentPath.startsWith("http") ? contentPath : `${BASE_URL}${contentPath}`;
    const html = await this.fetchHtml(url);

    if (html.length <= 1) {
      return "(页面为客户端渲染 SPA，无法获取服务端内容)";
    }

    return htmlToMarkdown(html);
  }
}
