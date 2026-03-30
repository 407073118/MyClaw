import type { PendingWorkItem, PendingWorkResumePolicy } from "../store/pending-work-store";

export type PendingWorkDraft = {
  employeeId: string;
  workflowId: string | null;
  title: string;
  dueAt: string | null;
  expiresAt?: string | null;
  attemptCount?: number;
  maxAttempts: number;
  resumePolicy: PendingWorkResumePolicy;
  now?: string;
};

function resolveInitialStatus(input: Pick<PendingWorkDraft, "dueAt" | "resumePolicy">): PendingWorkItem["status"] {
  if (input.dueAt) {
    return "waiting";
  }

  if (input.resumePolicy.kind === "manual" || input.resumePolicy.kind === "event") {
    return "blocked";
  }

  return "ready";
}

export function createPendingWorkItem(input: PendingWorkDraft): PendingWorkItem {
  const updatedAt = input.now ?? new Date().toISOString();

  return {
    id: `pending-${crypto.randomUUID()}`,
    employeeId: input.employeeId,
    workflowId: input.workflowId,
    title: input.title,
    status: resolveInitialStatus(input),
    dueAt: input.dueAt,
    expiresAt: input.expiresAt ?? null,
    attemptCount: Math.max(0, Math.floor(input.attemptCount ?? 0)),
    maxAttempts: Math.max(1, Math.floor(input.maxAttempts)),
    resumePolicy: input.resumePolicy,
    updatedAt,
  };
}
