# MyClaw Work OS Final Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 MyClaw 一步到位改造成本地优先、云端分发、可远程触发、可长期运行、可人工接管、可审计复盘的 AI Work Operating System。

**Architecture:** 新增统一 `WorkRun` 控制平面，把现有 Session、Task V2、AgentTask、WorkflowRun、ScheduleJob、AwarenessRoutine、RealtimeBridge 消息和 Project Capability Bundle 都映射到同一个工作运行模型。旧模块不被推倒重写，而是通过 adapter 接入统一运行账本、统一事件流、统一人工门禁、统一能力快照和统一工作中枢 UI。

**Tech Stack:** Electron main IPC, React 18, Zustand, TypeScript, sql.js/SQLite, existing Workflow Pregel runner, existing Time/Awareness runtime, existing Realtime Bridge NestJS service, Cloud NestJS/Nuxt/Prisma shared contracts.

---

## 0. 执行立场

本计划不按 MVP 设计，也不做“先凑一个能跑”的临时版本。目标是直接朝最终产品形态开发：MyClaw 的主产品语义从“聊天 + 若干工具”升级为“工作运行系统”。

为了快速迭代，测试策略只保留少量高价值护栏：

- 契约测试：确保 `WorkRun`、`HumanGate`、`CapabilitySnapshot` 类型和旧对象映射稳定。
- 存储 smoke test：确保 Work OS SQLite 建表、写入、查询、迁移可用。
- 端到端 smoke test：覆盖“定时任务触发 -> 创建 WorkRun -> 执行 -> 完成/等待用户 -> UI 可见”。
- Realtime smoke test：覆盖“钉钉消息 -> WorkRun -> 本地 session -> 回发/状态事件”。

不为每个小 helper 写 TDD，不做碎片化提交。建议一个开发分支完成全部重构，过程中按大切面提交。

## 1. 最终目标态

MyClaw 最终应该有五个面：

1. `Work Command Center`：所有正在跑、等待用户、失败、已计划、已完成的工作都在这里。
2. `Agent Team Workspace`：硅基员工有职责、队列、能力、工作时间、失败记录和产出。
3. `Time & Routine Center`：所有定时、周期、提醒、巡检、值守、升级策略都归这里。
4. `Project Capability Console`：项目绑定后，运行只暴露项目允许的 Skill/MCP/Workflow/Employee 能力。
5. `Channel Control`：Desktop Chat、钉钉、Cloud Hub、项目页面都只是入口和出口，不直接拥有执行语义。

核心原则：任何长期工作都必须变成 `WorkRun`。任何等待用户的地方都必须变成 `HumanGate`。任何模型运行前可用能力都必须冻结成 `CapabilitySnapshot`。任何状态变化都必须落成 `WorkEvent`。

## 2. 核心模型

新增文件：

- `desktop/shared/contracts/work-os.ts`
- `desktop/src/main/services/work-os-database.ts`
- `desktop/src/main/services/work-os-store.ts`
- `desktop/src/main/services/work-run-service.ts`
- `desktop/src/main/services/work-run-adapters.ts`
- `desktop/src/main/services/work-event-bus.ts`
- `desktop/src/main/ipc/work-os.ts`
- `desktop/src/renderer/pages/WorkCommandCenterPage.tsx`
- `desktop/src/renderer/components/work-os/WorkRunList.tsx`
- `desktop/src/renderer/components/work-os/WorkRunDetailPanel.tsx`
- `desktop/src/renderer/components/work-os/HumanGatePanel.tsx`
- `desktop/src/renderer/components/work-os/CapabilitySnapshotPanel.tsx`

修改文件：

- `desktop/shared/contracts/index.ts`
- `desktop/src/main/services/runtime-context.ts`
- `desktop/src/main/ipc/index.ts`
- `desktop/src/main/ipc/bootstrap.ts`
- `desktop/src/main/index.ts`
- `desktop/src/preload/index.ts`
- `desktop/src/renderer/types/electron.d.ts`
- `desktop/src/renderer/stores/workspace.ts`
- `desktop/src/renderer/router/index.tsx`
- `desktop/src/renderer/layouts/AppShell.tsx`

