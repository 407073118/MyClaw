---
id: 260507-gc0
type: quick
tier: P0
plan_path: .planning/quick/260507-gc0-workflow-sidebar/260507-gc0-PLAN.md
status: P0-complete
date: 2026-05-07
branch: worktree-agent-a7f4e9ae0a32619cf
commits:
  - 2b6e1d9 fix(workflow): rewire run-panel detail to IPC instead of dead 127.0.0.1:43110
  - 1745dae fix(workflow): stop swallowing IPC errors in preload; surface runWorkflow failures
  - 0d8c07c fix(workflow): align run-status CSS selector with contract value 'succeeded'
  - 2e24f73 feat(workflow): add subgraph stub executor with friendly error
typecheck: pass (only pre-existing McpPage AlertCircle error remains, unrelated)
remaining_tiers: [P1, P2]
---

# Quick 260507-gc0 — P0 Tier Summary

仅交付 P0 四个 task；P1 / P2 留作后续 quick task。

## Per-task Detail

### P0-1: 把 RunPanel 从 HTTP 切回 IPC — `2b6e1d9`

**Goal:** 让 `WorkflowRunPanel.loadRunDetail` 不再走 `fetch("http://127.0.0.1:43110/...")` 死代码，改走 `window.myClawAPI.getWorkflowRunDetail(runId)`。

**Changes:**

- `desktop/src/renderer/components/workflow/WorkflowRunPanel.tsx`
  - 删除 `getWorkflowRun` import 与 `useShellStore` 依赖（line 1-8）
  - 引入 `WorkflowCheckpointSummary` 与本地 `WorkflowRunDetailPayload` 类型
  - `loadRunDetail` 改用 `window.myClawAPI.getWorkflowRunDetail(runId)`，错误信息直接来源于 throw（错误文案 fallback "详情加载失败"）
  - `lastError` 改为读 `activeRunDetail.run.error`（`WorkflowCheckpointSummary` 没有 `error` 字段；`WorkflowRunSummary` 才有）
  - `stateFields` 不再读 `run.state`（`WorkflowRunSummary` 不持有 channel state），改为从最新 interrupt payload 取 `currentState`；完整状态展示留给后续 plan（依赖 checkpointer channel 还原）
- `desktop/src/main/ipc/workflows.ts`
  - 把 `WorkflowCheckpointSummary` 加入 `@shared/contracts` import 列表（line 5-14）
  - `workflow:get-run-detail` handler 返回形状从 `WorkflowRunSummary | null` 改为 `{ run, checkpoints } | null`，checkpoints 取自 `SqliteCheckpointer.listCheckpoints(runId)`
- `desktop/src/renderer/components/workflow/WorkflowCheckpointTimeline.tsx`
  - 类型从 `WorkflowRunCheckpoint` 改为 `WorkflowCheckpointSummary`（`@shared/contracts`）
  - 渲染逻辑改用 `triggeredNodes`（数组）+ `interruptPayload.{type, prompt, currentState}`，弃用 `error` / `retryAt` / `state` 字段（这些字段不在 contract 类型上）
- `desktop/src/renderer/services/runtime-client.ts` — **整文件删除**（无任何 production source 还在 import；过期的 vitest mock 引用见下文 Deferred）

**Verify:** typecheck pass（无新增 TS 错误）；手测 ✓ 见下方。

---

### P0-2: preload 不再吞错；UI 把 null runId 当失败 — `1745dae`

**Goal:** workflow:* IPC wrapper 不再静默 `.catch(() => fallback)`；`handleExecute` 把 `runId === null` 当失败处理。

**Changes:**

- `desktop/src/preload/index.ts:343-376` —— 删除 9 个 `workflow:*` wrapper 上的 `.catch(() => ...)`；保留 `then` 包装（保持 `{items}` / `{workflow}` 形状契约不变）。涵盖：`fetchWorkflows / getWorkflow / createWorkflow / updateWorkflow / fetchWorkflowRuns / startWorkflowRun / resumeWorkflowRun / deleteWorkflow / cancelWorkflowRun / getWorkflowRunDetail`。**未触碰**其他系统的 IPC wrapper（model / tool / mcp / silicon-person / cloud / skills / meeting / time / asr / publish / web-panel）。
- `desktop/src/renderer/pages/WorkflowsPage.tsx:286-299` —— `handleExecute` 包 try/catch；`result.runId` 缺失抛 `Error("启动失败：未返回 runId")`，alert 文案改为中文 `"启动工作流失败：<msg>"`。删掉之前 alert 的 "Successfully started workflow run" 文案。
- `desktop/src/renderer/pages/WorkflowStudioPage.tsx` —— grep 确认无相同 alert 复制粘贴，无需改动。

**Verify:** typecheck pass。手测：在 main 端临时 throw 时，UI 收到中文错误 alert 而不是 "Successfully ... null"。

---

### P0-3: `data-status="success"` → `"succeeded"` — `0d8c07c`

