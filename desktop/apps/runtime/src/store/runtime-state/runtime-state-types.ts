import type initSqlJsType from "sql.js";
import type {
  ApprovalPolicy,
  ApprovalRequest,
  BuiltinToolPreference,
  ChatSession,
  McpServerConfig,
  McpToolPreference,
  ModelProfile,
} from "@myclaw-desktop/shared";
import type { LocalEmployeeSummary, WorkflowDefinitionSummary } from "@myclaw-desktop/shared";

import type { MemoryRecord } from "../memory-store";
import type { PendingWorkItem } from "../pending-work-store";
import type { WorkflowLibraryRootRecord } from "../workflow-library-root-store";

export type SqlJsRuntime = Awaited<ReturnType<typeof initSqlJsType>>;
export type SqlDatabase = InstanceType<SqlJsRuntime["Database"]>;
export type SqlRow = Record<string, number | string | Uint8Array | null>;

export type RuntimeState = {
  defaultModelProfileId: string | null;
  models: ModelProfile[];
  sessions: ChatSession[];
  approvals: ApprovalPolicy;
  mcpServerConfigs: McpServerConfig[];
  mcpToolPreferences: McpToolPreference[];
  builtinToolPreferences: BuiltinToolPreference[];
  approvalRequests: ApprovalRequest[];
  employees: LocalEmployeeSummary[];
  workflows: WorkflowDefinitionSummary[];
  workflowLibraryRoots?: WorkflowLibraryRootRecord[];
  memoryRecords: MemoryRecord[];
  pendingWorkItems: PendingWorkItem[];
};
