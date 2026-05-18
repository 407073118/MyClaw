# MyClaw Awareness Runtime Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把当前“日程规划 / 值守”完整重建为可审计、可暂停、可通知、可授权、可恢复、可解释、端到端可用的 Heartbeat / Awareness 长时值守系统。

**Architecture:** `ScheduleJob` 继续负责精确定时，`AwarenessRuntime` 只负责周期性感知和升级判断，`LongRunLedger` 负责所有长时活动账本，`StandingOrder` 负责长期授权边界。Renderer 只展示快照和发起用户操作，真实状态由 main runtime 与 time database 维护。

**Tech Stack:** Electron main process、React 18、Zustand、TypeScript 5.8、SQL.js、Vitest、现有 `@shared/contracts` 契约。

---

## 0. 资料结论与产品原则

参考资料：

- OpenClaw Automation & Tasks: https://docs.openclaw.ai/automation
- OpenClaw Heartbeat: https://docs.openclaw.ai/gateway/heartbeat
- OpenClaw Background Tasks: https://docs.openclaw.ai/automation/tasks
- OpenClaw Standing Orders: https://docs.openclaw.ai/automation/standing-orders
- OpenClaw Task Flow: https://docs.openclaw.ai/automation/taskflow

关键判断：

- Cron / `ScheduleJob` 是“到点必须做什么”，适合日报、提醒、固定 workflow。
- Heartbeat / Awareness 是“现在有没有值得关注的变化”，适合 inbox、calendar、后台任务、卡住任务、审批等待、员工状态。
- Task / `LongRunLedger` 是账本，不是调度器；它记录发生了什么、是否完成、是否需要通知或人工处理。
- Standing Order 是长期授权边界，不是 UI 偏好；它回答“什么可以自动做，什么必须升级给用户”。
- Heartbeat 无事时应静默或只更新状态，不应污染主聊天；只有需要用户介入时才产生通知或 Catch-up。
- 桌面端不是 24/7 server，必须处理关机、休眠、错过 tick、启动补偿和 runtime 丢失后的 reconciliation。

当前 MyClaw 状态：

- 已有 `desktop/src/main/services/awareness-runtime.ts`、`awareness-store.ts`、`awareness-signal-collector.ts`、`awareness-decision-engine.ts`、`standing-order-service.ts`、`long-run-ledger.ts`。
- 已有 `desktop/shared/contracts/awareness.ts` 与 `time-orchestration-database.ts` 表结构。
- 已将 `awarenessTick` 挂到 `time-scheduler.ts`。
- 已有 TimeCenter “值守”入口、Today catch-up、AgentTeamDock badge。
- 严重缺口：`getScheduleJobs` 和 `getWorkflowRuns` 目前为空源；action 只写 audit 不执行；delivery 没闭环；budget / activeHours / scope / standing order 语义不完整；缺少测试。

不可裁剪范围：

- 本计划不是救火计划，不定义 MVP，不接受“先把入口跑起来”的交付口径。
- 所有 15 个任务都是完整可用版本的组成部分；可以分批提交，但不能分批宣称功能完成。
- 在 Task 15 E2E 全部通过前，值守只能视为未完成实现。
- 任何缺少真实信号源、动作执行、权限边界、通知交付、账本审计、UI 管理、设置守卫或恢复机制的版本，都不算可用。
- 计划执行时允许先修基础设施，但每一步都必须朝完整闭环推进，不做临时旁路。

## 1. 最终能力定义

### 1.1 用户可见行为

- 用户能看到“哪些 routine 正在值守、值守目的、最近一次检查、下一次检查、最近结果”。
- 用户能创建、编辑、暂停、恢复、删除 routine。
- 用户能手动试跑 routine，并看到会读哪些信号、会不会调用模型、可能触发什么动作。
- 用户能 dismiss / acknowledge / resolve signal；dismiss 必须进入冷却，避免重复打扰。
- 用户能创建 Standing Order，说明授权范围、允许动作、审批门槛、升级规则、过期时间。
- Today 页面显示需要关注的 signal；无事不显示噪音。
- Team Dock 显示每个硅基员工自己的值守状态，而不是全局误报。
- 硅基员工工作台有“值守”tab，能管理该员工 scope 下的 routine 和 signal。
- 设置页能控制全局值守预算、默认频率、quiet hours、通知策略。

### 1.2 Runtime 语义

