# Phase 8 Context — 统一文档理解能力（Document IR + document.read 门面）

> 本文档在 `/gsd:add-phase` 阶段沉淀，供后续 `/gsd:discuss-phase` 与 `/gsd:plan-phase` 读取。

## 目标

让桌面端 AI 助手原生理解 office/pdf 等企业文档格式，不再依赖员工本地 Python 环境。在四个维度同时立住：

- **保真度**：保留结构语义（标题层级、表格、列表、页码、幻灯片顺序、备注、批注、脚注）
- **可扩展性**：新增格式只写 parser，下游零改动
- **可观测/可审计**：结构化日志、审计可检索、缓存可溯源
- **模型引导**：模型默认走原生工具，python 路径被物理堵死

## 当前状态（真实）

`desktop/src/main/services/builtin-tool-executor.ts`：
- `xlsx.extract` 已用 SheetJS (`xlsx` 0.18.5) 原生实现（`:1303-1372`）
- `docx.extract` / `pdf.extract` 只有 `BINARY_EXT_MAP` 里的 `suggestedTool` 占位（`:207, :209`），executor 无实现分支
- 模型遇到 `.docx/.pdf/.pptx` 会 fallback 到 `exec_command` + `py -3` + `python-docx/openpyxl/PyPDF2`
- `buildSkillExecutionGuidance` (`:619-634`) 仍把 `py -3` 当首选引导
- `buildWindowsPythonFallbackCommand` (`:604-617`) 是 python 不可用时的兜底，侧面证明员工机器确实经常没装 python

对"全公司员工"这一受众，python 依赖不可预期；且 `python-docx` 等库输出扁平字符串，结构语义大面积丢失——这是方案要解决的**本质问题**。

## 设计核心

### 1. Document IR（统一中间表示）

所有格式先收敛到同一个结构化模型，下游渲染/检索/审计/缓存基于 IR 一次写完全部复用。

位置：`desktop/shared/contracts/document.ts`（新增）

节点类型（最小集，只保留语义、不保留表现层）：
- `heading` / `paragraph` / `list` / `table` / `image` / `code` / `quote`
- `slide`（带 `notes` 备注）/ `sheet`（带 `dims`）
- `comment` / `footnote` / `pageBreak`

IR 主体：
- `source`：`path` / `format` / `bytes` / `sha256`
- `meta`：`title` / `author` / `modifiedAt` / `pages` / `words`
- `outline`：扁平目录，每项带 `Locator`
- `body`：节点树
- `media`：图片等资产按引用存，不内联

### 2. 工具门面：一个 `document.read`

替代散落的 `xlsx.extract / docx.extract / pdf.extract`，收敛到一个工具。

参数设计：
```ts
{
  path: string,
  mode: "stats" | "outline" | "read" | "search",
  locator?: { page?: number; slide?: number; sheet?: string; heading?: string; range?: [number, number] },
  query?: string,          // mode=search
  maxChars?: number,       // 默认 8000，硬顶 32000
  format?: "markdown" | "json",
  includeImages?: "none" | "refs" | "inline"
}
```

四个 mode 对应"像人一样读书"的动作：
- `stats` → 这是本什么书（决定策略）
- `outline` → 目录（决定读哪）
- `read` → 精读某页/某 sheet/某章节
- `search` → 关键词定位（RAG 雏形）

大文档从此不再一次性灌上下文。

### 3. Parser 选型（全部纯 JS，零 Python）

| 格式 | 方案 | 关键决策 |
|---|---|---|
| `.xlsx/.xls/.xlsm` | SheetJS（已装）重写到 IR | 保留多 sheet + 合并单元格 |
| `.docx` | `mammoth` + 自写 XML 补表格/批注/脚注/图片引用 | mammoth 单用丢表格结构 |
| `.pdf` | `pdfjs-dist`（禁 JS 执行） | 按页切分 = locator.page |
| `.pptx` | 自写：unzip + 解析 `ppt/slides/*.xml` + `notesSlides/*.xml` | 必须拿到备注页 |
| `.md/.txt` | 直接 + `marked`（已装） | - |
| `.csv` | 自写（BOM / 编码探测 / 分隔符探测） | 收敛到 IR.table |
| `.doc` 老格式 | **不实现**，引导另存为 `.docx` | 纯 Node 无可打的方案 |
| 图片 | 不 extract，走多模态通道 | 保真度最高 |
| 音视频 | 不在本 phase 范围 | 属 cloud 能力 |

