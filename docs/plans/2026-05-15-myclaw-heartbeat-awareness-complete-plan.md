# MyClaw Heartbeat / 长时值守完整开发计划

## 背景与目标

MyClaw 已经具备定时任务、硅基员工任务、Workflow checkpoint、OpenAI Responses background mode 等长时能力的局部基础，但这些能力目前分散在不同模块中，缺少统一的值守语义、长期授权边界、运行账本、异常升级和用户可解释入口。

本文定义 MyClaw Heartbeat / Awareness / Standing Orders / LongRun Ledger 的完整产品级开发计划。该计划不是残缺 MVP，也不是只做静默巡检的底层能力，而是一次性设计完整闭环：感知、判断、升级、执行、审计、暂停、恢复、解释和回滚。

工程实现可以拆批提交，但正式对用户开放必须等完整闭环完成。任何只具备局部巡检、缺少审计或缺少权限边界的版本，都只能作为内部开发阶段，不应作为正式功能发布。

参考资料：

- OpenClaw Heartbeat: https://docs.openclaw.ai/gateway/heartbeat
- OpenClaw Cron Jobs: https://docs.openclaw.ai/automation/cron-jobs
- OpenClaw Background Tasks: https://docs.openclaw.ai/automation/tasks
- OpenClaw Standing Orders: https://docs.openclaw.ai/automation/standing-orders

## 核心判断：Heartbeat 不是 Cron

Heartbeat 不是 cron 的弱化版，也不是“每隔一段时间让主聊天说一句话”。Cron 负责精确调度：每天 9 点生成日报、每周五跑周报、某个时间点提醒用户、定时触发 workflow。Heartbeat 负责周期性感知：检查是否有新风险、任务是否卡住、审批是否等待、后台任务是否完成、员工职责是否需要升级。

MyClaw 中应严格区分三类能力：

- `ScheduleJob`：精确定时执行器，回答“到点必须做什么”。
- `Heartbeat` / `AwarenessRuntime`：周期性感知引擎，回答“现在有没有值得关注的变化”。
- `StandingOrder`：长期授权边界，回答“在什么范围内可以自主处理，什么必须升级给用户”。

Heartbeat 不直接承担重要副作用。它发现问题后，可以创建待处理信号、触发审批、建议动作、唤醒已授权流程，或把工作交给 `AgentTask`、`WorkflowRun`、`ScheduleJob` 等既有执行系统。所有可审计执行都必须进入统一账本。

## 产品定位

Heartbeat 的产品目标是让 MyClaw 从“用户下命令后执行”升级为“能够长期照看工作状态”。用户应该感觉到 MyClaw 在稳定值守，但不会被无意义的 OK 消息打扰。

正式交付必须覆盖以下用户体验：

- 用户能看到哪些事项被值守、为什么被值守、最近一次巡检结果是什么。
- 用户能为个人、硅基员工、workspace 配置不同值守策略。
- 用户能创建 Standing Order，明确长期意图、授权边界和升级路径。
- 用户能试跑 routine，预览它会读取哪些信息、可能触发哪些动作、是否需要审批。
- 用户能暂停、恢复、删除 routine。
- 用户能 dismiss 某类 signal，并且系统会进入冷却，不重复打扰。
- 用户能在 Today、Team Dock、硅基员工工作台、TimeCenter 和设置页看到一致状态。
- 主聊天不会被无事 Heartbeat 污染；只有用户需要介入时才出现摘要卡片或待处理入口。

## 总体架构

新增 runtime 级 `AwarenessRuntime`，运行在 `desktop/src/main`，由 `RuntimeContext` 持有。Renderer 只订阅状态和发起用户操作，不保存值守真相。

核心服务：

- `AwarenessRuntimeService`：主循环入口，负责 tick、调度 routine、维护活跃状态。
- `AwarenessRoutineService`：执行具体 routine，聚合上下文、生成 signal、调用 decision engine。
- `AwarenessSignalCollector`：从现有系统收集确定性信号。
- `AwarenessDecisionEngine`：在需要时调用模型，并要求模型返回结构化 decision。
- `AwarenessPolicyEngine`：合并全局审批策略、硅基员工策略、Standing Order、工具风险、时间策略和预算。
- `StandingOrderService`：管理长期授权边界。
- `LongRunLedgerService`：统一记录长时运行、后台任务、巡检、执行结果和审计事件。

现有能力应被复用，而不是旁路重写：

- `AgentTask` 继续承担员工任务派发和结果回灌。
- `WorkflowRun` 继续承担 workflow 执行和 checkpoint。
- `ScheduleJob` 继续承担精确定时。
- `session.backgroundTask` 继续承担 OpenAI Responses background poll/cancel/result merge。
- `ApprovalPolicy` 和工具风险策略继续裁决高风险动作。

## 核心数据模型

新增共享契约建议放在 `desktop/shared/contracts/awareness.ts`，并由 `desktop/shared/contracts/index.ts` 导出。