- `TimeScheduler.tick()` 仍然是唯一主 tick，不新增独立轮询器。
- 每次 scheduler tick 末尾调用 `AwarenessRuntime.tick()`，awareness 失败不能阻塞 reminders 和 schedule jobs。
- `AwarenessRuntime` 只调度 due routine；非 due routine 不读取上下文、不调用模型。
- `AwarenessRuntime` 先做确定性 signal collection，再按 routine scope / source / activeHours / quietHours 过滤。
- 没有新 signal 且没有 due structured task 时，直接记录 receipt，不调用模型。
- 有新 signal 时，先用规则决策；只有跨源归因或动作建议需要模型时才调用模型。
- 模型只返回结构化 decision，不直接执行副作用。
- 所有副作用由 `AwarenessActionExecutor` 按 policy 执行或阻塞。
- 所有执行、阻塞、通知、用户处理都写入 `LongRunLedger` / `awareness_audit_events`。

### 1.3 不做的事

- 不把 Heartbeat 做成另一个 cron。
- 不让 routine 私自创建新的 routine 或 schedule job。
- 不在主聊天里插入 OK heartbeat。
- 不让 renderer 保存值守真相。
- 不让模型直接获得无限工具能力。

## 2. 目标架构

```text
TimeScheduler.tick()
  ├─ due reminders
  ├─ due schedule jobs
  └─ AwarenessRuntime.tick()
       ├─ AwarenessScheduler: due routine / catch-up / active hours
       ├─ AwarenessSignalCollector: deterministic raw signals
       ├─ AwarenessSignalStore: dedupe / cooldown / lifecycle
       ├─ AwarenessDecisionEngine: rules first, model second
       ├─ AwarenessPolicyEngine: standing orders / approvals / budget / risk
       ├─ AwarenessActionExecutor: notify / create task / trigger workflow / execute job / dismiss
       ├─ LongRunLedger: run records and audit events
       └─ AwarenessDeliveryService: today catch-up / dock badge / chat card / silent
```

新增或重构服务：

- `desktop/src/main/services/awareness-source-adapter.ts`
- `desktop/src/main/services/awareness-policy-engine.ts`
- `desktop/src/main/services/awareness-action-executor.ts`
- `desktop/src/main/services/awareness-delivery-service.ts`
- `desktop/src/main/services/awareness-reconciliation.ts`
- `desktop/src/main/services/awareness-context-builder.ts`

保留但重构：

- `desktop/src/main/services/awareness-runtime.ts`
- `desktop/src/main/services/awareness-store.ts`
- `desktop/src/main/services/awareness-signal-collector.ts`
- `desktop/src/main/services/awareness-decision-engine.ts`
- `desktop/src/main/services/standing-order-service.ts`
- `desktop/src/main/services/long-run-ledger.ts`
- `desktop/shared/contracts/awareness.ts`

## 3. 数据模型调整

### 3.1 Contract 补齐

修改 `desktop/shared/contracts/awareness.ts`：

- `AwarenessScopeKind` 保留 `personal | silicon_person | workspace`，如需 session / workflow 只作为 `sourceKind + sourceId` 表示，避免 scope 爆炸。
- `AwarenessRoutine` 增加：
  - `contextPolicy`
  - `quietHoursPolicy`
  - `catchUpPolicy`
  - `lastSkippedReason`
  - `lastDecisionSummary`
- `AwarenessSignal` 增加：
  - `title`
  - `firstSeenAt`
  - `lastSeenAt`
  - `occurrenceCount`
  - `resolvedBySourceState`
  - `relatedLedgerRecordId`
- `AwarenessDecision` 增加：
  - `skipReason?: "no_signal" | "no_due_task" | "outside_active_hours" | "budget_exceeded" | "queue_busy"`
  - `modelUsed: boolean`
  - `modelProfileId?: string`
- `LongRunRecord` 增加：
  - `sourceTitle?: string`
  - `parentRecordId?: string`
  - `notifyPolicy?: "done_only" | "state_changes" | "silent"`
  - `deliveryTarget?: "today_catchup" | "dock_badge" | "chat_card" | "system_notification" | "silent"`

### 3.2 Database 迁移

修改 `desktop/src/main/services/time-orchestration-database.ts`：

- 禁止对已有 awareness 表做无条件 `DROP + CREATE`。
- 增加按列迁移和 payload backfill。
- 为以下查询增加索引：
  - `awareness_routines(status, next_run_at)`
  - `awareness_signals(status, source_kind, source_id)`
  - `awareness_signals(fingerprint, status)`
  - `long_run_ledger(status, updated_at)`
  - `long_run_ledger(kind, source_id)`

## 4. 实施任务

### Task 1: Awareness Contract Tests

**Files:**

- Modify: `desktop/shared/contracts/awareness.ts`
- Test: `desktop/tests/awareness-contracts.test.ts`

**Step 1: Write failing tests**

