import type { MemoryRecord } from "../store/memory-store";

export type MemoryWriteInput = {
  employeeId: string;
  kind: MemoryRecord["kind"];
  subject: string;
  content: string;
  now?: string;
};

export function createMemoryRecord(input: MemoryWriteInput): MemoryRecord {
  const updatedAt = input.now ?? new Date().toISOString();

  return {
    id: `memory-${crypto.randomUUID()}`,
    employeeId: input.employeeId,
    kind: input.kind,
    subject: input.subject,
    content: input.content,
    updatedAt,
  };
}
