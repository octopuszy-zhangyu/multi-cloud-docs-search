import { CloudDocAdapter } from "./base.js";
const BASE_URL = "https://www.volcengine.com";
export class VolcengineAdapter extends CloudDocAdapter {
    provider = "volcengine";
    name = "火山引擎";
    async fetchJson(url) {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json",
            },
        });
        if (!res.ok) {
            throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
        }
        return res.json();
    }
    async listProducts() {
        const url = `${BASE_URL}/api/doc/getLibList?Limit=999`;
        const raw = await this.fetchJson(url);
        const products = [];
        const libs = raw.Result || [];
        for (const lib of libs) {
            products.push({
                productId: String(lib.LibraryID),
                name: lib.Name,
                description: lib.EnName,
            });
        }
        return products;
    }
    async getDocumentToc(productId) {
        const url = `${BASE_URL}/api/doc/getDocList?LibraryID=${productId}&DataSchema=all_second_nav&type=online`;
        const raw = await this.fetchJson(url);
        const items = [];
        const result = raw.Result || {};
        // 遍历所有 SecondNav（章节）
        for (const [navId, docs] of Object.entries(result)) {
            for (const doc of docs) {
                if (doc.Type === 1 && doc.ParentID === 0) {
                    // 这是一个顶级目录节点
                    const children = this.buildTocTree(result, doc.DocumentID);
                    items.push({
                        pageId: `${productId}/${doc.DocumentID}`,
                        title: doc.Title,
                        children: children.length > 0 ? children : undefined,
                    });
                }
            }
        }
        return items;
    }
    buildTocTree(result, parentId) {
        const children = [];
        for (const docs of Object.values(result)) {
            for (const doc of docs) {
                if (doc.ParentID === parentId) {
                    const subChildren = this.buildTocTree(result, doc.DocumentID);
                    children.push({
                        pageId: doc.LibraryID + "/" + doc.DocumentID,
                        title: doc.Title,
                        children: subChildren.length > 0 ? subChildren : undefined,
                    });
                }
            }
        }
        return children;
    }
    async searchDocuments(productId, keyword) {
        const toc = await this.getDocumentToc(productId);
        const lowerKeyword = keyword.toLowerCase();
        const results = [];
        const searchToc = (items) => {
            for (const item of items) {
                if (item.title.toLowerCase().includes(lowerKeyword)) {
                    results.push({
                        pageId: item.pageId,
                        title: item.title,
                    });
                }
                if (item.children) {
                    searchToc(item.children);
                }
            }
        };
        searchToc(toc);
        return results;
    }
    async getPageMetadata(pageId) {
        // pageId 格式: "productId/docId"
        const [productId, docId] = pageId.split("/");
        const url = `${BASE_URL}/api/doc/getDocDetail?LibraryID=${productId}&DocumentID=${docId}&AuditDocumentID=&type=online`;
        const raw = await this.fetchJson(url);
        const doc = raw.Result;
        return {
            pageId,
            title: doc.Title,
            note: "",
            contentPath: pageId,
            bookId: productId,
            updateDate: doc.UpdatedTime,
        };
    }
    async getPageContent(contentPath) {
        // contentPath 实际上是 pageId: "productId/docId"
        const [productId, docId] = contentPath.split("/");
        const url = `${BASE_URL}/api/doc/getDocDetail?LibraryID=${productId}&DocumentID=${docId}&AuditDocumentID=&type=online`;
        const raw = await this.fetchJson(url);
        const doc = raw.Result;
        // 返回 Markdown 内容
        return doc.MDContent || doc.Content || "";
    }
}