Create `desktop/tests/awareness-contracts.test.ts`:

```ts
import {
  AWARENESS_SIGNAL_SOURCE_KIND_VALUES,
  createDefaultActionPolicy,
  createDefaultBudgetPolicy,
  createDefaultDecisionPolicy,
  createDefaultDeliveryPolicy,
} from "../shared/contracts";

describe("awareness contracts", () => {
  it("exports stable signal source values used by runtime and UI", () => {
    expect(AWARENESS_SIGNAL_SOURCE_KIND_VALUES).toEqual([
      "agent_task",
      "schedule_job",
      "workflow_run",
      "background_task",
      "session_stuck",
      "approval_pending",
      "system_health",
    ]);
  });

  it("defaults to rules-first, quiet, bounded awareness behavior", () => {
    expect(createDefaultDecisionPolicy()).toMatchObject({
      useModelForCrossSource: true,
      useModelForActionSuggestion: true,
      maxModelCallsPerTick: 1,
    });
    expect(createDefaultActionPolicy().requireApproval).toContain("notify_user");
    expect(createDefaultDeliveryPolicy()).toMatchObject({
      notifyOnSignal: false,
      notifyOnDecision: true,
      deliveryChannel: "today_catchup",
    });
    expect(createDefaultBudgetPolicy().pausedOnBudgetExceeded).toBe(true);
  });
});
```

**Step 2: Run test to verify baseline**

Run:

```powershell
pnpm vitest run tests/awareness-contracts.test.ts
```

Expected: FAIL until exports and defaults match the final contract.

**Step 3: Update contract**

Implement the contract additions from section 3.1. Keep old fields backward compatible.

**Step 4: Run tests**

Run:

```powershell
pnpm vitest run tests/awareness-contracts.test.ts
pnpm run typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add desktop/shared/contracts/awareness.ts desktop/tests/awareness-contracts.test.ts
git commit -m "feat(desktop): stabilize awareness contracts"
```

### Task 2: Safe Awareness Database Migration

**Files:**

- Modify: `desktop/src/main/services/time-orchestration-database.ts`
- Test: `desktop/tests/awareness-database.test.ts`

**Step 1: Write failing migration tests**

Create `desktop/tests/awareness-database.test.ts` with an in-memory temp database path. Test:

- Existing `awareness_routines` rows survive startup migration.
- Missing columns are added without dropping payload rows.
- Indexes exist after migration.

**Step 2: Run test**

```powershell
pnpm vitest run tests/awareness-database.test.ts
```

Expected: FAIL if migration drops rows or does not add columns.

**Step 3: Implement minimal migration**

Replace the drop-based awareness migration with:

- `PRAGMA table_info(table)` inspection.
- `ALTER TABLE ADD COLUMN` for missing nullable columns.
- Payload backfill only when needed.
- Chinese logs for every migration decision.

**Step 4: Verify**

```powershell
pnpm vitest run tests/awareness-database.test.ts
pnpm run typecheck
```

**Step 5: Commit**

```powershell
git add desktop/src/main/services/time-orchestration-database.ts desktop/tests/awareness-database.test.ts
git commit -m "fix(desktop): preserve awareness data during migrations"
```

### Task 3: Runtime Source Adapter

**Files:**

- Create: `desktop/src/main/services/awareness-source-adapter.ts`
- Modify: `desktop/src/main/index.ts`
- Test: `desktop/tests/awareness-source-adapter.test.ts`

**Step 1: Write failing tests**

Test that source adapter returns:

- schedule jobs from `TimeOrchestrationStore.listScheduleJobs()`
- latest execution runs grouped by schedule job
- workflow runs from persisted runtime state
- background tasks from sessions
- approval requests from runtime state
- silicon persons with correct id and status

**Step 2: Run test**

```powershell
pnpm vitest run tests/awareness-source-adapter.test.ts
```

Expected: FAIL because adapter does not exist.

**Step 3: Implement adapter**

Create a pure factory:

```ts
export function createAwarenessSourceAdapter(deps: {
  timeStore: TimeOrchestrationStore;
  getSessions: () => ChatSession[];
  getWorkflowRuns: () => WorkflowRunSummary[];
  getApprovalRequests: () => ApprovalRequest[];
  getSiliconPersons: () => SiliconPerson[];
  getActiveSessionRuns: () => Map<string, ActiveSessionRun>;
}) {
  return {
    async snapshot() {
      const [scheduleJobs, executionRuns] = await Promise.all([
        deps.timeStore.listScheduleJobs(),
        deps.timeStore.listExecutionRuns?.() ?? Promise.resolve([]),
      ]);
      return {
        scheduleJobs,
        executionRuns,
        sessions: deps.getSessions(),
        workflowRuns: deps.getWorkflowRuns(),
        approvalRequests: deps.getApprovalRequests(),
        siliconPersons: deps.getSiliconPersons(),
        activeSessionRuns: deps.getActiveSessionRuns(),
      };
    },
  };
}
```

