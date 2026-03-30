import type { WorkflowDefinitionSummary } from "@myclaw-desktop/shared";

export function sanitizeWorkflows(input: WorkflowDefinitionSummary[] | undefined): WorkflowDefinitionSummary[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((item): item is WorkflowDefinitionSummary => {
    if (!item || typeof item !== "object") {
      return false;
    }

    return (
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.description === "string" &&
      typeof item.status === "string" &&
      typeof item.source === "string" &&
      typeof item.updatedAt === "string"
    );
  });
}
