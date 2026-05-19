import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";

import type {
  ArtifactKind,
  ArtifactLifecycle,
  ArtifactRecord,
  ArtifactRelation,
  ArtifactScopeRef,
} from "@shared/contracts";

import type { MyClawPaths } from "./directory-service";
import type { ArtifactManager } from "./artifact-manager";

export type RegisterGeneratedFileArtifactInput = {
  artifactManager: ArtifactManager;
  paths: MyClawPaths;
  cwd: string;
  sessionId: string;
  filePath: string;
  title?: string | null;
  kind?: ArtifactKind | null;
  lifecycle?: ArtifactLifecycle | null;
  metadata?: Record<string, unknown> | null;
  siliconPersonId?: string | null;
  sourceToolName?: string | null;
};

export type ArtifactRegisterToolContext = {
  artifactManager: ArtifactManager;
  paths: MyClawPaths;
  cwd: string;
  sessionId: string;
  siliconPersonId?: string | null;
  sourceToolName?: string | null;
};

export type ArtifactRegisterToolResult = {
  success: boolean;
  output: string;
  error?: string;
  artifact?: ArtifactRecord;
};

const ARTIFACT_KIND_VALUES: ArtifactKind[] = [
  "doc",
  "image",
  "code",
  "dataset",
  "archive",
  "log",
  "other",
];

const ARTIFACT_LIFECYCLE_VALUES: ArtifactLifecycle[] = [
  "working",
  "ready",
  "final",
  "superseded",
  "archived",
  "failed",
];

/** 规范化 Files 产物相对路径，始终相对当前配置的产物根目录。 */
function normalizeRelativePath(paths: MyClawPaths, absolutePath: string): string {
  if (isInsideBase(paths.artifactsDir, absolutePath)) {
    return relative(paths.artifactsDir, absolutePath).replace(/\\/g, "/");
  }
  return relative(paths.myClawDir, absolutePath).replace(/\\/g, "/");
}