If `listExecutionRuns` does not exist, add it to `TimeOrchestrationStore` with a focused test.

**Step 4: Replace empty source functions**

Modify `desktop/src/main/index.ts` so `createAwarenessSignalCollector` reads from adapter snapshots, not empty arrays.

**Step 5: Verify**

```powershell
pnpm vitest run tests/awareness-source-adapter.test.ts
pnpm run typecheck
```

**Step 6: Commit**

```powershell
git add desktop/src/main/services/awareness-source-adapter.ts desktop/src/main/index.ts desktop/tests/awareness-source-adapter.test.ts
git commit -m "feat(desktop): connect awareness runtime to real sources"
```

### Task 4: Deterministic Signal Collector

**Files:**

- Modify: `desktop/src/main/services/awareness-signal-collector.ts`
- Test: `desktop/tests/awareness-signal-collector.test.ts`

**Step 1: Write failing tests**

Cover:

- failed schedule job creates `schedule_job` warning with owner scope copied from job.
- stale schedule job creates critical only after threshold.
- failed workflow run creates warning.
- interrupted workflow creates info.
- failed background task creates warning.
- stuck active session creates warning after threshold.
- pending approval creates info after threshold.
- silicon person error creates `silicon_person` scoped warning.
- waiting-user threshold is actually used or removed.

**Step 2: Run tests**

```powershell
pnpm vitest run tests/awareness-signal-collector.test.ts
```

Expected: FAIL on scope and missing data behavior.

**Step 3: Implement collector cleanup**

- Make collector accept a source snapshot object.
- Remove unused constants or use them.
- Ensure every signal has stable `fingerprint`, `title`, `summary`, `recommendedAction`, `scope`, `sourceKind`, `sourceId`.
- Scope rules:
  - schedule job uses `ownerScope / ownerId`
  - employee task with assignee uses `silicon_person`
  - system/global issues use `personal`
  - workspace-level future sources use `workspace`

**Step 4: Verify**

```powershell
pnpm vitest run tests/awareness-signal-collector.test.ts
pnpm run typecheck
```

**Step 5: Commit**

```powershell
git add desktop/src/main/services/awareness-signal-collector.ts desktop/tests/awareness-signal-collector.test.ts
git commit -m "feat(desktop): collect scoped awareness signals"
```

### Task 5: Signal Lifecycle and Reconciliation

**Files:**

- Modify: `desktop/src/main/services/awareness-store.ts`
- Create: `desktop/src/main/services/awareness-reconciliation.ts`
- Test: `desktop/tests/awareness-signal-lifecycle.test.ts`

**Step 1: Write failing tests**

Cover:

- same fingerprint increments `occurrenceCount` and updates `lastSeenAt`.
- dismissed signal stays suppressed until cooldown expires.
- failed schedule job signal resolves automatically after a later successful execution.
- stale job signal resolves when `nextRunAt` is no longer overdue.
- acknowledged signal remains visible but lower priority.

**Step 2: Run tests**

```powershell
pnpm vitest run tests/awareness-signal-lifecycle.test.ts
```

**Step 3: Implement lifecycle**

- Replace `cleanupStaleSignals` semantics: cooldown expiry should not blindly suppress active unresolved problems.
- Add `reconcileSignals(sourceSnapshot)` to resolve signals whose source state is healthy.
- Add Chinese logs for automatic resolve and repeated signal suppression.

**Step 4: Verify**

```powershell
pnpm vitest run tests/awareness-signal-lifecycle.test.ts
pnpm run typecheck
```

**Step 5: Commit**

```powershell
git add desktop/src/main/services/awareness-store.ts desktop/src/main/services/awareness-reconciliation.ts desktop/tests/awareness-signal-lifecycle.test.ts
git commit -m "feat(desktop): reconcile awareness signal lifecycle"
```

### Task 6: Scheduler Semantics and Catch-up

**Files:**

- Modify: `desktop/src/main/services/awareness-runtime.ts`
- Modify: `desktop/src/main/services/awareness-store.ts`
- Test: `desktop/tests/awareness-runtime-scheduler.test.ts`

**Step 1: Write failing tests**

Cover:

