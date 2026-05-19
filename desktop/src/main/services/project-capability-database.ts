import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import type {
  CapabilityBundle,
  CapabilityInstallation,
  CloudProjectBinding,
  ProjectCapabilityDetail,
  ProjectCapabilityLocalState,
  ProjectCapabilityPref,
  ProjectCapabilityRef,
  ProjectSyncStatus,
} from "@shared/contracts";

import type { MyClawPaths } from "./directory-service";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cloud_projects (
  id TEXT PRIMARY KEY,
  cloud_project_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  cloud_version INTEGER NOT NULL DEFAULT 1,
  etag TEXT NOT NULL DEFAULT '',
  policy_epoch INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  deleted_at TEXT,
  last_sync_status TEXT NOT NULL DEFAULT 'never',
  last_sync_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(cloud_project_id, tenant_id, account_id)
);

CREATE TABLE IF NOT EXISTS project_capability_refs (
  id TEXT PRIMARY KEY,
  local_project_id TEXT NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  cloud_capability_id TEXT NOT NULL,
  cloud_release_id TEXT,
  alias TEXT,
  display_name TEXT NOT NULL,
  description TEXT,
  default_enabled INTEGER NOT NULL DEFAULT 0,
  manifest_json TEXT,
  artifact_json TEXT,
  artifact_hash TEXT,
  runtime_policy_json TEXT,
  cloud_config_json TEXT,
  sync_status TEXT NOT NULL DEFAULT 'never',
  sync_warning TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(local_project_id, kind, cloud_capability_id)
);

CREATE TABLE IF NOT EXISTS project_capability_prefs (
  id TEXT PRIMARY KEY,
  local_project_id TEXT NOT NULL REFERENCES cloud_projects(id) ON DELETE CASCADE,
  capability_ref_id TEXT NOT NULL REFERENCES project_capability_refs(id) ON DELETE CASCADE,
  local_state TEXT NOT NULL DEFAULT 'inherit',
  reason TEXT,
  updated_by TEXT,
  local_policy_json TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(local_project_id, capability_ref_id)
);

CREATE TABLE IF NOT EXISTS capability_installations (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  local_project_id TEXT,
  capability_ref_id TEXT,
  install_dir TEXT,
  manifest_hash TEXT,
  artifact_hash TEXT,
  installed_release_id TEXT,
  installed_at TEXT,
  verified_at TEXT,
  install_status TEXT NOT NULL,
  last_error TEXT,
  UNIQUE(source_type, local_project_id, capability_ref_id)
);

CREATE TABLE IF NOT EXISTS session_project_bindings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  local_project_id TEXT,
  bound_at TEXT,
  unbound_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_capability_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  local_project_id TEXT,
  bundle_hash TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

/** sql.js 绑定参数需要加 @ 前缀，并把 undefined 收敛为 null。 */
function bp(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    result[`@${key}`] = value === undefined ? null : value;
  }
  return result;
}

