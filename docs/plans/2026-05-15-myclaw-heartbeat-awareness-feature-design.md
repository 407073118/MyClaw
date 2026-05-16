# MyClaw Heartbeat / Awareness 功能设计文档

> 基于现有 desktop 架构分析 + OpenClaw / Hermes Agent 等竞品调研，面向 Electron 桌面应用的完整功能设计。

---

## 一、功能定位

### 1.1 核心判断：Heartbeat 不是 Cron

MyClaw 已有三类长时能力，Heartbeat 不替代其中任何一个：

| 能力 | 负责什么 | 现有实现 |
|------|---------|---------|
| **ScheduleJob** | 精确定时执行：每天 9 点发日报、每周五跑周报、到点提醒用户 | `TimeScheduler` + `TimeOrchestrationStore` |
| **AgentTask** | 员工任务派发与结果回灌：主聊天派给硅基员工、员工完成后通知 | `agent-task-store.ts` + `agent-tasks.ts` IPC |
| **BackgroundTask** | 模型后台研究任务：OpenAI Responses background poll/cancel/result | `session:poll-background-task` IPC |
| **Heartbeat** | 周期性感知引擎：检查有没有新风险、任务是否卡住、审批是否等待 | **新增** |

Heartbeat 不直接承担重要副作用。它发现问题后，可以创建待处理信号、触发审批、建议动作、唤醒已授权流程，或把工作交给 `AgentTask`、`WorkflowRun`、`ScheduleJob` 等既有执行系统。

### 1.2 产品目标

让 MyClaw 从"用户下命令后执行"升级为"能够长期照看工作状态"。用户应该感觉到 MyClaw 在稳定值守，但不会被无意义的 OK 消息打扰。

### 1.3 与竞品的关键差异

| 维度 | OpenClaw | Hermes Agent | MyClaw |
|------|----------|-------------|--------|
| 运行环境 | 服务器 Gateway + 消息平台 | VPS/Docker + 20+ 消息平台 | **本地 Electron 桌面应用** |
| 静默协议 | `HEARTBEAT_OK` + ackMaxChars | `[SILENT]` 前缀 + 空 stdout | **结构化 Signal + fingerprint 冷却** |
| 持久化 | SQLite (tasks/runs.sqlite) | JSON 文件 | **sql.js (time.db 同模式)** |
| 权限模型 | Operator Scopes | 命令白名单 + 容器隔离 | **既有 ApprovalPolicy + 新增 Standing Order** |
| 后台任务账本 | 7 天自动清理 | 本地文件记录 | **LongRunLedger 统一审计** |

**MyClaw 的独特挑战**：桌面应用不像服务器永远在线。用户会合盖、关机、休眠。心跳系统必须处理"错过了怎么办"——这正是 ScheduleJob 已经解决的问题（`buildNextScheduleJobState` 计算 nextRunAt），Heartbeat 可以复用。

---

## 二、架构设计

### 2.1 在现有架构中的位置

```
index.ts (启动)
  └─ buildRuntimeContext()
       ├─ ... 现有服务 ...
       ├─ TimeOrchestrationStore (time.db)  ← 已有
       ├─ TimeScheduler (tick 循环)          ← 已有
       └─ AwarenessRuntimeService            ← 新增，由 TimeScheduler tick 驱动

IPC 注册 (registerAllIpcHandlers)
  ├─ registerBootstrapHandlers
  ├─ registerSessionHandlers
  ├─ ... 现有 IPC ...
  ├─ registerTimeOrchestrationHandlers
  └─ registerAwarenessHandlers              ← 新增

Contract 导出 (shared/contracts/index.ts)
  ├─ ... 现有 29 个模块 ...
  └─ export * from "./awareness"             ← 新增
```

### 2.2 核心服务拆分

| 服务 | 职责 | 放在哪里 |
|------|------|---------|
| `AwarenessRuntimeService` | 主循环入口，tick、调度 routine、维护活跃状态 | `src/main/services/awareness-runtime.ts` |
| `AwarenessRoutineService` | 执行具体 routine，聚合上下文、生成 signal、调 decision engine | `src/main/services/awareness-routine.ts` |
| `AwarenessSignalCollector` | 从现有系统收集确定性信号（不调模型） | `src/main/services/awareness-signal-collector.ts` |
| `AwarenessDecisionEngine` | 需要时调用模型，返回结构化 decision | `src/main/services/awareness-decision-engine.ts` |
| `StandingOrderService` | 管理长期授权边界 | `src/main/services/standing-order-service.ts` |
| `LongRunLedgerService` | 统一记录长时运行审计事件 | `src/main/services/long-run-ledger.ts` |

**关键设计决策**：不新建独立的 tick 循环。`AwarenessRuntimeService.tick()` 由现有的 `TimeScheduler.tick()` 在每个周期末尾调用。这样：

- 复用现有的 watchdog 防卡死机制
- 复用 `AvailabilityPolicy` 的 quiet hours 判断
- awareness 失败不影响 reminders 和 schedule jobs 的正常执行
- 不增加额外的 `setInterval` 开销

### 2.3 Tick 执行流程

