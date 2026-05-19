import type {
  CapabilityBundle,
  CapabilityInstallation,
  CloudProjectBinding,
  ProjectCapabilityDetail,
  ProjectCapabilityLocalState,
  ProjectCapabilityRef,
} from "@shared/contracts";

import { ProjectCapabilityDatabase } from "./project-capability-database";
import type { ProjectRuntimeContext, ProjectRuntimeMcp, ProjectRuntimeSkill } from "./project-runtime-context-client";

export type ProjectRuntimeSyncOptions = {
  accountId?: string;
  syncedAt?: string;
};

/** 将任意 ID 收敛为适合本地 SQLite 主键片段的稳定字符串。 */
function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

/** 生成本地项目绑定 ID，保证同一账号同一项目重复同步时落在同一行。 */
function createLocalProjectId(input: { tenantId: string; accountId: string; cloudProjectId: string }): string {
  return `project_${safeId(input.tenantId)}_${safeId(input.accountId)}_${safeId(input.cloudProjectId)}`;
}

/** 生成本地项目能力引用 ID，保证同一项目同一能力重复同步时落在同一行。 */
function createCapabilityRefId(input: { localProjectId: string; kind: "skill" | "mcp"; cloudCapabilityId: string }): string {
  return `ref_${safeId(input.localProjectId)}_${input.kind}_${safeId(input.cloudCapabilityId)}`;
}

/** 查询 warnings 中与指定能力相关的同步提示。 */
function resolveWarning(context: ProjectRuntimeContext, targetType: "skill" | "mcp", targetId: string): string | null {
  const warning = context.warnings.find((item) => item.targetType === targetType && item.targetId === targetId);
  return warning ? `${warning.code}: ${warning.message}` : null;
}

/** 项目能力应用服务：封装 SQLite 读写、同步、会话绑定和本地偏好。 */
export class ProjectCapabilityService {
  constructor(private readonly database: ProjectCapabilityDatabase) {}

  /** 列出本机绑定过的 Cloud 项目。 */
  listProjects(): CloudProjectBinding[] {
    return this.database.listProjects();
  }

  /** 读取单个项目能力详情。 */
  getProjectDetail(localProjectId: string): ProjectCapabilityDetail {
    return this.database.getProjectCapabilityView(localProjectId);
  }

  /** 读取能力引用，供安装器和 IPC 校验使用。 */
  getCapabilityRef(capabilityRefId: string): ProjectCapabilityRef | null {
    return this.database.getCapabilityRef(capabilityRefId);
  }

  /** 读取能力引用所属项目，供安装器定位缓存路径。 */
  findProjectByCapabilityRefId(capabilityRefId: string): CloudProjectBinding | null {
    return this.database.findProjectByCapabilityRefId(capabilityRefId);
  }

  /** 把 Cloud runtime-context 同步为本地项目、能力引用与默认 inherit 偏好。 */
  syncRuntimeContext(context: ProjectRuntimeContext, options: ProjectRuntimeSyncOptions = {}): ProjectCapabilityDetail {
    const accountId = options.accountId?.trim() || "local";
    const tenantId = context.project.tenantId || "default";
    const cloudProjectId = String(context.project.id);
    const localProjectId = createLocalProjectId({ tenantId, accountId, cloudProjectId });
    const now = options.syncedAt ?? new Date().toISOString();
    const project: CloudProjectBinding = {
      id: localProjectId,
      cloudProjectId,
      tenantId,
      accountId,
      code: context.project.code,
      name: context.project.name,
      description: context.project.description ?? null,
      cloudVersion: context.project.version,
      etag: context.project.etag,
      policyEpoch: context.project.policyEpoch,
      syncedAt: now,
      expiresAt: context.project.expiresAt ?? null,
      revokedAt: context.project.revokedAt ?? null,
      deletedAt: context.project.deletedAt ?? null,
      lastSyncStatus: context.project.deletedAt ? "deleted" : context.project.revokedAt ? "revoked" : "synced",
      lastSyncError: null,
      createdAt: this.database.getProject(localProjectId)?.createdAt ?? now,
      updatedAt: now,
    };
    console.info("[project-capability-service] 同步 Cloud 项目运行上下文到本地", {
      localProjectId,
      cloudProjectId,
      skillCount: context.skills.length,
      mcpCount: context.mcps.length,
    });
    this.database.upsertProject(project);
    this.database.upsertCapabilityRefs(localProjectId, [
      ...context.skills.map((skill) => this.toSkillRef(localProjectId, skill, context, now)),
      ...context.mcps.map((mcp) => this.toMcpRef(localProjectId, mcp, context, now)),
    ]);
    return this.database.getProjectCapabilityView(localProjectId);
  }

