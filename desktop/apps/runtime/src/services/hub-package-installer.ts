import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LocalEmployeeSummary, WorkflowDefinitionSummary } from "@myclaw-desktop/shared";

export type EmployeePackageManifest = {
  kind: "employee-package";
  name: string;
  version: string;
  description: string;
  role: string;
  defaultWorkflowIds?: string[];
};

export type WorkflowPackageManifest = {
  kind: "workflow-package";
  name: string;
  version: string;
  description: string;
  entryWorkflowId: string;
};

type PackageRecord<TManifest extends EmployeePackageManifest | WorkflowPackageManifest> = {
  id: string;
  itemId: string;
  releaseId: string;
  filePath: string;
  downloadUrl: string | null;
  installedAt: string;
  manifest: TManifest;
};

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "package";
}

export async function installHubEmployeePackage(input: {
  outputDir: string;
  itemId: string;
  releaseId: string;
  name: string;
  summary?: string;
  downloadUrl?: string;
  manifest: EmployeePackageManifest;
  now?: string;
}): Promise<{
  employee: LocalEmployeeSummary;
  packageRecord: PackageRecord<EmployeePackageManifest>;
}> {
  const installedAt = input.now ?? new Date().toISOString();
  const employee: LocalEmployeeSummary = {
    id: `employee-${crypto.randomUUID()}`,
    name: input.name.trim(),
    description: input.manifest.description || input.summary?.trim() || input.name.trim(),
    status: "draft",
    source: "hub",
    workflowIds: [...(input.manifest.defaultWorkflowIds ?? [])],
    updatedAt: installedAt,
  };

  const filePath = join(input.outputDir, `${slugify(input.itemId)}-${slugify(input.releaseId)}.json`);
  const packageRecord: PackageRecord<EmployeePackageManifest> = {
    id: `employee-package-${crypto.randomUUID()}`,
    itemId: input.itemId,
    releaseId: input.releaseId,
    filePath,
    downloadUrl: input.downloadUrl?.trim() || null,
    installedAt,
    manifest: input.manifest,
  };

  await mkdir(input.outputDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(packageRecord, null, 2), "utf8");

  return { employee, packageRecord };
}

export async function installHubWorkflowPackage(input: {
  outputDir: string;
  itemId: string;
  releaseId: string;
  name: string;
  summary?: string;
  downloadUrl?: string;
  manifest: WorkflowPackageManifest;
  now?: string;
}): Promise<{
  workflow: WorkflowDefinitionSummary;
  packageRecord: PackageRecord<WorkflowPackageManifest>;
}> {
  const installedAt = input.now ?? new Date().toISOString();
  const workflow: WorkflowDefinitionSummary = {
    id: `workflow-${crypto.randomUUID()}`,
    name: input.name.trim(),
    description: input.manifest.description || input.summary?.trim() || input.name.trim(),
    status: "draft",
    source: "hub",
    updatedAt: installedAt,
  };

  const filePath = join(input.outputDir, `${slugify(input.itemId)}-${slugify(input.releaseId)}.json`);
  const packageRecord: PackageRecord<WorkflowPackageManifest> = {
    id: `workflow-package-${crypto.randomUUID()}`,
    itemId: input.itemId,
    releaseId: input.releaseId,
    filePath,
    downloadUrl: input.downloadUrl?.trim() || null,
    installedAt,
    manifest: input.manifest,
  };

  await mkdir(input.outputDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(packageRecord, null, 2), "utf8");

  return { workflow, packageRecord };
}