```ts
export type AwarenessScopeKind =
  | "personal"
  | "silicon_person"
  | "workspace"
  | "session"
  | "workflow";

export type AwarenessScope = {
  kind: AwarenessScopeKind;
  id?: string;
};

export type AwarenessRoutineStatus =
  | "enabled"
  | "paused"
  | "failed"
  | "disabled";

export type AwarenessRoutine = {
  id: string;
  name: string;
  scope: AwarenessScope;
  purpose: string;
  cadenceMinutes: number;
  activeHours?: Array<{ weekday: number; start: string; end: string }>;
  quietHours?: { enabled: boolean; start: string; end: string };
  signalSources: string[];
  contextPolicy: AwarenessContextPolicy;
  decisionPolicy: AwarenessDecisionPolicy;
  actionPolicy: AwarenessActionPolicy;
  deliveryPolicy: AwarenessDeliveryPolicy;
  budgetPolicy: AwarenessBudgetPolicy;
  standingOrderIds: string[];
  status: AwarenessRoutineStatus;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type StandingOrder = {
  id: string;
  scope: AwarenessScope;
  intent: string;
  allowedSignals: string[];
  allowedActions: string[];
  approvalGate: "always" | "risk_based" | "never_for_low_risk";
  escalationPolicy: AwarenessEscalationPolicy;
  expiresAt?: string;
  status: "active" | "paused" | "expired" | "revoked";
  createdAt: string;
  updatedAt: string;
};

export type AwarenessSignal = {
  id: string;
  fingerprint: string;
  sourceKind: string;
  sourceId: string;
  scope: AwarenessScope;
  severity: "info" | "warning" | "critical";
  summary: string;
  recommendedAction?: string;
  status: "active" | "dismissed" | "resolved" | "suppressed";
  cooldownUntil?: string;
  createdAt: string;
  updatedAt: string;
};

export type AwarenessDecision = {
  routineId: string;
  notify: boolean;
  actions: AwarenessAction[];
  requiresApproval: boolean;
  reason: string;
  confidence: number;
};

export type LongRunRecord = {
  id: string;
  kind:
    | "agent_task"
    | "schedule_job"
    | "workflow_run"
    | "model_background"
    | "awareness_routine"
    | "session_turn";
  sourceId: string;
  scope: AwarenessScope;
  status: "queued" | "running" | "waiting_user" | "succeeded" | "failed" | "cancelled" | "lost";
  startedAt: string;
  finishedAt?: string;
  lastHeartbeatAt?: string;
  resultSummary?: string;
  error?: string;
  deliveryStatus?: "not_required" | "pending" | "delivered" | "failed";
  auditEvents: LongRunAuditEvent[];
};
```

长期状态应进入 SQLite。旧 `agent-tasks.json` 保持兼容读取，但正式运行期应把关键状态同步进 `LongRunLedger`，避免长时任务继续散落在多个不可审计文件中。

## Runtime 行为

Heartbeat 默认作为 runtime 能力启用，但用户可见 routine 必须显式配置。全局 runtime tick 负责发现系统异常、维护 ledger、刷新 background task 状态和驱动 due routine。

默认频率：

- personal scope：30 分钟。
- silicon_person scope：60 分钟。
- workspace scope：30 分钟。
- critical monitor：最短 10 分钟。

静默与去重规则：

- 没有新 signal 时只写 receipt，不打扰用户。
- 同一 `fingerprint` 默认 2 小时冷却。
- quiet hours 内只记录，不打扰，除非 severity 是 `critical`。
- 连续失败 3 次的 routine 自动暂停。
- critical routine 被暂停时必须升级提醒用户。

模型调用规则：

- 没有新 signal 不调用模型。
- 低风险、单来源、确定性问题只走规则。
- 中高风险、跨来源归因、需要建议行动时才调用模型。
- 模型必须返回 `AwarenessDecision`，不能直接执行未审计动作。
- 模型上下文必须受 `contextPolicy` 限制，不能默认塞入主聊天完整历史。

执行规则：

- 内部只读检查和 receipt 写入可自动执行。
- 创建 `AgentTask`、触发 workflow、恢复已有后台任务，可在 Standing Order 授权下执行。
- 写文件、执行命令、外部路径访问、MCP 写操作、发外部消息、改日历，必须进入审批。

## 用户体验

Today 页面新增“值守 / Catch-up”区域：

- 待审批。
- 卡住的员工任务。
- 失败的定时任务。
- 完成但未回灌的后台任务。
- workflow 等待人工输入。
- Standing Order 需要用户决策的事项。

Team Dock：

- 每个硅基员工展示值守状态。
- 展示当前 routine、最近巡检时间、失败 badge、等待审批 badge。
- 支持暂停某个员工的值守。

硅基员工工作台：

- 新增“值守” tab。
- 结构化配置职责、观察来源、频率、预算、可执行动作、升级路径。
- 提供“试跑一次”按钮。
- 试跑必须展示会读取什么、可能触发什么动作、是否需要审批、预计成本。

主聊天：

- 不自动插入 OK heartbeat。
- 只有用户需要介入时出现摘要卡片。
- 用户可点开审计详情。

TimeCenter：