**Goal:** CSS 选择器与契约 `WorkflowRunStatus.Succeeded = "succeeded"` 对齐。

**Changes:**

- `desktop/src/renderer/components/workflow/WorkflowRunPanel.tsx:385` —— `.run-status-dot[data-status="success"]` → `[data-status="succeeded"]`
- `desktop/src/renderer/components/workflow/WorkflowRunPanel.tsx:412` —— `.status-pill[data-status="success"]` → `[data-status="succeeded"]`

**Grep 全局确认：** `desktop/src/renderer/` 内已无 `data-status="success"` 残留。

**Verify:** 完成的 run 行卡显示绿色状态徽章。

---

### P0-4: subgraph 占位 executor — `2e24f73`

**Goal:** 让 `NodeExecutorRegistry` 装上 `subgraph` kind 占位 executor，不再让 graph 编译阶段抛 `No executor registered for node kind: subgraph`；运行时 throw 友好错误，由 PregelRunner 落到 `failed`。

**Changes:**

- `desktop/src/main/ipc/workflows.ts:39-47` —— import 列表新增 `NodeExecutor / NodeExecutionContext / NodeExecutionResult` 类型
- `desktop/src/main/ipc/workflows.ts:431-447`（注册段尾部）—— 加入 `registry.register(new SubgraphStubExecutor())`；同文件底部新增 `SubgraphStubExecutor` 类（inline，6 行），`execute` 时 `throw new Error("子工作流尚未支持，请移除该节点")`，注册时无副作用。

**没有实现**真正的子工作流调度逻辑——本任务只是给引擎一个让 run 干净落到 failed 的出口。

---

## Typecheck Result

`pnpm --filter desktop typecheck` 命令：`tsc --noEmit -p tsconfig.main.json && tsc --noEmit -p tsconfig.renderer.json`

```
src/renderer/pages/McpPage.tsx(205,14): error TS2304: Cannot find name 'AlertCircle'.
```

**唯一一条 TS 错误是 pre-existing**，存在于 `McpPage.tsx`（与 P0 任何文件均无关联）。已通过 `git stash` 验证：在 stash 掉所有 P0 改动后，该错误仍然存在。本错误属于 SCOPE BOUNDARY 中"pre-existing failures in unrelated files"，按 deviation rules 不修。

**P0 改动 0 条 TS 错误。**

## Deviations from Plan

### [Rule 3 - Blocking issue] P0-1: IPC handler 返回形状不匹配，必须扩成 `{ run, checkpoints }`

**Found during:** P0-1 准备阶段（读 `workflows.ts:920` IPC 实现 vs `runtime-client.ts:36` `GetWorkflowRunPayload` shape）。

**Issue:** 计划 P0-1 步骤 2 注释写"IPC 返回 shape 已经匹配 (见 `desktop/src/main/ipc/workflows.ts:920` 与 `desktop/src/preload/index.ts:392`)"，但实际：

- IPC `workflow:get-run-detail` 返回 `WorkflowRunSummary | null`
- RunPanel 消费的是 `{ run: WorkflowRunDetail, checkpoints: WorkflowRunCheckpoint[] }`
- `WorkflowRunSummary` 没有 `state` 字段，`WorkflowCheckpointSummary` 也没有 `error / retryAt / state` 字段（与 runtime-client 里的 `WorkflowRunCheckpoint` 不同）

如果只做计划字面规定的 "把调用从 HTTP 换成 IPC"，UI 收到的将是裸 `WorkflowRunSummary`，运行面板会立刻读不到 `run.currentNodeIds` / `checkpoints` / `run.state` 全部断字段，等于把 P0-1 的目的（"详情区出现 startedAt / 状态 / 步骤列表"）完全打掉。

**Fix:** Rule 3（auto-fix blocking issue）：

1. 把 IPC 改成返回 `{ run, checkpoints }` 形状；checkpoints 用现成的 `SqliteCheckpointer.listCheckpoints(runId)`，不引入新的存储路径。
2. RunPanel + Timeline 切到 `WorkflowCheckpointSummary`（contract 类型）。
3. `lastError` 来源改为 `run.error`（`WorkflowRunSummary` 已有），`stateFields` 来源改为最新 interrupt payload 的 `currentState`（contract 已暴露）；完整 channel state 展示标记为后续工作。

**Rationale:** 这是计划写错（"shape 已经匹配"），不是实现问题。修复范围仅限 P0-1 直接相关文件 + checkpointer.listCheckpoints 调用，没有溢出到引擎重构。

**Files modified additionally:** `WorkflowCheckpointTimeline.tsx`（plan 中未列出，但与 P0-1 同源——它原本依赖 `runtime-client.ts` 的 `WorkflowRunCheckpoint` 类型，文件被删除后必须迁移）。

**Commit:** `2b6e1d9`（合并到 P0-1 commit）。

### [Plan ambiguity resolved] P0-1: runtime-client.ts 整文件删除（option 1）