- routine outside `activeHours` skips with `lastSkippedReason = "outside_active_hours"`.
- routine with no new signals records receipt and does not call model.
- missed routine after desktop sleep runs once on resume, not N times.
- failed routine after 3 consecutive failures becomes `failed`.
- manual `runRoutineNow` ignores `nextRunAt` but still respects policy.

**Step 2: Run tests**

```powershell
pnpm vitest run tests/awareness-runtime-scheduler.test.ts
```

**Step 3: Implement scheduler logic**

- Add `shouldRunRoutine(routine, now, policy)` helper.
- Add catch-up policy: `once`, `skip_missed`, `run_all_due` default `once`.
- Update `nextRunAt` from scheduled boundary, not always from current wall clock, when appropriate.
- Add receipt skip reasons.

**Step 4: Verify**

```powershell
pnpm vitest run tests/awareness-runtime-scheduler.test.ts
pnpm run typecheck
```

**Step 5: Commit**

```powershell
git add desktop/src/main/services/awareness-runtime.ts desktop/src/main/services/awareness-store.ts desktop/tests/awareness-runtime-scheduler.test.ts
git commit -m "feat(desktop): make awareness scheduling durable"
```

### Task 7: Decision Engine Budget and Model Gating

**Files:**

- Modify: `desktop/src/main/services/awareness-decision-engine.ts`
- Modify: `desktop/src/main/services/awareness-runtime.ts`
- Test: `desktop/tests/awareness-decision-engine.test.ts`

**Step 1: Write failing tests**

Cover:

- info-only single-source signal uses rule decision.
- critical signal creates notify action by rule.
- cross-source warning can call model when enabled.
- daily routine budget blocks model calls.
- global budget blocks model calls.
- malformed model JSON falls back to rule decision and records parse failure.

**Step 2: Run tests**

```powershell
pnpm vitest run tests/awareness-decision-engine.test.ts
```

**Step 3: Implement budget correctly**

- Compare daily call count to `budgetPolicy.maxModelCallsPerRoutinePerDay`, not `maxModelCallsPerTick`.
- Enforce global `maxModelCallsPerDay`.
- Persist budget counters or derive from ledger records for restart safety.
- Add structured logs with routine id, reason, model profile.

**Step 4: Verify**

```powershell
pnpm vitest run tests/awareness-decision-engine.test.ts
pnpm run typecheck
```

**Step 5: Commit**

```powershell
git add desktop/src/main/services/awareness-decision-engine.ts desktop/src/main/services/awareness-runtime.ts desktop/tests/awareness-decision-engine.test.ts
git commit -m "feat(desktop): gate awareness model calls by budget"
```

### Task 8: Policy Engine and Standing Orders

**Files:**

- Create: `desktop/src/main/services/awareness-policy-engine.ts`
- Modify: `desktop/src/main/services/standing-order-service.ts`
- Modify: `desktop/src/main/ipc/awareness.ts`
- Test: `desktop/tests/awareness-policy-engine.test.ts`

**Step 1: Write failing tests**

Cover:

- no standing order blocks `create_agent_task`, `trigger_workflow`, `execute_schedule_job`.
- low-risk `notify_user` can auto-approve only if routine policy or standing order permits.
- high-risk action requires approval under `risk_based`.
- expired standing order is ignored.
- standing order allowedSignals filters action authorization.

**Step 2: Run tests**

```powershell
pnpm vitest run tests/awareness-policy-engine.test.ts
```

**Step 3: Implement policy engine**

Move policy logic out of `awareness-runtime.ts`:

```ts
export function createAwarenessPolicyEngine(deps: {
  standingOrderService: StandingOrderService;
  getApprovalPolicy: () => ApprovalPolicy;
}) {
  return {
    async evaluate(input: AwarenessPolicyInput): Promise<AwarenessPolicyDecision> {
      // 中文注释：合并 routine 策略、长期授权、全局审批策略和动作风险等级。
    },
  };
}
```

**Step 4: IPC validation**

Validate standing-order create/update input:

- non-empty name / intent
- known scope kind
- known action kinds
- valid expiration date

**Step 5: Verify**

```powershell
pnpm vitest run tests/awareness-policy-engine.test.ts
pnpm run typecheck
```

**Step 6: Commit**

```powershell
git add desktop/src/main/services/awareness-policy-engine.ts desktop/src/main/services/standing-order-service.ts desktop/src/main/ipc/awareness.ts desktop/tests/awareness-policy-engine.test.ts
git commit -m "feat(desktop): enforce awareness standing orders"
```

### Task 9: Action Executor

**Files:**

- Create: `desktop/src/main/services/awareness-action-executor.ts`
- Modify: `desktop/src/main/services/awareness-runtime.ts`
- Modify: `desktop/src/main/services/runtime-context.ts`
- Test: `desktop/tests/awareness-action-executor.test.ts`

