import type { AvailabilityPolicy } from "./time-orchestration";

// ─── Scope ───

export type AwarenessScopeKind = "personal" | "silicon_person" | "workspace";

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

export type AwarenessSignalSeverity = "info" | "warning" | "critical";

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

// ─── Routine ───

export const AWARENESS_ROUTINE_STATUS_VALUES = [
  "enabled",
  "paused",
  "failed",
  "disabled",
] as const satisfies readonly AwarenessRoutineStatus[];

export type AwarenessRoutineStatus = "enabled" | "paused" | "failed" | "disabled";

export type AwarenessRoutine = {
  id: string;
  name: string;
  scope: AwarenessScope;
  purpose: string;
  cadenceMinutes: number;
  activeHours?: Array<{ weekday: number; start: string; end: string }>;
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

export type StandingOrderStatus = "active" | "paused" | "expired" | "revoked";

export const APPROVAL_GATE_VALUES = [
  "always",
  "risk_based",
  "never_for_low_risk",
] as const satisfies readonly ApprovalGate[];

export type ApprovalGate = "always" | "risk_based" | "never_for_low_risk";

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

export type AwarenessDecision = {
  routineId: string;
  notify: boolean;
  actions: AwarenessAction[];
  requiresApproval: boolean;
  reason: string;
  confidence: number;
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
  approvalStatus:
    | "auto_approved"
    | "pending"
    | "approved"
    | "rejected"
    | "not_required";
  detail: string;
  standingOrderId?: string;
  policyDecisionReason?: string;
};

// ─── Policy Sub-types ───

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

// ─── Snapshot ───

export type AwarenessSnapshot = {
  routines: AwarenessRoutine[];
  activeSignals: AwarenessSignal[];
  standingOrders: StandingOrder[];
  recentLedgerEntries: LongRunRecord[];
  pendingApprovals: number;
  failedRoutineCount: number;
};

// ─── Input Types ───

export type AwarenessRoutineCreateInput = {
  name: string;
  scope: AwarenessScope;
  purpose: string;
  cadenceMinutes?: number;
  activeHours?: Array<{ weekday: number; start: string; end: string }>;
  signalSources?: AwarenessSignalSourceKind[];
  decisionPolicy?: Partial<AwarenessDecisionPolicy>;
  actionPolicy?: Partial<AwarenessActionPolicy>;
  deliveryPolicy?: Partial<AwarenessDeliveryPolicy>;
  budgetPolicy?: Partial<AwarenessBudgetPolicy>;
  standingOrderIds?: string[];
};

export type AwarenessRoutineUpdateInput = Partial<AwarenessRoutineCreateInput> & {
  status?: AwarenessRoutineStatus;
};

export type StandingOrderCreateInput = {
  scope: AwarenessScope;
  name: string;
  intent: string;
  allowedSignals?: AwarenessSignalSourceKind[];
  allowedActions?: AwarenessActionKind[];
  approvalGate?: ApprovalGate;
  escalationPolicy?: Partial<AwarenessEscalationPolicy>;
  expiresAt?: string;
};

export type StandingOrderUpdateInput = Partial<StandingOrderCreateInput> & {
  status?: StandingOrderStatus;
};

// ─── Factory Functions ───

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

/** 判断当前时间是否在静默时段内 */
export function isInQuietHours(
  policy: AvailabilityPolicy | null,
  now: Date,
): boolean {
  if (!policy?.quietHours) return false;
  const qh = policy.quietHours;
  if (!qh.enabled) return false;
  const hour = now.getHours();
  const minute = now.getMinutes();
  const current = hour * 60 + minute;
  const [startH, startM] = (qh.start ?? "22:00").split(":").map(Number);
  const [endH, endM] = (qh.end ?? "08:00").split(":").map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  if (start <= end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}
