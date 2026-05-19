import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SiliconPerson, WorkflowDefinition, WorkflowSummary } from "@shared/contracts";

export type PublishDraftInput = {
  kind: "employee-package" | "workflow-package";
  sourceId: string;
  version: string;
};

export type PublishDraftRecord = {
  id: string;
  kind: PublishDraftInput["kind"];
  sourceId: string;
  status: "draft";
  filePath: string;
  manifest: {
    id: string;
    kind: "employee" | "workflow";
    name: string;
    version: string;
    sourceId: string;
    createdAt: string;
  };
  createdAt: string;
};

export type CreatePublishDraftContext = {
  artifactsDir: string;
  siliconPersons: SiliconPerson[];
  workflows: WorkflowSummary[];
  workflowDefinitions: Record<string, WorkflowDefinition>;
};

/** 校验并归一化发布草稿输入，避免 IPC 层把不完整数据写成 artifact。 */
function normalizeInput(input: Record<string, unknown>): PublishDraftInput {
  const kind = input.kind === "employee-package" || input.kind === "workflow-package"
    ? input.kind
    : null;
  const sourceId = typeof input.sourceId === "string" ? input.sourceId.trim() : "";
  const version = typeof input.version === "string" ? input.version.trim() : "";
  if (!kind) {
    throw new Error("发布草稿类型无效。");
  }
  if (!sourceId) {
    throw new Error("发布草稿缺少 sourceId。");
  }
  if (!version) {
    throw new Error("发布草稿缺少 version。");
  }
  return { kind, sourceId, version };
}

/** 清理文件名片段，避免 sourceId/version 中的特殊字符逃逸草稿目录。 */
function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "draft";
}

/** 生成本地发布草稿文件，确保返回的 draft 指向真实 artifact 内容。 */
export async function createLocalPublishDraft(
  rawInput: Record<string, unknown>,
  ctx: CreatePublishDraftContext,
): Promise<{ draft: PublishDraftRecord }> {
  const input = normalizeInput(rawInput);
  const createdAt = new Date().toISOString();
  const draftId = [
    input.kind,
    sanitizePathSegment(input.sourceId),
    sanitizePathSegment(input.version),
    Date.now().toString(36),
  ].join("-");
  const draftRoot = join(ctx.artifactsDir, "publish-drafts");
  await mkdir(draftRoot, { recursive: true });

  const sourceSnapshot = input.kind === "employee-package"
    ? ctx.siliconPersons.find((item) => item.id === input.sourceId) ?? null
    : ctx.workflowDefinitions[input.sourceId]
      ?? ctx.workflows.find((item) => item.id === input.sourceId)
      ?? null;

  if (!sourceSnapshot) {
    throw new Error(`未找到可发布来源：${input.sourceId}`);
  }

  const sourceName = "name" in sourceSnapshot && typeof sourceSnapshot.name === "string"
    ? sourceSnapshot.name
    : input.sourceId;
  const manifest = {
    id: draftId,
    kind: input.kind === "employee-package" ? "employee" as const : "workflow" as const,
    name: sourceName,
    version: input.version,
    sourceId: input.sourceId,
    createdAt,
  };
  const filePath = join(draftRoot, `${draftId}.json`);
  const draft: PublishDraftRecord = {
    id: draftId,
    kind: input.kind,
    sourceId: input.sourceId,
    status: "draft",
    filePath,
    manifest,
    createdAt,
  };

  const artifact = {
    draft,
    manifest,
    sourceSnapshot,
  };
  await writeFile(filePath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.info("[publish-draft] 已创建本地发布草稿 artifact", {
    draftId,
    kind: input.kind,
    sourceId: input.sourceId,
    filePath,
  });

  return { draft };
}