**Step 1: Write failing tests**

Cover:

- `log_only` writes audit and no side effect.
- `notify_user` creates delivery item.
- `dismiss_signal` changes signal status.
- `execute_schedule_job` calls existing time scheduler `executeJobNow`.
- `trigger_workflow` calls existing workflow start.
- `create_agent_task` calls existing agent task API.
- blocked action writes audit with `approvalStatus = "pending" | "rejected"`.

**Step 2: Run tests**

```powershell
pnpm vitest run tests/awareness-action-executor.test.ts
```

**Step 3: Implement executor**

Executor dependencies must be explicit:

- `timeApplication`
- `timeScheduler`
- workflow start function
- agent task service or IPC-safe adapter
- `awarenessStore`
- `longRunLedger`
- `deliveryService`

Do not use `require("./ipc/...")` inside executor. Move IPC-only code behind a service adapter if needed.

**Step 4: Verify**

```powershell
pnpm vitest run tests/awareness-action-executor.test.ts
pnpm run typecheck
```

**Step 5: Commit**

```powershell
git add desktop/src/main/services/awareness-action-executor.ts desktop/src/main/services/awareness-runtime.ts desktop/src/main/services/runtime-context.ts desktop/tests/awareness-action-executor.test.ts
git commit -m "feat(desktop): execute approved awareness actions"
```

### Task 10: Delivery Service

**Files:**

- Create: `desktop/src/main/services/awareness-delivery-service.ts`
- Modify: `desktop/src/main/ipc/awareness.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/awareness-delivery-service.test.ts`

**Step 1: Write failing tests**

Cover:

- silent OK creates no renderer event.
- active warning creates today catch-up delivery.
- critical signal creates renderer event even during quiet hours if override enabled.
- delivery mark updates ledger `deliveryStatus`.
- failed delivery remains pending and retriable.

**Step 2: Run tests**

```powershell
pnpm vitest run tests/awareness-delivery-service.test.ts
```

**Step 3: Implement service**

Delivery output shapes:

- `awareness.changed` for state refresh.
- `awareness.delivery` for actionable user-visible cards.
- no chat message for OK receipts.

**Step 4: Renderer store integration**

Update workspace store:

- subscribe to `awareness.delivery`
- refresh snapshot on `awareness.changed`
- expose `markAwarenessDeliveryRead`

**Step 5: Verify**

```powershell
pnpm vitest run tests/awareness-delivery-service.test.ts
pnpm run typecheck
```

**Step 6: Commit**

```powershell
git add desktop/src/main/services/awareness-delivery-service.ts desktop/src/main/ipc/awareness.ts desktop/src/preload/index.ts desktop/src/renderer/stores/workspace.ts desktop/tests/awareness-delivery-service.test.ts
git commit -m "feat(desktop): deliver awareness signals without chat noise"
```

### Task 11: Long Run Ledger Integration

**Files:**

- Modify: `desktop/src/main/services/long-run-ledger.ts`
- Modify: `desktop/src/main/services/time-scheduler.ts`
- Modify: `desktop/src/main/index.ts`
- Test: `desktop/tests/long-run-ledger-awareness.test.ts`

**Step 1: Write failing tests**

Cover:

- schedule job execution writes ledger record and execution run.
- awareness routine writes ledger record only when it makes a decision or executes action.
- background task status transition writes or updates ledger.
- startup reconciliation marks lost records when no authoritative runtime exists.

**Step 2: Run tests**

```powershell
pnpm vitest run tests/long-run-ledger-awareness.test.ts
```

**Step 3: Implement ledger updates**

- Use stable `kind + sourceId + runId` where possible.
- Avoid creating duplicate ledger record every time agent task hook fires.
- Add reconciliation that checks schedule jobs, active runs, background tasks, workflow runs.

**Step 4: Verify**

```powershell
pnpm vitest run tests/long-run-ledger-awareness.test.ts
pnpm run typecheck
```

**Step 5: Commit**

```powershell
git add desktop/src/main/services/long-run-ledger.ts desktop/src/main/services/time-scheduler.ts desktop/src/main/index.ts desktop/tests/long-run-ledger-awareness.test.ts
git commit -m "feat(desktop): reconcile long run ledger"
```

### Task 12: TimeCenter Awareness UI

**Files:**

