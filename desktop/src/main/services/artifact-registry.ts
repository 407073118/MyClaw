import { randomUUID } from "node:crypto";

import type {
  ArtifactEventRecord,
  ArtifactEventType,
  ArtifactLink,
  ArtifactRecord,
  ArtifactRelation,
  ArtifactScopeItem,
  ArtifactScopeRef,
} from "@shared/contracts";

import type { SessionDatabase } from "./session-database";

export type CreateArtifactInput = Omit<
  ArtifactRecord,
  "createdAt" | "updatedAt" | "lastOpenedAt" | "openCount"
> & {
  createdAt?: string;
  updatedAt?: string;
  lastOpenedAt?: string | null;
  openCount?: number;
};

/** 管理 artifact 元数据、scope 关联和生命周期事件。 */
export class ArtifactRegistry {
  constructor(private readonly sessionDb: SessionDatabase) {}

  /** 创建或覆盖 artifact 记录。 */
  createArtifact(input: CreateArtifactInput): ArtifactRecord {
    const now = input.updatedAt ?? input.createdAt ?? new Date().toISOString();
    const artifact: ArtifactRecord = {
      ...input,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      lastOpenedAt: input.lastOpenedAt ?? null,
      openCount: input.openCount ?? 0,
    };
    this.sessionDb.saveArtifact(artifact);
    return artifact;
  }

  /** 局部更新 artifact。 */
  updateArtifact(
    artifactId: string,
    updates: Partial<Omit<ArtifactRecord, "id" | "createdAt">>,
  ): ArtifactRecord {
    const current = this.sessionDb.getArtifact(artifactId);
    if (!current) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const next: ArtifactRecord = {
      ...current,
      ...updates,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: updates.updatedAt ?? new Date().toISOString(),
      lastOpenedAt: Object.prototype.hasOwnProperty.call(updates, "lastOpenedAt")
        ? updates.lastOpenedAt ?? null
        : current.lastOpenedAt,
      openCount: updates.openCount ?? current.openCount,
    };
    this.sessionDb.saveArtifact(next);
    return next;
  }

  /** 读取单个 artifact。 */
  getArtifactById(artifactId: string): ArtifactRecord | null {
    return this.sessionDb.getArtifact(artifactId);
  }

  /** 查询指定 scope 下的全部 artifact。 */
  listArtifactsByScope(scope: ArtifactScopeRef): ArtifactScopeItem[] {
    return this.sessionDb.listArtifactsByScope(scope.scopeKind, scope.scopeId);
  }

  /** 查询指定 scope 下用户可见的 artifact（排除 cache 类内部文件）。 */
  listUserArtifactsByScope(scope: ArtifactScopeRef): ArtifactScopeItem[] {
    return this.sessionDb
      .listArtifactsByScope(scope.scopeKind, scope.scopeId)
      .filter((a) => a.storageClass !== "cache");
  }

  /** 查询最近更新的 artifact。 */
  listRecentArtifacts(limit = 20): ArtifactRecord[] {
    return this.sessionDb.listRecentArtifacts(limit);
  }

  /** 查询最近更新的用户可见 artifact（排除 cache 类内部文件）。 */
  listRecentUserArtifacts(limit = 20): ArtifactRecord[] {
    return this.sessionDb.listRecentArtifacts(limit).filter((a) => a.storageClass !== "cache");
  }

  /** 保存 scope 关联。 */
  linkArtifact(
    artifactId: string,
    scope: ArtifactScopeRef,
    relation: ArtifactRelation,
    isPrimary = false,
  ): ArtifactLink {
    const link: ArtifactLink = {
      artifactId,
      scopeKind: scope.scopeKind,
      scopeId: scope.scopeId,
      relation,
      isPrimary,
      createdAt: new Date().toISOString(),
    };
    this.sessionDb.saveArtifactLink(link);
    return link;
  }

  /** 查询单个 artifact 的全部关联。 */
  listArtifactLinks(artifactId: string): ArtifactLink[] {
    return this.sessionDb.listArtifactLinks(artifactId);
  }

  /** 记录 artifact 事件。 */
  recordEvent(
    artifactId: string,
    eventType: ArtifactEventType,
    payload: Record<string, unknown> | null = null,
  ): ArtifactEventRecord {
    const event: ArtifactEventRecord = {
      id: `artifact-event-${randomUUID()}`,
      artifactId,
      eventType,
      payload,
      createdAt: new Date().toISOString(),
    };
    this.sessionDb.saveArtifactEvent(event);
    return event;
  }

  /** 读取 artifact 事件。 */
  listArtifactEvents(artifactId: string, limit = 20): ArtifactEventRecord[] {
    return this.sessionDb.listArtifactEvents(artifactId, limit);
  }

  /** 标记 artifact 被打开。 */
  markOpened(artifactId: string, openedAt = new Date().toISOString()): ArtifactRecord {
    this.sessionDb.markArtifactOpened(artifactId, openedAt);
    const updated = this.sessionDb.getArtifact(artifactId);
    if (!updated) {
      throw new Error(`Artifact not found after markOpened: ${artifactId}`);
    }
    return updated;
  }
}
