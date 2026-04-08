import type { SiliconPersonStatus } from "./events";

export type SiliconPersonSource = "personal" | "enterprise" | "hub";

export const SILICON_PERSON_SOURCE_VALUES = [
  "personal",
  "enterprise",
  "hub",
] as const satisfies readonly SiliconPersonSource[];

export type SiliconPersonApprovalMode = "inherit" | "always_ask" | "auto_approve";

export const SILICON_PERSON_APPROVAL_MODE_VALUES = [
  "inherit",
  "always_ask",
  "auto_approve",
] as const satisfies readonly SiliconPersonApprovalMode[];

export type SiliconPersonSessionSummary = {
  id: string;
  title: string;
  status: SiliconPersonStatus;
  unreadCount: number;
  hasUnread: boolean;
  needsApproval: boolean;
  updatedAt: string;
};

export type SiliconPerson = {
  id: string;
  name: string;
  title: string;
  description: string;
  status: SiliconPersonStatus;
  source: SiliconPersonSource;
  approvalMode: SiliconPersonApprovalMode;
  currentSessionId: string | null;
  sessions: SiliconPersonSessionSummary[];
  unreadCount: number;
  hasUnread: boolean;
  needsApproval: boolean;
  workflowIds: string[];
  updatedAt: string;
};

/** 统一 currentSession 解析规则，避免多个层各自决定默认 session。 */
export function resolveSiliconPersonCurrentSessionId(input: {
  currentSessionId?: string | null;
  sessions: Array<{ id: string }>;
}): string | null {
  const { currentSessionId, sessions } = input;
  if (currentSessionId && sessions.some((session) => session.id === currentSessionId)) {
    return currentSessionId;
  }
  return sessions[0]?.id ?? null;
}
