---
phase: quick-260508-jp9
plan: 01
subsystem: time-orchestration
tags: [time-job, schedule-job, prompt, session, per-run, shared, migration, ui-refactor]
dependency-graph:
  requires:
    - 260508-hcp（assistant_prompt 走真 session 长链路）
    - 260508-hvr（推理深度 chip + 行点击跳详情）
    - 260508-ic3（详情独立页 /time/jobs/:id 替换抽屉）
  provides:
    - "ScheduleJob.sessionMode（per_run 默认 / shared opt-in）"
    - "ExecutionRun.sessionId（per_run 与 shared 双模式都持久化）"
    - "ChatSession.associatedScheduleJobId（per_run 新建 session 时回填）"
    - "TimeOrchestrationStore.migrateAssistantPromptSessionMode（启动期幂等迁移）"
    - "TimeJobDetailPage per_run 行展开内嵌消息流 + 继续聊天 form"
    - "ScheduleJobEditor 会话模式 chip 二选一"
  affects:
    - "main/index.ts runAssistantPrompt（双态分支重写）"
    - "time-job-executor 返回类型（加 sessionId）"
    - "time-scheduler runScheduleJob result 透传链路"
tech-stack:
  added:
    - "ScheduleJobSessionMode 类型 + SCHEDULE_JOB_SESSION_MODE_VALUES const 数组"
  patterns:
    - "迁移钩子：启动期一次性幂等回填（已有 sessionId → shared，未跑过 → per_run），不动新数据"
    - "per_run session 标题：'[定时] {title} · MM-DD HH:mm'，时间戳基于 job.timezone Intl.DateTimeFormat"
    - "ChatSession.associatedScheduleJobId 反向标记，便于 ChatPage 列表识别定时任务产物"
key-files:
  created: []
  modified:
    - "desktop/shared/contracts/time-orchestration.ts"
    - "desktop/shared/contracts/session.ts"
    - "desktop/src/main/services/time-job-executor.ts"
    - "desktop/src/main/services/time-scheduler.ts"
    - "desktop/src/main/services/time-orchestration-store.ts"
    - "desktop/src/main/index.ts"
    - "desktop/src/renderer/pages/TimeJobDetailPage.tsx"
    - "desktop/src/renderer/components/time/ScheduleJobEditor.tsx"
    - "desktop/tests/time-job-executor.test.ts"
    - "desktop/tests/time-scheduler.test.ts"
    - "desktop/tests/time-orchestration-store.test.ts"
decisions:
  - "per_run 分支不回写 job.sessionId：避免污染 shared 模式语义；ExecutionRun.sessionId 已经能从执行记录回链到 session"
  - "session-mode-chip 走描边风格（border + radius-md），不放 .glass-pill 圆 pill；放在 title-row 紧跟 status-badge 之后；色彩 per_run=cyan / shared=yellow（暗示这是兼容老路径）"
  - "Editor 会话模式控件复用 reasoning-chip-group 视觉（同样 role=radio，桌面级紧凑），不引入新组件类"
  - "迁移函数实现成幂等公开方法 migrateAssistantPromptSessionMode 而不是塞进 store.create 内部：便于测试单独覆盖、符合现有 ScheduleJobUpsertInput 显式回填风格"
  - "RunRow 整行包成 button（all: unset）触发展开，而非额外 chevron icon：键盘可达 + hover 反馈给整行卡，符合 ui-style-guide「不堆装饰」"
metrics:
  duration: 18min
  tasks: 2
  files: 11
  completed-at: "2026-05-08T14:30:00Z"
---

# Quick 260508-jp9 Plan 01: Prompt 任务 per_run/shared 双态 + ExecutionRun ↔ Session 1:1 关联 Summary

把 Prompt 类型定时任务从「一个 job 永久绑定一个累积 session」重构为「每次触发新建独立 session（per_run）默认 + 老 job/显式 opt-in 用 shared」，并把 ExecutionRun ↔ ChatSession 做成 1:1 关联，详情页 per_run 行可展开内嵌该次会话消息流 + 继续聊天，shared 兼容路径不破坏老 job。

## Tasks

### Task 1: 数据模型 + main 双态分支 + scheduler/store 透传 + 启动期迁移
**Commit:** `e4a4531`
**Files:** 6 modified