/** 将 JSON 字段稳定序列化，空值统一存为 null。 */
function encodeJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/** 安全解析 JSON 字段，失败时保留 null，避免脏数据打断 UI 展示。 */
function decodeJson(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** 把 SQLite 0/1 值转换为布尔值。 */
function boolOf(value: unknown): boolean {
  return Number(value) === 1;
}

/** 项目能力本地 SQLite sidecar，负责项目绑定、偏好、安装和运行快照持久化。 */
export class ProjectCapabilityDatabase {
  private constructor(
    private readonly db: Database,
    private readonly dbPath: string,
  ) {}

  /** 打开或创建项目能力本地数据库。 */
  static async create(paths: MyClawPaths): Promise<ProjectCapabilityDatabase> {
    const SQL = await initSqlJs();
    const dir = dirname(paths.projectCapabilitiesDbFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const db = existsSync(paths.projectCapabilitiesDbFile)
      ? new SQL.Database(readFileSync(paths.projectCapabilitiesDbFile))
      : new SQL.Database();
    const instance = new ProjectCapabilityDatabase(db, paths.projectCapabilitiesDbFile);
    instance.db.run("PRAGMA foreign_keys = ON");
    instance.db.exec(SCHEMA_SQL);
    instance.flush();
    console.info("[project-capability-db] 项目能力数据库已初始化", {
      dbPath: paths.projectCapabilitiesDbFile,
    });
    return instance;
  }

  /** 列出本机已绑定项目。 */
  listProjects(): CloudProjectBinding[] {
    return this.queryAll("SELECT * FROM cloud_projects ORDER BY updated_at DESC")
      .map((row) => this.toProject(row));
  }

  /** 根据本地项目 ID 查询项目绑定。 */
  getProject(id: string): CloudProjectBinding | null {
    const row = this.queryOne("SELECT * FROM cloud_projects WHERE id = @id", { id });
    return row ? this.toProject(row) : null;
  }

  /** 根据 Cloud 项目三元组查找本地绑定。 */
  findProjectByCloudKey(input: { cloudProjectId: string; tenantId: string; accountId: string }): CloudProjectBinding | null {
    const row = this.queryOne(
      "SELECT * FROM cloud_projects WHERE cloud_project_id = @cloudProjectId AND tenant_id = @tenantId AND account_id = @accountId",
      input,
    );
    return row ? this.toProject(row) : null;
  }

  /** 新增或更新绑定项目元数据。 */
  upsertProject(project: CloudProjectBinding): void {
    console.info("[project-capability-db] 写入本地绑定项目", {
      localProjectId: project.id,
      cloudProjectId: project.cloudProjectId,
      status: project.lastSyncStatus,
    });
    this.run(`
      INSERT INTO cloud_projects (
        id, cloud_project_id, tenant_id, account_id, code, name, description,
        cloud_version, etag, policy_epoch, synced_at, expires_at, revoked_at,
        deleted_at, last_sync_status, last_sync_error, created_at, updated_at
      ) VALUES (
        @id, @cloudProjectId, @tenantId, @accountId, @code, @name, @description,
        @cloudVersion, @etag, @policyEpoch, @syncedAt, @expiresAt, @revokedAt,
        @deletedAt, @lastSyncStatus, @lastSyncError, @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        cloud_project_id = excluded.cloud_project_id,
        tenant_id = excluded.tenant_id,
        account_id = excluded.account_id,
        code = excluded.code,
        name = excluded.name,
        description = excluded.description,
        cloud_version = excluded.cloud_version,
        etag = excluded.etag,
        policy_epoch = excluded.policy_epoch,
        synced_at = excluded.synced_at,
        expires_at = excluded.expires_at,
        revoked_at = excluded.revoked_at,
        deleted_at = excluded.deleted_at,
        last_sync_status = excluded.last_sync_status,
        last_sync_error = excluded.last_sync_error,
        updated_at = excluded.updated_at
    `, project as unknown as Record<string, unknown>);
    this.flush();
  }

  /** 新增或更新项目能力引用，并保留已有本地偏好。 */
  upsertCapabilityRefs(projectId: string, refs: ProjectCapabilityRef[]): void {
    console.info("[project-capability-db] 同步项目能力引用", {
      localProjectId: projectId,
      refCount: refs.length,
    });
    const now = new Date().toISOString();
    this.transaction(() => {
      const incoming = new Set(refs.map((ref) => ref.id));
      for (const ref of refs) {
        this.run(`
          INSERT INTO project_capability_refs (
            id, local_project_id, kind, cloud_capability_id, cloud_release_id, alias,
            display_name, description, default_enabled, manifest_json, artifact_json,
            artifact_hash, runtime_policy_json, cloud_config_json, sync_status,
            sync_warning, created_at, updated_at
          ) VALUES (
            @id, @localProjectId, @kind, @cloudCapabilityId, @cloudReleaseId, @alias,
            @displayName, @description, @defaultEnabled, @manifestJson, @artifactJson,
            @artifactHash, @runtimePolicyJson, @cloudConfigJson, @syncStatus,
            @syncWarning, @createdAt, @updatedAt
          )
          ON CONFLICT(local_project_id, kind, cloud_capability_id) DO UPDATE SET
            cloud_release_id = excluded.cloud_release_id,
            alias = excluded.alias,
            display_name = excluded.display_name,
            description = excluded.description,
            default_enabled = excluded.default_enabled,
            manifest_json = excluded.manifest_json,
            artifact_json = excluded.artifact_json,
            artifact_hash = excluded.artifact_hash,
            runtime_policy_json = excluded.runtime_policy_json,
            cloud_config_json = excluded.cloud_config_json,
            sync_status = excluded.sync_status,
            sync_warning = excluded.sync_warning,
            updated_at = excluded.updated_at
        `, this.refParams(ref));
        const existingPref = this.queryOne(
          "SELECT id FROM project_capability_prefs WHERE capability_ref_id = @refId",
          { refId: ref.id },
        );
        if (!existingPref) {
          this.run(`
            INSERT INTO project_capability_prefs (
              id, local_project_id, capability_ref_id, local_state, reason,
              updated_by, local_policy_json, updated_at
            ) VALUES (
              @id, @localProjectId, @capabilityRefId, 'inherit', NULL,
              NULL, NULL, @updatedAt
            )
          `, {
            id: `pref-${ref.id}`,
            localProjectId: projectId,
            capabilityRefId: ref.id,
            updatedAt: now,
          });
        }
      }

      const existingRefs = this.queryAll(
        "SELECT id FROM project_capability_refs WHERE local_project_id = @projectId",
        { projectId },
      );
      for (const existing of existingRefs) {
        const existingId = String(existing.id);
        if (!incoming.has(existingId)) {
          this.run(
            "UPDATE project_capability_refs SET sync_status = 'deleted', sync_warning = @warning, updated_at = @updatedAt WHERE id = @id",
            {
              id: existingId,
              warning: "Cloud runtime context no longer returns this capability.",
              updatedAt: now,
            },
          );
        }
      }
    });
    this.flush();
  }

  /** 读取项目详情视图，包含 refs、prefs 与安装状态。 */
  getProjectCapabilityView(projectId: string): ProjectCapabilityDetail {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error(`project_not_found:${projectId}`);
    }
    const refs = this.queryAll(
      "SELECT * FROM project_capability_refs WHERE local_project_id = @projectId ORDER BY kind, display_name",
      { projectId },
    ).map((row) => this.toRef(row));
    const prefs = this.queryAll(
      "SELECT * FROM project_capability_prefs WHERE local_project_id = @projectId",
      { projectId },
    ).map((row) => this.toPref(row));
    const installations = this.queryAll(
      "SELECT * FROM capability_installations WHERE local_project_id = @projectId",
      { projectId },
    ).map((row) => this.toInstallation(row));
    return { project, refs, prefs, installations };
  }

  /** 根据能力引用 ID 查询能力引用。 */
  getCapabilityRef(refId: string): ProjectCapabilityRef | null {
    const row = this.queryOne("SELECT * FROM project_capability_refs WHERE id = @refId", { refId });
    return row ? this.toRef(row) : null;
  }

  /** 根据能力引用 ID 查询所属本地项目。 */
  findProjectByCapabilityRefId(refId: string): CloudProjectBinding | null {
    const row = this.queryOne(`
      SELECT p.* FROM cloud_projects p
      JOIN project_capability_refs r ON r.local_project_id = p.id
      WHERE r.id = @refId
    `, { refId });
    return row ? this.toProject(row) : null;
  }

  /** 设置项目能力本地启停偏好。 */
  setCapabilityLocalState(refId: string, state: ProjectCapabilityLocalState, reason?: string): void {
    const ref = this.getCapabilityRef(refId);
    if (!ref) {
      throw new Error(`capability_ref_not_found:${refId}`);
    }
    console.info("[project-capability-db] 更新项目能力本地状态", {
      refId,
      localProjectId: ref.localProjectId,
      state,
    });
    const now = new Date().toISOString();
    this.run(`
      INSERT INTO project_capability_prefs (
        id, local_project_id, capability_ref_id, local_state, reason,
        updated_by, local_policy_json, updated_at
      ) VALUES (
        @id, @localProjectId, @capabilityRefId, @localState, @reason,
        'local-user', NULL, @updatedAt
      )
      ON CONFLICT(local_project_id, capability_ref_id) DO UPDATE SET
        local_state = excluded.local_state,
        reason = excluded.reason,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `, {
      id: `pref-${refId}`,
      localProjectId: ref.localProjectId,
      capabilityRefId: refId,
      localState: state,
      reason: reason ?? null,
      updatedAt: now,
    });
    this.flush();
  }

  /** 保存项目 MCP 的本地确认与暴露策略，不保存任何 secret。 */
  confirmMcpCapability(refId: string, input: { localConfirmed: boolean; secretsConfigured: boolean; allowExposeToModel: boolean }): void {
    const ref = this.getCapabilityRef(refId);
    if (!ref) {
      throw new Error(`capability_ref_not_found:${refId}`);
    }
    if (ref.kind !== "mcp") {
      throw new Error("capability_ref_not_mcp");
    }
    console.info("[project-capability-db] 更新项目 MCP 本地确认状态", {
      refId,
      localProjectId: ref.localProjectId,
      localConfirmed: input.localConfirmed,
      allowExposeToModel: input.allowExposeToModel,
    });
    const now = new Date().toISOString();
    this.run(`
      INSERT INTO project_capability_prefs (
        id, local_project_id, capability_ref_id, local_state, reason,
        updated_by, local_policy_json, updated_at
      ) VALUES (
        @id, @localProjectId, @capabilityRefId, 'inherit', NULL,
        'local-user', @localPolicyJson, @updatedAt
      )
      ON CONFLICT(local_project_id, capability_ref_id) DO UPDATE SET
        local_policy_json = excluded.local_policy_json,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `, {
      id: `pref-${refId}`,
      localProjectId: ref.localProjectId,
      capabilityRefId: refId,
      localPolicyJson: JSON.stringify(input),
      updatedAt: now,
    });
    this.flush();
  }

  /** 新增或更新能力安装状态。 */
  upsertInstallation(installation: CapabilityInstallation): void {
    console.info("[project-capability-db] 写入项目能力安装状态", {
      installationId: installation.id,
      capabilityRefId: installation.capabilityRefId,
      installStatus: installation.installStatus,
    });
    this.run(`
      INSERT INTO capability_installations (
        id, source_type, local_project_id, capability_ref_id, install_dir,
        manifest_hash, artifact_hash, installed_release_id, installed_at,
        verified_at, install_status, last_error
      ) VALUES (
        @id, @sourceType, @localProjectId, @capabilityRefId, @installDir,
        @manifestHash, @artifactHash, @installedReleaseId, @installedAt,
        @verifiedAt, @installStatus, @lastError
      )
      ON CONFLICT(source_type, local_project_id, capability_ref_id) DO UPDATE SET
        install_dir = excluded.install_dir,
        manifest_hash = excluded.manifest_hash,
        artifact_hash = excluded.artifact_hash,
        installed_release_id = excluded.installed_release_id,
        installed_at = excluded.installed_at,
        verified_at = excluded.verified_at,
        install_status = excluded.install_status,
        last_error = excluded.last_error
    `, installation as unknown as Record<string, unknown>);
    this.flush();
  }

  /** 根据能力引用读取安装状态。 */
  getInstallationByRefId(refId: string): CapabilityInstallation | null {
    const row = this.queryOne(
      "SELECT * FROM capability_installations WHERE capability_ref_id = @refId",
      { refId },
    );
    return row ? this.toInstallation(row) : null;
  }

  /** 绑定或解绑会话与本地项目。 */
  bindSessionToProject(sessionId: string, localProjectId: string | null): void {
    console.info("[project-capability-db] 更新会话项目绑定", { sessionId, localProjectId });
    const now = new Date().toISOString();
    this.run(`
      INSERT INTO session_project_bindings (
        id, session_id, local_project_id, bound_at, unbound_at, created_at, updated_at
      ) VALUES (
        @id, @sessionId, @localProjectId, @boundAt, @unboundAt, @createdAt, @updatedAt
      )
      ON CONFLICT(session_id) DO UPDATE SET
        local_project_id = excluded.local_project_id,
        bound_at = excluded.bound_at,
        unbound_at = excluded.unbound_at,
        updated_at = excluded.updated_at
    `, {
      id: randomUUID(),
      sessionId,
      localProjectId,
      boundAt: localProjectId ? now : null,
      unboundAt: localProjectId ? null : now,
      createdAt: now,
      updatedAt: now,
    });
    this.flush();
  }

  /** 查询会话当前绑定的本地项目 ID。 */
  getSessionProjectBinding(sessionId: string): string | null {
    const row = this.queryOne(
      "SELECT local_project_id FROM session_project_bindings WHERE session_id = @sessionId AND unbound_at IS NULL",
      { sessionId },
    );
    return typeof row?.local_project_id === "string" ? row.local_project_id : null;
  }

  /** 保存一轮模型运行使用的冻结能力包快照。 */
  saveRunCapabilitySnapshot(input: {
    runId: string;
    sessionId: string;
    localProjectId: string | null;
    bundleHash: string;
    bundleJson: CapabilityBundle | Record<string, unknown>;
  }): void {
    console.info("[project-capability-db] 保存运行能力快照", {
      runId: input.runId,
      sessionId: input.sessionId,
      localProjectId: input.localProjectId,
      bundleHash: input.bundleHash,
    });
    this.run(`
      INSERT INTO run_capability_snapshots (
        id, run_id, session_id, local_project_id, bundle_hash, bundle_json, created_at
      ) VALUES (
        @id, @runId, @sessionId, @localProjectId, @bundleHash, @bundleJson, @createdAt
      )
      ON CONFLICT(run_id) DO UPDATE SET
        local_project_id = excluded.local_project_id,
        bundle_hash = excluded.bundle_hash,
        bundle_json = excluded.bundle_json
    `, {
      id: randomUUID(),
      runId: input.runId,
      sessionId: input.sessionId,
      localProjectId: input.localProjectId,
      bundleHash: input.bundleHash,
      bundleJson: JSON.stringify(input.bundleJson),
      createdAt: new Date().toISOString(),
    });
    this.flush();
  }

  /** 查询运行能力快照，供测试和审计页读取。 */
  listRunCapabilitySnapshots(sessionId?: string): Array<{ runId: string; sessionId: string; localProjectId: string | null; bundleHash: string; bundleJson: unknown; createdAt: string }> {
    const rows = sessionId
      ? this.queryAll("SELECT * FROM run_capability_snapshots WHERE session_id = @sessionId ORDER BY created_at DESC", { sessionId })
      : this.queryAll("SELECT * FROM run_capability_snapshots ORDER BY created_at DESC");
    return rows.map((row) => ({
      runId: String(row.run_id),
      sessionId: String(row.session_id),
      localProjectId: typeof row.local_project_id === "string" ? row.local_project_id : null,
      bundleHash: String(row.bundle_hash),
      bundleJson: decodeJson(row.bundle_json),
      createdAt: String(row.created_at),
    }));
  }

  /** 关闭数据库连接前把内存状态刷到磁盘。 */
  close(): void {
    this.flush();
    this.db.close();
  }

  /** 将项目契约转换为 SQLite 绑定参数。 */
  private refParams(ref: ProjectCapabilityRef): Record<string, unknown> {
    return {
      ...ref,
      defaultEnabled: ref.defaultEnabled ? 1 : 0,
      manifestJson: encodeJson(ref.manifestJson),
      artifactJson: encodeJson(ref.artifactJson),
      runtimePolicyJson: encodeJson(ref.runtimePolicyJson),
      cloudConfigJson: encodeJson(ref.cloudConfigJson),
    };
  }

  /** 把 cloud_projects 行转换为契约对象。 */
  private toProject(row: Record<string, unknown>): CloudProjectBinding {
    return {
      id: String(row.id),
      cloudProjectId: String(row.cloud_project_id),
      tenantId: String(row.tenant_id),
      accountId: String(row.account_id),
      code: String(row.code),
      name: String(row.name),
      description: typeof row.description === "string" ? row.description : null,
      cloudVersion: Number(row.cloud_version),
      etag: String(row.etag),
      policyEpoch: Number(row.policy_epoch),
      syncedAt: typeof row.synced_at === "string" ? row.synced_at : null,
      expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
      revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
      deletedAt: typeof row.deleted_at === "string" ? row.deleted_at : null,
      lastSyncStatus: String(row.last_sync_status) as ProjectSyncStatus,
      lastSyncError: typeof row.last_sync_error === "string" ? row.last_sync_error : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  /** 把 project_capability_refs 行转换为契约对象。 */
  private toRef(row: Record<string, unknown>): ProjectCapabilityRef {
    return {
      id: String(row.id),
      localProjectId: String(row.local_project_id),
      kind: String(row.kind) as ProjectCapabilityRef["kind"],
      cloudCapabilityId: String(row.cloud_capability_id),
      cloudReleaseId: typeof row.cloud_release_id === "string" ? row.cloud_release_id : null,
      alias: typeof row.alias === "string" ? row.alias : null,
      displayName: String(row.display_name),
      description: typeof row.description === "string" ? row.description : null,
      defaultEnabled: boolOf(row.default_enabled),
      manifestJson: decodeJson(row.manifest_json),
      artifactJson: decodeJson(row.artifact_json),
      artifactHash: typeof row.artifact_hash === "string" ? row.artifact_hash : null,
      runtimePolicyJson: decodeJson(row.runtime_policy_json),
      cloudConfigJson: decodeJson(row.cloud_config_json),
      syncStatus: String(row.sync_status) as ProjectSyncStatus,
      syncWarning: typeof row.sync_warning === "string" ? row.sync_warning : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  /** 把 project_capability_prefs 行转换为契约对象。 */
  private toPref(row: Record<string, unknown>): ProjectCapabilityPref {
    return {
      id: String(row.id),
      localProjectId: String(row.local_project_id),
      capabilityRefId: String(row.capability_ref_id),
      localState: String(row.local_state) as ProjectCapabilityLocalState,
      reason: typeof row.reason === "string" ? row.reason : null,
      updatedBy: typeof row.updated_by === "string" ? row.updated_by : null,
      updatedAt: String(row.updated_at),
      localPolicyJson: decodeJson(row.local_policy_json),
    };
  }

  /** 把 capability_installations 行转换为契约对象。 */
  private toInstallation(row: Record<string, unknown>): CapabilityInstallation {
    return {
      id: String(row.id),
      sourceType: String(row.source_type) as CapabilityInstallation["sourceType"],
      localProjectId: typeof row.local_project_id === "string" ? row.local_project_id : null,
      capabilityRefId: typeof row.capability_ref_id === "string" ? row.capability_ref_id : null,
      installDir: typeof row.install_dir === "string" ? row.install_dir : null,
      manifestHash: typeof row.manifest_hash === "string" ? row.manifest_hash : null,
      artifactHash: typeof row.artifact_hash === "string" ? row.artifact_hash : null,
      installedReleaseId: typeof row.installed_release_id === "string" ? row.installed_release_id : null,
      installedAt: typeof row.installed_at === "string" ? row.installed_at : null,
      verifiedAt: typeof row.verified_at === "string" ? row.verified_at : null,
      installStatus: String(row.install_status) as CapabilityInstallation["installStatus"],
      lastError: typeof row.last_error === "string" ? row.last_error : null,
    };
  }

  /** 执行写操作。 */
  private run(sql: string, params?: Record<string, unknown>): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.db.run(sql, params ? bp(params) as any : undefined);
  }

  /** 查询单行记录。 */
  private queryOne(sql: string, params?: Record<string, unknown>): Record<string, unknown> | undefined {
    const stmt = this.db.prepare(sql);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (params) stmt.bind(bp(params) as any);
      return stmt.step() ? (stmt.getAsObject() as Record<string, unknown>) : undefined;
    } finally {
      stmt.free();
    }
  }

  /** 查询多行记录。 */
  private queryAll(sql: string, params?: Record<string, unknown>): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (params) stmt.bind(bp(params) as any);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, unknown>);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }

  /** 在事务内执行写入，失败自动回滚。 */
  private transaction(fn: () => void): void {
    this.db.run("BEGIN TRANSACTION");
    try {
      fn();
      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
  }

  /** 将内存数据库原子刷写到磁盘。 */
  private flush(): void {
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${this.dbPath}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, Buffer.from(this.db.export()));
    renameSync(tmpPath, this.dbPath);
  }
}
