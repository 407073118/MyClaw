import { readApprovalPolicyFromDatabase, readApprovalRequestsFromDatabase, writeApprovalPolicyToDatabase, writeApprovalRequestsToDatabase } from "./codecs/runtime-state-approval-codec";
import { readBuiltinToolPreferencesFromDatabase, writeBuiltinToolPreferencesToDatabase } from "./codecs/runtime-state-builtin-tool-codec";
import { readEmployeesFromDatabase, writeEmployeesToDatabase } from "./codecs/runtime-state-employee-codec";
import { readMcpServerConfigsFromDatabase, readMcpToolPreferencesFromDatabase, writeMcpServerConfigsToDatabase, writeMcpToolPreferencesToDatabase } from "./codecs/runtime-state-mcp-codec";
import {
  readDefaultModelProfileIdFromDatabase,
  readModelProfilesFromDatabase,
  writeDefaultModelProfileIdToDatabase,
  writeModelProfilesToDatabase,
} from "./codecs/runtime-state-model-codec";
import { readMemoryRecordsFromDatabase, writeMemoryRecordsToDatabase } from "./codecs/runtime-state-memory-codec";
import { readPendingWorkItemsFromDatabase, writePendingWorkItemsToDatabase } from "./codecs/runtime-state-pending-work-codec";
import { readSessionsFromDatabase, writeSessionsToDatabase } from "./codecs/runtime-state-session-codec";
import { readWorkflowLibraryRootsFromDatabase, writeWorkflowLibraryRootsToDatabase } from "./codecs/runtime-state-workflow-root-codec";
import { readWorkflowsFromDatabase, writeWorkflowsToDatabase } from "./codecs/runtime-state-workflow-codec";
import type { RuntimeState, SqlDatabase } from "./runtime-state-types";

const RUNTIME_STATE_TABLES = [
  "messages",
  "sessions",
  "model_profiles",
  "approval_requests",
  "approval_policy",
  "mcp_tool_preferences",
  "mcp_server_configs",
  "builtin_tool_preferences",
  "pending_work_items",
  "memory_records",
  "workflows",
  "workflow_library_roots",
  "employees",
  "app_state",
] as const;

/** 从数据库读取各域记录并拼装 RuntimeState 片段。 */
export function readRuntimeStateFromDatabase(db: SqlDatabase): Partial<RuntimeState> {
  return {
    defaultModelProfileId: readDefaultModelProfileIdFromDatabase(db),
    models: readModelProfilesFromDatabase(db),
    sessions: readSessionsFromDatabase(db),
    approvals: readApprovalPolicyFromDatabase(db),
    mcpServerConfigs: readMcpServerConfigsFromDatabase(db),
    mcpToolPreferences: readMcpToolPreferencesFromDatabase(db),
    builtinToolPreferences: readBuiltinToolPreferencesFromDatabase(db),
    approvalRequests: readApprovalRequestsFromDatabase(db),
    employees: readEmployeesFromDatabase(db),
    workflows: readWorkflowsFromDatabase(db),
    workflowLibraryRoots: readWorkflowLibraryRootsFromDatabase(db),
    memoryRecords: readMemoryRecordsFromDatabase(db),
    pendingWorkItems: readPendingWorkItemsFromDatabase(db),
  };
}

/** 将 RuntimeState 编码写入数据库（事务 + 全量覆盖语义）。 */
export function writeRuntimeStateToDatabase(db: SqlDatabase, state: RuntimeState): void {
  db.run("BEGIN");
  try {
    clearRuntimeStateTables(db);
    writeDefaultModelProfileIdToDatabase(db, state.defaultModelProfileId);
    writeModelProfilesToDatabase(db, state.models);
    writeSessionsToDatabase(db, state.sessions);
    writeApprovalPolicyToDatabase(db, state.approvals);
    writeMcpServerConfigsToDatabase(db, state.mcpServerConfigs);
    writeMcpToolPreferencesToDatabase(db, state.mcpToolPreferences);
    writeBuiltinToolPreferencesToDatabase(db, state.builtinToolPreferences);
    writeApprovalRequestsToDatabase(db, state.approvalRequests);
    writeEmployeesToDatabase(db, state.employees);
    writeWorkflowsToDatabase(db, state.workflows);
    writeWorkflowLibraryRootsToDatabase(db, state.workflowLibraryRoots ?? []);
    writeMemoryRecordsToDatabase(db, state.memoryRecords);
    writePendingWorkItemsToDatabase(db, state.pendingWorkItems);
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}

/** 清空 runtime-state 业务表，保证后续写入为覆盖模式。 */
function clearRuntimeStateTables(db: SqlDatabase): void {
  RUNTIME_STATE_TABLES.forEach((tableName) => {
    db.run(`DELETE FROM ${tableName}`);
  });
}
