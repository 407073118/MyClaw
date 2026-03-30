import { ToolRiskCategory } from "./events";

export type ApprovalMode = "prompt" | "auto-read-only" | "auto-allow-all";
export type ApprovalDecision = "deny" | "allow-once" | "allow-session" | "always-allow-tool";
export type ApprovalRequestSource =
  | "builtin-tool"
  | "mcp-tool"
  | "skill"
  | "shell-command"
  | "network-request";

export type ApprovalPolicy = {
  mode: ApprovalMode;
  autoApproveReadOnly: boolean;
  autoApproveSkills: boolean;
  alwaysAllowedTools: string[];
};

export type McpExecutionContext = {
  serverId?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
};

export type ApprovalRequest = {
  id: string;
  sessionId: string;
  source: ApprovalRequestSource;
  toolId: string;
  label: string;
  risk: ToolRiskCategory;
  detail: string;
  resumeConversation?: boolean;
} & McpExecutionContext;

export type ExecutionIntent = {
  source: ApprovalRequestSource;
  toolId: string;
  label: string;
  risk: ToolRiskCategory;
  detail: string;
} & McpExecutionContext;

export type ExecutionIntentResult = {
  status: "auto-approved" | "pending";
  approvalRequest: ApprovalRequest | null;
  message: string;
};

export function createDefaultApprovalPolicy(): ApprovalPolicy {
  return {
    mode: "prompt",
    autoApproveReadOnly: true,
    autoApproveSkills: true,
    alwaysAllowedTools: [],
  };
}

export function shouldRequestApproval(input: {
  policy: ApprovalPolicy;
  source: ApprovalRequestSource;
  toolId: string;
  risk: ToolRiskCategory;
}): boolean {
  if (input.policy.mode === "auto-allow-all") {
    return false;
  }

  if (input.policy.alwaysAllowedTools.includes(input.toolId)) {
    return false;
  }

  if (input.source === "skill" && input.policy.autoApproveSkills) {
    return false;
  }

  if (input.risk === ToolRiskCategory.Read && input.policy.autoApproveReadOnly) {
    return false;
  }

  return true;
}
