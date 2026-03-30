import type { MemoryRecord } from "../store/memory-store";
import type { PendingWorkItem, PendingWorkResumePolicy } from "../store/pending-work-store";
import { createMemoryRecord, type MemoryWriteInput } from "./memory-writer";
import { createPendingWorkItem } from "./pending-work-manager";

export type EmployeeRunRequest = {
  employeeId: string;
  workflowId: string | null;
  summary: string;
  memory?: Omit<MemoryWriteInput, "employeeId" | "now">;
  pendingWork?: {
    title: string;
    dueAt: string | null;
    expiresAt?: string | null;
    maxAttempts: number;
    resumePolicy: PendingWorkResumePolicy;
  };
  now?: string;
};

export type EmployeeRunResult = {
  run: {
    id: string;
    employeeId: string;
    workflowId: string | null;
    summary: string;
    createdAt: string;
  };
  memoryRecord: MemoryRecord | null;
  pendingWork: PendingWorkItem | null;
};

export function executeEmployeeRun(input: EmployeeRunRequest): EmployeeRunResult {
  const createdAt = input.now ?? new Date().toISOString();
  const memoryRecord = input.memory
    ? createMemoryRecord({
        employeeId: input.employeeId,
        now: createdAt,
        ...input.memory,
      })
    : null;
  const pendingWork = input.pendingWork
    ? createPendingWorkItem({
        employeeId: input.employeeId,
        workflowId: input.workflowId,
        title: input.pendingWork.title,
        dueAt: input.pendingWork.dueAt,
        expiresAt: input.pendingWork.expiresAt ?? null,
        maxAttempts: input.pendingWork.maxAttempts,
        resumePolicy: input.pendingWork.resumePolicy,
        now: createdAt,
      })
    : null;

  return {
    run: {
      id: `run-${crypto.randomUUID()}`,
      employeeId: input.employeeId,
      workflowId: input.workflowId,
      summary: input.summary,
      createdAt,
    },
    memoryRecord,
    pendingWork,
  };
}