```
TimeScheduler.tick()
  ├─ 1. 处理到期 reminders        (已有)
  ├─ 2. 处理到期 schedule jobs     (已有)
  └─ 3. AwarenessRuntimeService.tick()  ← 新增
       ├─ a. collectSignals()     — 从现有系统收集确定性状态变化
       ├─ b. diffLastTick()       — 对比上次 tick，有无新变化
       │    └─ 无变化 → 写 receipt，结束
       ├─ c. filterByPolicy()     — 冷却、静默时段、严重度过滤
       ├─ d. matchRoutines()      — 找到哪些 routine 关心这些 signal
       ├─ e. 需要模型？(跨源归因/建议行动/中高风险)
       │    ├─ 否 → 规则决策
       │    └─ 是 → AwarenessDecisionEngine.decide() → AwarenessDecision
       ├─ f. enforcePolicy()      — Standing Order + ApprovalPolicy 裁决
       │    ├─ 自动允许 → 执行
       │    ├─ 需审批 → 创建 ApprovalRequest
       │    └─ 禁止 → 记录原因，不执行
       ├─ g. executeActions()     — 通过既有系统执行
       │    ├─ 创建 AgentTask
       │    ├─ 触发 WorkflowRun
       │    ├─ 执行 ScheduleJob
       │    └─ 仅记录 signal (不执行)
       └─ h. writeLedger()        — 写入 LongRunRecord + AuditEvent
```

### 2.4 与现有系统的集成点

```
AwarenessRuntimeService 消费的数据源：

RuntimeContext.state
  ├─ activeSessionRuns    — 哪些会话正在运行、卡在哪
  ├─ activeWorkflowRuns   — 哪些 workflow 在执行、到哪个节点
  └─ sessions             — 会话列表（含 backgroundTask 状态）

TimeOrchestrationStore (time.db)
  ├─ scheduleJobs         — 定时任务及其 executionRuns
  ├─ reminders            — 提醒及其状态
  └─ availabilityPolicy   — 工作时段、静默时段

AgentTaskStore
  └─ agentTasks           — 员工任务队列、状态、分配

IPC 桥接
  └─ invokeRegisteredSessionSendMessage() — 复用 agentic loop 执行模型调用
```

---

## 三、数据模型

### 3.1 新增共享契约

新文件 `desktop/shared/contracts/awareness.ts`，遵循现有 29 个契约模块的模式：

- 纯 type/const 导出
- `*At` 后缀表示 ISO 8601 时间戳
- `satisfies` 定义枚举值数组
- `createDefault*()` 工厂函数
- ownerScope 遵循 `"personal" | "silicon_person"` 模式（来自 `calendar.ts`）

### 3.2 核心类型