核心类型建议：

```ts
export type WorkRunKind =
  | "session_turn"
  | "agent_task"
  | "workflow_run"
  | "schedule_job"
  | "awareness_routine"
  | "realtime_message"
  | "project_capability_sync";

export type WorkRunStatus =
  | "queued"
  | "running"
  | "waiting_user"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "lost";

export type WorkRun = {
  id: string;
  kind: WorkRunKind;
  title: string;
  status: WorkRunStatus;
  source: WorkRunSource;
  owner: WorkRunOwner;
  parentRunId?: string | null;
  rootRunId: string;
  sessionId?: string | null;
  workflowRunId?: string | null;
  agentTaskId?: string | null;
  scheduleJobId?: string | null;
  realtimeDeliveryId?: string | null;
  capabilitySnapshotId?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  lastEventAt: string;
  summary?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HumanGate = {
  id: string;
  workRunId: string;
  gateKind: "user_input" | "approval" | "workflow_interrupt" | "risk_confirmation";
  status: "active" | "submitted" | "approved" | "rejected" | "cancelled" | "expired";
  question: string;
  reason?: string | null;
  choices?: Array<{ id: string; label: string; value: unknown }> | null;
  inputSchema?: unknown;
  resumeToken: string;
  createdAt: string;
  expiresAt?: string | null;
  resolvedAt?: string | null;
};

export type WorkEvent = {
  id: string;
  workRunId: string;
  type: string;
  level: "debug" | "info" | "warning" | "error";
  message: string;
  payload?: unknown;
  createdAt: string;
};
```

实现要求：

- 所有类型必须有中文注释。
- 所有服务方法必须有中文注释和中文日志。
- `WorkRun` 是新运行态的唯一查询入口，旧对象继续保留，用 adapter 映射。
- 不在第一轮删除旧表或旧 IPC，避免把整个桌面端炸穿。

## 3. 存储与服务层

新增 `work_os.db` 或复用现有 session/time database 的单独表，推荐独立数据库文件：

```text
work_runs
work_steps
human_gates
work_events
capability_snapshots
work_artifacts
work_channel_bindings
```

`work-os-database.ts` 负责建表和轻量迁移。`work-os-store.ts` 只做 CRUD。`work-run-service.ts` 做业务语义：

- `createRun`
- `startRun`
- `finishRun`
- `failRun`
- `cancelRun`
- `appendEvent`
- `openHumanGate`
- `resolveHumanGate`
- `attachCapabilitySnapshot`
- `linkLegacyEntity`

`work-run-adapters.ts` 负责从旧系统创建或同步 `WorkRun`：

- `fromSessionTurn`
- `fromAgentTask`
- `fromWorkflowRun`
- `fromScheduleJob`
- `fromAwarenessRoutine`
- `fromRealtimeMessage`
- `fromProjectCapabilitySync`

集成点：

- `desktop/src/main/ipc/sessions.ts`：每次 `invokeRegisteredSessionSendMessage` 创建 `session_turn` WorkRun；`task_wait_for_user` 创建 `HumanGate`。
- `desktop/src/main/ipc/agent-tasks.ts`：创建 AgentTask 时创建 root/child WorkRun。
- `desktop/src/main/ipc/workflows.ts`：启动 workflow run 时创建 `workflow_run` WorkRun；human input 映射为 `HumanGate`。
- `desktop/src/main/services/time-scheduler.ts`：执行 schedule job 前创建 `schedule_job` WorkRun。
- `desktop/src/main/services/awareness-runtime.ts`：routine tick 和 action decision 写入 WorkRun/WorkEvent。
- `desktop/src/main/services/realtime-bridge-client.ts`：收到外部消息时创建 `realtime_message` WorkRun。

## 4. CapabilitySnapshot 全链路

目标：任何 WorkRun 开始前，都要知道“这次到底能用什么”。

修改文件：

- `desktop/src/main/services/capability-bundle-resolver.ts`
- `desktop/src/main/services/project-capability-service.ts`
- `desktop/src/main/services/project-mcp-runtime-service.ts`
- `desktop/src/main/ipc/sessions.ts`
- `desktop/src/main/ipc/workflows.ts`
- `desktop/src/main/ipc/agent-tasks.ts`

