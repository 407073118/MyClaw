import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { copyFile, mkdir, rename } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";

import type {
  ArtifactKind,
  ArtifactLifecycle,
  ArtifactRecord,
  ArtifactRelation,
  ArtifactScopeRef,
  ArtifactStatus,
  ArtifactStorageClass,
} from "@shared/contracts";

import type { MyClawPaths } from "./directory-service";
import { deriveSiliconPersonPaths } from "./directory-service";
import type { ArtifactRegistry } from "./artifact-registry";

export type ArtifactLinkInput = {
  scope: ArtifactScopeRef;
  relation?: ArtifactRelation;
  isPrimary?: boolean;
};

export type PlanArtifactInput = {
  artifactId?: string;
  title: string;
  kind: ArtifactKind;
  mimeType?: string | null;
  storageClass: ArtifactStorageClass;
  lifecycle?: ArtifactLifecycle;
  status?: ArtifactStatus;
  fileName: string;
  scope: ArtifactScopeRef;
  links?: ArtifactLinkInput[];
  metadata?: Record<string, unknown> | null;
  siliconPersonId?: string | null;
};

export type CompleteArtifactInput = {
  artifactId: string;
  absolutePath?: string;
  lifecycle?: ArtifactLifecycle;
  status?: ArtifactStatus;
  metadata?: Record<string, unknown> | null;
  sha256?: string | null;
};

function normalizeRelativePath(paths: MyClawPaths, absolutePath: string): string {
  return relative(paths.myClawDir, absolutePath).replace(/\\/g, "/");
}