```ts
// ─── Scope ───

export type AwarenessScopeKind =
  | "personal"
  | "silicon_person"
  | "workspace";

export type AwarenessScope = {
  kind: AwarenessScopeKind;
  ownerId?: string;
};

// ─── Signal ───

export const AWARENESS_SIGNAL_SEVERITY_VALUES = [
  "info",
  "warning",
  "critical",
] as const satisfies readonly AwarenessSignalSeverity[];

export type AwarenessSignalSeverity =
  | "info"
  | "warning"
  | "critical";

export const AWARENESS_SIGNAL_STATUS_VALUES = [
  "active",
  "acknowledged",
  "resolved",
  "dismissed",
  "suppressed",
] as const satisfies readonly AwarenessSignalStatus[];

export type AwarenessSignalStatus =
  | "active"
  | "acknowledged"
  | "resolved"
  | "dismissed"
  | "suppressed";

export type AwarenessSignal = {
  id: string;
  fingerprint: string;
  sourceKind: AwarenessSignalSourceKind;
  sourceId: string;
  scope: AwarenessScope;
  severity: AwarenessSignalSeverity;
  summary: string;
  recommendedAction?: string;
  status: AwarenessSignalStatus;
  cooldownUntil?: string;
  resolvedAt?: string;
  dismissedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export const AWARENESS_SIGNAL_SOURCE_KIND_VALUES = [
  "agent_task",
  "schedule_job",
  "workflow_run",
  "background_task",
  "session_stuck",
  "approval_pending",
  "system_health",
] as const satisfies readonly AwarenessSignalSourceKind[];

export type AwarenessSignalSourceKind =
  | "agent_task"
  | "schedule_job"
  | "workflow_run"
  | "background_task"
  | "session_stuck"
  | "approval_pending"
  | "system_health";

// ─── Routine ───

export const AWARENESS_ROUTINE_STATUS_VALUES = [
  "enabled",
  "paused",
  "failed",
  "disabled",
] as const satisfies readonly AwarenessRoutineStatus[];

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
  activeHours?: Array<{
    weekday: number;
    start: string;
    end: string;
  }>;
  signalSources: AwarenessSignalSourceKind[];
  decisionPolicy: AwarenessDecisionPolicy;
  actionPolicy: AwarenessActionPolicy;
  deliveryPolicy: AwarenessDeliveryPolicy;
  budgetPolicy: AwarenessBudgetPolicy;
  standingOrderIds: string[];
  status: AwarenessRoutineStatus;
  consecutiveFailures: number;
  lastRunAt?: string;
  nextRunAt?: string;
  lastReceipt?: AwarenessTickReceipt;
  createdAt: string;
  updatedAt: string;
};

// ─── Standing Order ───

export const STANDING_ORDER_STATUS_VALUES = [
  "active",
  "paused",
  "expired",
  "revoked",
] as const satisfies readonly StandingOrderStatus[];

export type StandingOrderStatus =
  | "active"
  | "paused"
  | "expired"
  | "revoked";

export const APPROVAL_GATE_VALUES = [
  "always",
  "risk_based",
  "never_for_low_risk",
] as const satisfies readonly ApprovalGate[];

export type ApprovalGate =
  | "always"
  | "risk_based"
  | "never_for_low_risk";

export type StandingOrder = {
  id: string;
  scope: AwarenessScope;
  name: string;
  intent: string;
  allowedSignals: AwarenessSignalSourceKind[];
  allowedActions: AwarenessActionKind[];
  approvalGate: ApprovalGate;
  escalationPolicy: AwarenessEscalationPolicy;
  expiresAt?: string;
  status: StandingOrderStatus;
  createdAt: string;
  updatedAt: string;
};

// ─── Decision ───

export type AwarenessDecision = {
  routineId: string;
  notify: boolean;
  actions: AwarenessAction[];
  requiresApproval: boolean;
  reason: string;
  confidence: number;
};

export const AWARENESS_ACTION_KIND_VALUES = [
  "create_agent_task",
  "trigger_workflow",
  "execute_schedule_job",
  "notify_user",
  "dismiss_signal",
  "log_only",
] as const satisfies readonly AwarenessActionKind[];

export type AwarenessActionKind =
  | "create_agent_task"
  | "trigger_workflow"
  | "execute_schedule_job"
  | "notify_user"
  | "dismiss_signal"
  | "log_only";

export type AwarenessAction = {
  kind: AwarenessActionKind;
  description: string;
  riskLevel: "low" | "medium" | "high";
  payload?: Record<string, unknown>;
};

// ─── Long Run Ledger ───

export const LONG_RUN_KIND_VALUES = [
  "agent_task",
  "schedule_job",
  "workflow_run",
  "model_background",
  "awareness_routine",
  "session_turn",
] as const satisfies readonly LongRunKind[];

export type LongRunKind =
  | "agent_task"
  | "schedule_job"
  | "workflow_run"
  | "model_background"
  | "awareness_routine"
  | "session_turn";

export const LONG_RUN_STATUS_VALUES = [
  "queued",
  "running",
  "waiting_user",
  "succeeded",
  "failed",
  "cancelled",
  "lost",
] as const satisfies readonly LongRunStatus[];

export type LongRunStatus =
  | "queued"
  | "running"
  | "waiting_user"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "lost";

export type LongRunRecord = {
  id: string;
  kind: LongRunKind;
  sourceId: string;
  scope: AwarenessScope;
  status: LongRunStatus;
  startedAt: string;
  finishedAt?: string;
  lastHeartbeatAt?: string;
  resultSummary?: string;
  error?: string;
  deliveryStatus: "not_required" | "pending" | "delivered" | "failed";
  createdAt: string;
  updatedAt: string;
};

// ─── Audit Event ───

export type AwarenessAuditEvent = {
  id: string;
  ledgerRecordId: string;
  timestamp: string;
  action: string;
  actor: "system" | "user" | "model";
  riskLevel: "low" | "medium" | "high";
  approvalStatus: "auto_approved" | "pending" | "approved" | "rejected" | "not_required";
  detail: string;
  standingOrderId?: string;
  policyDecisionReason?: string;
};

// ─── Policy 子类型 ───

export type AwarenessDecisionPolicy = {
  modelProfileId?: string;
  useModelForCrossSource: boolean;
  useModelForActionSuggestion: boolean;
  maxModelCallsPerTick: number;
};

export type AwarenessActionPolicy = {
  autoAllow: AwarenessActionKind[];
  requireApproval: AwarenessActionKind[];
  alwaysDeny: AwarenessActionKind[];
};

export type AwarenessDeliveryPolicy = {
  notifyOnSignal: boolean;
  notifyOnDecision: boolean;
  deliveryChannel: "chat_card" | "dock_badge" | "today_catchup" | "silent";
  quietHoursRespected: boolean;
  criticalOverridesQuietHours: boolean;
};

export type AwarenessBudgetPolicy = {
  maxModelCallsPerDay: number;
  maxModelCallsPerRoutinePerDay: number;
  pausedOnBudgetExceeded: boolean;
};

export type AwarenessEscalationPolicy = {
  escalateAfterConsecutiveFailures: number;
  criticalRoutinePausedMustNotify: boolean;
  escalationChannel: "chat_card" | "notification" | "dock_badge";
};

// ─── Tick Receipt ───

export type AwarenessTickReceipt = {
  tickedAt: string;
  signalsCollected: number;
  signalsNew: number;
  modelCalled: boolean;
  decisionsMade: number;
  actionsExecuted: number;
  actionsBlocked: number;
  durationMs: number;
};

// ─── Snapshot (给 renderer 用的聚合视图) ───

export type AwarenessSnapshot = {
  routines: AwarenessRoutine[];
  activeSignals: AwarenessSignal[];
  standingOrders: StandingOrder[];
  recentLedgerEntries: LongRunRecord[];
  pendingApprovals: number;
  failedRoutineCount: number;
};

// ─── 工厂函数 ───

export function createDefaultDecisionPolicy(): AwarenessDecisionPolicy {
  return {
    useModelForCrossSource: true,
    useModelForActionSuggestion: true,
    maxModelCallsPerTick: 1,
  };
}

export function createDefaultActionPolicy(): AwarenessActionPolicy {
  return {
    autoAllow: ["log_only", "dismiss_signal"],
    requireApproval: [
      "create_agent_task",
      "trigger_workflow",
      "execute_schedule_job",
      "notify_user",
    ],
    alwaysDeny: [],
  };
}

export function createDefaultDeliveryPolicy(): AwarenessDeliveryPolicy {
  return {
    notifyOnSignal: false,
    notifyOnDecision: true,
    deliveryChannel: "today_catchup",
    quietHoursRespected: true,
    criticalOverridesQuietHours: true,
  };
}

export function createDefaultBudgetPolicy(): AwarenessBudgetPolicy {
  return {
    maxModelCallsPerDay: 50,
    maxModelCallsPerRoutinePerDay: 10,
    pausedOnBudgetExceeded: true,
  };
}

export function createDefaultEscalationPolicy(): AwarenessEscalationPolicy {
  return {
    escalateAfterConsecutiveFailures: 3,
    criticalRoutinePausedMustNotify: true,
    escalationChannel: "chat_card",
  };
}
```

