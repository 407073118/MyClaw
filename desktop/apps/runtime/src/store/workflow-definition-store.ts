import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

import type { WorkflowDefinition } from "@myclaw-desktop/shared";

import type { RuntimeLayout } from "../services/runtime-layout";
import type { WorkflowLibraryRootRecord } from "./workflow-library-root-store";

type WorkflowDefinitionLocationInput = {
  workflowId: string;
  libraryRootId: string;
  roots: WorkflowLibraryRootRecord[];
  layout: RuntimeLayout;
};

/** 判断是否开启工作流存储调试日志。 */
function isWorkflowStorageDebugEnabled(): boolean {
  return process.env.MYCLAW_RUNTIME_STORAGE_DEBUG === "1";
}

/** 统一输出工作流存储调试日志，默认关闭避免污染常规输出。 */
function logWorkflowStorage(message: string, payload: Record<string, unknown>): void {
  if (!isWorkflowStorageDebugEnabled()) {
    return;
  }
  console.info(message, payload);
}

/** 校验工作流定义结构，尽早在存储层暴露文件损坏或结构异常。 */
function assertValidWorkflowDefinition(definition: unknown): asserts definition is WorkflowDefinition {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new Error("Invalid workflow definition: expected an object payload.");
  }
  const candidate = definition as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.description !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.source !== "string" ||
    typeof candidate.updatedAt !== "string" ||
    typeof candidate.version !== "number" ||
    typeof candidate.nodeCount !== "number" ||
    typeof candidate.edgeCount !== "number" ||
    typeof candidate.libraryRootId !== "string" ||
    typeof candidate.entryNodeId !== "string" ||
    !Array.isArray(candidate.nodes) ||
    !Array.isArray(candidate.edges) ||
    !Array.isArray(candidate.stateSchema)
  ) {
    throw new Error("Invalid workflow definition: required workflow graph fields are missing.");
  }

  const nodes = candidate.nodes as unknown[];
  const edges = candidate.edges as unknown[];
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new Error("Invalid workflow definition: node payload must be an object.");
    }
    const nodeId = (node as Record<string, unknown>).id;
    if (typeof nodeId !== "string" || !nodeId.trim()) {
      throw new Error("Invalid workflow definition: node id is required.");
    }
    if (nodeIds.has(nodeId)) {
      throw new Error(`Invalid workflow definition: duplicate node id '${nodeId}'.`);
    }
    nodeIds.add(nodeId);
  }

  if (!nodeIds.has(candidate.entryNodeId)) {
    throw new Error("Invalid workflow definition: entryNodeId must reference an existing node.");
  }
  if (typeof candidate.libraryRootId !== "string" || !candidate.libraryRootId.trim()) {
    throw new Error("Invalid workflow definition: libraryRootId is required.");
  }
  if (candidate.nodeCount !== nodes.length) {
    throw new Error("Invalid workflow definition: nodeCount does not match nodes length.");
  }
  if (candidate.edgeCount !== edges.length) {
    throw new Error("Invalid workflow definition: edgeCount does not match edges length.");
  }

  for (const edge of edges) {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) {
      throw new Error("Invalid workflow definition: edge payload must be an object.");
    }
    const edgeRecord = edge as Record<string, unknown>;
    if (typeof edgeRecord.id !== "string" || !edgeRecord.id.trim()) {
      throw new Error("Invalid workflow definition: edge id is required.");
    }
    if (typeof edgeRecord.fromNodeId !== "string" || !nodeIds.has(edgeRecord.fromNodeId)) {
      throw new Error("Invalid workflow definition: edge.fromNodeId must reference an existing node.");
    }
    if (typeof edgeRecord.toNodeId !== "string" || !nodeIds.has(edgeRecord.toNodeId)) {
      throw new Error("Invalid workflow definition: edge.toNodeId must reference an existing node.");
    }
  }

  for (const stateField of candidate.stateSchema as unknown[]) {
    if (!stateField || typeof stateField !== "object" || Array.isArray(stateField)) {
      throw new Error("Invalid workflow definition: stateSchema element must be an object.");
    }
    const field = stateField as Record<string, unknown>;
    if (typeof field.key !== "string" || !field.key.trim()) {
      throw new Error("Invalid workflow definition: stateSchema.key is required.");
    }
    if (typeof field.label !== "string" || !field.label.trim()) {
      throw new Error("Invalid workflow definition: stateSchema.label is required.");
    }
    if (typeof field.valueType !== "string" || !field.valueType.trim()) {
      throw new Error("Invalid workflow definition: stateSchema.valueType is required.");
    }

    const producerNodeIds = field.producerNodeIds;
    if (Array.isArray(producerNodeIds) && producerNodeIds.some((nodeId) => typeof nodeId !== "string" || !nodeIds.has(nodeId))) {
      throw new Error("Invalid workflow definition: stateSchema.producerNodeIds must reference existing nodes.");
    }
    const consumerNodeIds = field.consumerNodeIds;
    if (Array.isArray(consumerNodeIds) && consumerNodeIds.some((nodeId) => typeof nodeId !== "string" || !nodeIds.has(nodeId))) {
      throw new Error("Invalid workflow definition: stateSchema.consumerNodeIds must reference existing nodes.");
    }
  }
}

