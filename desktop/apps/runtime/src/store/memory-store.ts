export type MemoryRecordKind = "profile" | "domain" | "entity" | "episodic-summary";

export type MemoryRecord = {
  id: string;
  employeeId: string;
  kind: MemoryRecordKind;
  subject: string;
  content: string;
  updatedAt: string;
};

export function sanitizeMemoryRecords(input: MemoryRecord[] | undefined): MemoryRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((item): item is MemoryRecord => {
    if (!item || typeof item !== "object") {
      return false;
    }

    return (
      typeof item.id === "string" &&
      typeof item.employeeId === "string" &&
      typeof item.kind === "string" &&
      typeof item.subject === "string" &&
      typeof item.content === "string" &&
      typeof item.updatedAt === "string"
    );
  });
}
