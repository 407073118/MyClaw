---
quick_id: 260508-fmv
description: ScheduleJobListPage 列表 + ExecutionHistoryDrawer 视觉重做 + outputSummary Markdown 渲染
date: 2026-05-08
mode: quick
must_haves:
  truths:
    - "outputSummary 在抽屉里以渲染后的 Markdown 呈现，标题/列表/代码块/引用/链接都按规范字体和颜色显示，不再出现裸 ** # > 字符"
    - "Markdown 渲染走 marked@17 + 现有 sanitizePreviewHtml（移除 script/iframe/style/on*/javascript:），LLM 注入 onerror/script 不会执行"
    - "list-page-row--job 行有左侧 3px 状态色条（运行 cyan / 成功 green / 失败 red / 暂停 muted），hover 用 --bg-surface-hover 提升对比"
    - "ExecutionHistoryDrawer header 和 row 都加左侧 3px 状态色条，row 背景从 --bg-surface 升到 --bg-card 与 drawer body 形成层次"
    - "errorMessage 仍以 mono red <pre> 渲染（错误不是 markdown，避免误格式化）"
  artifacts:
    - desktop/src/renderer/components/MarkdownView.tsx
    - desktop/src/renderer/pages/TimeCenterPage.tsx
  key_links:
    - desktop/src/renderer/utils/skill-preview.ts # 现有 sanitizePreviewHtml，复用
    - desktop/src/renderer/pages/TimeCenterPage.tsx:790  # list-page-row--job
    - desktop/src/renderer/pages/TimeCenterPage.tsx:887  # drawer header
    - desktop/src/renderer/pages/TimeCenterPage.tsx:919  # status-badge in row
    - desktop/src/renderer/pages/TimeCenterPage.tsx:929  # <pre>{outputSummary}</pre>
    - desktop/src/renderer/pages/TimeCenterPage.tsx:2126 # drawer CSS start
    - desktop/src/renderer/pages/TimeCenterPage.tsx:2293 # list-page-row CSS
---

# Quick 260508-fmv — Plan

## Goal
让定时任务列表与执行历史抽屉「一眼可读」，LLM 输出按 Markdown 渲染而不是裸文本。

## Tasks

### Task 1 — 新建 MarkdownView 组件

**files:**
- desktop/src/renderer/components/MarkdownView.tsx (new)

**action:**
1. 新文件，依赖：
   - `import { marked } from "marked"` —— 同 ChatPage.tsx / skill-preview.ts 用法
   - `import { sanitizePreviewHtml } from "../utils/skill-preview"` —— 复用现有 sanitizer，不要造新轮子（已覆盖 script/iframe/style/embed/link/meta/base + on* attr + javascript: href + srcdoc）
2. 组件签名：`export default function MarkdownView({ source, className }: { source: string; className?: string }): React.JSX.Element | null`
3. `useMemo` 把 `source` parse 成 html：
   - 先 `source.replace(/\]\(\s*javascript:[^)]+\)/gi, "]()")` 同 skill-preview 的处理
   - `marked.parse(normalized) as string`，失败则回退转义原文
   - 再过 `sanitizePreviewHtml`
4. 渲染 `<div className={className ?? "markdown-view"} dangerouslySetInnerHTML={{ __html: html }} />`，空字符串返回 null。
5. **不在组件文件内放 CSS**（typography CSS 写在 TimeCenterPage 的 `styles` 字符串里，针对 `.execution-history-row__markdown`，不污染全局）。

**verify:**
- `tsc --noEmit -p desktop/tsconfig.renderer.json` 0 新错误（preexisting workspace.ts 错误属另一未提交改动，不属本任务）
- 手动构造 `source = "# H\n- a\n\n```\ncode\n```\n[x](javascript:alert(1))"` 渲染：标题、列表、code block 正常，javascript: 链接被替换为 `#`，无脚本执行

**done:**
- 文件存在且导出 default 组件

---

### Task 2 — 列表行 + 抽屉视觉重做 + outputSummary 走 MarkdownView

**files:**
- desktop/src/renderer/pages/TimeCenterPage.tsx

**action:**