- Modify: `desktop/src/renderer/pages/TimeCenterPage.tsx`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/time-awareness-ui.test.tsx`

**Step 1: Write failing UI tests**

Cover:

- Awareness tab lists routines with last / next run.
- create form validates name and cadence.
- pause / resume calls store actions.
- run now refreshes snapshot.
- active signals show severity, source, summary, acknowledge, dismiss.
- no active signals hides catch-up card.

**Step 2: Run tests**

```powershell
pnpm vitest run tests/time-awareness-ui.test.tsx
```

**Step 3: Refactor UI**

Extract components:

- `desktop/src/renderer/components/time/AwarenessRoutineManager.tsx`
- `desktop/src/renderer/components/time/AwarenessSignalList.tsx`
- `desktop/src/renderer/components/time/AwarenessCatchUp.tsx`

Keep TimeCenterPage focused on page composition.

**Step 4: Verify**

```powershell
pnpm vitest run tests/time-awareness-ui.test.tsx
pnpm run typecheck
```

**Step 5: Commit**

```powershell
git add desktop/src/renderer/pages/TimeCenterPage.tsx desktop/src/renderer/components/time/AwarenessRoutineManager.tsx desktop/src/renderer/components/time/AwarenessSignalList.tsx desktop/src/renderer/components/time/AwarenessCatchUp.tsx desktop/src/renderer/stores/workspace.ts desktop/tests/time-awareness-ui.test.tsx
git commit -m "feat(desktop): make awareness manageable in time center"
```

### Task 13: Silicon Person Awareness UI

**Files:**

- Modify: `desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx`
- Modify: `desktop/src/renderer/components/AgentTeamDock.tsx`
- Test: `desktop/tests/silicon-person-awareness.test.tsx`

**Step 1: Write failing UI tests**

Cover:

- Team dock badge counts only active signals for that employee.
- employee workspace has “值守” tab.
- employee tab lists routines scoped to `silicon_person` owner id.
- creating employee routine includes correct scope.
- employee signal actions call acknowledge / dismiss.

**Step 2: Run tests**

```powershell
pnpm vitest run tests/silicon-person-awareness.test.tsx
```

**Step 3: Implement UI**

- Add a `值守` tab next to existing employee workspace tabs.
- Reuse Awareness components with `scope` filter.
- Keep schedule jobs under “定时任务”，do not mix them with routine management.

**Step 4: Verify**

```powershell
pnpm vitest run tests/silicon-person-awareness.test.tsx
pnpm run typecheck
```

**Step 5: Commit**

```powershell
git add desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx desktop/src/renderer/components/AgentTeamDock.tsx desktop/tests/silicon-person-awareness.test.tsx
git commit -m "feat(desktop): add employee awareness workspace"
```

### Task 14: Settings and Guardrails

**Files:**

- Modify: settings page files located by `rg -n "Settings|设置" desktop/src/renderer`
- Modify: `desktop/src/main/ipc/awareness.ts`
- Modify: `desktop/shared/contracts/awareness.ts`
- Test: `desktop/tests/awareness-settings.test.tsx`

**Step 1: Locate settings files**

Run:

```powershell
rg -n "Settings|设置|preferences|偏好" desktop/src/renderer
```

**Step 2: Write failing tests**

Cover:

- global default cadence persists.
- global daily model budget persists.
- quiet hours respected by routine.
- user can disable default auto-seeded routines.

**Step 3: Implement settings**

Add settings for:

- enable / disable awareness runtime.
- default cadence.
- max model calls per day.
- critical override quiet hours.
- delivery channel preference.
- default routine seeding policy.

**Step 4: Verify**

```powershell
pnpm vitest run tests/awareness-settings.test.tsx
pnpm run typecheck
```

**Step 5: Commit**

```powershell
git add <settings-files> desktop/src/main/ipc/awareness.ts desktop/shared/contracts/awareness.ts desktop/tests/awareness-settings.test.tsx
git commit -m "feat(desktop): add awareness settings and guardrails"
```

### Task 15: End-to-End Awareness Flow

**Files:**

- Create: `desktop/tests/awareness-e2e.test.ts`
- Modify: any service files exposed by previous integration failures.

**Step 1: Write E2E tests**

Scenarios:

- failed schedule job -> awareness tick -> active signal -> Today catch-up -> user dismiss -> cooldown suppresses repeat.
- employee failed task -> employee scoped signal -> Team Dock badge -> employee workspace signal.
- pending approval older than threshold -> info signal -> no model call -> catch-up only.
- critical stale job during quiet hours -> delivery allowed only if override enabled.
- no signal -> no model call -> no delivery.

**Step 2: Run E2E**

```powershell
pnpm vitest run tests/awareness-e2e.test.ts
```

**Step 3: Fix integration gaps**

Patch only files directly implicated by failing E2E tests.

**Step 4: Full verification**

```powershell
pnpm run typecheck
pnpm test
```

**Step 5: Commit**

```powershell
git add desktop/tests/awareness-e2e.test.ts <changed-files>
git commit -m "test(desktop): cover awareness runtime end to end"
```

## 5. 并行拆分建议

可以并行，但必须避免写入冲突：

- Worker A：contracts + database + store lifecycle
  - Owns `desktop/shared/contracts/awareness.ts`
  - Owns `desktop/src/main/services/time-orchestration-database.ts`
  - Owns `desktop/src/main/services/awareness-store.ts`
- Worker B：source adapter + collector + runtime scheduler
  - Owns `desktop/src/main/services/awareness-source-adapter.ts`
  - Owns `desktop/src/main/services/awareness-signal-collector.ts`
  - Owns `desktop/src/main/services/awareness-runtime.ts`
- Worker C：policy + action + delivery + ledger
  - Owns `desktop/src/main/services/awareness-policy-engine.ts`
  - Owns `desktop/src/main/services/awareness-action-executor.ts`
  - Owns `desktop/src/main/services/awareness-delivery-service.ts`
  - Owns `desktop/src/main/services/long-run-ledger.ts`
- Worker D：UI
  - Owns TimeCenter awareness components
  - Owns SiliconPerson awareness tab
  - Owns AgentTeamDock badge

主 Agent 合并前必须统一复核：

- `desktop/src/main/index.ts`
- `desktop/src/main/services/runtime-context.ts`
- `desktop/src/preload/index.ts`
- `desktop/src/renderer/stores/workspace.ts`
- 所有 `@shared/contracts` 变更

## 6. 验收标准

功能验收：

- 创建一个每 5 分钟检查的 personal routine，不产生信号时不会调用模型、不会显示通知。
- 手动制造 failed schedule job 后，下一轮值守产生 warning signal。
- 解决该 schedule job 后，signal 自动 resolved。
- 创建 silicon person scoped routine 后，员工相关问题只显示在该员工 badge / workspace 中。
- 创建 Standing Order 后，低风险授权动作自动执行，高风险动作进入 pending approval。
- 删除或暂停 routine 后不会继续 tick。
- 休眠超过 cadence 后恢复，只执行一次 catch-up。
- 用户 dismiss 后，同 fingerprint 在 cooldown 内不重复打扰。

工程验收：

- `pnpm run typecheck` 通过。
- `pnpm test` 通过。
- 新增 awareness 相关测试覆盖 contracts、database、collector、runtime、policy、delivery、UI、E2E。
- 对本次修改文件执行乱码门禁。
- 不修改无关 API 或字段语义。

乱码门禁命令：

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern desktop/src desktop/shared desktop/tests docs/plans
```

