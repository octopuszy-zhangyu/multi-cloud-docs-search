import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAdapter } from "./adapters/index.js";
const MAX_RESPONSE_CHARS = 80000;
/**
 * 检测响应大小，超限时返回指引让 Agent 直接使用 Fetch/curl + Python 获取数据
 */
function truncateResponse(text, toolName, args) {
    if (text.length <= MAX_RESPONSE_CHARS) {
        return text;
    }
    const totalChars = text.length;
    const provider = args.provider || "";
    let guidance = "";
    if (toolName === "get_product_price" && (provider === "tencent" || provider === "all")) {
        guidance = `请直接使用 Fetch 工具或 curl 获取腾讯云 CVM 价格数据，然后用 Python 筛选所需内容：

--- Fetch + Python 方式 ---
\`\`\`python
import json, urllib.request

def fetch_cvm_price(region, charge_type=None):
    """获取腾讯云 CVM 价格
    Args:
        region: 地域，如 ap-guangzhou, ap-shanghai, ap-beijing
        charge_type: 计费模式，PREPAID(包年包月) 或 POSTPAID_BY_HOUR(按量)，不传则查全部
    """
    filters = [{"Name": "instance-charge-type", "Values": [charge_type]}] if charge_type else [
        {"Name": "instance-charge-type", "Values": ["PREPAID", "POSTPAID_BY_HOUR"]}
    ]
    body = json.dumps({
        "serviceType": "cvm", "action": "DescribeZoneInstanceConfigInfos",
        "region": region, "cgiName": "api",
        "data": {"Filters": filters, "Platform": "LINUX", "Version": "2017-03-12"}
    }).encode()
    req = urllib.request.Request(
        f"https://workbench.cloud.tencent.com/cgi/api?i=cvm/DescribeZoneInstanceConfigInfos&region={region}",
        data=body,
        headers={"content-type": "application/json", "User-Agent": "Mozilla/5.0"}
    )
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())

# 示例：查询广州地域所有价格
data = fetch_cvm_price("ap-guangzhou")
for item in data.get("data", {}).get("Response", {}).get("InstanceTypeQuotaSet", []):
    p = item.get("Price", {})
    print(f"{item['InstanceType']} | {item['Zone']} | {item['InstanceChargeType']} | "
          f"按量={p.get('UnitPrice', '-')}/h | 包月={p.get('OriginalPrice', '-')}/月")
\`\`\`

--- curl 方式 ---
\`\`\`bash
curl -s -X POST "https://workbench.cloud.tencent.com/cgi/api?i=cvm/DescribeZoneInstanceConfigInfos&region=ap-guangzhou" \\
  -H "content-type: application/json" -H "User-Agent: Mozilla/5.0" \\
  -d '{"serviceType":"cvm","action":"DescribeZoneInstanceConfigInfos","region":"ap-guangzhou","cgiName":"api","data":{"Filters":[{"Name":"instance-charge-type","Values":["PREPAID","POSTPAID_BY_HOUR"]}],"Platform":"LINUX","Version":"2017-03-12"}}' \\
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f\"{i['InstanceType']} | {i['Zone']} | {i['InstanceChargeType']} | 按量={i.get('Price',{}).get('UnitPrice','-')}/h | 包月={i.get('Price',{}).get('OriginalPrice','-')}/月\") for i in d.get('data',{}).get('Response',{}).get('InstanceTypeQuotaSet',[])]"
\`\`\`

可用地域: ap-guangzhou, ap-shanghai, ap-beijing, ap-singapore, na-siliconvalley, eu-frankfurt
计费模式: PREPAID(包年包月), POSTPAID_BY_HOUR(按量)
带宽价格: curl -s -X POST "https://workbench.cloud.tencent.com/cgi/api?i=vpc/DescribeInternetChargePrices&region=ap-guangzhou" -H "content-type: application/json" -d '{"serviceType":"vpc","action":"DescribeInternetChargePrices","region":"ap-guangzhou","cgiName":"api","data":{"Filters":[{"Name":"internet-charge-type","Values":["BANDWIDTH_PREPAID_BY_MONTH","BANDWIDTH_POSTPAID_BY_HOUR","TRAFFIC_POSTPAID_BY_HOUR"]}],"Version":"2017-03-12"}}'`;
    }
    else if (toolName === "get_product_price" && provider === "huawei") {
        guidance = `请直接使用 Fetch 工具或 curl 获取华为云价格数据，然后用 Python 筛选：

--- 获取产品菜单 ---
\`\`\`bash
curl -s "https://portal.huaweicloud.com/rest/cbc/portalcalculatornodeservice/v4/api/menuInfo?sign=common&language=zh-cn" \\
  -H "User-Agent: Mozilla/5.0" -H "Referer: https://www.huaweicloud.com/pricing/calculator.html"
\`\`\`

--- 获取全量价格 (替换 urlPath 为目标产品) ---
\`\`\`python
import json, urllib.request

def export_prices(url_path):
    """导出产品全量价格"""
    body = json.dumps({"urlPath": url_path, "sources": [{"param": "hws.resource.type.vm"}], "type": "JSON", "language": "zh-cn"}).encode()
    req = urllib.request.Request(
        "https://portal.huaweicloud.com/rest/cbc/portalcalculatornodeservice/v4/api/export/productlist",
        data=body,
        headers={"content-type": "application/json", "User-Agent": "Mozilla/5.0", "Referer": "https://www.huaweicloud.com/pricing/calculator.html"}
    )
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())

# 示例：导出 ECS 价格
data = export_prices("ecs")
for region, items in data.items():
    for item in items:
        spec = item.get("resourceSpecCode", "")
        ondemand = item.get("ONDEMAND", 0)
        monthly = item.get("MONTHLY_1", 0)
        if ondemand or monthly:
            print(f"{region} | {spec} | 按量={ondemand}/h | 包月={monthly}/月")
\`\`\`

--- MaaS Token 价格 ---
\`\`\`bash
curl -s "https://portal.huaweicloud.com/rest/cbc/portalcalculatornodeservice/v4/api/productInfo?urlPath=maas&tag=general.online.portal&region=cn-north-4&tab=calc&sign=common&language=zh-cn" \\
  -H "User-Agent: Mozilla/5.0" -H "Referer: https://www.huaweicloud.com/pricing/calculator.html"
\`\`\`

常见 urlPath: ecs, evs, vpc, maas, obs, rds, dds, gaussdb, ces, scm, waf, aad, cdn, sms, dns`;
    }
    else if (toolName === "get_product_price" && provider === "volcengine") {
        guidance = `请直接使用 Fetch 工具或 curl 获取火山引擎价格数据：

--- 获取定价表格 ---
\`\`\`python
import json, urllib.request

def get_volc_prices(product_code="ECS"):
    """获取火山引擎产品定价
    Args:
        product_code: 产品代码，如 ECS, TOS, RDS for MySQL 等
    """
    # 1. 获取 TemplateCode
    ssr_url = f"https://www.volcengine.com/pricing?product={product_code}&tab=1&__loader=__ssr_without_user/pricing/page&__ssrDirect=true"
    ssr_resp = urllib.request.urlopen(urllib.request.Request(ssr_url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"}))
    ssr_data = json.loads(ssr_resp.read())
    template_code = ssr_data.get("activeProductInfo", {}).get("TemplateInfoList", [{}])[0].get("TemplateCode")
    if not template_code:
        print("No template code found")
        return

    # 2. 获取定价表格
    body = json.dumps({"TemplateCode": template_code}).encode()
    req = urllib.request.Request(
        "https://www.volcengine.com/anonymous-api/trade/price?Action=GetTable&Version=2020-01-01",
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}
    )
    resp = urllib.request.urlopen(req)
    table_data = json.loads(resp.read())

    # 3. 解析价格
    for table in table_data.get("Result", {}).get("TableList", []):
        for row in table.get("Rows", []):
            product_name = row.get("Product", "")
            for pi in row.get("PriceInfoList", []):
                if pi.get("Price", 0) > 0:
                    print(f"{product_name} | {row.get('ConfigurationCode','')} | {pi.get('Period','')} | {pi.get('Price')}元")

get_volc_prices("ECS")
\`\`\`

常见产品代码: ECS, TOS, RDS for MySQL, GPU_Server, volume, IMS`;
    }
    else if (toolName === "get_document_toc" && provider === "aliyun") {
        guidance = `请直接使用 Fetch 获取阿里云文档 llms.txt（纯文本 Markdown 格式）：

\`\`\`bash
# 获取产品文档目录（productId 从 list_products 获取）
curl -s "https://help.aliyun.com/zh/${args.productId}/llms.txt" | head -200
\`\`\`

\`\`\`python
import urllib.request
# 获取完整目录并用关键词筛选
url = f"https://help.aliyun.com/zh/${args.productId}/llms.txt"
resp = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}))
lines = resp.read().decode()
# 用关键词筛选，如 "价格", "计费", "规格"
for line in lines.split("\\n"):
    if "价格" in line or "计费" in line:
        print(line)
\`\`\``;
    }
    else if (toolName === "get_document_toc" && provider === "huawei") {
        guidance = `请直接使用 Fetch 获取华为云文档目录 HTML：

\`\`\`bash
# 获取产品文档目录（productId 如 ecs）
curl -s "https://support.huaweicloud.com/${args.productId}/v3_support_leftmenu_fragment.html" | grep -oP 'href="[^"]*"\\s*>\\s*[^<]+' | head -100
\`\`\`

\`\`\`python
from html.parser import HTMLParser
import urllib.request

class TocParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items = []
        self._title = ""
        self._in_link = False
    def handle_starttag(self, tag, attrs):
        if tag == "a":
            attrs_dict = dict(attrs)
            href = attrs_dict.get("href", "")
            if href and "/${args.productId}/" in href:
                self._in_link = True
                self._href = href
    def handle_data(self, data):
        if self._in_link:
            self._title = data.strip()
    def handle_endtag(self, tag):
        if tag == "a" and self._in_link:
            if self._title:
                self.items.append((self._href, self._title))
            self._in_link = False

url = "https://support.huaweicloud.com/${args.productId}/v3_support_leftmenu_fragment.html"
resp = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}))
parser = TocParser()
parser.feed(resp.read().decode())
for href, title in parser.items:
    print(f"{title} | {href}")
\`\`\``;
    }
    else if (toolName === "get_document_toc" && provider === "tencent") {
        guidance = `请直接使用 Fetch 获取腾讯云文档目录（从 HTML 中提取）：

\`\`\`bash
curl -s "https://cloud.tencent.com/document/product/${args.productId}" | grep -oP '"title":"[^"]*","link":"[^"]*"' | head -100
\`\`\`

\`\`\`python
import re, urllib.request

url = f"https://cloud.tencent.com/document/product/${args.productId}"
resp = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"}))
html = resp.read().decode()
# 提取 hydrated 数据中的目录
match = re.search(r'__staticRouterHydrationData.*?JSON\\.parse\\("([^"]+)"', html)
if match:
    import json
    data = json.loads(match.group(1).replace('\\\\"', '"'))
    catalogue = data.get("loaderData", {}).get("product", {}).get("data", {}).get("sidebar", {}).get("catalogue", {})
    for item in catalogue.get("list", []):
        title = item.get("title", "")
        link = item.get("link", "")
        if title and link:
            print(f"{title} | {link}")
\`\`\``;
    }
    else if (toolName === "list_products" && provider === "huawei") {
        guidance = `请直接使用 Fetch 获取华为云产品列表：

\`\`\`bash
curl -s "https://portal.huaweicloud.com/rest/cbc/portaldocdataservice/v1/books/items?appId=CHINA-ZH_CN" \\
  -H "User-Agent: Mozilla/5.0" -H "Accept: application/json" \\
  | python3 -c "import sys,json; [print(f\"{p['code']}: {p['title']}\") for c in json.load(sys.stdin)['data'] for p in c['products']]"
\`\`\``;
    }
    else if (toolName === "list_products" && provider === "volcengine") {
        guidance = `请直接使用 Fetch 获取火山引擎产品列表：

\`\`\`bash
curl -s "https://www.volcengine.com/api/doc/getLibList?Limit=999" \\
  -H "User-Agent: Mozilla/5.0" -H "Accept: application/json" \\
  | python3 -c "import sys,json; [print(f\"{r['LibraryID']}: {r['Name']}\") for r in json.load(sys.stdin)['Result']]"
\`\`\``;
    }
    else if (toolName === "get_page_content" && provider === "tencent") {
        guidance = `请直接使用 Fetch 获取腾讯云文档页面：

\`\`\`bash
curl -s "${args.contentPath}" -H "User-Agent: Mozilla/5.0" | python3 -c "
import sys, re, html
text = sys.stdin.read()
# 提取正文区域（简化）
text = re.sub(r'<style[^>]*>[^<]*</style>', '', text)
text = re.sub(r'<script[^>]*>[^<]*</script>', '', text)
text = re.sub(r'<[^>]+>', '\\n', text)
text = html.unescape(text)
lines = [l.strip() for l in text.split('\\n') if l.strip()]
print('\\n'.join(lines[:200]))
" | head -300
\`\`\``;
    }
    else {
        guidance = `数据量过大（约 ${totalChars} 字符），请使用 Fetch 或 curl 直接获取原始数据，然后用 Python 筛选：

1. 使用 Fetch 工具获取 ${args.contentPath || args.provider || ""} 的原始内容
2. 使用 Python 解析并提取所需信息
3. 如需帮助，请告知具体需要筛选什么内容`;
    }
    return `[数据量过大指引]
工具 ${toolName}(${JSON.stringify(args)}) 返回数据量约 ${totalChars} 字符，无法一次性返回。
请直接使用 Fetch 工具或 curl + Python 获取并筛选数据，无需再调用此 MCP 工具。

${guidance}`;
}
const server = new McpServer({
    name: "multi-cloud-docs-search",
    version: "1.0.0",
}, {
    instructions: `云厂商文档搜索 MCP Server。

## 核心原则（重要）

1. **优先浏览目录，迫不得已再搜索**：先调用 get_document_toc 查看文档目录结构，定位到相关章节后，再决定是否调用 search_documents。search_documents 的关键词不宜太具体（如"价格 4C8G"会返回空），应使用宽泛关键词（如"计费""价格""规格"）。
2. **严格遵循 metadata → content 顺序**：必须先调用 get_page_metadata 获取 contentPath，再将 contentPath 传给 get_page_content。不能跳过 metadata 直接构造 URL。
3. **并行 Agent 模式（重要）**：当需要查询多个云厂商时，必须为每个云厂商分别启动一个独立的 Agent 并行执行，而不是串行逐个查询。每个 Agent 负责一个云厂商的完整查询流程（list_products → get_document_toc → get_page_metadata → get_page_content），最后汇总所有 Agent 的结果。
4. **list_products 结果可能过大**：阿里云等厂商的产品列表可能超过 token 限制，需分块读取或 grep 过滤。

## 工作模式

### 多厂商并行查询（推荐）
当用户需要对比多个云厂商的产品/价格时，使用以下模式：

1. **启动并行 Agent**：为每个需要查询的云厂商分别启动一个 Agent（使用 Agent 工具，设置 subagent_type="claude"）
2. **每个 Agent 独立执行完整流程**：每个 Agent 负责一个云厂商的完整查询链路
3. **汇总结果**：等待所有 Agent 完成后，汇总各厂商的结果进行对比分析

示例：用户问"对比阿里云和腾讯云的 ECS 价格"
- Agent 1：查询阿里云 ECS 价格（list_products → get_document_toc → 定位定价页面 → get_page_metadata → get_page_content）
- Agent 2：查询腾讯云 CVM 价格（list_products → get_document_toc → 定位定价页面 → get_page_metadata → get_page_content）
- 汇总两个 Agent 的结果进行对比

### 需要规划时使用 Plan 模式
当任务涉及以下场景时，先调用 EnterPlanMode 进入规划模式：
- 需要多步骤执行的复杂查询
- 需要对比多个厂商的跨厂商分析
- 需要分阶段执行的大型任务
- 需要用户确认执行路径的场景

在 Plan 模式下制定清晰的执行计划，获得用户确认后再执行。

### 需要任务列表时使用 Task/Todos
当任务需要拆分为多个可追踪的子任务时，使用 TaskCreate 创建任务列表：
- 每个子任务创建一个 Task（如"查询阿里云价格"、"查询腾讯云价格"）
- 任务完成后调用 TaskUpdate 更新状态
- 使用 TaskList 查看当前进度

## 工作流程

### 标准流程（推荐）
1. 获取产品列表：调用 list_products({ provider: "xxx" })（可并行查询多个厂商）
2. 匹配产品：从返回结果中找到用户询问的产品，获取 productId
3. 获取文档目录：调用 get_document_toc({ provider: "xxx", productId: "xxx" }) 浏览目录结构
4. 定位章节：从目录中找到相关章节的 pageId（如"计费说明""价格""规格"等）
5. 获取页面元信息：调用 get_page_metadata({ provider: "xxx", pageId: "xxx" }) 获取 contentPath
6. 获取文档正文：调用 get_page_content({ provider: "xxx", contentPath: "xxx" })
7. 总结回答：基于文档内容回答用户问题

### 搜索流程（当目录无法定位或用户询问具体功能时）
1. 获取产品列表：调用 list_products 获取产品 productId（可并行）
2. 先用宽泛关键词搜索：调用 search_documents，关键词不要太具体（如用"计费"而非"4C8G价格"）
3. 获取页面元信息：调用 get_page_metadata 获取 contentPath
4. 获取文档正文：调用 get_page_content 获取完整 Markdown 内容
5. 总结回答

### 价格查询流程（当用户询问价格时）

**优先从文档目录定位定价页面**（推荐）：
1. 获取产品列表：调用 list_products 获取产品 productId（可并行查询多个厂商）
2. 获取文档目录：调用 get_document_toc 查看目录，寻找"计费说明""价格""定价""计费"等章节
3. 定位定价页面：从目录中找到定价相关章节的 pageId
4. 获取定价页面内容：调用 get_page_metadata → get_page_content 获取定价页面 Markdown 内容
5. 提取价格表：从 Markdown 内容中解析价格表格
6. 总结回答

**搜索回退**（目录中找不到定价章节时）：
1. 调用 search_documents({ provider: "xxx", productId: "xxx", keyword: "计费" }) 搜索定价相关页面（用宽泛关键词）
2. 获取搜索结果中的 pageId，调用 get_page_metadata → get_page_content
3. 提取价格信息

**get_product_price 回退**（文档中找不到价格时）：
1. 调用 get_product_price({ provider: "xxx" }) 获取价格数据
2. 如果返回空，尝试带 productId 调用：get_product_price({ provider: "xxx", productId: "xxx" })

## 各厂商特殊说明

- **联通云 cucloud**：文档详情页为 Vue SPA 有反爬保护，get_page_content 返回搜索 API 摘要而非完整页面，价格信息需从搜索摘要中提取
- **移动云 ecloud**：contentPath 是 hash 字符串（如 60daff9598d5c8fe58d847009f94c256）而非 URL，直接传给 get_page_content 即可
- **华为云 CloudPond 云桌面**：文档只有规格清单（企业办公型-4U8GB 等），具体价格需联系销售，get_product_price 返回空
- **腾讯云云桌面**：文档未公开具体价格，需官网价格计算器
- **天翼云云电脑价格**：get_product_price({ provider: "ctyun", productId: "10027004" }) 可获取完整价格表

## 腾讯云大模型 Token 价格速查

当用户询问腾讯云大模型 Token 价格时，直接使用以下已知的文档页面获取价格信息（无需搜索目录）：

| 价格类型 | 文档 URL | 说明 |
|---------|---------|------|
| 模型价格（按需） | https://cloud.tencent.com/document/product/1823/130055 | 各模型按量计费单价 |
| Token Plan 企业版专业套餐 | https://cloud.tencent.com/document/product/1823/130659 | 企业版专业套餐价格 |
| Token Plan 企业版轻享套餐 | https://cloud.tencent.com/document/product/1823/131173 | 企业版轻享套餐价格 |
| Token Plan 个人版 | https://cloud.tencent.com/document/product/1823/130060 | 个人版套餐价格 |

获取方式：直接调用 get_page_metadata({ provider: "tencent", pageId: "1823/130055" }) → get_page_content 即可获取完整价格表。所有 Token 价格页面可并行获取。

## 火山引擎大模型 Token 价格速查

当用户询问火山引擎（火山方舟/豆包）大模型 Token 价格时，直接使用以下页面：

| 价格类型 | 文档 URL | 说明 |
|---------|---------|------|
| 模型价格（按需） | https://www.volcengine.com/docs/82379/1544106 | 各模型按量计费单价（含 doubao、DeepSeek 等） |
| 定价详情页 | https://www.volcengine.com/pricing?product=ark_bd&tab=1 | 价格计算器（含资源包） |

获取方式：调用 get_page_metadata({ provider: "volcengine", pageId: "82379/1544106" }) → get_page_content 获取模型价格表。火山方舟的 Agent Plan / Coding Plan（套餐概览）页面为 pageId: "82379/2366394"，可通过 get_page_metadata → get_page_content 获取套餐详情（含 Small/Medium/Large/Max 四档套餐价格）。

## 华为云大模型 Token 价格速查

当用户询问华为云 MaaS（模型即服务）Token 价格时，直接使用以下方式：

| 价格类型 | 获取方式 | 说明 |
|---------|---------|------|
| 模型价格（按需） | get_product_price({ provider: "huawei", productId: "maas" }) | 返回所有模型的输入/输出 Token 单价 |
| Token Plan（套餐） | https://support.huaweicloud.com/price-maas/price-maas-0002.html | 套餐包价格详情 |

获取方式：按需价格直接调用 get_product_price 获取；套餐价格通过 get_page_metadata({ provider: "huawei", pageId: "maas/price-maas/price-maas-0002" }) → get_page_content 获取套餐详情页面。

## 移动云大模型 Token 价格速查

当用户询问移动云 MoMA（模型服务平台）Token 价格时，直接使用以下页面：

| 价格类型 | 文档 URL | 说明 |
|---------|---------|------|
| 预置模型服务-token按量计费 | https://ecloud.10086.cn/op-help-center/doc/article/91592 | 预置模型 Token 按量价格 |
| 预置模型服务-一次性资源包 | https://ecloud.10086.cn/op-help-center/doc/article/95323 | 预置模型资源包价格 |
| 合作模型服务-token按量计费 | https://ecloud.10086.cn/op-help-center/doc/article/99427 | 合作模型 Token 按量价格 |
| Coding Plan个人版价格 | https://ecloud.10086.cn/op-help-center/doc/article/98320 | Coding Plan 套餐价格 |

获取方式：直接调用 get_page_metadata({ provider: "ecloud", pageId: "91592" }) → get_page_content 获取 Token 价格表。所有 Token 价格页面可并行获取。

## 百度云千帆大模型 Token 价格速查

当用户询问百度云千帆大模型 Token 价格时，直接使用以下页面：

| 价格类型 | 文档 URL | 说明 |
|---------|---------|------|
| Token 计费说明 | https://cloud.baidu.com/doc/qianfan/s/wmh4sv6ya | 千帆大模型 Token 按量计费价格 |
| Token 福利包 | https://cloud.baidu.com/doc/qianfan/s/Smoghsq3g | Token 福利包套餐价格 |

获取方式：直接调用 get_page_metadata({ provider: "baidu", pageId: "qianfan/s/wmh4sv6ya" }) → get_page_content 获取 Token 价格表。所有 Token 价格页面可并行获取。

## 智谱 GLM 大模型 Token 价格速查

当用户询问智谱 GLM Token 价格时，直接使用以下方式：

| 价格类型 | 获取方式 | 说明 |
|---------|---------|------|
| 模型按量价格 | https://bigmodel.cn/pricing | 各模型按量计费单价（含 GLM-4 系列、GLM-4V 等） |
| GLM Coding Plan | https://bigmodel.cn/glm-coding | Coding Plan 套餐（Lite/Pro/Max）价格 |

获取方式：按量价格通过 get_page_metadata({ provider: "glm", pageId: "/cn/guide/start/quick-start" }) → get_page_content 获取文档中的价格信息。Coding Plan 套餐详情通过 get_page_metadata({ provider: "glm", pageId: "/cn/coding-plan/overview" }) → get_page_content 获取。

## 当前支持的云厂商

- ctyun - 天翼云
- aliyun - 阿里云
- volcengine - 火山引擎
- tencent - 腾讯云
- huawei - 华为云
- ecloud - 移动云
- cucloud - 联通云
- bailian - 阿里云百炼
- baidu - 百度云
- deepseek - DeepSeek
- glm - 智谱 GLM
- minimax - MiniMax
- kimi - 月之暗面 Kimi`,
});
server.registerTool("list_products", {
    description: "获取指定云厂商的所有产品文档列表，返回产品名称和对应的 productId",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识，如 'ctyun'"),
    }).strict(),
}, async ({ provider }) => {
    const adapter = getAdapter(provider);
    const products = await adapter.listProducts();
    const text = JSON.stringify(products);
    return { content: [{ type: "text", text: truncateResponse(text, "list_products", { provider }) }] };
});
server.registerTool("get_document_toc", {
    description: "获取指定产品的文档目录树。参数 productId 来自 list_products 返回的 productId",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        productId: z.string().describe("产品文档 ID"),
    }).strict(),
}, async ({ provider, productId }) => {
    const adapter = getAdapter(provider);
    const items = await adapter.getDocumentToc(productId);
    const text = JSON.stringify(items, null, 2);
    return { content: [{ type: "text", text: truncateResponse(text, "get_document_toc", { provider, productId }) }] };
});
server.registerTool("search_documents", {
    description: "在指定云厂商的产品文档中按关键词搜索，返回匹配的页面列表",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        productId: z.string().describe("产品文档 ID"),
        keyword: z.string().describe("搜索关键词"),
    }).strict(),
}, async ({ provider, productId, keyword }) => {
    const adapter = getAdapter(provider);
    const results = await adapter.searchDocuments(productId, keyword);
    const text = JSON.stringify(results, null, 2);
    return { content: [{ type: "text", text: truncateResponse(text, "search_documents", { provider, productId, keyword }) }] };
});
server.registerTool("get_page_metadata", {
    description: "获取文档页面的元信息，包括标题和 contentPath。参数 pageId 来自 get_document_toc 或 search_documents",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        pageId: z.string().describe("文档页面 ID"),
    }).strict(),
}, async ({ provider, pageId }) => {
    const adapter = getAdapter(provider);
    const metadata = await adapter.getPageMetadata(pageId);
    const text = JSON.stringify(metadata, null, 2);
    return { content: [{ type: "text", text: truncateResponse(text, "get_page_metadata", { provider, pageId }) }] };
});
server.registerTool("get_product_price", {
    description: "获取指定云厂商的产品价格信息。不传 productId 则返回所有产品价格概览",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        productId: z.string().optional().describe("产品 ID（可选，不传则返回所有产品价格概览）"),
        region: z.string().optional().describe("地域/可用区，如 ap-guangzhou"),
        billingMode: z.string().optional().describe("计费模式，如 PREPAID（包年包月）、POSTPAID_BY_HOUR（按量）"),
    }).strict(),
}, async ({ provider, productId, region, billingMode }) => {
    const adapter = getAdapter(provider);
    const result = await adapter.getProductPrice(productId, { region, billingMode });
    const text = JSON.stringify(result, null, 2);
    return { content: [{ type: "text", text: truncateResponse(text, "get_product_price", { provider, productId, region, billingMode }) }] };
});
server.registerTool("get_page_content", {
    description: "获取文档页面的完整 Markdown 正文。参数 contentPath 来自 get_page_metadata 返回的 contentPath",
    inputSchema: z.object({
        provider: z.string().describe("云厂商标识"),
        contentPath: z.string().describe("文档正文 URL"),
    }).strict(),
}, async ({ provider, contentPath }) => {
    const adapter = getAdapter(provider);
    const content = await adapter.getPageContent(contentPath);
    return { content: [{ type: "text", text: truncateResponse(content, "get_page_content", { provider, contentPath }) }] };
});
export async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch(console.error);
