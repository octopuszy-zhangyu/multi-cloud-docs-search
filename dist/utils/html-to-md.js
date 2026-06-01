import * as cheerio from "cheerio";
/**
 * 将 HTML 文档正文转换为 Markdown 格式
 * 处理标题、列表、图片、表格等元素
 */
export function htmlToMarkdown(html) {
    const $ = cheerio.load(html);
    // 移除不需要的标签
    $("script, style, nav, footer, header, aside, .ad, .advertisement").remove();
    // 将标题转换为 Markdown 格式
    $("h1").each((_, el) => { $(el).replaceWith("\n# " + $(el).text().trim() + "\n"); });
    $("h2").each((_, el) => { $(el).replaceWith("\n## " + $(el).text().trim() + "\n"); });
    $("h3").each((_, el) => { $(el).replaceWith("\n### " + $(el).text().trim() + "\n"); });
    $("h4").each((_, el) => { $(el).replaceWith("\n#### " + $(el).text().trim() + "\n"); });
    $("h5").each((_, el) => { $(el).replaceWith("\n##### " + $(el).text().trim() + "\n"); });
    $("h6").each((_, el) => { $(el).replaceWith("\n###### " + $(el).text().trim() + "\n"); });
    // 将列表转换为 Markdown 格式
    $("ul").each((_, el) => {
        const items = [];
        $(el).find("li").each((_, li) => {
            items.push("- " + $(li).text().trim().replace(/\s+/g, " "));
        });
        $(el).replaceWith("\n" + items.join("\n") + "\n");
    });
    $("ol").each((_, el) => {
        const items = [];
        let idx = 1;
        $(el).find("li").each((_, li) => {
            items.push(idx + ". " + $(li).text().trim().replace(/\s+/g, " "));
            idx++;
        });
        $(el).replaceWith("\n" + items.join("\n") + "\n");
    });
    // 将图片转换为 Markdown 格式
    $("img").each((_, el) => {
        const src = $(el).attr("src") || $(el).attr("data-src") || "";
        const alt = $(el).attr("alt") || "";
        if (src) {
            $(el).replaceWith("![" + alt + "](" + src + ")");
        }
    });
    // 将表格转换为 Markdown 格式
    const markdownTables = [];
    $("table").each((_, table) => {
        const $table = $(table);
        const rows = [];
        $table.find("tr").each((_, tr) => {
            const cells = [];
            $(tr).find("th, td").each((_, cell) => {
                let text = $(cell).text().trim().replace(/\s+/g, " ");
                text = text.replace(/\n/g, " ");
                cells.push(text);
            });
            if (cells.length > 0) {
                rows.push("| " + cells.join(" | ") + " |");
            }
        });
        if (rows.length > 1) {
            const headerCells = rows[0].split("|").filter((_, i, arr) => i > 0 && i < arr.length - 1);
            const separator = "| " + headerCells.map(() => "---").join(" | ") + " |";
            rows.splice(1, 0, separator);
        }
        markdownTables.push(rows.join("\n"));
    });
    // 清理 HTML 并转换为纯文本
    let text = $("body").html() || "";
    text = text.replace(/<(\w+)[^>]*>\s*<\/\1>/g, "");
    text = text.replace(/<\/?(p|div|br|blockquote|pre|section)[^>]*>/gi, "\n");
    text = text.replace(/<[^>]+>/g, "");
    text = text.replace(/[ \t]+/g, " ");
    text = text.replace(/\n{3,}/g, "\n\n");
    text = text.trim();
    if (markdownTables.length > 0) {
        text += "\n\n" + markdownTables.join("\n\n");
    }
    return text || "(空内容)";
}
