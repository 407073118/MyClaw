---
phase: quick-260507-s7m
status: completed
date: 2026-05-07
commits:
  - f37db8e  # Task 1: assistant_prompt executor + outputSummary chain
  - 8b2ea52  # Tasks 2+3: ExecutionHistoryDrawer + ui-style-guide token 化
---

# Quick Task 260507-s7m — 时间规划定时任务三处缺口修复

## 目标

1. `assistant_prompt` 执行器从空操作升级到真正调用模型，并把回复落进 ExecutionRun.outputSummary
2. 定时任务执行结果对用户可见 —— 桌面端原生右侧抽屉，点行打开，看每次执行完整输入/输出/错误
3. TimeCenterPage 三处不符合 ui-style-guide 的硬编码色值与圆角统一为 token

## 实施

### Task 1 — assistant_prompt 执行器接入 callModel（commit f37db8e）

**修改文件 4 个：**

- `desktop/src/main/services/time-job-executor.ts`
  - `TimeJobExecutorDeps` 新增 `runAssistantPrompt: (input: { prompt: string }) => Promise<{ outputSummary: string }>`
  - `execute` 返回类型 `Promise<TimeJobExecutionResult | void>`
  - `assistant_prompt` 分支：取 `job.description ?? job.title` 作 prompt，调 `runAssistantPrompt`，返回截断到 500 字符的 outputSummary
  - `default` 分支独立成块，避免和 assistant_prompt fallthrough

- `desktop/src/main/services/time-scheduler.ts`
  - `TimeExecutionRunInput` 新增 `jobId? / outputSummary? / errorMessage?` 三字段
  - 新增导出 `TimeScheduleJobRunResult`
  - `runScheduleJob?` 签名改为可返回 `TimeScheduleJobRunResult | void`
  - `runSingleScheduleJob` 接收执行器返回值并写入 ExecutionRun
  - reminder 分支补 `jobId: reminder.id`

- `desktop/src/main/services/time-orchestration-store.ts`
  - `ExecutionRunRecordInput` 新增 `jobId? / outputSummary? / errorMessage?`
  - `recordExecutionRun` 重塑 `payload_json`：现在写入与 `ExecutionRun` 契约对齐的对象（`jobId / status (succeeded|failed) / outputSummary / errorMessage`），不再是 `entityKind/entityId/note` 形状
  - DB 列保留旧 `completed/failed` 字面量，不做 schema migration

- `desktop/src/main/index.ts`
  - `createTimeJobExecutor` wiring 新增 `runAssistantPrompt`：调 `callModel(defaultProfile, [{role:"user", content: prompt}], timeoutMs: 60_000)`，回退顺序与 MeetingRecorder 一致（`defaultModelProfileId → models[0]`）
  - `runScheduleJob` 改为 `return await timeJobExecutor.execute(job)`（之前是 void）

### Task 2 — 计划任务执行历史右侧抽屉（commit 8b2ea52 一部分）

**修改文件 2 个：**

- `desktop/src/renderer/stores/workspace.ts`
  - `WorkspaceState.refreshExecutionRuns: () => Promise<ExecutionRun[]>` 新增
  - 实现：直接调用 `window.myClawAPI.time.listExecutionRuns()`（既有 IPC，不新增）

- `desktop/src/renderer/pages/TimeCenterPage.tsx`
  - 新增 `ExecutionHistoryDrawer` 组件：fixed 全屏 overlay + 480px 右侧 aside；按 `startedAt` 倒序排列；状态徽章 + 时间范围 + outputSummary（pre-wrap 全文）+ errorMessage（红字 pre-wrap 全文）
  - `ScheduleJobListPage` 接入：local `selectedJobForHistory` state + article `role="button"` + `onKeyDown` Enter/Space + `.job-row__actions` `stopPropagation`；抽屉打开时 useEffect 主动 `refreshExecutionRuns()` 一次
  - 新增 `IconClose` SVG（与同文件 IconPlay/IconRestore 同 14×14 风格）
  - 新增 `.execution-history-drawer-*` 一组 CSS（fixed overlay + slide-in 动画 + body scroll + empty state）
  - 新增 `.list-page-row.is-clickable` hover/focus-visible
  - 新增 `.status-badge--danger` 变体（仅在抽屉范围内使用）

### Task 3 — 三处 token 化与删除按钮 danger 变体（commit 8b2ea52 另一部分）

**全部在 `desktop/src/renderer/pages/TimeCenterPage.tsx`：**

- `.composer-tab-btn` 圆角：`999px` → `var(--radius-md)`，与同页 `.planning-view-tab` 一致
- `.schedule-summary-bar__feedback` 文字色：`#b6f3df` → `var(--accent-cyan)`
- `.summary-chip.is-warning` 文字色：`#ffd1d1` → `var(--status-red)`；border/background 暂沿用 rgba 等价（注释说明待全局 alpha token 落地后统一）
- `.job-row__run.is-warning` 文字色：`#fca5a5` → `var(--status-red)`
- `ActionIconButton` 新增 `variant?: "default" | "danger"`；`ScheduleJobListPage` 删除按钮 `variant="danger"`
- 新增 `.job-action-icon-btn--danger` 与 `:hover` 样式（`var(--status-red)` 描边 + 微红 hover）

## 关键决策

1. **不做 schema migration** —— `execution_runs` 表 `status` 列继续保留 `completed/failed` 字面量，对外契约通过 `payload_json` 在写入时塑形（`completed → succeeded`），读出来时 `parseExecutionRun` 类型断言自然成立。代价是若以后想直接 SQL `WHERE status='succeeded'` 查询会查不到，但当前所有列表读取都走 `payload_json`，不影响。

2. **抽屉数据源走 store 而非 props** —— `ExecutionHistoryDrawer` 内部用 `useWorkspaceStore` selector 直接读 `executionRuns + refreshExecutionRuns`，避免 `ScheduleJobListPage` 多注入两个 prop。同时 `useEffect` 在抽屉打开时刷新一次。

3. **不新加 IPC** —— `time:list-execution-runs` 已经存在；之前只有 `executeScheduleJobNow` 后会刷新，现在抽屉打开主动调一次即可。

4. **Task 2/3 合并提交** —— 都在同一个 `TimeCenterPage.tsx` 文件，分两次 commit 会因为 hunk 交错难以拆分；用户也明确说"全部开发完成"。功能上"让结果可见 + 让 UI 一致"是同一焦点。

## 已知限制

1. **未跑 typecheck** —— 用户明确"不需要测试，先全部开发完成"。最终验证由后续 dev 启动时自然报错来兜底。
2. **assistant_prompt 默认 60s 超时** —— 长 prompt 可能不够；后续可参数化或结合用户配置的 model timeout。
3. **outputSummary 截断 500 字符** —— 当前在 executor 层硬编码；超出部分加 `…`。如果用户想看完整输出，未来可加"详情"二级抽屉。
4. **CRLF→LF 一次性归一化** —— `TimeCenterPage.tsx` 之前是 CRLF，本次 commit `git config core.autocrlf` 自动归一为 LF，导致 commit stat 显示大量增删；实际逻辑改动 ~200 行。后续 diff 不再受影响。

## 待办（不在本次范围）

来自 `desktop/docs/plans/2026-05-07-time-planning-comprehensive-plan.md` P0 但本次未做：

- TodayBrief 接入模型（仍是字符串模板）
- 路由/菜单/标题 "时间中心" → "时间规划"
- Top Priority Hero 卡
- 会议 → action items 通道

这些是独立工作，建议各开 quick task 推进。
