import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LocalEmployeeSummary, WorkflowDefinitionSummary } from "@myclaw-desktop/shared";

import type { EmployeePackageManifest, WorkflowPackageManifest } from "./hub-package-installer";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "draft";
}

export async function createPublishDraft(input:
  | {
      outputDir: string;
      kind: "employee-package";
      version: string;
      employee: LocalEmployeeSummary;
      workflows: WorkflowDefinitionSummary[];
      now?: string;
    }
  | {
      outputDir: string;
      kind: "workflow-package";
      version: string;
      workflow: WorkflowDefinitionSummary;
      now?: string;
    },
): Promise<{
  id: string;
  kind: "employee-package" | "workflow-package";
  sourceId: string;
  filePath: string;
  createdAt: string;
  manifest: EmployeePackageManifest | WorkflowPackageManifest;
}> {
  const createdAt = input.now ?? new Date().toISOString();
  const id = `publish-draft-${crypto.randomUUID()}`;

  const manifest =
    input.kind === "employee-package"
      ? ({
          kind: "employee-package",
          name: slugify(input.employee.name),
          version: input.version,
          description: input.employee.description,
          role: input.employee.name,
          ...(input.employee.workflowIds.length > 0
            ? { defaultWorkflowIds: [...input.employee.workflowIds] }
            : {}),
        } satisfies EmployeePackageManifest)
      : ({
          kind: "workflow-package",
          name: slugify(input.workflow.name),
          version: input.version,
          description: input.workflow.description,
          entryWorkflowId: input.workflow.id,
        } satisfies WorkflowPackageManifest);

  const sourceId = input.kind === "employee-package" ? input.employee.id : input.workflow.id;
  const filePath = join(input.outputDir, `${slugify(sourceId)}-${slugify(input.version)}.json`);
  const payload =
    input.kind === "employee-package"
      ? {
          id,
          kind: input.kind,
          sourceId,
          createdAt,
          manifest,
          source: {
            employee: {
              id: input.employee.id,
              name: input.employee.name,
              description: input.employee.description,
              workflowIds: [...input.employee.workflowIds],
            },
            workflows: input.workflows
              .filter((workflow) => input.employee.workflowIds.includes(workflow.id))
              .map((workflow) => ({
                id: workflow.id,
                name: workflow.name,
                description: workflow.description,
              })),
          },
        }
      : {
          id,
          kind: input.kind,
          sourceId,
          createdAt,
          manifest,
          source: {
            workflow: {
              id: input.workflow.id,
              name: input.workflow.name,
              description: input.workflow.description,
            },
          },
        };

  await mkdir(input.outputDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");

  return {
    id,
    kind: input.kind,
    sourceId,
    filePath,
    createdAt,
    manifest,
  };
}