新增规则：

- Session turn 创建 WorkRun 后立即解析 `CapabilityBundle`。
- 解析结果写入 `capability_snapshots`，并把 snapshot id 写回 WorkRun。
- Tool schema builder 和 executor 只能通过本轮 snapshot 查找能力，不允许运行中回读 mutable global state。
- 项目 Skill/MCP、全局 Skill/MCP、模型配置、审批策略、路径授权、personal prompt 都要进入 snapshot 摘要。
- Snapshot 不保存 secrets，只保存能力身份、来源、版本、工具名、启用状态和安全原因。

需要顺手修复：

- `ProjectRuntimeContextClient` 的 `/api/api/projects` 风险。
- Cloud Hub 类型与 Desktop Hub 类型映射风险。
- 项目 MCP 未确认时 UI 必须明确展示“已同步但未暴露给模型”。

## 5. HumanGate 统一人工门禁

现有人工等待分散在：

- Task V2 `task_wait_for_user`
- approval request
- workflow `human-input`
- realtime 远程长任务补充信息

目标：全部统一到 `HumanGate`。

修改文件：

- `desktop/shared/contracts/task.ts`
- `desktop/shared/contracts/workflow-run.ts`
- `desktop/src/main/services/task-interrupt-store.ts`
- `desktop/src/main/ipc/sessions.ts`
- `desktop/src/main/ipc/approvals.ts`
- `desktop/src/main/ipc/workflows.ts`
- `desktop/src/renderer/components/plan-state-panel.tsx`
- `desktop/src/renderer/components/work-os/HumanGatePanel.tsx`

规则：

- `task_wait_for_user` 继续存在，但底层必须创建 `HumanGate`。
- Approval request 保留旧 UI，但 Work OS 页面看到的是 `HumanGate`。
- Workflow human-input 继续支持原 resume，但要额外创建/关闭 `HumanGate`。
- `HumanGate` 只能通过 token 恢复，不能靠自然语言绕过。
- 任意 active HumanGate 存在时，对应 WorkRun 以及 parent/root WorkRun 都进入 `waiting_user` 或 `waiting_approval`。

## 6. Work Command Center UI

新增主导航 `/work`，建议放在 Chat 之前。它是未来 MyClaw 的主屏。

修改文件：

- `desktop/src/renderer/router/index.tsx`
- `desktop/src/renderer/layouts/AppShell.tsx`
- `desktop/src/renderer/stores/workspace.ts`
- `desktop/src/preload/index.ts`
- `desktop/src/renderer/types/electron.d.ts`

页面结构：

- 左侧：状态筛选，`Running`、`Waiting`、`Failed`、`Scheduled`、`Completed`、`External`。
- 中间：WorkRun 列表，按最近事件排序。
- 右侧：详情，包括事件流、HumanGate、CapabilitySnapshot、关联 session/workflow/job/task。
- 顶部：全局计数，正在运行、等待我、今日完成、失败待处理。

交互：

- 打开关联会话。
- 打开 workflow run。
- 打开 schedule job detail。
- 处理 HumanGate。
- 取消 WorkRun。
- 重试失败 WorkRun。
- 查看能力快照。
- 查看外部渠道状态。

设计要求：

- 工具型 UI，信息密度高，不做 landing page。
- 不把卡片套卡片。
- 所有按钮使用 lucide icon。
- 长文本必须截断并可展开。
- WorkRun 状态颜色不能只有单一蓝紫色。

## 7. Time、Routine、Agent Team 深度接入

不是把 Time Center、Agent Team Dock 废掉，而是把它们变成 Work OS 的专门视图。

Time Center：

- ScheduleJob 列表显示最近 WorkRun 状态。
- Job Detail 展示所有关联 WorkRun，而不只展示 ExecutionRun。
- `assistant_prompt` 的 `per_run/shared` 模式在 UI 中清楚说明。
- 失败 job 可以一键创建诊断 WorkRun。

Agent Team：

