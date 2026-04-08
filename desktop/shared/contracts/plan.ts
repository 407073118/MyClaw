/** 任务 id 需要跨多轮规划/持久化保持稳定，便于可靠追踪同一任务。 */
import type { WorkflowRunSummary } from "./workflow-run";

export type PlanTaskId = string;

export type PlanTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | (string & {});

export const PLAN_TASK_STATUS_VALUES = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
] as const satisfies readonly PlanTaskStatus[];

export type PlanModeWorkflowMode = "default" | "plan";

export const PLAN_MODE_WORKFLOW_MODE_VALUES = [
  "default",
  "plan",
] as const satisfies readonly PlanModeWorkflowMode[];

export type PlanModeStateValue =
  | "off"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "canceled"
  | "blocked";

export const PLAN_MODE_STATE_VALUES = [
  "off",
  "planning",
  "awaiting_approval",
  "executing",
  "completed",
  "canceled",
  "blocked",
] as const satisfies readonly PlanModeStateValue[];

export type PlanModeApprovalStatus =
  | "idle"
  | "pending"
  | "approved"
  | "rejected";

export const PLAN_MODE_APPROVAL_STATUS_VALUES = [
  "idle",
  "pending",
  "approved",
  "rejected",
] as const satisfies readonly PlanModeApprovalStatus[];

export type PlanStepKind =
  | "analysis"
  | "tool"
  | "verification"
  | "user_confirmation";

export const PLAN_STEP_KIND_VALUES = [
  "analysis",
  "tool",
  "verification",
  "user_confirmation",
] as const satisfies readonly PlanStepKind[];

export type PlanTask = {
  id: PlanTaskId;
  title: string;
  status: PlanTaskStatus;
  detail?: string;
  blocker?: string;
  kind?: PlanStepKind;
  lane?: string;
};

export type PlanState = {
  tasks: PlanTask[];
  updatedAt: string;
};

export type StructuredPlan = {
  goal: string;
  summary?: string;
  assumptions?: string[];
  openQuestions?: string[];
  steps: PlanTask[];
  acceptanceCriteria?: string[];
};

export type PlanWorkstreamStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked";

export type PlanWorkstream = {
  id: string;
  label: string;
  status: PlanWorkstreamStatus;
  stepIds: PlanTaskId[];
};

export type PlanModeState = {
  mode: PlanModeStateValue;
  workflowMode?: PlanModeWorkflowMode;
  approvalStatus: PlanModeApprovalStatus;
  planVersion: number;
  lastPlanMessageId?: string;
  summary?: string;
  goal?: string;
  approvedAt?: string;
  blockedReason?: string;
  structuredPlan?: StructuredPlan | null;
  currentTaskId?: PlanTaskId;
  currentTaskTitle?: string;
  currentTaskKind?: PlanStepKind;
  workstreams?: PlanWorkstream[];
  workflowRun?: WorkflowRunSummary | null;
};
