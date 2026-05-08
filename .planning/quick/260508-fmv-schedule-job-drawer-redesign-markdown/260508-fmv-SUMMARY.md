---
quick_id: 260508-fmv
description: ScheduleJobListPage 列表 + ExecutionHistoryDrawer 视觉重做 + outputSummary Markdown 渲染
date: 2026-05-08
status: completed
---

# Quick 260508-fmv — Summary

## What changed

### 新增文件
**`desktop/src/renderer/components/MarkdownView.tsx`**
- 轻量 Markdown 渲染组件，复用 `desktop/src/renderer/utils/skill-preview.ts` 里已有的 `sanitizePreviewHtml`（白名单移除 script/iframe/style/object/embed/link/meta/base/srcdoc + on* 属性 + `javascript:` 协议链接）。
- `marked.parse(...)` 同步 + try/catch + 降级转义 plain text。
- 受控 className，默认 `"markdown-view"`，业务页面可传入自己的 scope class（避免全局污染）。

### 修改文件
**`desktop/src/renderer/pages/TimeCenterPage.tsx`**

1. 状态 → 颜色映射工具
   - `resolveJobAccent(job, latestRun)` 综合 ScheduleJobStatus + ExecutionRunStatus 决定列表行 / 抽屉 header 的色条颜色（active/running/failed/muted）。
   - `resolveRunAccent(run)` 单次执行记录的色条颜色。

2. ScheduleJobListPage 列表行
   - `<article className={`list-page-row list-page-row--job list-page-row--job-${accent} is-clickable`}>`
   - CSS：左侧 3px 状态色条（`::before` 绝对定位 + `box-shadow` 微 glow），hover 升 `--bg-surface-hover`，hover 时色条 opacity 0.55 → 1，色条颜色随 accent 变化。

3. ExecutionHistoryDrawer
   - 根据 `sortedRuns[0]` 计算 `drawerAccent`，加 `execution-history-drawer--{accent}` modifier。
   - header 加 3px 色条（`::before`）+ eyebrow 颜色由 `--text-muted` 改为 `--accent-cyan`。
   - 每条 run 的 `<li>` 加 `execution-history-row--{accent}` modifier 与 3px 色条；row 背景从 `--bg-surface` 升到 `--bg-card` 与 drawer body 拉开层次。
   - `<pre>{run.outputSummary}</pre>` 替换为 `<MarkdownView source={run.outputSummary} className="execution-history-row__markdown" />`。
   - `errorMessage` 仍走原 mono red `<pre>`（错误不是 Markdown）。

4. Markdown typography（`.execution-history-row__markdown`）
   - `h1-h4` 字号梯度 18/16/14/13、`p` 8px 上下间距、`ul/ol` padding-left 22、`li` 3px 间距。
   - `code` 行内 rgba 0.06 + radius-sm；`pre` rgba 0 0.35 + glass-border + radius-md + horizontal scroll。
   - `blockquote` 左 3px glass-border-strong + 弱底；`hr` 1px glass-border；`table` 边线 + th 浅底；`a` accent-cyan + 下划线；`img` max-width 100%。

## How to verify

1. `cd desktop && pnpm run typecheck` —— 本次改动 0 错误（preexisting `workspace.ts:31` `WorkflowDefinitionSummary` 错误属仓库另一未提交改动）。
2. desktop dev → 「定时任务」列表页：
   - 每行最左 3px 色条；hover 行变明显。
   - 暂停 job 灰色，最近成功绿，最近失败红，运行中 cyan。
3. 点行打开抽屉：
   - header 左侧色条与 eyebrow cyan 字一目了然。
   - run 卡片背景比 drawer body 暗，左侧色条颜色按本次 run 状态变化。
4. 一条 outputSummary 例如：
   ```
   # 标题
   - 列表 a
   - 列表 b
   > 引用
   `inline code`
   ```js
   const x = 1;
   ```
   [link](https://example.com)
   [bad](javascript:alert(1))
   ```
   预期：标题/列表/引用/代码/链接全部按 typography 渲染；`javascript:` 链接被替换为 `#`，无 alert 触发。
5. 失败 run 的 errorMessage 仍是红色 mono 等宽 `<pre>`。

## Out of scope (deferred)
- 列表 status-badge 重设计（保留现状，左色条已承载状态信号）
- 长 outputSummary 的折叠/展开（默认全展开）
- 代码块语法高亮（不引新依赖）
- 修复预存在的 `WorkflowDefinitionSummary` 导出缺失（与本任务无关）

## Files
- `desktop/src/renderer/components/MarkdownView.tsx` (new)
- `desktop/src/renderer/pages/TimeCenterPage.tsx`