- 每个硅基员工显示当前 WorkRun 队列。
- AgentTask child session 变成 child WorkRun。
- 员工等待审批、等待用户、失败都进入统一 HumanGate/WorkRun。
- 员工详情页展示能力快照来源：全局能力、项目能力、员工私有能力。

Awareness：

- `AwarenessSignal` 变成 `WorkSignal` 或映射到 WorkRun event。
- `create_agent_task`、`trigger_workflow`、`execute_schedule_job` 动作必须接线。
- 所有自动动作默认走策略：低风险可自动，高风险进入 HumanGate。

## 8. Realtime Bridge 长任务协议

目标：钉钉不再只是一次性问答入口，而是 WorkRun 的外部 channel。

修改文件：

- `desktop/shared/contracts/realtime-bridge.ts`
- `desktop/src/main/services/realtime-bridge-client.ts`
- `desktop/src/main/ipc/realtime-bridge.ts`
- `realtime-bridge/src/contracts/bridge-events.ts`
- `realtime-bridge/src/modules/desktop-ws/desktop-ws.gateway.ts`
- `realtime-bridge/src/modules/delivery/delivery.service.ts`
- `realtime-bridge/src/modules/outbound/outbound.service.ts`
- `realtime-bridge/src/modules/admin/admin.controller.ts`

新增事件：

```text
desktop.work.started
desktop.work.progress
desktop.work.waiting_user
desktop.work.completed
desktop.work.failed
desktop.work.cancelled
bridge.work.cancel_requested
bridge.work.resume_submitted
```

规则：

- Bridge 入站消息创建 `realtime_message` WorkRun。
- 如果本地执行短时间完成，直接 `desktop.work.completed` 并回发文本。
- 如果进入后台或长运行，先回发“已开始处理”，后续状态变化按事件回发。
- 如果进入 HumanGate，钉钉可以收到结构化问题；用户回复后通过 `bridge.work.resume_submitted` 恢复。
- Admin timeline 展示 WorkRun id、delivery id、localSessionKey、状态和最终结果。

必须修复：

- Desktop 默认 `extractAssistantReplyText` 要能从 `{ session }` 最新 assistant 消息提取文本。
- Bridge 与 Desktop realtime contract 要么共享包，要么加 contract drift 测试。
- Desktop 建连 token 需要向 Cloud/Bridge 细化，不长期使用单共享 token。

## 9. Cloud Control Plane

Cloud 不运行本地工具，不抢 Desktop runtime。Cloud 负责分发、治理、项目能力和组织策略。

修改文件：

- `cloud/packages/shared/src/contracts/projects.ts`
- `cloud/packages/shared/src/contracts/hub.ts`
- `cloud/packages/shared/src/contracts/install.ts`
- `cloud/apps/cloud-api/src/modules/projects/*`
- `cloud/apps/cloud-api/src/modules/hub/*`
- `cloud/apps/cloud-api/src/modules/install/*`
- `cloud/apps/cloud-web/server/api/projects/*`
- `desktop/src/main/ipc/cloud.ts`
- `desktop/src/main/ipc/projects.ts`

目标：

- `ProjectRuntimeContext` 返回稳定 release、artifact hash、runtime policy、warnings。
- `tenantId` 不再硬编码 `default`，至少契约层预留真实 tenant/account。
- Hub item 类型统一，Desktop 和 Cloud 不再各说各话。
- Employee package、workflow package、project capability install 都进入安装留痕。
- Cloud Web 增加 runtime-context BFF，Desktop 可继续直连 API，但契约一致。

## 10. 最少测试策略

新增测试文件：

- `desktop/tests/work-os-contract.test.ts`
- `desktop/tests/work-os-store.test.ts`
- `desktop/tests/work-os-session-adapter.test.ts`
- `desktop/tests/work-os-human-gate.test.ts`
- `desktop/tests/work-command-center-store.test.ts`
- `desktop/tests/realtime-bridge-work-run.test.ts`
- `cloud/apps/cloud-api/src/modules/projects/tests/project-runtime-context-contract.test.ts`
- `realtime-bridge/tests/contracts/work-events.test.ts`

只验证高风险链路：