#### 2.1 计算行/抽屉状态颜色
新增本地小工具 `resolveJobAccent(job, latestRun): "active" | "running" | "failed" | "muted"`：
- `job.status === "paused"` → `"muted"`
- `latestRun?.status === "running" || job.status === "running"` → `"running"`
- `latestRun?.status === "failed" || job.status === "failed"` → `"failed"`
- `latestRun?.status === "succeeded"` → `"active"`
- 否则 → `"muted"`

新增 `resolveRunAccent(run): "active" | "running" | "failed" | "muted"`：
- `run.status === "succeeded"` → `"active"`
- `run.status === "running"` → `"running"`
- `run.status === "failed"` → `"failed"`
- queued/cancelled/其他 → `"muted"`

#### 2.2 list-page-row--job 加状态色条
在 `ScheduleJobListPage` 的 `jobs.map` 里：
```tsx
const accent = resolveJobAccent(job, latestRun);
<article
  className={`list-page-row list-page-row--job list-page-row--job-${accent} is-clickable`}
  ...
>
```

#### 2.3 ExecutionHistoryDrawer header + row 状态化
```tsx
<aside
  className="execution-history-drawer"
  data-status={resolveJobAccent(job, latestRun)}  // 计算 props 传入或 useMemo
  ...
>
```
更稳妥：在 ExecutionHistoryDrawer 内根据 `sortedRuns[0]` 推断 header 状态，加 `className={`execution-history-drawer execution-history-drawer--${accent}`}`。

每条 run li：
```tsx
<li className={`execution-history-row execution-history-row--${resolveRunAccent(run)}`}>
```

#### 2.4 替换 outputSummary 渲染
```tsx
import MarkdownView from "../components/MarkdownView";
...
{run.outputSummary ? (
  <MarkdownView
    source={run.outputSummary}
    className="execution-history-row__markdown"
  />
) : null}
```
errorMessage 保持原 `<pre className="execution-history-row__error">`。

#### 2.5 styles 字符串追加 CSS

A. list-page-row--job 加伪元素色条 + hover：
```css
.list-page-row--job {
  position: relative;
  padding-left: 27px; /* 24px 原 + 3px stripe */
}
.list-page-row--job::before {
  content: "";
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--text-muted);
  opacity: 0.6;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.list-page-row--job:hover {
  background: var(--bg-surface-hover);
}
.list-page-row--job:hover::before { opacity: 1; }

.list-page-row--job-active::before { background: var(--status-green); box-shadow: 0 0 8px rgba(34,197,94,0.35); }
.list-page-row--job-running::before { background: var(--accent-cyan); box-shadow: 0 0 8px rgba(16,163,127,0.45); }
.list-page-row--job-failed::before { background: var(--status-red); box-shadow: 0 0 8px rgba(239,68,68,0.45); }
.list-page-row--job-muted::before { background: var(--text-muted); }
```

B. 抽屉 header 加色条 + eyebrow accent：
```css
.execution-history-drawer__header {
  position: relative;
  padding-left: 27px;
}
.execution-history-drawer__header::before {
  content: "";
  position: absolute;
  left: 0; top: 16px; bottom: 16px;
  width: 3px;
  border-radius: 2px;
  background: var(--text-muted);
}
.execution-history-drawer--active .execution-history-drawer__header::before { background: var(--status-green); }
.execution-history-drawer--running .execution-history-drawer__header::before { background: var(--accent-cyan); }
.execution-history-drawer--failed .execution-history-drawer__header::before { background: var(--status-red); }
.execution-history-drawer--muted .execution-history-drawer__header::before { background: var(--text-muted); }

.execution-history-drawer__eyebrow {
  color: var(--accent-cyan);
}
```

C. row 背景升级 + 色条：
```css
.execution-history-row {
  position: relative;
  background: var(--bg-card);
  border: 1px solid var(--glass-border);
  padding-left: 16px;
}
.execution-history-row::before {
  content: "";
  position: absolute;
  left: 0; top: 12px; bottom: 12px;
  width: 3px;
  border-radius: 2px;
  background: var(--text-muted);
}
.execution-history-row--active::before { background: var(--status-green); }
.execution-history-row--running::before { background: var(--accent-cyan); }
.execution-history-row--failed::before { background: var(--status-red); }
.execution-history-row--muted::before { background: var(--text-muted); }

.execution-history-row__time {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
```

