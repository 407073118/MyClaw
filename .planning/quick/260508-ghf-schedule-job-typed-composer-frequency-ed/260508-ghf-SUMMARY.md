---
quick_id: 260508-ghf
description: B 层 typed composer + 频率友好化 + 编辑按钮（定时任务大改）
date: 2026-05-08
status: completed
---

# Quick 260508-ghf — Summary

## What changed

### 修预存在的导出问题（顺手）
- `desktop/shared/contracts/workflow.ts` 加 `export type WorkflowDefinitionSummary = WorkflowSummary;` —— `desktop/src/renderer/stores/workspace.ts:31` 已经引用，至此 typecheck 全绿。

### 新增：频率工具与组件
- `desktop/src/renderer/utils/frequency.ts`（新增）：
  - `FrequencyValue` 9 种：once / every-day / weekdays / weekends / weekly / monthly / interval-minutes / interval-hours / custom-cron。
  - `frequencyToScheduleInput(value)` —— 转 `{ scheduleKind, startsAt?, intervalMinutes?, cronExpression? }`，喂给 IPC。
  - `parseFrequency(job)` —— 反解，识别 5 种典型 cron 模式（每天/工作日/周末/每周指定/每月几号），其他 cron 兜底为 custom-cron。
  - `formatFrequency(value, { formatDateTime })` / `formatJobFrequency(job, formatDateTime)` —— 中文人话展示，"每天 09:00" / "工作日 09:00" / "每周一三五 09:00" / "每月 15 号 09:00" / "每 30 分钟" / "Cron: …"。
- `desktop/src/renderer/components/time/FrequencyPicker.tsx`（新增）：受控组件。9 个 chip + 详情区按 kind 切换字段（time / weekday 多选 / 月日 select / 间隔 number / cron text），底部预览人话频率，使用 `--accent-cyan` 强调。
  - 一次性走 `<input type="datetime-local">`，提交时调用方负责 `localDateTimeToUtcIso`。
  - cron 按时区转换由 `Intl.DateTimeFormat` 处理。

### 重写：ScheduleJobEditor 按 type 渲染 + 编辑模式
- `desktop/src/renderer/components/time/ScheduleJobEditor.tsx` 完全重写：
  - 接受 `executor: ScheduleJobExecutor` 由父组件锁定（不再编辑器内 select）。
  - 接受 `initialJob?: ScheduleJob` 进入编辑模式；用 `parseFrequency` 把已有 cron / interval 反解回 picker。
  - Prompt 类型显示「提示词 textarea」，写入 `description`（与后端 `time-job-executor.ts:69` 行为一致）。
  - Workflow 类型显示「选择工作流 select」，options 从父组件传入（state.workflows）。
  - 员工类型显示「选择员工 select + 派发消息 textarea」（消息也写入 description）。
  - 提交时按 `mode = initialJob ? "update" : "create"` 调 `onSave(input, mode)`。
  - 编辑器顶部一条 chip 展示当前 type + 「← 换类型」按钮（仅 create 模式）。

### TimeCenterPage：typed composer + 编辑入口 + 列表强化
- 新增顶层 state：`chosenJobType: ScheduleJobExecutor | null` 与 `editingJob: ScheduleJob | null`。
- 新增 `handleSaveScheduleJob(input, mode)` 把 create / update 分流到 `workspace.createScheduleJob` / `workspace.updateScheduleJob`。
- 新增 `handleEditScheduleJob(job)` 一键预填编辑器。
- ComposerModal 改造：
  - `activeComposer === "job"` 且未选 type 且非编辑模式 → 渲染 `ScheduleJobTypePicker`（3 张大卡片：💬 Prompt / ⚙️ Workflow / 👤 调用员工，每张含图标 + 标题 + 描述）。
  - 选中 type 后或编辑模式 → 渲染 ScheduleJobEditor，传入 `executor`、`initialJob`、`workflowOptions`、`siliconPersonOptions`。
  - 关闭 modal / 切到非 job tab 时清掉 `chosenJobType` 与 `editingJob`，避免状态残留。
- ScheduleJobListPage 改造：
  - 列表头下方加 type filter chip 组（全部 / Prompt / Workflow / 员工），用 `useMemo` 派生 `filteredJobs`。
  - 行内主标题旁加 `.job-type-chip job-type-chip--{executor}`（紫 / 黄 / 青三色 999px pill）。
  - secondary line 用 `formatJobFrequency(job, formatDateTime)` 替换 `formatScheduleKind(job.scheduleKind)`，写出"每天 09:00"等中文频率。
  - actions 多了 ✏️ 编辑按钮（IconEdit）。
  - 新增 `formatExecutorLabel(executor): "Prompt" | "Workflow" | "员工"` 工具，filter / chip 共用。

### 视觉 / token
- 三个 type chip 用各自浅色底 + 描边 999px pill（紫 = Prompt、黄 = Workflow、青 = 员工），与左侧色条不同，承载身份不承载状态。
- type filter chip：`is-active` 升 `--bg-surface-hover` + `--glass-border-strong`，hover 升 `--text-secondary`，无填充。
- type picker 卡片：`var(--bg-card)` + `var(--radius-lg)` + hover 微抬 1px。
- FrequencyPicker：详情区 `--bg-surface` 浅底卡 + chip 选中态 cyan，weekday 圆形按钮 28×28。
- 编辑模式 hint「编辑模式」eyebrow muted；create 模式提供「← 换类型」cyan 链接按钮。

## How to verify

1. `cd desktop && pnpm run typecheck` —— 全绿，包括之前一直报错的 `workspace.ts:31`。
2. desktop dev：
   - 「定时任务」tab 点 + 按钮 → 出现 3 张大卡（Prompt / Workflow / 调用员工）。
   - 点「Prompt 任务」→ 进入表单：Prompt chip + 标题 + 频率（FrequencyPicker） + 提示词 textarea。
   - 频率切换：选「每天」→ 详情区出 time picker；选「每周指定」→ 出 7 个 weekday 圆形按钮 + time；选「每 30 分钟」→ 出 number；预览实时显示中文频率。
   - 保存 → 列表行显示标题 + 紫色 `Prompt` chip + secondary "我 · 每天 09:00"。
   - 点同一行 ✏️ → 弹回编辑器，所有字段已预填（含频率反解），改个时刻 → 保存 → 列表同步刷新。
   - 顶部「Workflow」filter chip → 列表只显示 Workflow 类型任务。
   - 关闭 modal 后再点 + → 又看到 3 张 type 卡（state 已重置）。
3. 已有任务（来自 cron 0 9 * * 1-5）打开编辑器：FrequencyPicker 自动落到「工作日」chip，时刻 09:00。
4. 输入非典型 cron `*/15 9-18 * * 1-5` 进入「自定义 Cron」chip 显示原文。

## Out of scope (deferred)
- 列表按 type 分组排序（仅做 filter）
- "自定义 cron"语法校验（除空字符串外不校验）
- workflow 任务的额外参数 / silicon_person 任务的目标 session 等高级字段
- 工作流多选 / 员工多选派发
- 编辑/删除二次确认弹层

## Files
- `desktop/shared/contracts/workflow.ts` (+3 行 alias)
- `desktop/src/renderer/utils/frequency.ts` (new)
- `desktop/src/renderer/components/time/FrequencyPicker.tsx` (new)
- `desktop/src/renderer/components/time/ScheduleJobEditor.tsx` (rewrite)
- `desktop/src/renderer/pages/TimeCenterPage.tsx` (~+350 行 含 CSS)