打包增量估算：mammoth ~500KB、pdfjs-dist ~5MB、pptx 0（Node 原生 zlib）。总 ~5-6MB。

### 4. IR 持久化缓存

位置：`userData/docCache/<sha256>/`
- `ir.json`：DocumentIR 主体
- `media/`：图片等资产
- `meta.json`：`{ cachedAt, hits, lastAccess }`

策略：
- Key = 文件内容 sha256（文件移动/复制依然命中）
- LRU 清理，默认 500MB 上限
- sha256 变化自然失效

支撑场景：批量周报汇总、合同版本对比。

### 5. 安全边界

- 解析器禁用外部引用（docx/xlsx 的 XXE、PDF 嵌入 JS、pptx 外链媒体）
- 单文件 > 50MB 拒绝并提示先 `mode=stats`
- `maxChars` 硬顶 32000
- 路径权限完全复用现有 5-tier `PathAccessPolicy`（commit `f90a67c`）
- 审计日志：每次 read 落结构化记录（`sha256 + user + mode + returnedBytes`）

### 6. 模型引导（与实现同等重要）

三处改动把模型"遇到 docx 就写 py 脚本"的路径物理堵死：
1. `fs_read` description：明确指引所有 office/pdf/csv 走 `document.read`
2. `fs_read` 命中已知二进制格式时**硬拒绝**（目前只是 suggestedTool 提示），错误消息直接给出 `document.read` 调用模板
3. 清理 `buildSkillExecutionGuidance` (`builtin-tool-executor.ts:619-634`) 里把 `py -3` 当首选的文案

## 范围（本 phase）

IN：
- IR 契约 + Parser registry + 工具门面骨架
- 首批 parser：xlsx 迁移、docx、pdf、pptx、md/txt/csv
- `stats/outline/read/search` 四个 mode
- sha256 缓存
- 安全边界（禁 XXE/禁 PDF JS/大小闸门/路径权限）
- 模型引导三处改动

OUT（留到后续 phase）：
- `.doc` 老格式硬啃
- 扫描件 OCR
- 音视频转写
- 企业内网文档系统连接（`cloud://` URI）

## 约束

- 纯 Node/Electron，零 Python 依赖
- 跨平台一致（Win/Mac/Linux）
- 打包增量 ≤ 6MB
- 向后兼容：`xlsx.extract` 保留一段 alias 过渡期
- 不新造权限轮子，复用 `PathAccessPolicy`

## 关键 Tradeoff（已决）

1. **合并成一个 `document.read`**，不做 N 个 extract 工具 → 降低模型选择成本
2. **IR 只留语义、不留表现层**（字体字号等不入 IR）→ 降噪 + 保持精简
3. **缓存上磁盘**（非内存）→ 支撑跨会话批量工作流
4. **`.doc` 不硬啃** → 坚守"零外部依赖"底线
5. **扫描件不伪 OCR**，如实告诉模型"这页是扫描件"→ 诚实 > 假装能干

## 验收锚点（给 verify-phase）

- 模型处理 `.xlsx/.docx/.pdf/.pptx` 不再诱导写 Python 脚本（tool-call log 审计）
- `stats/outline/read/search` 四个 mode 都能用且有契约测试
- 同一文件二次读秒回（IR 缓存命中）
- `fs_read` 碰到已知二进制格式直接拒绝 + 指向 `document.read`
- `xlsx.extract` 旧 toolId 仍可用（向后兼容）
- 打包体积增量 ≤ 6MB

## 分期建议（供 plan-phase 参考）

- **A 骨架**：IR 契约 / Parser interface + registry / `document.read` 门面 + mode 路由 / IR→Markdown 纯函数 / 缓存骨架
- **B 核心 parser**：xlsx 迁移 / docx / pdf / pptx / md/txt/csv
- **C 引导与拦截**：`fs_read` 硬拒绝 / 清理 python-first 文案 / tool-schemas 四 mode 示例
- **D 搜索 + 多模态**：`mode=search` 检索 / `includeImages=inline` 多模态通道 / 批量场景缓存验证

A→B 不可跳（没 IR 就没意义）；B→C 不可跳（没引导模型还是走老路）；D 可选。