## 7. 风险与处理

- 风险：现有工作树已有大量修改，直接实现容易踩用户改动。
  - 处理：先在单独分支或 worktree 执行本计划；每个任务独立提交。
- 风险：`agent-tasks` 目前通过 IPC 模块缓存暴露，不适合 runtime service 依赖。
  - 处理：抽出 main service adapter，IPC 只调用 service。
- 风险：模型决策可能制造无授权副作用。
  - 处理：模型只能产出 decision，所有 action 必须经过 policy engine。
- 风险：值守过频导致 token burn。
  - 处理：due-only、no-signal skip、budget、light context、模型调用审计。
- 风险：通知噪声污染聊天。
  - 处理：默认 Today catch-up / dock badge；OK silent；chat card 只用于用户明确开启或 critical。
- 风险：桌面休眠导致 missed tick 堆积。
  - 处理：默认 catch-up once，receipt 记录 missed duration。

## 8. 推荐执行顺序

说明：以下只是工程提交顺序，不是产品发布阶段。任意单批完成后都不能宣称“值守可用”；只有 Task 1-15 全部完成、E2E 和全量验证通过后，才算完整交付。

第一批：Task 1-5。目标是建立完整系统所需的数据、迁移、真实信号源和 signal 生命周期基础。

第二批：Task 6-9。目标是补齐 runtime 调度、决策、权限和动作执行，形成可审计闭环。

第三批：Task 10-14。目标是补齐通知交付、用户管理入口、硅基员工入口和全局设置守卫。

第四批：Task 15。目标是证明完整用户路径端到端可用。

每批结束运行：

```powershell
pnpm run typecheck
pnpm test
```

每批结束写一条简短交付记录到对应 PR 描述或开发日志，说明：

- 完成了哪些任务。
- 哪些 signal / action / UI 路径已经接入完整闭环。
- 哪些风险仍未关闭。
- 是否满足进入下一批的工程条件；不得把批次通过写成产品完成。