### 3.3 持久化方案

复用 `TimeOrchestrationStore` 的 sql.js 模式，在同一个 `time.db` 中新增表：

```sql
-- Awareness Routines
CREATE TABLE IF NOT EXISTS awareness_routines (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL,
  owner_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled',
  cadence_minutes INTEGER NOT NULL DEFAULT 30,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Awareness Signals
CREATE TABLE IF NOT EXISTS awareness_signals (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  owner_id TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  status TEXT NOT NULL DEFAULT 'active',
  cooldown_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_fingerprint ON awareness_signals(fingerprint);
CREATE INDEX IF NOT EXISTS idx_signals_status ON awareness_signals(status);

-- Standing Orders
CREATE TABLE IF NOT EXISTS standing_orders (
  id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL,
  owner_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Long Run Ledger
CREATE TABLE IF NOT EXISTS long_run_ledger (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at TEXT NOT NULL,
  finished_at TEXT,
  last_heartbeat_at TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'not_required',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_kind_status ON long_run_ledger(kind, status);
CREATE INDEX IF NOT EXISTS idx_ledger_source ON long_run_ledger(kind, source_id);

-- Awareness Audit Events
CREATE TABLE IF NOT EXISTS awareness_audit_events (
  id TEXT PRIMARY KEY,
  ledger_record_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  approval_status TEXT NOT NULL,
  detail TEXT NOT NULL,
  standing_order_id TEXT,
  payload_json TEXT,
  FOREIGN KEY (ledger_record_id) REFERENCES long_run_ledger(id)
);
CREATE INDEX IF NOT EXISTS idx_audit_ledger ON awareness_audit_events(ledger_record_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON awareness_audit_events(timestamp);
```

**设计要点**：

- 与 `TimeOrchestrationStore` 保持完全一致的 `payload_json` + 类型化列 模式
- 所有表共用 `time.db`，不引入新的数据库文件
- `owner_id` 允许为空（personal scope 不需要 ownerId）
- Signal 表的 `fingerprint` 索引用于去重查询
- Ledger 表的 `kind + status` 索引用于 Today 页面的"待处理"查询

### 3.4 Ledger 数据来源映射

`LongRunRecord` 不是凭空产生的。它从现有系统同步而来：

| kind | 来源 | 触发时机 |
|------|------|---------|
| `agent_task` | `AgentTaskStore` | 任务创建/状态变更时同步写入 |
| `schedule_job` | `TimeOrchestrationStore.executionRuns` | 每次执行完成时同步写入 |
| `workflow_run` | `WorkflowRunSummary` + `WorkflowStreamEvent` | workflow 开始/完成/失败时同步写入 |
| `model_background` | `ChatSession.backgroundTask` | background task poll 到终态时同步写入 |
| `awareness_routine` | `AwarenessRoutineService` | routine tick 执行时写入 |
| `session_turn` | `handleSessionSendMessage` | 可选：记录每次模型调用的摘要 |

**同步策略**：不在 AwarenessRuntimeService.tick() 里轮询同步，而是在各既有系统的状态变更点主动推送。用 `RuntimeContext` 的 getter 函数模式（如现有的 `getApprovals`）暴露当前状态，由 `AwarenessSignalCollector` 在 tick 时读取。

---

## 四、Runtime 行为规则