1. 创建 session turn 会创建 WorkRun，并保存 CapabilitySnapshot。
2. `task_wait_for_user` 会创建 HumanGate，并把 WorkRun 置为 waiting。
3. schedule job 执行会创建 WorkRun，并在完成后写 event。
4. workflow human-input 会映射成 HumanGate。
5. realtime bridge 默认 session 返回可提取 assistant 文本。
6. project runtime-context 不会产生 `/api/api` 路径，Hub 类型映射一致。

验证命令：

```powershell
pnpm --dir desktop vitest run tests/work-os-contract.test.ts tests/work-os-store.test.ts tests/work-os-session-adapter.test.ts tests/work-os-human-gate.test.ts tests/realtime-bridge-work-run.test.ts
pnpm --dir desktop typecheck
pnpm --dir realtime-bridge test
pnpm --dir cloud/apps/cloud-api test
```

乱码门禁：

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern desktop cloud realtime-bridge docs *.md
```

## 11. 开发顺序

虽然目标是一步到位，但实施仍按大切面推进，避免互相踩坏。

1. Work OS contracts、database、store、IPC、preload、renderer type。
2. Session/Task adapter：session turn、task_wait_for_user、background task 接入 WorkRun。
3. AgentTask/Workflow/ScheduleJob adapter：所有旧运行态都能映射为 WorkRun。
4. CapabilitySnapshot：所有运行前冻结能力，运行详情可查看。
5. HumanGate：Task、Approval、Workflow human input 统一恢复。
6. Work Command Center UI：主导航、列表、详情、操作。
7. Awareness action 接线：信号、策略、动作、WorkEvent。
8. Realtime Work protocol：远程长任务状态、等待用户、完成回发。
9. Cloud/Project/Hub contract 修正：类型、runtime-context、install log。
10. 统一验证和乱码门禁。

每一切面可以大提交一次，不要求 2-5 分钟小提交。

## 12. 不做的事

为了保持最终形态清晰，以下内容暂不做：

- 不把 Cloud 变成远程执行 runtime。
- 不让 Bridge 运行模型或工具。
- 不删除旧 Task/Workflow/ScheduleJob 表。
- 不做复杂多租户组织权限 UI，先把契约和字段立住。
- 不做完整移动端。
- 不做所有 helper 的细粒度单测。

## 13. 完成标准

完成后必须满足：

- Work Command Center 能看到 session、agent task、workflow、schedule job、awareness、realtime message 的统一运行状态。
- 任意等待用户的任务都以 HumanGate 呈现，并能从同一个入口恢复。
- 任意 WorkRun 都能看到事件流、关联旧对象、能力快照和产出摘要。
- 定时任务、硅基员工、workflow、钉钉远程消息都能进入同一个 WorkRun 模型。
- 项目能力不会污染全局能力，运行前能力快照可审计。
- Realtime Bridge 能区分短任务完成、长任务开始、等待用户、失败和完成。
- Cloud/Project/Hub 契约和 Desktop 使用一致。
- 少量关键 smoke tests、typecheck、乱码门禁通过。

## 14. 关键风险

- 当前工作区已有 desktop context 相关未提交改动，实施前必须确认是否保留、合并或另起 worktree。
- Workflow 冷恢复仍是难点，Work OS 第一轮可以统一显示 lost/waiting 状态，但真正 cold resume 需要单独深挖 Pregel checkpoint。
- Realtime 多实例能力仍不足，长期需要 Redis/DB 级在线路由和 nonce 防重放。
- Cloud tenant/account 目前还不完整，不能把组织级权限说成已完成。
- UI 改造较大，必须用 Playwright 或手动截图检查主工作台不会信息重叠。

## 15. 推荐启动命令

建议新建独立分支或 worktree 后执行：

```powershell
git status --short
pnpm --dir desktop typecheck
pnpm --dir desktop vitest run tests/realtime-bridge-session-execution.test.ts tests/task-interrupt-store.test.ts tests/time-scheduler.test.ts
```

如果基线通过，直接进入 Work OS contracts 和 store。若基线失败，先记录为既有风险，不扩大修复范围。
