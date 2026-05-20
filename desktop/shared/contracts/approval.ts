import { ToolRiskCategory } from "./events";
import type { BuiltinToolApprovalMode } from "./builtin-tool";

export type ApprovalMode = "prompt" | "auto-read-only" | "auto-allow-all" | "unrestricted";
export type ApprovalDecision =
  | "deny"
  | "deny-persistent"
  | "allow-once"
  | "allow-session"
  | "allow-directory"
  | "always-allow-tool";
export type ApprovalRequestSource =
  | "builtin-tool"
  | "mcp-tool"
  | "skill"
  | "shell-command"
  | "network-request"
  | "external-path";

/** 工作区外路径访问的持久化授权。粒度仅到目录，不支持单文件持久授权。 */
export type PathGrants = {
  /** 允许访问的目录列表（及其子路径）。 */
  allowedDirs: string[];
  /** 永久拒绝的路径列表（及其子路径）。 */
  deniedPaths: string[];
};

export type ApprovalPolicy = {
  mode: ApprovalMode;
  autoApproveReadOnly: boolean;
  autoApproveSkills: boolean;
  alwaysAllowedTools: string[];
  /** 可选：工作区外路径授权（目录级持久 allow / 路径级持久 deny）。 */
  pathGrants?: PathGrants;
};

export type McpExecutionContext = {
  serverId?: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
};

/** 外部路径审批的附带元信息，渲染端审批卡片展示用。 */
export type ExternalPathMeta = {
  path: string;
  userPath: string;
  operation: "read" | "write" | "delete" | "exec";
  size?: number;
  isBinary?: boolean;
  /** 建议用户可以选择的目录授权粒度（通常是 dirname(path)）。 */
  suggestedDirectory?: string;
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
  pathMeta?: ExternalPathMeta;
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
    mode: "auto-read-only",
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
  isOutsideWorkspace?: boolean;
  toolApprovalMode?: BuiltinToolApprovalMode | null;
}): boolean {
  // Unrestricted mode: never ask, even for external paths
  if (input.policy.mode === "unrestricted") {
    return false;
  }

  // 工作区外访问始终保留显式审批，避免单工具 allow 绕过路径边界。
  if (input.isOutsideWorkspace === true) {
    return true;
  }

  // Auto-allow-all: workspace paths auto-approved; external paths need approval
  if (input.policy.mode === "auto-allow-all") {
    return false;
  }

  if (input.toolApprovalMode === "always-allow") {
    return false;
  }

  if (input.toolApprovalMode === "always-ask") {
    return true;
  }

  if (input.policy.alwaysAllowedTools.includes(input.toolId)) {
    return false;
  }

  // prompt 模式表示所有未单独放行的工具都需要审批，用于最保守的全询问策略。
  if (input.policy.mode === "prompt") {
    return true;
  }

  if (input.source === "skill" && input.policy.autoApproveSkills) {
    return false;
  }

  if (input.risk === ToolRiskCategory.Read && input.policy.autoApproveReadOnly) {
    return false;
  }

  return true;
}

/** Whether the given approval mode allows access to paths outside the workspace. */
export function allowsExternalPaths(mode: ApprovalMode): boolean {
  return mode === "unrestricted" || mode === "auto-allow-all";
}