D. Markdown typography（限定在 row 内，避免泄漏）：
```css
.execution-history-row__markdown {
  margin: 0;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.65;
  word-break: break-word;
}
.execution-history-row__markdown > *:first-child { margin-top: 0; }
.execution-history-row__markdown > *:last-child { margin-bottom: 0; }
.execution-history-row__markdown h1,
.execution-history-row__markdown h2,
.execution-history-row__markdown h3,
.execution-history-row__markdown h4 {
  margin: 14px 0 6px;
  color: var(--text-primary);
  font-weight: 600;
  line-height: 1.35;
}
.execution-history-row__markdown h1 { font-size: 18px; }
.execution-history-row__markdown h2 { font-size: 16px; }
.execution-history-row__markdown h3 { font-size: 14px; }
.execution-history-row__markdown h4 { font-size: 13px; color: var(--text-secondary); }
.execution-history-row__markdown p { margin: 8px 0; }
.execution-history-row__markdown ul,
.execution-history-row__markdown ol { margin: 8px 0; padding-left: 22px; }
.execution-history-row__markdown li { margin: 3px 0; }
.execution-history-row__markdown li > p { margin: 0; }
.execution-history-row__markdown a {
  color: var(--accent-cyan);
  text-decoration: none;
  border-bottom: 1px solid rgba(16,163,127,0.35);
}
.execution-history-row__markdown a:hover { border-bottom-color: var(--accent-cyan); }
.execution-history-row__markdown code {
  padding: 1px 5px;
  background: rgba(255,255,255,0.06);
  border-radius: var(--radius-sm);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--text-primary);
}
.execution-history-row__markdown pre {
  margin: 10px 0;
  padding: 12px 14px;
  background: rgba(0,0,0,0.35);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.55;
}
.execution-history-row__markdown pre code {
  padding: 0;
  background: transparent;
  border-radius: 0;
  font-size: 12px;
}
.execution-history-row__markdown blockquote {
  margin: 10px 0;
  padding: 4px 12px;
  border-left: 3px solid var(--glass-border-strong);
  color: var(--text-secondary);
}
.execution-history-row__markdown hr {
  margin: 14px 0;
  border: 0;
  border-top: 1px solid var(--glass-border);
}
.execution-history-row__markdown table {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 12px;
}
.execution-history-row__markdown th,
.execution-history-row__markdown td {
  padding: 6px 10px;
  border: 1px solid var(--glass-border);
  text-align: left;
}
.execution-history-row__markdown th {
  background: rgba(255,255,255,0.04);
  color: var(--text-secondary);
  font-weight: 600;
}
.execution-history-row__markdown img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-md);
}
.execution-history-row__markdown strong { color: var(--text-primary); font-weight: 600; }
.execution-history-row__markdown em { color: var(--text-secondary); font-style: italic; }
```

**verify:**
- `pnpm run typecheck` 0 新错误。
- 启动 desktop dev：
  - 进入「定时任务」列表页：每行最左多了一根细色条；hover 整行背景变明显；状态色与 latestRun 实际状态吻合（成功绿、失败红、运行 cyan、暂停 muted）。
  - 点行打开抽屉：header 左侧色条；eyebrow「执行历史」用 cyan；每条 run 卡片背景变暗对比 drawer body，左侧色条颜色随该次 run 状态变化。
  - 用一条 outputSummary 含 `# 标题 / **粗** / *斜* / [link](https://x) / 列表 / ``` 代码块 ``` / > 引用` 的 run：渲染为格式化 HTML；`[x](javascript:alert(1))` 链接被替换为 `#`，无 alert 触发。
  - 失败 run 的 errorMessage 仍保持 mono red 等宽显示。

**done:**
- 列表行有色条 + 强 hover；抽屉有层次 + 色条；outputSummary 渲染 Markdown；XSS 注入被 sanitize 拦截。

## Out of scope
- 列表行 status-badge 重设计（保留现状，色条已承载状态信号）
- 长 outputSummary 折叠/展开（默认全展开，符合用户期望「直接看到」）
- 代码块语法高亮（不引新依赖）
- 错误 message 的 markdown 渲染（错误不是 markdown，保持 plain）