### 4.1 默认频率

| scope | 默认频率 | 说明 |
|-------|---------|------|
| `personal` | 30 分钟 | 用户个人的整体值守 |
| `silicon_person` | 60 分钟 | 每个硅基员工的独立值守 |
| `workspace` | 30 分钟 | 工作空间级别的值守 |

### 4.2 静默与去重规则

借鉴 OpenClaw 的 `HEARTBEAT_OK` 和 Hermes 的 `[SILENT]` 模式，但使用结构化方式实现：

**规则 1 — 无事不扰**：没有新 signal 时只写 `AwarenessTickReceipt`，不产生任何用户可见输出。

**规则 2 — Fingerprint 冷却**：同一 `fingerprint`（= `sourceKind + sourceId + 问题类型` 的哈希）默认 2 小时冷却。冷却期内的重复 signal 自动标记为 `suppressed`。

**规则 3 — 静默时段**：`AvailabilityPolicy.quietHours` 内只记录不打扰，除非 severity 是 `critical`。复用现有 `TimeOrchestrationStore` 中已保存的 `AvailabilityPolicy`。

**规则 4 — 连续失败暂停**：routine 连续失败 3 次自动暂停，`consecutiveFailures` 计数器跟踪。借鉴 Hermes 的 turn budget 和 OpenClaw 的 `skipWhenBusy`。

**规则 5 — 关键升级**：被暂停的 critical routine 必须通过 `escalationChannel` 通知用户。

**规则 6 — 忙碌时跳过**：如果 `RuntimeContext.state.activeSessionRuns` 中有与该 routine 同 scope 的活跃运行，延迟到下次 tick。借鉴 OpenClaw 的 `skipWhenBusy`。

### 4.3 模型调用规则（成本优化）

借鉴 Hermes 的 `wakeAgent` 门控模式，实现三层成本优化：

| 层 | 触发条件 | 是否调模型 | 成本 |
|----|---------|-----------|------|
| **纯规则层** | 无新 signal，或单来源低风险确定性检查 | 否 | 零 |
| **轻量模型层** | 有新 signal，但低风险、单来源、可用规则处理 | 否（用规则） | 零 |
| **完整模型层** | 跨源归因、中高风险、需要建议行动 | 是 | 正常 |

**具体规则**：
- 没有 signal → 不调模型
- 单来源 + 低严重度 → 规则决策，不调模型
- 多来源归因 / 需要 action 建议 / severity >= warning → 调模型
- 模型必须返回结构化 `AwarenessDecision`，不能直接执行未审计动作
- 模型上下文受 `decisionPolicy` 限制，不塞入完整聊天历史

**模型调用预算**：
- `budgetPolicy.maxModelCallsPerDay` 控制每日上限（默认 50 次）
- `budgetPolicy.maxModelCallsPerRoutinePerDay` 控制每 routine 上限（默认 10 次）
- 超预算自动暂停该 routine（`pausedOnBudgetExceeded: true`）

### 4.4 执行规则

**默认自动允许**（借鉴现有 `ApprovalPolicy.autoApproveReadOnly` 模式）：
- 读取 MyClaw 内部状态
- 写 receipt / ledger / audit event
- 标记内部 signal 为 dismissed / suppressed

**Standing Order 授权下允许**（需有匹配的 Standing Order）：
- 创建 `AgentTask`
- 触发 `WorkflowRun`
- 恢复已有后台任务

**必须审批**（通过现有 `ApprovalPolicy` 管道）：
- 写文件
- 执行命令
- 外部路径访问
- MCP 写操作
- 发外部消息
- 改日历
- 创建长期自动化

### 4.5 防递归

借鉴 Hermes 的"Cron 不能创建 Cron"规则：

Heartbeat routine 执行时不能：
- 创建新的 Heartbeat routine
- 创建新的 Standing Order
- 修改审批策略
- 修改其他 routine 的配置
- 触发另一个 routine 的立即执行

---

## 五、Signal Collector — 确定性信号源

`AwarenessSignalCollector` 在每个 tick 从现有系统收集信号。**不调模型，纯规则判断。**

### 5.1 信号源与生成规则

| sourceKind | 数据来源 | 何时产生 signal | severity | fingerprint 构成 |
|-----------|---------|----------------|----------|-----------------|
| `agent_task` | `AgentTaskStore` | 任务 status = `failed` | warning | `task:failed:{taskId}` |
| `agent_task` | `AgentTaskStore` | 任务 status = `waiting_user` 超过 N 分钟 | info | `task:waiting:{taskId}` |
| `schedule_job` | `TimeOrchestrationStore.executionRuns` | 最近一次 executionRun status = `failed` | warning | `job:failed:{jobId}` |
| `schedule_job` | `TimeOrchestrationStore.scheduleJobs` | job 的 `nextRunAt` 严重滞后（说明持续未执行） | critical | `job:stale:{jobId}` |
| `workflow_run` | `WorkflowStreamEvent` | run status = `failed` | warning | `workflow:failed:{runId}` |
| `workflow_run` | `WorkflowStreamEvent` | run 状态为 `interrupt-requested` 等待人工输入 | info | `workflow:waiting:{runId}` |
| `background_task` | `ChatSession.backgroundTask` | background task 终态为 `failed` 或长时间无进展 | warning | `bg:failed:{sessionId}` |
| `session_stuck` | `RuntimeContext.state.activeSessionRuns` | 会话运行超过 30 分钟无响应 | warning | `stuck:{sessionId}` |
| `approval_pending` | `RuntimeContext.state.approvalRequests` | 有超过 10 分钟未处理的审批 | info | `approval:{approvalId}` |
| `system_health` | 内部自检 | sql.js 数据库连接异常、MCP server 断连 | critical | `health:{checkType}` |