- 保留 `ScheduleJob` 精确定时。
- 新增 AwarenessRoutine 管理入口。
- 文案必须明确说明 AwarenessRoutine 是周期性感知，不是普通 cron。

设置页：

- 全局值守预算。
- 静默时段。
- 通知策略。
- Standing Orders 管理。
- 默认权限策略。

## 实现改造范围

新增 IPC：

- `awareness:list-routines`
- `awareness:create-routine`
- `awareness:update-routine`
- `awareness:pause-routine`
- `awareness:resume-routine`
- `awareness:delete-routine`
- `awareness:run-routine-now`
- `awareness:preview-routine`
- `awareness:get-snapshot`
- `awareness:dismiss-signal`
- `standing-order:list`
- `standing-order:create`
- `standing-order:update`
- `standing-order:delete`
- `long-run:list`
- `long-run:detail`
- `long-run:cancel`
- `long-run:retry`

新增事件：

- `awareness:changed`
- `long-run:changed`
- `standing-order:changed`

必要重构：

- 把 `agent-tasks.ts` 中的任务创建、更新、入队、取消、重试抽成 service，IPC 只做代理。
- 把 `sessions.ts` 中 background task poll/cancel/persist 抽成 `SessionBackgroundTaskService`。
- 把 workflow checkpointer 从 `workflows.ts` 提升为 runtime service。
- 让 `timeScheduler.tick()` 调用 `AwarenessRuntimeService.tick()`，但 awareness 失败不能阻塞 reminders 和 schedule jobs。

## 安全与权限边界

Standing Order 不能扩大权限，只能收窄或组合已有权限。所有自动动作必须通过 `AwarenessPolicyEngine`。

默认禁止：

- 自动发邮件或外部消息。
- 自动写文件。
- 自动改日历。
- 自动创建长期自动化。
- 员工间隐式 handoff。
- 无限递归触发 routine。
- Heartbeat 修改审批策略。
- 静默创建 Standing Order。

默认允许：

- 读取 MyClaw 内部状态。
- 写 receipt。
- 写 ledger audit event。
- 标记内部 signal dismissed。
- 对已存在 background task 做 poll。

用户必须能看到：

- routine 为什么运行。
- routine 读取了什么。
- routine 为什么提醒。
- routine 为什么没有执行某个动作。
- 哪条 Standing Order 授权了它。
- 哪个审批策略阻止了它。

## 验收标准

正式对用户开放前，必须同时满足：

- 用户能创建 personal、silicon_person、workspace routine。
- 用户能创建 Standing Order 并绑定 routine。
- 硅基员工能拥有自己的值守策略。
- Today 能显示值守发现的问题。
- Team Dock 能显示员工值守状态。
- 长时任务、后台任务、workflow、员工任务进入统一 ledger。
- routine 试跑可解释且不写入副作用数据。
- routine 正式运行有 audit trail。
- 重复 signal 会被去重和冷却。
- quiet hours 生效。
- 高风险动作进入审批。
- 失败 routine 会暂停并升级。
- 用户可以暂停、恢复、删除 routine。
- 用户可以 dismiss 某类 signal。
- 模型不可直接执行未授权动作。
- 主聊天不会被 OK heartbeat 污染。

## 测试计划

契约测试：

- `AwarenessRoutine`、`StandingOrder`、`LongRunRecord` 能序列化和反序列化。
- 旧 schedule job、旧 session、旧 agent task 数据正常加载。
- unknown optional fields 不破坏兼容性。

服务测试：

- signal collector 能聚合 agent task、workflow、background task、schedule job。
- policy engine 能阻止外部写入。
- quiet hours 生效。
- cooldown 生效。
- routine 连续失败后暂停。
- model decision 只能产生允许动作。
- awareness tick 异常不影响 scheduler 后续 tick。

集成测试：

- background task 完成后进入 ledger 并显示 Today。
- failed schedule job 触发 awareness signal。
- waiting_user AgentTask 触发员工 badge。
- workflow waiting-input 触发可恢复 signal。
- Standing Order 允许内部 AgentTask 创建，但拒绝外部写入。

IPC 测试：

- routine CRUD。
- Standing Order CRUD。
- preview routine 不产生副作用。
- run now 产生 ledger 和 audit。

UI 测试：

- Today Catch-up。
- Team Dock badge。
- 员工值守 tab。
- routine preview。
- Standing Order policy view。

回归测试：

- 主聊天不会被 OK heartbeat 污染。
- cron 和 reminder 仍按原逻辑运行。
- approval 仍由原审批链裁决。
- renderer 断开不影响 runtime tick。

## 假设与约束

- 本计划是一步到位的产品计划，不是残缺 MVP。
- 工程可以分批实现，但正式对用户开放必须等完整闭环完成。
- Heartbeat 是 runtime 能力，主聊天、硅基员工、workspace 只是 scope。
- AwarenessRoutine 不是普通 cron；cron 继续负责精确定时。
- Standing Orders 是授权边界，不是绕过审批的自然语言口令。
- 所有目标文件必须使用 UTF-8 保存。
- 涉及中文文件时必须遵守仓库中文编辑安全规则，避免既有乱码继续扩散。
