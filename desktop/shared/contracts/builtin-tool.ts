import type { ToolRiskCategory } from "./events";

export const BUILTIN_TOOL_GROUPS = ["fs", "exec", "git", "process", "http", "archive", "task", "time", "web", "browser", "ppt"] as const;
export type BuiltinToolGroup = (typeof BUILTIN_TOOL_GROUPS)[number];

export const BUILTIN_TOOL_APPROVAL_MODES = ["inherit", "always-ask", "always-allow"] as const;
export type BuiltinToolApprovalMode = (typeof BUILTIN_TOOL_APPROVAL_MODES)[number];

export type BuiltinToolDefinition = {
  id: string;
  name: string;
  description: string;
  group: BuiltinToolGroup;
  risk: ToolRiskCategory;
  requiresAttachedDirectory: boolean;
  enabledByDefault: boolean;
  exposedByDefault: boolean;
  approvalMode: BuiltinToolApprovalMode;
};

export type BuiltinToolPreference = {
  toolId: string;
  enabled: boolean;
  exposedToModel: boolean;
  approvalModeOverride: BuiltinToolApprovalMode | null;
  updatedAt: string;
};

export type ResolvedBuiltinTool = {
  id: string;
  name: string;
  description: string;
  group: BuiltinToolGroup;
  risk: ToolRiskCategory;
  requiresAttachedDirectory: boolean;
  enabled: boolean;
  exposedToModel: boolean;
  effectiveApprovalMode: BuiltinToolApprovalMode;
};