### 5.2 Signal 生命周期

借鉴 PagerDuty 的事件模型，扩展原有设计：

```
trigger (新 signal 产生)
  → active (活跃中，等待处理)
    → acknowledged (用户已看到，尚未处理)
      → resolved (问题已解决，自动或手动)
    → dismissed (用户选择忽略，进入冷却)
    → suppressed (系统级抑制：冷却期内/静默时段)
```

### 5.3 自动解决

部分 signal 可以在后续 tick 中自动标记为 resolved：
- `agent_task` failed → 重新 retry 成功后自动 resolve
- `schedule_job` failed → 下次执行成功后自动 resolve
- `approval_pending` → 审批被处理后自动 resolve
- `session_stuck` → 会话恢复正常后自动 resolve

---

## 六、IPC 接口

新增 IPC 模块 `desktop/src/main/ipc/awareness.ts`，遵循现有 `registerXxxHandlers(ctx)` 模式。

### 6.1 IPC Channels

```ts
// Routine 管理
"awareness:list-routines"
"awareness:create-routine"
"awareness:update-routine"
"awareness:pause-routine"
"awareness:resume-routine"
"awareness:delete-routine"
"awareness:run-routine-now"      // 手动触发一次
"awareness:preview-routine"       // 试跑预览，不写副作用

// Signal 管理
"awareness:list-signals"
"awareness:get-snapshot"          // 返回 AwarenessSnapshot
"awareness:dismiss-signal"
"awareness:acknowledge-signal"

// Standing Order 管理
"standing-order:list"
"standing-order:create"
"standing-order:update"
"standing-order:delete"

// Long Run Ledger
"long-run:list"
"long-run:detail"
"long-run:cancel"
"long-run:retry"
```

### 6.2 推送事件

在现有 `EventType` 枚举中新增：

```ts
// events.ts 新增
| "AwarenessChanged"
| "LongRunChanged"
| "StandingOrderChanged"
| "AwarenessActionRequiresApproval"
```

通过现有 `broadcastToRenderers("session:stream", ...)` 推送到 renderer。

### 6.3 Preload 桥接

在 `desktop/src/preload/index.ts` 的 `window.myClawAPI` 中新增：

```ts
awareness: {
  listRoutines: () => ipcInvoke("awareness:list-routines"),
  createRoutine: (input) => ipcInvoke("awareness:create-routine", input),
  updateRoutine: (id, patch) => ipcInvoke("awareness:update-routine", id, patch),
  pauseRoutine: (id) => ipcInvoke("awareness:pause-routine", id),
  resumeRoutine: (id) => ipcInvoke("awareness:resume-routine", id),
  deleteRoutine: (id) => ipcInvoke("awareness:delete-routine", id),
  runRoutineNow: (id) => ipcInvoke("awareness:run-routine-now", id),
  previewRoutine: (id) => ipcInvoke("awareness:preview-routine", id),
  listSignals: () => ipcInvoke("awareness:list-signals"),
  getSnapshot: () => ipcInvoke("awareness:get-snapshot"),
  dismissSignal: (id) => ipcInvoke("awareness:dismiss-signal", id),
  acknowledgeSignal: (id) => ipcInvoke("awareness:acknowledge-signal", id),
  onAwarenessChanged: (cb) => ipcOn("session:stream", filterCb(cb, "AwarenessChanged")),
},
standingOrders: {
  list: () => ipcInvoke("standing-order:list"),
  create: (input) => ipcInvoke("standing-order:create", input),
  update: (id, patch) => ipcInvoke("standing-order:update", id, patch),
  delete: (id) => ipcInvoke("standing-order:delete", id),
},
longRun: {
  list: (query?) => ipcInvoke("long-run:list", query),
  detail: (id) => ipcInvoke("long-run:detail", id),
  cancel: (id) => ipcInvoke("long-run:cancel", id),
  retry: (id) => ipcInvoke("long-run:retry", id),
},
```

---

## 七、Renderer UI 设计

### 7.1 Store 扩展

在 `workspace.ts` 的 `WorkspaceTimeState` 中新增：

```ts
type WorkspaceTimeState = {
  // ... 现有字段 ...
  awarenessSnapshot: AwarenessSnapshot | null;
};
```

