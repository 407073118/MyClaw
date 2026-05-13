import type { ApprovalStatus } from "../core/approval-store.js";
import type { HeartbeatState } from "../core/heartbeat-state.js";
import type { EmployeeProfile, EmployeeProfileStatus } from "../core/profile-store.js";
import type { EmployeeTaskStatus } from "../core/task-store.js";
import type { CapabilityId } from "../policy/policy-engine.js";

export type UiTargetKind = "runtime" | "employee" | "task" | "approval" | "run" | "file";

export type UiErrorView = {
  code: string;
  message: string;
  target?: {
    kind: UiTargetKind;
    id?: string;
    path?: string;
  };
  recoverable: boolean;
  suggestedAction?: string;
};

export type RuntimeSummaryView = {
  employees: number;
  running: number;
  waitingApproval: number;
  blocked: number;
  failed: number;
  queued: number;
  succeeded: number;
};

export type EmployeeListItemView = {
  employeeId: string;
  displayName: string;
  definitionId: string;
  templateName?: string;
  status: EmployeeProfileStatus | "unreadable";
  currentTaskId?: string;
  currentRunId?: string;
  lastBeatAt: string | null;
  tickCount: number;
  lastErrorMessage?: string;
  openTasks: number;
  waitingApprovals: number;
  blockedTasks: number;
  failedTasks: number;
  doctorStatus: "passed" | "failed" | "unknown";
};

export type QueueStreamItemView = {
  id: string;
  kind: "task" | "approval" | "run" | "schedule";
  employeeId: string;
  title: string;
  status: string;
  blocker?: string;
  updatedAt: string;
};

export type ActionRequiredItemView = {
  id: string;
  kind: "approval" | "blocked_task" | "failed_employee" | "stale_lock" | "malformed_record";
  employeeId?: string;
  taskId?: string;
  approvalId?: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "error";
  updatedAt?: string;
};

export type RuntimeDashboardView = {
  runtimeRoot: string;
  daemon: {
    status: string;
    pid: number;
    tickCount: number;
    updatedAt: string;
    lastErrorMessage?: string;
  };
  summary: RuntimeSummaryView;
  employees: EmployeeListItemView[];
  queueStream: QueueStreamItemView[];
  actionRequired: ActionRequiredItemView[];
  errors: UiErrorView[];
};

export type TaskListItemView = {
  id: string;
  title: string;
  status: EmployeeTaskStatus;
  attempt: number;
  requestedCapability?: CapabilityId;
  approvalId?: string;
  runId?: string;
  artifactPath?: string;
  reviewPath?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalListItemView = {
  id: string;
  taskId: string;
  capability: CapabilityId;
  reason: string;
  status: ApprovalStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type EmployeeDetailView = {
  profile: EmployeeProfile;
  heartbeat: HeartbeatState;
  counts: {
    openTasks: number;
    waitingApprovals: number;
    blockedTasks: number;
    failedTasks: number;
    schedules: number;
    memoryEvents: number;
  };
  tasks: TaskListItemView[];
  approvals: ApprovalListItemView[];
  doctor: {
    passed: boolean;
    staleLocks: number;
    malformedRecords: number;
    errors: string[];
  };
};

export type RunTimelineEventView = {
  eventId: string;
  type: string;
  taskId?: string;
  runId?: string;
  createdAt?: string;
  message?: string;
};

export type RunStepView = {
  stepId?: string;
  type?: string;
  status?: string;
  [key: string]: unknown;
};

export type RunEvidenceView = {
  path: string;
  readable: boolean;
  byteLength: number;
  summary?: string;
};

export type RunTimelineView = {
  runId: string;
  taskId: string;
  status: "succeeded" | "blocked" | "failed" | string;
  startedAt?: string;
  finishedAt?: string;
  executorMode?: string;
  blockedReason?: string;
  events: RunTimelineEventView[];
  steps: RunStepView[];
  evidence: RunEvidenceView[];
};

export type ArtifactReviewView = {
  employeeId: string;
  taskId: string;
  runId?: string;
  artifact: {
    path?: string;
    content: string;
  };
  review: {
    path?: string;
    content: string;
  };
};
