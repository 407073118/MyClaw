import type { LocalEmployeeSummary } from "@myclaw-desktop/shared";

export function sanitizeEmployees(input: LocalEmployeeSummary[] | undefined): LocalEmployeeSummary[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((item): item is LocalEmployeeSummary => {
    if (!item || typeof item !== "object") {
      return false;
    }

    return (
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.description === "string" &&
      typeof item.status === "string" &&
      typeof item.source === "string" &&
      Array.isArray(item.workflowIds) &&
      item.workflowIds.every((workflowId): workflowId is string => typeof workflowId === "string") &&
      typeof item.updatedAt === "string"
    );
  });
}
