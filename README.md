# ctyun-docs-search

天翼云文档搜索 Skill - 让 AI 编程助手能够搜索和获取天翼云官方产品文档。

## 功能特性

- **产品文档搜索**：自动搜索天翼云官方文档站，获取任意产品的详细文档
- **全产品覆盖**：支持天翼云所有产品线（云电脑、弹性云主机、存储、网络等）
- **关键词搜索**：支持在指定产品文档中按关键词搜索相关页面
- **完整内容获取**：获取文档的完整 Markdown 正文，包括操作步骤、配置说明等

## 支持的产品

- 天翼云电脑（政企版）
- 弹性云主机 ECS
- 云硬盘
- 对象存储
- 虚拟私有云
- 负载均衡
- ... (通过 API 获取完整列表)

## 在不同 AI 助手中导入

### 1. Claude Code (推荐)

#### 方式一：使用 Skill 工具安装

```bash
# 安装 skill
/skills install https://github.com/octopuszy-zhangyu/ctyun-docs-search
```

#### 方式二：手动安装

```bash
# 克隆仓库
git clone https://github.com/octopuszy-zhangyu/ctyun-docs-search.git ~/.claude/skills/ctyun-docs-search
```

#### 使用方式

安装后，只需在对话中提及天翼云相关产品即可自动触发：

```
用户：请问天翼云电脑怎么登录？
→ 自动触发 skill，搜索并返回登录文档
```

### 2. Cursor

#### 安装步骤

1. 打开 Cursor 设置 (Settings → Features → Skills)
2. 点击 "Add Skill" 或 "Add Custom Skill"
3. 选择 "From URL" 或 "From GitHub"
4. 输入仓库地址：`https://github.com/octopuszy-zhangyu/ctyun-docs-search`
5. 点击安装

#### 使用方式

在 Cursor 对话框中询问天翼云相关问题即可：

```
请问弹性云主机的计费方式有哪些？
```

### 3. Windsurf (Codeium)

#### 安装步骤

1. 打开 Windsurf 设置
2. 找到 "Extensions" 或 "Skills" 部分
3. 添加新的 Skill
4. 粘贴仓库地址：`https://github.com/octopuszy-zhangyu/ctyun-docs-search`

#### 使用方式

在 Windsurf 对话中直接提问：

```
天翼云电脑如何配置网络？
```

### 4. 其他支持 MCP Tools 的客户端

如果你的 AI 助手支持 MCP 工具，可以通过以下方式集成：

1. 将仓库克隆到本地
2. 在 MCP 配置中添加 skill 路径
3. 重启客户端

## 使用示例

### 示例 1：查询产品基本信息

**用户提问**：
> 天翼云电脑（政企版）是什么产品？

**自动执行**：
1. 调用 `ListForHelp` API 获取产品列表
2. 匹配 "天翼云电脑（政企版）" 获取 bookId: 10027004
3. 获取文档目录，提取产品定义页面
4. 返回产品定义和简介

### 示例 2：查询具体功能

**用户提问**：
> 弹性云主机如何设置自动备份？

**自动执行**：
1. 获取 ECS 产品的 bookId (10026730)
2. 调用 `ContentQuery` 搜索关键词 "备份"
3. 获取相关页面的 contentPath
4. 返回备份设置的具体操作步骤

### 示例 3：查询计费信息

**用户提问**：
> 天翼云电脑怎么计费？

**自动执行**：
1. 获取产品列表，匹配 "天翼云电脑"
2. 获取文档目录，定位计费相关页面
3. 返回计费说明文档内容

## 技术原理

### 核心 API

| API | 用途 |
|-----|------|
| `ListForHelp` | 获取所有产品文档列表 |
| `ContentQuery` | 在产品文档中搜索关键词 |
| `page/Get` | 获取文档页面元信息和 contentPath |
| `contentPath` | 获取文档 Markdown 正文 |

### 工作流程

```
用户提问 → 匹配产品 → 获取目录/搜索 → 获取页面 → 返回内容
```

## 正在改进的点

- [ ] **缓存机制**：增加产品列表缓存，减少重复请求
- [ ] **更精确的匹配**：优化产品名称匹配算法，支持更多模糊匹配场景
- [ ] **目录结构解析**：完善从 HTML 提取目录的稳定性
- [ ] **图片处理**：优化文档中图片的显示和引用
- [ ] **更多产品支持**：持续更新产品 bookId 映射表

## 注意事项

1. 本 skill 依赖天翼云官方文档站 API，需保持网络畅通
2. 部分 API 需要携带特定的请求头（`csm`, `cst`）
3. 文档内容以 Markdown 格式返回，图片链接需单独处理

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License