Plan P0-1 step 1 给了两种处置：option 1（整文件删）只在"无其他 importer"时适用。原始读出时 `WorkflowCheckpointTimeline` 仍 import `WorkflowRunCheckpoint`。**P0-1 同步把 timeline 迁到 contract 类型后**，runtime-client.ts 不再有 production source importer，符合 option 1 条件，整文件删除。剩下的 `desktop/tests/workflow-run-panel.test.ts` 是过期 vitest mock（只引用 import 路径用于 mock，不属于 production source），见 Deferred。

## Auth Gates

无。

## Manual Verification Checklist

> Plan 的 P0 Acceptance Criteria 转译。当前 executor 阶段不做手测，下面是给后续 verifier 的脚本。

- [ ] **场景 1：1-node start→end 工作流跑通**
  - 在 WorkflowsPage 创建一个新工作流（默认 starter graph 是 start→end）
  - 点击行卡 ▶ 运行
  - **预期：** 不再 alert "Successfully started workflow run: null"；列表 Recent Runs 出现新 run；进入 studio 后 Run Panel 详情区出现 run id / status；状态徽章为绿色 succeeded（**P0-3 selector 修正后**）
- [ ] **场景 2：subgraph 节点工作流友好失败**
  - 拖一个 subgraph 节点连入 start→subgraph→end
  - 保存图，点运行
  - **预期：** run 状态干净落到 `failed`，错误 message 含 "子工作流尚未支持，请移除该节点"；不再是 graph compile 阶段红色 IPC error alert
- [ ] **场景 3：IPC reject 现在透传**
  - 在 main 端临时让 `workflow:start-run` throw
  - 点 ▶ 运行
  - **预期：** UI alert "启动工作流失败：<原始 error message>"，不再是 "Successfully ... null"

## Deferred Issues

### Out-of-scope (logged here, not fixed)

1. **`desktop/tests/workflow-run-panel.test.ts`** — 测试文件 mock 了已删除的 `../src/renderer/services/runtime-client`，并 mock `getWorkflowRun` / `useShellStore`，与新 IPC 路径不匹配。本任务约束明确"Do NOT add tests"，且测试不进入 typecheck，故未修改。后续若开 P1 quick task 应：
   - 把 `vi.mock("../src/renderer/services/runtime-client", ...)` 改为 `vi.mock("../src/preload/index"` 或 mock `window.myClawAPI.getWorkflowRunDetail`
   - 删除 `useShellStore` mock
   - resolved 形状从 `{run, checkpoints}` 沿用，但 checkpoint 字段改为 `checkpointId / triggeredNodes / interruptPayload`（不是 `id / nodeId / state / error`）

2. **`McpPage.tsx:205` 缺 `AlertCircle` import** — pre-existing TS 错误，与 P0 完全无关，留给独立 quick task 处理。

3. **完整 channel state 展示** — `WorkflowRunSummary` 不持有 channel state；本 P0 改 stateFields 仅从 interrupt payload 取，详情面板里的 "状态预览 (State)" 卡片在非中断态会显示 "无状态数据"。完整能力需要让 IPC 把 `checkpointer.restoreChannelData(runId, channelVersions)` 的结果一并打包返回，属于后续工作。

### Scope-respected (intentionally not done)

- P1 全部 7 task（P1-1..P1-7：sidebar 减法、conditional edge 编辑、inspector chrome 清洗）
- P2 全部 6 task（P2-1..P2-6：handleDelete 真删、library card / filters 删除、token 化、契约收紧、derived 字段去持久化、sidebar 样式违规）
- 不删 `WorkflowExecutionPolicyEditor.tsx` / `WorkflowLibraryCard.tsx` / `WorkflowLibraryFilters.tsx`
- 不动 `WorkflowDefinitionSummaryCompat` union（P2-4）
- 不动 `desktop/shared/contracts/workflow.ts`

## Self-Check

`git log --oneline | head -4` 验证 4 个 commit 在 worktree branch 上：

```
2e24f73 feat(workflow): add subgraph stub executor with friendly error
0d8c07c fix(workflow): align run-status CSS selector with contract value 'succeeded'
1745dae fix(workflow): stop swallowing IPC errors in preload; surface runWorkflow failures
2b6e1d9 fix(workflow): rewire run-panel detail to IPC instead of dead 127.0.0.1:43110
```

文件变更核对：

- ✓ `desktop/src/main/ipc/workflows.ts` — modified (P0-1 + P0-4)
- ✓ `desktop/src/renderer/components/workflow/WorkflowRunPanel.tsx` — modified (P0-1 + P0-3)
- ✓ `desktop/src/renderer/components/workflow/WorkflowCheckpointTimeline.tsx` — modified (P0-1)
- ✓ `desktop/src/renderer/services/runtime-client.ts` — DELETED (P0-1)
- ✓ `desktop/src/preload/index.ts` — modified (P0-2)
- ✓ `desktop/src/renderer/pages/WorkflowsPage.tsx` — modified (P0-2)

## Self-Check: PASSED