新增 actions：
- `loadAwarenessSnapshot()` — 调用 IPC 获取
- `createAwarenessRoutine()` / `updateAwarenessRoutine()` / `deleteAwarenessRoutine()`
- `pauseAwarenessRoutine()` / `resumeAwarenessRoutine()` / `runRoutineNow()`
- `dismissSignal()` / `acknowledgeSignal()`
- `createStandingOrder()` / `updateStandingOrder()` / `deleteStandingOrder()`
- `loadLongRunRecords()`

Bootstrap 时自动订阅 `onAwarenessChanged` 事件。

### 7.2 Today 页面 Catch-up 区域

在 TimeCenterPage 的 Today 视图中新增"值守 Catch-up"区域，位于 timeline 上方：

```
┌─────────────────────────────────────────────┐
│ 值守 Catch-up (3)                           │
├─────────────────────────────────────────────┤
│ ● schedule_job 失败    每日数据同步 2h ago   │  ← .list-row
│ ● agent_task 等待      周报整理    45m ago   │  ← .list-row
│ ○ workflow 等待输入    审批流程    刚刚      │  ← .list-row (acknowledged)
└─────────────────────────────────────────────┘
```

UI 规范（遵循 `ui-style-guide.md`）：
- 容器使用 `.glass-card`，圆角 `var(--radius-xl)` (14px)
- 每行使用 `.list-row`，左侧用 `.status-dot` 表示严重度
- 行动按钮使用 `.btn-premium`（描边风格）
- 点击展开 drawer 显示详细 signal 信息

### 7.3 AgentTeamDock 值守状态

在 AgentTeamDock 的员工列表中，为每个硅基员工显示值守状态：

```
┌──────────────────────────┐
│ 员工列表                  │
├──────────────────────────┤
│ 🟢 张三  值守中  上次: 5m ago   │  ← .status-dot(--status-green)
│ 🟡 李四  1个待处理         │  ← .status-dot(--status-yellow)
│ ⚪ 王五  值守已暂停        │  ← .status-dot(灰色)
└──────────────────────────┘
```

- 复用现有 `SiliconPersonStatus` 的 status-dot 模式
- 值守状态从 `AwarenessSnapshot.activeSignals` 中按 scope 过滤
- Badge 数字 = 该员工 scope 下 `status = "active"` 的 signal 数量

### 7.4 硅基员工工作台 — 值守 Tab

在 `SiliconPersonWorkspacePage` 新增"值守"tab：

- **Routine 列表**：该员工的 routine，使用 `.list-rows` + `.list-row`
- **配置表单**：新建/编辑 routine 的 drawer，包含：
  - purpose（值守目的）
  - cadenceMinutes（频率）
  - signalSources（观察哪些信号源）
  - decisionPolicy（模型调用策略）
  - actionPolicy（可执行动作）
  - standingOrderIds（绑定的 Standing Order）
- **试跑按钮**：调用 `previewRoutine`，展示：
  - 会读取哪些信号源
  - 当前有多少活跃 signal
  - 是否会调用模型
  - 可能触发的动作及风险等级
  - **不写入任何副作用数据**
- **执行历史**：该员工 scope 下的 LongRunRecord 列表

### 7.5 TimeCenter — Routine 管理

TimeCenterPage 的 jobs 视图中，增加"值守 Routines"分区：

- 与 ScheduleJob 列表平级，通过 PlanningViewSwitcher 切换
- 文案明确说明："Routine 是周期性感知，不是精确定时。它检查有没有需要关注的变化，而非到点执行某个任务。"
- 支持 pause / resume / delete / run-now 操作

### 7.6 主聊天

- **不自动插入 OK heartbeat** — 这是核心原则
- 只有用户需要介入时出现摘要卡片（使用现有的 `CapabilityTraceTimeline` 或类似组件）
- 用户可点击卡片查看审计详情
- 值守相关的 model 调用在 `ChatRunPhase` 中标记为 `awareness`，便于区分

### 7.7 设置页

新增"值守"设置区域：

- 全局值守预算（`maxModelCallsPerDay`）
- 默认权限策略
- Standing Orders 管理列表
- 全局静默时段（复用现有 `AvailabilityPolicy` 编辑器）

---

## 八、安全与权限边界

### 8.1 Standing Order 约束

Standing Order 不能扩大权限，只能收窄或组合已有权限。

**默认禁止的动作**：
- 自动发邮件或外部消息
- 自动写文件
- 自动改日历
- 自动创建长期自动化
- 员工间隐式 handoff
- 无限递归触发 routine
- Heartbeat 修改审批策略
- 静默创建 Standing Order

**默认允许的动作**：
- 读取 MyClaw 内部状态
- 写 receipt / ledger / audit event
- 标记内部 signal 为 dismissed / suppressed
- 对已存在 background task 做 poll

### 8.2 可解释性

用户必须能看到：
- routine 为什么运行（purpose 字段）
- routine 读取了什么（signal sources）
- routine 为什么提醒（decision.reason）
- routine 为什么没有执行某个动作（policyDecisionReason）
- 哪条 Standing Order 授权了它（audit event 的 standingOrderId）
- 哪个审批策略阻止了它（audit event 的 approvalStatus）

---

## 九、实现改造范围

### 9.1 新增文件