- `desktop/shared/contracts/time-orchestration.ts:54-91` — 新增 `ScheduleJobSessionMode = "per_run" | "shared"` + `SCHEDULE_JOB_SESSION_MODE_VALUES` const 数组（紧跟 `SCHEDULE_JOB_EXECUTOR_VALUES`，与 STATUS/EXECUTOR 同风格）；`ScheduleJob` 加 `sessionMode?` 字段（`sessionId` 之上）；`ExecutionRun` 加 `sessionId?: string`
- `desktop/shared/contracts/session.ts:91-94` — `ChatSession` 在 `tasks` 与 `linkedMeetingId` 之间插入 `associatedScheduleJobId?: string | null`
- `desktop/src/main/services/time-job-executor.ts:9-13, 73-83` — `runAssistantPrompt` 返回类型改为 `Promise<{ outputSummary: string; sessionId: string }>`；`TimeJobExecutionResult` 加 `sessionId?`；`assistant_prompt` 分支解构后 `return { outputSummary: truncated, sessionId }`
- `desktop/src/main/services/time-scheduler.ts:8-23, 191-220` — `TimeScheduleJobRunResult` 与 `TimeExecutionRunInput` 加 `sessionId?`；`runSingleScheduleJob` 解构 `result?.sessionId` 并透传至 `recordExecutionRun({ ..., sessionId })`
- `desktop/src/main/services/time-orchestration-store.ts:61-71, 103-126, 347-352, 535-544, 386-432` — `ExecutionRunRecordInput` 加 `sessionId?`；`ScheduleJobUpsertInput` 加 `sessionMode?`；`upsertScheduleJob` 字面量加 `sessionMode`；`recordExecutionRun` 写入 `persistedRun.sessionId`；新增 `migrateAssistantPromptSessionMode()` 公开方法（已有 sessionId → "shared" / 缺 sessionId → "per_run"，幂等）
- `desktop/src/main/index.ts:18-29, 187-189, 222-321` — import `ScheduleJobSessionMode`；`timeStore.create` 后立即调 `migrateAssistantPromptSessionMode()` 并 log；`runAssistantPrompt` 整体重写为双态分支：shared 走原复用 + 回写 `sessionMode: "shared"` 路径，per_run 每次新建 session（标题 `[定时] {title} · MM-DD HH:mm`），两边 return `{ outputSummary, sessionId }`

### Task 2: 详情页 per_run 视图重构 + ScheduleJobEditor 会话模式 + 测试联动
**Commit:** `4d63037`
**Files:** 5 modified

- `desktop/src/renderer/pages/TimeJobDetailPage.tsx` — 顶部 `sessionMode = job.sessionMode ?? "per_run"`；title-row 加 `.session-mode-chip` 描边 chip（per_run=cyan / shared=yellow）；`time-job-detail__chat` section 仅在 `sessionMode === "shared" && supportsChat` 渲染；`RunRow` 重构为带 `expanded`/`onToggle`/`runSession`/`sessionMode` props 的复合组件 — per_run + sessionId 时整行 button 可切展开，展开后内嵌 `ChatBubble` 消息流 + form（textarea + 发送按钮，⌘/Ctrl+Enter 提交，调 `selectSession + sendMessage`）；styles 全部用 `var(--radius-md)`/`var(--radius-sm)`/`var(--radius-xl)`，描边按钮（`.run-row__btn.is-primary`），符合 ui-style-guide
- `desktop/src/renderer/components/time/ScheduleJobEditor.tsx` — import `ScheduleJobSessionMode`；`ScheduleJobEditorSubmitInput` 加 `sessionMode?`；`useState<ScheduleJobSessionMode>(initial?.sessionMode ?? "per_run")`；`assistant_prompt` 分支在「推理深度」之后插入「会话模式」chip 二选一（每次新会话 / 累积会话），sessionMode 与 reasoning chip 共享 `.reasoning-chip-group` 视觉；submit 透传 `sessionMode`（仅 assistant_prompt）；create 模式 reset 时同步重置
- `desktop/tests/time-job-executor.test.ts` — 旧 case 补 `runAssistantPrompt` mock；新增 `returns sessionId from runAssistantPrompt when executing an assistant_prompt job` 用例：mock 返回 `{ outputSummary: "ok", sessionId: "sess-x" }`，断言 `result === { outputSummary: "ok", sessionId: "sess-x" }`
- `desktop/tests/time-scheduler.test.ts` — 第二个 case 改为 `executor: "assistant_prompt", sessionMode: "per_run"`，`runScheduleJob` 返回 `{ outputSummary: "y", sessionId: "sess-y" }`，断言 `recorded[0]` 含 `sessionId: "sess-y"`
- `desktop/tests/time-orchestration-store.test.ts` — 第一个 case 末尾追加 `recordExecutionRun + listExecutionRuns` 验证 `sessionId` 持久化；新增 `migrateAssistantPromptSessionMode backfills legacy assistant_prompt jobs and is idempotent` 用例：构造 (有 sessionId) / (无 sessionId) / (workflow) 三条 job，跑迁移得 `migrated: 2` 且类型正确，再跑得 `migrated: 0`（幂等）