function ensureDirSync(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function guessMimeType(fileName: string): string | null {
  switch (extname(fileName).toLowerCase()) {
    case ".json":
      return "application/json";
    case ".txt":
    case ".md":
      return "text/plain";
    case ".html":
      return "text/html";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".csv":
      return "text/csv";
    case ".pdf":
      return "application/pdf";
    case ".zip":
      return "application/zip";
    default:
      return null;
  }
}

function computeSha256(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

/** 管理 artifact 的落盘路径、生命周期状态和 registry 同步。 */
export class ArtifactManager {
  constructor(
    private readonly paths: MyClawPaths,
    readonly registry: ArtifactRegistry,
  ) {}

  /** 解析指定 scope 对应的受控目录。 */
  resolveScopeBaseDir(
    storageClass: ArtifactStorageClass,
    scope: ArtifactScopeRef,
    siliconPersonId?: string | null,
  ): string {
    if (storageClass === "artifact") {
      if (scope.scopeKind === "session") {
        return join(this.paths.artifactsDir, "sessions", scope.scopeId);
      }
      if (scope.scopeKind === "workflowRun") {
        return join(this.paths.artifactsDir, "workflows", scope.scopeId);
      }
      if (scope.scopeKind === "siliconPerson") {
        return join(this.paths.artifactsDir, "silicon-persons", scope.scopeId);
      }
      return join(this.paths.artifactsDir, "turn-outcomes", scope.scopeId);
    }

    if (storageClass === "cache") {
      return join(this.paths.cacheDir, scope.scopeKind, scope.scopeId);
    }

    if (scope.scopeKind === "siliconPerson") {
      const personPaths = deriveSiliconPersonPaths(this.paths, siliconPersonId ?? scope.scopeId);
      return personPaths.workspaceDir;
    }

    return join(this.paths.workspaceDir, `${scope.scopeKind}s`, scope.scopeId);
  }

  /** 解析 artifact 的目标绝对路径。 */
  resolveManagedPath(
    storageClass: ArtifactStorageClass,
    scope: ArtifactScopeRef,
    fileName: string,
    siliconPersonId?: string | null,
  ): string {
    const baseDir = this.resolveScopeBaseDir(storageClass, scope, siliconPersonId);
    return join(baseDir, fileName);
  }

  /** 规划一个 artifact，并立即写入 registry。 */
  planArtifact(input: PlanArtifactInput): { artifact: ArtifactRecord; absolutePath: string } {
    const artifactId = input.artifactId ?? `artifact-${randomUUID()}`;
    const absolutePath = this.resolveManagedPath(
      input.storageClass,
      input.scope,
      input.fileName,
      input.siliconPersonId,
    );
    ensureDirSync(dirname(absolutePath));

    const now = new Date().toISOString();
    const lifecycle = input.lifecycle
      ?? (input.storageClass === "workspace" ? "working" : "ready");
    const artifact = this.registry.createArtifact({
      id: artifactId,
      title: input.title,
      kind: input.kind,
      mimeType: input.mimeType ?? guessMimeType(input.fileName),
      storageClass: input.storageClass,
      lifecycle,
      status: input.status ?? "planned",
      relativePath: normalizeRelativePath(this.paths, absolutePath),
      sizeBytes: existsSync(absolutePath) ? statSync(absolutePath).size : null,
      sha256: existsSync(absolutePath) ? computeSha256(absolutePath) : null,
      metadata: input.metadata ?? null,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      openCount: 0,
    });

    const links = input.links?.length
      ? input.links
      : [{ scope: input.scope, relation: "primary_output" as ArtifactRelation, isPrimary: true }];
    for (const link of links) {
      this.registry.linkArtifact(
        artifact.id,
        link.scope,
        link.relation ?? "secondary_output",
        link.isPrimary ?? false,
      );
    }
    this.registry.recordEvent(artifact.id, "artifact.created", {
      scopeKind: input.scope.scopeKind,
      scopeId: input.scope.scopeId,
      lifecycle: artifact.lifecycle,
      status: artifact.status,
    });

    return { artifact, absolutePath };
  }

  /** 将 artifact 标记为写入中。 */
  materializeArtifact(
    artifactId: string,
    metadata: Record<string, unknown> | null = null,
  ): ArtifactRecord {
    const artifact = this.registry.updateArtifact(artifactId, {
      status: "materializing",
      metadata,
    });
    this.registry.recordEvent(artifactId, "artifact.updated", {
      lifecycle: artifact.lifecycle,
      status: artifact.status,
    });
    return artifact;
  }

  /** 根据落盘结果完成一个 artifact。 */
  completeArtifact(input: CompleteArtifactInput): ArtifactRecord {
    const current = this.registry.getArtifactById(input.artifactId);
    if (!current) {
      throw new Error(`Artifact not found: ${input.artifactId}`);
    }

    const absolutePath = input.absolutePath
      ? input.absolutePath
      : join(this.paths.myClawDir, current.relativePath);
    const sizeBytes = existsSync(absolutePath) ? statSync(absolutePath).size : current.sizeBytes;
    const sha256 = input.sha256 === undefined ? computeSha256(absolutePath) : input.sha256;
    const artifact = this.registry.updateArtifact(input.artifactId, {
      relativePath: normalizeRelativePath(this.paths, absolutePath),
      sizeBytes,
      sha256,
      lifecycle: input.lifecycle ?? current.lifecycle,
      status: input.status ?? "ready",
      metadata: input.metadata ?? current.metadata,
    });
    this.registry.recordEvent(input.artifactId, "artifact.completed", {
      lifecycle: artifact.lifecycle,
      status: artifact.status,
    });
    return artifact;
  }

  /** 将 artifact 提升为最终交付。 */
  markArtifactFinal(artifactId: string): ArtifactRecord {
    const artifact = this.registry.updateArtifact(artifactId, {
      lifecycle: "final",
      status: "ready",
    });
    this.registry.recordEvent(artifactId, "artifact.updated", {
      lifecycle: artifact.lifecycle,
      status: artifact.status,
    });
    return artifact;
  }

  /** 将 artifact 标记为失败。 */
  markArtifactFailed(
    artifactId: string,
    error: string,
    metadata: Record<string, unknown> | null = null,
  ): ArtifactRecord {
    const artifact = this.registry.updateArtifact(artifactId, {
      lifecycle: "failed",
      status: "failed",
      metadata: {
        ...(artifactId ? this.registry.getArtifactById(artifactId)?.metadata ?? {} : {}),
        ...(metadata ?? {}),
        error,
      },
    });
    this.registry.recordEvent(artifactId, "artifact.failed", {
      lifecycle: artifact.lifecycle,
      status: artifact.status,
      error,
    });
    return artifact;
  }

  /** 将 artifact 归档。 */
  archiveArtifact(artifactId: string): ArtifactRecord {
    const artifact = this.registry.updateArtifact(artifactId, {
      lifecycle: "archived",
      status: "ready",
    });
    this.registry.recordEvent(artifactId, "artifact.updated", {
      lifecycle: artifact.lifecycle,
      status: artifact.status,
    });
    return artifact;
  }

  /** 直接登记一个已经落盘的受控文件。 */
  registerManagedFile(
    input: PlanArtifactInput & { absolutePath: string; copyFromPath?: string | null },
  ): Promise<ArtifactRecord> {
    return (async () => {
      const planned = this.planArtifact(input);
      await mkdir(dirname(input.absolutePath), { recursive: true });
      if (input.copyFromPath) {
        await copyFile(input.copyFromPath, input.absolutePath);
      }
      return this.completeArtifact({
        artifactId: planned.artifact.id,
        absolutePath: input.absolutePath,
        lifecycle: input.lifecycle ?? planned.artifact.lifecycle,
        status: "ready",
        metadata: input.metadata ?? null,
      });
    })();
  }

  /** 将现有工作文件迁移到最终产物目录，并标记为 final。 */
  promoteArtifactToFinal(
    artifactId: string,
    scope: ArtifactScopeRef,
    fileName?: string,
    siliconPersonId?: string | null,
  ): Promise<ArtifactRecord> {
    return (async () => {
      const current = this.registry.getArtifactById(artifactId);
      if (!current) {
        throw new Error(`Artifact not found: ${artifactId}`);
      }

      const currentAbsolutePath = join(this.paths.myClawDir, current.relativePath);
      const targetAbsolutePath = this.resolveManagedPath(
        "artifact",
        scope,
        fileName ?? current.relativePath.split("/").pop() ?? `${artifactId}.dat`,
        siliconPersonId,
      );
      await mkdir(dirname(targetAbsolutePath), { recursive: true });
      if (currentAbsolutePath !== targetAbsolutePath && existsSync(currentAbsolutePath)) {
        await rename(currentAbsolutePath, targetAbsolutePath);
      }

      const updated = this.registry.updateArtifact(artifactId, {
        storageClass: "artifact",
        relativePath: normalizeRelativePath(this.paths, targetAbsolutePath),
        lifecycle: "final",
        status: "ready",
      });
      this.registry.linkArtifact(artifactId, scope, "primary_output", true);
      this.registry.recordEvent(artifactId, "artifact.updated", {
        lifecycle: updated.lifecycle,
        status: updated.status,
        scopeKind: scope.scopeKind,
        scopeId: scope.scopeId,
      });
      return this.completeArtifact({
        artifactId,
        absolutePath: targetAbsolutePath,
        lifecycle: "final",
        status: "ready",
        metadata: updated.metadata,
      });
    })();
  }
}