| 文件 | 说明 |
|------|------|
| `shared/contracts/awareness.ts` | 契约类型定义 |
| `src/main/services/awareness-runtime.ts` | AwarenessRuntimeService |
| `src/main/services/awareness-routine.ts` | AwarenessRoutineService |
| `src/main/services/awareness-signal-collector.ts` | Signal 收集器 |
| `src/main/services/awareness-decision-engine.ts` | 模型决策引擎 |
| `src/main/services/standing-order-service.ts` | Standing Order 服务 |
| `src/main/services/long-run-ledger.ts` | 长时运行账本 |
| `src/main/ipc/awareness.ts` | IPC 注册 |

### 9.2 修改文件

| 文件 | 改动 |
|------|------|
| `shared/contracts/index.ts` | 新增 `export * from "./awareness"` |
| `shared/contracts/events.ts` | EventType 新增 4 个事件类型 |
| `src/main/services/runtime-context.ts` | RuntimeContext 新增 awareness 相关 state/services |
| `src/main/services/time-scheduler.ts` | tick() 末尾调用 `awarenessRuntime.tick()` |
| `src/main/services/time-orchestration-store.ts` | 新增 5 张表的建表/CRUD 方法 |
| `src/main/ipc/index.ts` | 注册 `registerAwarenessHandlers` |
| `src/main/index.ts` | buildRuntimeContext 中创建 awareness 服务 |
| `src/preload/index.ts` | 新增 awareness / standingOrders / longRun API |
| `src/renderer/stores/workspace.ts` | 新增 awareness state 和 actions |
| `src/renderer/pages/TimeCenterPage.tsx` | 新增 Routine 管理和 Catch-up 区域 |
| `src/renderer/components/AgentTeamDock.tsx` | 新增值守状态 badge |
| `src/renderer/router/index.tsx` | 可能新增路由（如有独立页面） |

### 9.3 现有系统改造

**必要重构**（遵循文档要求，把散落的逻辑抽成 service）：

- `agent-tasks.ts` 中的任务创建/更新/入队/取消/重试 → 抽成 `AgentTaskService`，IPC 只做代理
- `sessions.ts` 中 background task poll/cancel/persist → 抽成 `SessionBackgroundTaskService`
- workflow checkpointer → 提升为 runtime service
- 这些重构不仅为 Heartbeat 服务，也让现有代码更可维护

---

## 十、测试计划

### 10.1 契约测试

- `AwarenessRoutine`、`StandingOrder`、`LongRunRecord` 能序列化和反序列化
- 旧 schedule job、旧 session、旧 agent task 数据正常加载
- unknown optional fields 不破坏兼容性
- 工厂函数返回合法默认值

### 10.2 服务测试

- `AwarenessSignalCollector` 能从 agent task / workflow / background task / schedule job 聚合信号
- fingerprint 冷却生效
- 静默时段生效（非 critical signal 被抑制）
- routine 连续失败后暂停
- 模型预算超限后暂停
- `AwarenessDecisionEngine` 返回结构化 decision
- `StandingOrderService` 正确匹配 routine
- awareness tick 异常不影响 scheduler 后续 tick

### 10.3 集成测试

- background task 完成后进入 ledger
- failed schedule job 触发 awareness signal
- waiting_user AgentTask 触发员工 badge
- workflow waiting-input 触发可恢复 signal
- Standing Order 允许内部 AgentTask 创建，但拒绝外部写入

### 10.4 IPC 测试

- routine CRUD
- Standing Order CRUD
- preview routine 不产生副作用
- run-now 产生 ledger 和 audit

### 10.5 回归测试

- 主聊天不会被 OK heartbeat 污染
- cron 和 reminder 仍按原逻辑运行
- approval 仍由原审批链裁决
- renderer 断开不影响 runtime tick
- 关机/休眠后恢复时正确处理"错过了"的情况

---

## 十一、工程分批建议

正式对用户开放必须等完整闭环完成，但工程可分 4 批实现：

### Batch 1 — 数据层 + Runtime 骨架
- `awareness.ts` 契约文件
- `time-orchestration-store.ts` 新增 5 张表
- `AwarenessRuntimeService` 基本 tick 循环
- `AwarenessSignalCollector` 确定性信号收集
- `LongRunLedgerService` 基础写入
- TimeScheduler.tick() 集成
- IPC: `awareness:get-snapshot`、`long-run:list`

### Batch 2 — Routine + Standing Order 管理
- `AwarenessRoutineService` 执行逻辑
- `StandingOrderService` CRUD + 匹配
- `AwarenessDecisionEngine` 模型调用
- IPC 全套 CRUD
- Preload 桥接
- Store 扩展

### Batch 3 — 策略引擎 + 审批
- cooldown / quiet hours / 预算 / 防递归
- 与现有 ApprovalPolicy 管道集成
- preview-routine 试跑
- 审计事件写入

### Batch 4 — UI 完整闭环
- TimeCenterPage Catch-up 区域
- AgentTeamDock 值守 badge
- 硅基员工值守 tab
- 设置页值守区域
- 主聊天摘要卡片
- 全面 UI 走查（对照 `ui-style-guide.md` checklist）