  /** 将会话绑定到本地项目，revoked/deleted/expired 项目不允许绑定。 */
  bindSessionProject(sessionId: string, localProjectId: string | null): void {
    if (localProjectId) {
      const project = this.database.getProject(localProjectId);
      if (!project) {
        throw new Error(`project_not_found:${localProjectId}`);
      }
      if (project.revokedAt || project.deletedAt) {
        console.warn("[project-capability-service] 拒绝绑定不可用项目", {
          sessionId,
          localProjectId,
          revokedAt: project.revokedAt,
          deletedAt: project.deletedAt,
        });
        throw new Error("project_binding_unavailable");
      }
      if (project.expiresAt && new Date(project.expiresAt).getTime() <= Date.now()) {
        console.warn("[project-capability-service] 拒绝绑定已过期项目", { sessionId, localProjectId });
        throw new Error("project_binding_expired");
      }
    }
    console.info("[project-capability-service] 绑定会话项目", { sessionId, localProjectId });
    this.database.bindSessionToProject(sessionId, localProjectId);
  }

  /** 查询会话当前绑定的项目 ID。 */
  getSessionProjectBinding(sessionId: string): string | null {
    return this.database.getSessionProjectBinding(sessionId);
  }

  /** 更新项目能力本地启停状态。 */
  setCapabilityLocalState(refId: string, state: ProjectCapabilityLocalState): void {
    console.info("[project-capability-service] 更新项目能力本地启停", { refId, state });
    this.database.setCapabilityLocalState(refId, state);
  }

  /** 确认项目 MCP 能力可以在本机暴露给模型，不保存 secret。 */
  confirmMcpCapability(refId: string, input: { localConfirmed: boolean; secretsConfigured: boolean; allowExposeToModel: boolean }): void {
    console.info("[project-capability-service] 确认项目 MCP 能力", {
      refId,
      localConfirmed: input.localConfirmed,
      allowExposeToModel: input.allowExposeToModel,
    });
    this.database.confirmMcpCapability(refId, input);
  }

  /** 写入能力安装状态。 */
  upsertInstallation(installation: CapabilityInstallation): void {
    this.database.upsertInstallation(installation);
  }

  /** 查询能力安装状态。 */
  getInstallationByRefId(refId: string): CapabilityInstallation | null {
    return this.database.getInstallationByRefId(refId);
  }

  /** 保存一轮运行的能力快照。 */
  saveRunCapabilitySnapshot(input: {
    runId: string;
    sessionId: string;
    localProjectId: string | null;
    bundleHash: string;
    bundleJson: CapabilityBundle | Record<string, unknown>;
  }): void {
    this.database.saveRunCapabilitySnapshot(input);
  }

  /** 将 Cloud runtime Skill 转为本地能力引用记录。 */
  private toSkillRef(localProjectId: string, skill: ProjectRuntimeSkill, context: ProjectRuntimeContext, now: string): ProjectCapabilityRef {
    return {
      id: createCapabilityRefId({ localProjectId, kind: "skill", cloudCapabilityId: skill.id }),
      localProjectId,
      kind: "skill",
      cloudCapabilityId: skill.id,
      cloudReleaseId: skill.releaseId,
      alias: skill.alias,
      displayName: skill.displayName,
      description: skill.description,
      defaultEnabled: skill.defaultEnabled,
      manifestJson: skill.manifest,
      artifactJson: skill.artifact,
      artifactHash: skill.artifact?.sha256 || null,
      runtimePolicyJson: null,
      cloudConfigJson: skill.config,
      syncStatus: "synced",
      syncWarning: resolveWarning(context, "skill", skill.id),
      createdAt: now,
      updatedAt: now,
    };
  }

  /** 将 Cloud runtime MCP 转为本地能力引用记录。 */
  private toMcpRef(localProjectId: string, mcp: ProjectRuntimeMcp, context: ProjectRuntimeContext, now: string): ProjectCapabilityRef {
    return {
      id: createCapabilityRefId({ localProjectId, kind: "mcp", cloudCapabilityId: mcp.id }),
      localProjectId,
      kind: "mcp",
      cloudCapabilityId: mcp.id,
      cloudReleaseId: mcp.releaseId,
      alias: mcp.alias,
      displayName: mcp.displayName,
      description: mcp.description,
      defaultEnabled: mcp.defaultEnabled,
      manifestJson: mcp.manifest,
      artifactJson: mcp.artifact,
      artifactHash: mcp.artifact?.sha256 || null,
      runtimePolicyJson: mcp.runtimePolicy,
      cloudConfigJson: mcp.config,
      syncStatus: "synced",
      syncWarning: resolveWarning(context, "mcp", mcp.id),
      createdAt: now,
      updatedAt: now,
    };
  }
}
