import type { WorkflowDefinitionSummary } from "@myclaw-desktop/shared";

import { resolveRuntimeLayout } from "../../services/runtime-layout";
import { sanitizeEmployees } from "../employee-store";
import { sanitizeMemoryRecords } from "../memory-store";
import { sanitizePendingWorkItems } from "../pending-work-store";
import { createSessionStore } from "../session-store";
import {
  createApprovalPolicy,
  createDefaultApprovalRequests,
  createDefaultMcpServerConfigs,
  createDefaultModelProfileId,
  createDefaultProfiles,
} from "../settings-store";
import { resolveWorkflowLibraryRoots } from "../workflow-library-root-store";
import { sanitizeWorkflows } from "../workflow-store";
import { toFiniteNumber } from "./runtime-state-shared-parsers";
import {
  sanitizeApprovalPolicy,
  sanitizeApprovalRequests,
  sanitizeBuiltinToolPreferences,
  sanitizeMcpServerConfigs,
  sanitizeMcpToolPreferences,
} from "./runtime-state-sanitizers";
import type { RuntimeState } from "./runtime-state-types";

/** 归一化工作流摘要字段，保证持久化字段完整有效。 */
export function normalizeWorkflowSummaryForPersistence(
  workflow: WorkflowDefinitionSummary,
): WorkflowDefinitionSummary {
  return {
    ...workflow,
    version: toFiniteNumber(workflow.version, 1),
    nodeCount: toFiniteNumber(workflow.nodeCount, 0),
    edgeCount: toFiniteNumber(workflow.edgeCount, 0),
    libraryRootId:
      typeof workflow.libraryRootId === "string" && workflow.libraryRootId.trim()
        ? workflow.libraryRootId
        : "personal",
  };
}

/** 构建默认 runtime-state，用于首次启动或状态文件缺失场景。 */
export function createDefaultRuntimeState(stateFilePath?: string): RuntimeState {
  const models = createDefaultProfiles();
  const defaultModelProfileId = createDefaultModelProfileId(models);
  const sessions = createSessionStore(defaultModelProfileId ?? "model-default").sessions;
  const layout = resolveRuntimeLayout(stateFilePath);
  const workflowLibraryRoots = resolveWorkflowLibraryRoots(undefined, layout);

  return {
    defaultModelProfileId,
    models,
    sessions,
    approvals: createApprovalPolicy(),
    mcpServerConfigs: createDefaultMcpServerConfigs(),
    mcpToolPreferences: [],
    builtinToolPreferences: [],
    approvalRequests: createDefaultApprovalRequests(sessions[0]?.id ?? "session-default"),
    employees: [],
    workflows: [],
    workflowLibraryRoots,
    memoryRecords: [],
    pendingWorkItems: [],
  };
}

/** 对输入状态做总清洗，输出满足运行时约束的 RuntimeState。 */
export function sanitizeRuntimeState(input: Partial<RuntimeState>, stateFilePath?: string): RuntimeState {
  const fallback = createDefaultRuntimeState(stateFilePath);
  const layout = resolveRuntimeLayout(stateFilePath);
  const models = Array.isArray(input.models) && input.models.length > 0 ? input.models : fallback.models;
  const defaultModelProfileId =
    typeof input.defaultModelProfileId === "string" &&
    models.some((profile) => profile.id === input.defaultModelProfileId)
      ? input.defaultModelProfileId
      : createDefaultModelProfileId(models);
  const sessions =
    Array.isArray(input.sessions) && input.sessions.length > 0
      ? input.sessions
      : createSessionStore(defaultModelProfileId ?? "model-default").sessions;
  const approvals = sanitizeApprovalPolicy(input.approvals, fallback.approvals);
  const mcpServerConfigs = sanitizeMcpServerConfigs(input.mcpServerConfigs, fallback.mcpServerConfigs);
  const mcpToolPreferences = sanitizeMcpToolPreferences(input.mcpToolPreferences, fallback.mcpToolPreferences);
  const builtinToolPreferences = sanitizeBuiltinToolPreferences(
    input.builtinToolPreferences,
    fallback.builtinToolPreferences,
  );
  const approvalRequests = sanitizeApprovalRequests(input.approvalRequests, fallback.approvalRequests);
  const employees = sanitizeEmployees(input.employees);
  const workflows = sanitizeWorkflows(input.workflows).map((workflow) =>
    normalizeWorkflowSummaryForPersistence(workflow),
  );
  const workflowLibraryRoots = resolveWorkflowLibraryRoots(input.workflowLibraryRoots, layout);
  const memoryRecords = sanitizeMemoryRecords(input.memoryRecords);
  const pendingWorkItems = sanitizePendingWorkItems(input.pendingWorkItems);

  return {
    models,
    defaultModelProfileId,
    sessions,
    approvals,
    mcpServerConfigs,
    mcpToolPreferences,
    builtinToolPreferences,
    approvalRequests,
    employees,
    workflows,
    workflowLibraryRoots,
    memoryRecords,
    pendingWorkItems,
  };
}