## Verification

```bash
cd desktop && pnpm exec tsc --noEmit
# → 修改的 11 个文件 0 errors（其他 unrelated test 文件的 pre-existing 错误不在本计划范围）

cd desktop && pnpm exec vitest run \
  tests/time-job-executor.test.ts \
  tests/time-scheduler.test.ts \
  tests/time-orchestration-store.test.ts
# → Test Files: 3 passed (3)
# → Tests:      6 passed (6)
# → Duration:   18.52s
```

## Decisions Made

1. **per_run 分支不回写 `job.sessionId`** — 保持 sessionId 字段在 shared/老 job 语义下的不变性（shared = 单一长期 session 指针）。per_run 的「最近一次 session」可以直接通过 `runs.find(r => r.sessionId)?.sessionId` 反查，不必污染 job 字段。
2. **`session-mode-chip` 命名与位置** — 放在 title-row 紧跟 `status-badge` 之后，描边 chip 风格（不用 `.glass-pill` 圆 pill），colour 区分：per_run=cyan（新默认）、shared=yellow（兼容老行为，暗示"留意你在用累积模式"）。CSS 全部走 var(--radius-md) (7px) 桌面化圆角。
3. **迁移函数公开 + 幂等而非内嵌** — 把 `migrateAssistantPromptSessionMode` 做成公开方法（不是 `create()` 内部副作用），便于单测直接覆盖；幂等通过 `if (job.sessionMode !== undefined) continue` 实现，不依赖外部 flag。
4. **Editor 会话模式控件复用 `reasoning-chip-group`** — 不引入新组件 class；同样 `role="radiogroup"` + `role="radio"`，键盘可达，视觉与推理深度 chip 一致（桌面紧凑、描边）。
5. **RunRow 整行 button 展开** — 用 `all: unset` 把 button 重置为透明壳，让 hover/focus-visible 反馈落在整行（符合 ui-style-guide「悬停揭示」与「列表行卡 hover 整行」原则），右侧加「展开 ↓ / 收起 ↑」文字提示，无需额外 chevron 图标。

## Deviations from Plan

None — plan executed exactly as written，per-task action 步骤一一落地，verify 命令一次通过。

## UI Style Guide Self-Check

- [x] 圆角只用 `var(--radius-md)` (7px) / `var(--radius-xl)` (14px) / `var(--radius-sm)` (4px)；不出现 8/10/12px 硬编码
- [x] 按钮全部描边风格（`.run-row__btn`、`.run-row__btn.is-primary`、Editor chip group 都是 transparent + border）
- [x] 不写 v1/v2 字样
- [x] `.run-row` 单列布局（`flex column`），不引多列网格；展开内嵌 chat 也是单列消息流
- [x] `.session-mode-chip` 走描边 chip 而非 `.glass-pill`（小 inline 标签场景）
- [x] textarea/select focus 用 cyan border，不用 outline 蓝色

## Self-Check: PASSED

- [x] `desktop/shared/contracts/time-orchestration.ts` updated (sessionMode + ExecutionRun.sessionId)
- [x] `desktop/shared/contracts/session.ts` updated (associatedScheduleJobId)
- [x] `desktop/src/main/services/time-job-executor.ts` updated (return sessionId)
- [x] `desktop/src/main/services/time-scheduler.ts` updated (透传 sessionId)
- [x] `desktop/src/main/services/time-orchestration-store.ts` updated (持久化 + migrate)
- [x] `desktop/src/main/index.ts` updated (双态分支 + 启动期 migrate)
- [x] `desktop/src/renderer/pages/TimeJobDetailPage.tsx` updated (per_run 行展开)
- [x] `desktop/src/renderer/components/time/ScheduleJobEditor.tsx` updated (sessionMode chip)
- [x] 3 vitest 文件全绿（6/6 tests pass）
- [x] Commit `e4a4531` — Task 1 (contracts + main + scheduler/store + migrate)
- [x] Commit `4d63037` — Task 2 (UI + editor + tests)
