import type {
  ApprovalPolicy,
  ExecutionIntent,
  ExecutionIntentResult,
} from "@myclaw-desktop/shared";
import { shouldRequestApproval } from "@myclaw-desktop/shared";

export function createExecutionIntentResult(input: {
  sessionId: string;
  policy: ApprovalPolicy;
  intent: ExecutionIntent;
}): ExecutionIntentResult {
  const { sessionId, policy, intent } = input;

  if (
    !shouldRequestApproval({
      policy,
      source: intent.source,
      toolId: intent.toolId,
      risk: intent.risk,
    })
  ) {
    return {
      status: "auto-approved",
      approvalRequest: null,
      message: createAutoApprovalMessage(intent),
    };
  }

  return {
    status: "pending",
    approvalRequest: {
      id: `approval-${crypto.randomUUID()}`,
      sessionId,
      source: intent.source,
      toolId: intent.toolId,
      label: intent.label,
      risk: intent.risk,
      detail: intent.detail,
      serverId: intent.serverId,
      toolName: intent.toolName,
      arguments: intent.arguments,
    },
    message: `等待你确认后再执行 ${intent.label}。`,
  };
}

function createAutoApprovalMessage(intent: ExecutionIntent): string {
  if (intent.source === "skill") {
    return `已自动允许 Skills 调用 ${intent.label}。`;
  }

  if (intent.risk === "read") {
    return `已自动允许只读操作 ${intent.label}。`;
  }

  return `已自动允许执行 ${intent.label}。`;
}