/** 判断子路径是否被约束在基路径内，避免路径穿越。 */
function isPathInside(basePath: string, targetPath: string): boolean {
  const base = resolve(normalize(basePath));
  const target = resolve(normalize(targetPath));
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(":"));
}

/** 解析工作流定义文件所在路径。 */
export function resolveWorkflowDefinitionFilePath(
  workflowId: string,
  requestedLibraryRootId: string,
  roots: WorkflowLibraryRootRecord[],
  layout: RuntimeLayout,
): string {
  const root =
    requestedLibraryRootId === "personal"
      ? roots.find((item) => item.id === "personal" && item.kind === "personal") ?? null
      : roots.find((item) => item.id === requestedLibraryRootId) ?? null;

  if (!root) {
    const knownRoots = roots.map((item) => item.id);
    throw new Error(
      `Unknown workflow library root '${requestedLibraryRootId}' for workflow '${workflowId}'. Known roots: ${knownRoots.join(", ") || "none"}.`,
    );
  }

  if (!root.path.trim()) {
    throw new Error(
      `Invalid workflow library root '${root.id}' for workflow '${workflowId}': empty root path.`,
    );
  }
  if (root.kind === "mounted" && !isAbsolute(root.path)) {
    throw new Error(
      `Invalid workflow definition path for workflow '${workflowId}': mounted root '${root.id}' must use an absolute path.`,
    );
  }

  const resolvedPath = join(root.path, workflowId, "definition.json");
  if (!isPathInside(root.path, resolvedPath)) {
    throw new Error(
      `Invalid workflow definition path for workflow '${workflowId}': resolved path escapes root '${root.id}'.`,
    );
  }

  if (root.kind === "personal" && !isPathInside(layout.workflowRootsDir, root.path)) {
    throw new Error(
      `Invalid workflow definition path for workflow '${workflowId}': personal root must stay under runtime workflow roots directory.`,
    );
  }

  logWorkflowStorage("[workflow-definition-store] 解析工作流定义路径", {
      workflowId,
      libraryRootId: root.id,
      resolvedPath,
    });
  return resolvedPath;
}

/** 将完整工作流定义持久化到 definition.json。 */
export async function saveWorkflowDefinition(input: {
  definition: WorkflowDefinition;
  roots: WorkflowLibraryRootRecord[];
  layout: RuntimeLayout;
}): Promise<string> {
  const filePath = resolveWorkflowDefinitionFilePath(
    input.definition.id,
    input.definition.libraryRootId,
    input.roots,
    input.layout,
  );
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(input.definition, null, 2), "utf8");
  logWorkflowStorage("[workflow-definition-store] 工作流定义写入完成", {
    workflowId: input.definition.id,
    filePath,
  });
  return filePath;
}

/** 从 definition.json 读取并解析完整工作流定义。 */
export async function loadWorkflowDefinition(input: WorkflowDefinitionLocationInput): Promise<WorkflowDefinition> {
  const filePath = resolveWorkflowDefinitionFilePath(
    input.workflowId,
    input.libraryRootId,
    input.roots,
    input.layout,
  );
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  assertValidWorkflowDefinition(parsed);
  logWorkflowStorage("[workflow-definition-store] 工作流定义读取完成", {
    workflowId: input.workflowId,
    filePath,
  });
  return parsed;
}