/** 判断目标路径是否位于指定根目录内，避免外部路径被当作可直接打开的相对 artifact。 */
function isInsideBase(base: string, target: string): boolean {
  const normalizedBase = resolve(base).replace(/\\/g, "/").toLowerCase();
  const normalizedTarget = resolve(target).replace(/\\/g, "/").toLowerCase();
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}/`);
}

/** 根据扩展名推断 artifact 类型，减少模型登记文件时必须填写的字段。 */
function inferArtifactKind(filePath: string): ArtifactKind {
  const ext = extname(filePath).toLowerCase();
  if ([".md", ".txt", ".doc", ".docx", ".pdf", ".ppt", ".pptx"].includes(ext)) return "doc";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".java", ".go", ".rs", ".cs", ".cpp", ".c", ".h", ".css", ".html"].includes(ext)) return "code";
  if ([".csv", ".tsv", ".json", ".jsonl", ".xlsx", ".xls", ".xlsm", ".parquet"].includes(ext)) return "dataset";
  if ([".zip", ".tar", ".gz", ".tgz", ".7z", ".rar"].includes(ext)) return "archive";
  if ([".log", ".out"].includes(ext)) return "log";
  return "other";
}

/** 根据扩展名推断 MIME，补齐 ArtifactManager 当前未覆盖的 Office 与表格类型。 */
function inferMimeType(filePath: string): string | null {
  switch (extname(filePath).toLowerCase()) {
    case ".md":
      return "text/markdown";
    case ".txt":
    case ".log":
      return "text/plain";
    case ".html":
      return "text/html";
    case ".json":
      return "application/json";
    case ".jsonl":
      return "application/x-ndjson";
    case ".csv":
      return "text/csv";
    case ".tsv":
      return "text/tab-separated-values";
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".zip":
      return "application/zip";
    default:
      return null;
  }
}

/** 读取并校验模型传入的 artifact kind，非法值回退为扩展名推断。 */
function normalizeArtifactKind(value: unknown, filePath: string): ArtifactKind {
  return typeof value === "string" && ARTIFACT_KIND_VALUES.includes(value as ArtifactKind)
    ? value as ArtifactKind
    : inferArtifactKind(filePath);
}

/** 读取并校验模型传入的生命周期，非法值交给 ArtifactManager 使用默认 working。 */
function normalizeArtifactLifecycle(value: unknown): ArtifactLifecycle | null {
  return typeof value === "string" && ARTIFACT_LIFECYCLE_VALUES.includes(value as ArtifactLifecycle)
    ? value as ArtifactLifecycle
    : null;
}

/** 解析 artifact_register 的结构化参数，支持模型或兼容层传入 JSON 字符串。 */
function parseArtifactRegisterArgs(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    return JSON.parse(args) as Record<string, unknown>;
  }
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

/** 为 session 与硅基员工生成 artifact scope 链接，保证两个上下文都能回看文件。 */
function buildArtifactLinks(
  sessionId: string,
  siliconPersonId?: string | null,
): Array<{ scope: ArtifactScopeRef; relation: ArtifactRelation; isPrimary: boolean }> {
  const links: Array<{ scope: ArtifactScopeRef; relation: ArtifactRelation; isPrimary: boolean }> = [
    {
      scope: { scopeKind: "session", scopeId: sessionId },
      relation: "primary_output",
      isPrimary: true,
    },
  ];
  if (siliconPersonId) {
    links.push({
      scope: { scopeKind: "siliconPerson", scopeId: siliconPersonId },
      relation: "secondary_output",
      isPrimary: false,
    });
  }
  return links;
}

/** 查找当前 scope 下是否已经有同一路径 artifact，避免 Files 列表出现重复行。 */
function findExistingArtifactByPath(
  artifactManager: ArtifactManager,
  scope: ArtifactScopeRef,
  relativePath: string,
): ArtifactRecord | null {
  return artifactManager.registry
    .listArtifactsByScope(scope)
    .find((artifact) => artifact.relativePath === relativePath) ?? null;
}

/** 登记已经由模型工具生成的本地文件；非产物目录路径会先复制进受控 artifacts 目录。 */
export async function registerGeneratedFileArtifact(
  input: RegisterGeneratedFileArtifactInput,
): Promise<ArtifactRecord> {
  const sourceAbsolutePath = resolve(input.cwd, input.filePath);
  if (!existsSync(sourceAbsolutePath)) {
    console.warn("[artifact-tool] 登记生成文件失败：源文件不存在", {
      sessionId: input.sessionId,
      sourceToolName: input.sourceToolName ?? null,
      filePath: input.filePath,
      sourceAbsolutePath,
    });
    throw new Error(`文件不存在，无法登记到 Files：${input.filePath}`);
  }

  const scope: ArtifactScopeRef = { scopeKind: "session", scopeId: input.sessionId };
  const sourceInsideArtifactRoot = isInsideBase(input.paths.artifactsDir, sourceAbsolutePath);
  const targetFileName = basename(sourceAbsolutePath);
  const artifactAbsolutePath = sourceInsideArtifactRoot
    ? sourceAbsolutePath
    : input.artifactManager.resolveManagedPath("artifact", scope, targetFileName, input.siliconPersonId ?? null);
  const relativePath = normalizeRelativePath(input.paths, artifactAbsolutePath);
  const existing = findExistingArtifactByPath(input.artifactManager, scope, relativePath);
  const title = input.title?.trim() || targetFileName;
  const kind = input.kind ?? inferArtifactKind(sourceAbsolutePath);
  const lifecycle = input.lifecycle ?? existing?.lifecycle ?? "working";
  const metadata = {
    ...(input.metadata ?? {}),
    sourceToolName: input.sourceToolName ?? null,
    sourcePath: sourceAbsolutePath,
    copiedFromSourcePath: sourceInsideArtifactRoot ? null : sourceAbsolutePath,
  };

  console.info("[artifact-tool] 开始登记生成文件到 Files", {
    sessionId: input.sessionId,
    siliconPersonId: input.siliconPersonId ?? null,
    sourceToolName: input.sourceToolName ?? null,
    sourceAbsolutePath,
    artifactAbsolutePath,
    relativePath,
    existingArtifactId: existing?.id ?? null,
  });

  if (existing) {
    if (!sourceInsideArtifactRoot) {
      await mkdir(dirname(artifactAbsolutePath), { recursive: true });
      await copyFile(sourceAbsolutePath, artifactAbsolutePath);
    }
    input.artifactManager.registry.updateArtifact(existing.id, {
      title,
      kind,
      mimeType: inferMimeType(artifactAbsolutePath),
      storageClass: "artifact",
      lifecycle,
      status: "ready",
      metadata,
    });
    const artifact = input.artifactManager.completeArtifact({
      artifactId: existing.id,
      absolutePath: artifactAbsolutePath,
      lifecycle,
      status: "ready",
      metadata,
    });
    console.info("[artifact-tool] 已更新既有 Files artifact", {
      artifactId: artifact.id,
      sessionId: input.sessionId,
      relativePath: artifact.relativePath,
      sizeBytes: artifact.sizeBytes,
    });
    return artifact;
  }

  const artifact = await input.artifactManager.registerManagedFile({
    title,
    kind,
    mimeType: inferMimeType(artifactAbsolutePath),
    storageClass: "artifact",
    lifecycle,
    status: "ready",
    fileName: targetFileName,
    scope,
    links: buildArtifactLinks(input.sessionId, input.siliconPersonId ?? null),
    metadata,
    siliconPersonId: input.siliconPersonId ?? null,
    absolutePath: artifactAbsolutePath,
    copyFromPath: sourceInsideArtifactRoot ? null : sourceAbsolutePath,
  });

  console.info("[artifact-tool] 已创建新的 Files artifact", {
    artifactId: artifact.id,
    sessionId: input.sessionId,
    relativePath: artifact.relativePath,
    sizeBytes: artifact.sizeBytes,
  });
  return artifact;
}

/** 执行 artifact_register 工具，让模型可以显式把已有文件登记到 Files。 */
export async function executeArtifactRegisterTool(
  args: unknown,
  context: ArtifactRegisterToolContext,
): Promise<ArtifactRegisterToolResult> {
  try {
    const parsed = parseArtifactRegisterArgs(args);
    const filePath = typeof parsed.path === "string" ? parsed.path.trim() : "";
    if (!filePath) {
      return {
        success: false,
        output: "",
        error: "artifact_register 需要 path 参数，用来指定要登记到 Files 的本地文件。",
      };
    }

    const artifact = await registerGeneratedFileArtifact({
      artifactManager: context.artifactManager,
      paths: context.paths,
      cwd: context.cwd,
      sessionId: context.sessionId,
      siliconPersonId: context.siliconPersonId ?? null,
      sourceToolName: context.sourceToolName ?? "artifact_register",
      filePath,
      title: typeof parsed.title === "string" ? parsed.title : null,
      kind: normalizeArtifactKind(parsed.kind, filePath),
      lifecycle: normalizeArtifactLifecycle(parsed.lifecycle),
      metadata: {
        registeredBy: "artifact_register",
      },
    });

    return {
      success: true,
      output: `已记录到 Files：${artifact.title} (${artifact.relativePath})`,
      artifact,
    };
  } catch (error) {
    console.warn("[artifact-tool] artifact_register 执行失败", {
      sessionId: context.sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 从会自动产出文件的工具参数中提取路径，供会话工具循环做透明登记。 */
export function getGeneratedFilePathFromToolCall(
  toolId: string,
  args: Record<string, unknown>,
): string | null {
  if (toolId === "fs.write" && typeof args.path === "string" && args.path.trim()) {
    return args.path;
  }
  if (toolId === "ppt.generate" && typeof args.outputPath === "string" && args.outputPath.trim()) {
    return args.outputPath;
  }
  return null;
}
