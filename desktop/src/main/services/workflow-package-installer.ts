import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import JSZip from "jszip";

import type { WorkflowDefinition, WorkflowSummary } from "@shared/contracts";

export type WorkflowPackageManifestLike = {
  kind: "workflow-package";
  name?: string;
  version?: string;
  description?: string;
  entryWorkflowId?: string;
};

export type ResolveWorkflowPackageInput = {
  name?: string;
  summary?: string;
  downloadUrl: string;
  manifest: WorkflowPackageManifestLike;
};

/** 判断未知值是否为普通对象，供后续 workflow JSON 解析复用。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 判断 JSON 对象是否已经是完整 WorkflowDefinition。 */
function isWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && Array.isArray(value.nodes)
    && Array.isArray(value.edges)
    && Array.isArray(value.stateSchema);
}

/** 从常见工作流包 JSON 形状中挑出入口工作流定义。 */
function pickWorkflowDefinitionFromJson(payload: unknown, entryWorkflowId?: string): WorkflowDefinition | null {
  if (isWorkflowDefinition(payload)) return payload;
  if (!isRecord(payload)) return null;

  const directCandidates = [payload.workflow, payload.definition, payload.entryWorkflow];
  for (const candidate of directCandidates) {
    if (isWorkflowDefinition(candidate)) return candidate;
  }

  const workflows = Array.isArray(payload.workflows) ? payload.workflows : [];
  const matched = workflows.find((candidate) =>
    isWorkflowDefinition(candidate) && (!entryWorkflowId || candidate.id === entryWorkflowId),
  );
  if (isWorkflowDefinition(matched)) return matched;

  const first = workflows.find(isWorkflowDefinition);
  return first ?? null;
}

/** 下载 workflow package artifact；file:// 主要服务本地测试和离线导入。 */
async function downloadWorkflowPackageBytes(downloadUrl: string): Promise<Buffer> {
  if (!downloadUrl.trim()) {
    throw new Error("workflow_package_download_url_required");
  }
  console.info("[workflow-package-installer] 开始下载 workflow package artifact", { downloadUrl });
  if (downloadUrl.startsWith("file://")) {
    return readFile(new URL(downloadUrl));
  }
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Workflow package download failed: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** 先按 JSON 解析 artifact，失败后再按 zip 包解析。 */
async function parseWorkflowDefinitionFromArtifact(
  bytes: Buffer,
  manifest: WorkflowPackageManifestLike,
): Promise<WorkflowDefinition> {
  const asText = bytes.toString("utf8").trim();
  if (asText.startsWith("{") || asText.startsWith("[")) {
    const parsed = JSON.parse(asText);
    const definition = pickWorkflowDefinitionFromJson(parsed, manifest.entryWorkflowId);
    if (definition) return definition;
    throw new Error("workflow_package_artifact_missing_workflow_definition");
  }

  const zip = await JSZip.loadAsync(bytes);
  const jsonEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".json"))
    .sort((left, right) => {
      const leftScore = left.name === "workflow.json" ? 0 : left.name.includes(manifest.entryWorkflowId ?? "\0") ? 1 : 2;
      const rightScore = right.name === "workflow.json" ? 0 : right.name.includes(manifest.entryWorkflowId ?? "\0") ? 1 : 2;
      return leftScore - rightScore || left.name.localeCompare(right.name);
    });

  for (const entry of jsonEntries) {
    try {
      const parsed = JSON.parse(await entry.async("string"));
      const definition = pickWorkflowDefinitionFromJson(parsed, manifest.entryWorkflowId);
      if (definition) {
        console.info("[workflow-package-installer] 已从 artifact JSON 条目解析工作流", {
          entryName: entry.name,
          workflowId: definition.id,
        });
        return definition;
      }
    } catch (error) {
      console.warn("[workflow-package-installer] 跳过无法解析的 workflow JSON 条目", {
        entryName: entry.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new Error("workflow_package_artifact_missing_workflow_definition");
}

/** 用 artifact 中的真实工作流定义生成本地导入定义，避免空 workflow 假安装。 */
export async function resolveWorkflowPackageDefinition(
  input: ResolveWorkflowPackageInput,
): Promise<{ workflow: WorkflowSummary; definition: WorkflowDefinition }> {
  if (input.manifest.kind !== "workflow-package") {
    throw new Error("Cloud manifest is not a workflow package.");
  }
  const bytes = await downloadWorkflowPackageBytes(input.downloadUrl);
  const rawDefinition = await parseWorkflowDefinitionFromArtifact(bytes, input.manifest);
  const now = new Date().toISOString();
  const workflowId = `workflow-${randomUUID()}`;
  const workflow: WorkflowSummary = {
    id: workflowId,
    name: (input.name ?? input.manifest.name ?? rawDefinition.name).trim() || rawDefinition.name,
    description: input.manifest.description ?? input.summary ?? rawDefinition.description ?? rawDefinition.name,
    status: "draft",
    source: "hub",
    updatedAt: now,
    version: Number.isFinite(rawDefinition.version) ? rawDefinition.version : 1,
    nodeCount: rawDefinition.nodes.length,
    edgeCount: rawDefinition.edges.length,
    libraryRootId: rawDefinition.libraryRootId ?? "",
  };
  const definition: WorkflowDefinition = {
    ...rawDefinition,
    ...workflow,
    entryNodeId: rawDefinition.entryNodeId ?? "",
    nodes: rawDefinition.nodes,
    edges: rawDefinition.edges,
    stateSchema: rawDefinition.stateSchema,
  };
  console.info("[workflow-package-installer] 已基于真实 artifact 生成本地工作流定义", {
    importedWorkflowId: workflowId,
    sourceWorkflowId: rawDefinition.id,
    nodeCount: workflow.nodeCount,
    edgeCount: workflow.edgeCount,
  });
  return { workflow, definition };
}
