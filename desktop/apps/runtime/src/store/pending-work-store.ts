export type PendingWorkStatus =
  | "ready"
  | "running"
  | "waiting"
  | "blocked"
  | "resolved"
  | "expired"
  | "escalated";

export type PendingWorkResumePolicy = {
  kind: "manual" | "time" | "event" | "heartbeat";
  value?: string;
};

export type PendingWorkItem = {
  id: string;
  employeeId: string;
  workflowId: string | null;
  title: string;
  status: PendingWorkStatus;
  dueAt: string | null;
  expiresAt?: string | null;
  attemptCount: number;
  maxAttempts: number;
  resumePolicy: PendingWorkResumePolicy;
  updatedAt: string;
};

export function sanitizePendingWorkItems(input: PendingWorkItem[] | undefined): PendingWorkItem[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((item): item is PendingWorkItem => {
    if (!item || typeof item !== "object") {
      return false;
    }

    return (
      typeof item.id === "string" &&
      typeof item.employeeId === "string" &&
      (item.workflowId === null || typeof item.workflowId === "string") &&
      typeof item.title === "string" &&
      typeof item.status === "string" &&
      (item.dueAt === null || typeof item.dueAt === "string") &&
      (item.expiresAt === undefined || item.expiresAt === null || typeof item.expiresAt === "string") &&
      typeof item.attemptCount === "number" &&
      typeof item.maxAttempts === "number" &&
      !!item.resumePolicy &&
      typeof item.resumePolicy === "object" &&
      typeof item.resumePolicy.kind === "string" &&
      (item.resumePolicy.value === undefined || typeof item.resumePolicy.value === "string") &&
      typeof item.updatedAt === "string"
    );
  });
}
