import type {
  CreateProjectInput,
  ProjectApiInfo,
  ProjectDetail,
  ProjectId,
  ProjectMcpRefInfo,
  ProjectRepositoryInfo,
  ProjectRongzhiLinkInfo,
  ProjectRuntimeArtifact,
  ProjectRuntimeContext,
  ProjectRuntimeMcp,
  ProjectRuntimeSkill,
  ProjectRuntimeWarning,
  ProjectSiliconPersonRefInfo,
  ProjectServiceInfo,
  ProjectSkillRefInfo,
  ProjectStatus,
  ProjectSummary,
  ProjectWorkflowRefInfo,
  ReplaceProjectConfigInput
} from "@myclaw-cloud/shared";
import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { DatabaseService } from "../../database/services/database.service";
import type { ProjectsRepository } from "../ports/projects.repository";

const PROJECT_DETAIL_INCLUDE = {
  services: { orderBy: { sortOrder: "asc" as const } },
  repositories: { orderBy: { sortOrder: "asc" as const } },
  rongzhiLink: true,
  apis: { orderBy: { createdAt: "asc" as const } },
  skills: { orderBy: { createdAt: "asc" as const } },
  mcps: { orderBy: { createdAt: "asc" as const } },
  workflows: { orderBy: { createdAt: "asc" as const } },
  siliconPersons: { orderBy: { createdAt: "asc" as const } },
  snapshots: { orderBy: { version: "desc" as const }, take: 1 }
};

@Injectable()
export class PrismaProjectsRepository implements ProjectsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  /** 查询项目摘要列表，并统计项目维护对象数量。 */
  async list(): Promise<ProjectSummary[]> {
    console.info("[projects-repository] 查询项目摘要列表");
    const projects = await this.databaseService.project.findMany({
      include: {
        _count: {
          select: {
            repositories: true,
            apis: true,
            skills: true,
            mcps: true
          }
        },
        snapshots: { orderBy: { version: "desc" as const }, take: 1 }
      },
      orderBy: { updatedAt: "desc" }
    });

    return projects.map((project) => ({
      id: project.id,
      code: project.code,
      name: project.name,
      description: project.description,
      ownerAccount: project.ownerAccount,
      status: project.status as ProjectStatus,
      version: this.resolveProjectRuntimeVersion(project),
      repositoryCount: project._count.repositories,
      apiCount: project._count.apis,
      skillCount: project._count.skills,
      mcpCount: project._count.mcps,
      updatedAt: project.updatedAt.toISOString()
    }));
  }

  /** 根据项目 ID 查询完整项目配置。 */
  async findById(id: ProjectId): Promise<ProjectDetail | null> {
    console.info("[projects-repository] 根据 ID 查询项目详情", { projectId: id });
    const project = await this.databaseService.project.findUnique({
      where: { id },
      include: PROJECT_DETAIL_INCLUDE
    });
    return project ? this.toProjectDetail(project) : null;
  }

  /** 根据项目编码查询完整项目配置。 */
  async findByCode(code: string): Promise<ProjectDetail | null> {
    console.info("[projects-repository] 根据编码查询项目详情", { code });
    const project = await this.databaseService.project.findUnique({
      where: { code },
      include: PROJECT_DETAIL_INCLUDE
    });
    return project ? this.toProjectDetail(project) : null;
  }

  /** 查询 Desktop 运行上下文，解析项目 Skill/MCP 的具体 release 与安全策略。 */
  async findRuntimeContextById(id: ProjectId): Promise<ProjectRuntimeContext | null> {
    console.info("[projects-repository] 查询项目运行上下文", { projectId: id });
    const project = await this.databaseService.project.findUnique({
      where: { id },
      include: PROJECT_DETAIL_INCLUDE
    });
    if (!project) {
      return null;
    }

    const warnings: ProjectRuntimeWarning[] = [];
    const enabledSkillRefs = project.skills.filter((item: any) => item.enabled !== false);
    const enabledMcpRefs = project.mcps.filter((item: any) => item.enabled !== false);
    const skillIds = this.uniqueStrings(enabledSkillRefs.map((item: any) => item.skillId));
    const mcpServerIds = this.uniqueStrings(enabledMcpRefs.map((item: any) => item.mcpServerId));

    const skills = await this.databaseService.skill.findMany({
      where: { id: { in: skillIds } },
      select: {
        id: true,
        name: true,
        summary: true,
        description: true,
        latestReleaseId: true
      }
    });
    const skillMap = new Map(skills.map((item: any) => [item.id, item]));
    const skillReleaseIds = this.uniqueStrings(
      enabledSkillRefs.map((item: any) => item.skillReleaseId ?? skillMap.get(item.skillId)?.latestReleaseId)
    );
    const skillReleases = await this.databaseService.skillRelease.findMany({
      where: { id: { in: skillReleaseIds } },
      select: {
        id: true,
        skillId: true,
        manifestJson: true,
        artifactDownloadUrl: true,
        artifactFileSize: true,
        artifactSha256: true,
        updatedAt: true
      }
    });
    const skillReleaseMap = new Map(skillReleases.map((item: any) => [item.id, item]));

    const mcpServers = await this.databaseService.mcpServer.findMany({
      where: { id: { in: mcpServerIds } },
      select: {
        id: true,
        name: true,
        summary: true,
        description: true,
        latestReleaseId: true
      }
    });
    const mcpServerMap = new Map(mcpServers.map((item: any) => [item.id, item]));
    const mcpReleaseIds = this.uniqueStrings(
      enabledMcpRefs.map((item: any) => item.mcpReleaseId ?? mcpServerMap.get(item.mcpServerId)?.latestReleaseId)
    );
    const mcpReleases = await this.databaseService.mcpServerRelease.findMany({
      where: { id: { in: mcpReleaseIds } },
      select: {
        id: true,
        serverId: true,
        configJson: true,
        updatedAt: true
      }
    });
    const mcpReleaseMap = new Map(mcpReleases.map((item: any) => [item.id, item]));

    const runtimeSkills: ProjectRuntimeSkill[] = [];
    for (const ref of enabledSkillRefs) {
      const skill = skillMap.get(ref.skillId);
      const releaseId = ref.skillReleaseId ?? skill?.latestReleaseId ?? null;
      const release = releaseId ? skillReleaseMap.get(releaseId) : null;
      if (!skill || !releaseId || !release) {
        warnings.push({
          code: "project_skill_release_missing",
          message: "项目 Skill 未解析到可执行 release，已从运行上下文省略。",
          targetType: "skill",
          targetId: String(ref.skillId)
        });
        continue;
      }
      runtimeSkills.push({
        id: ref.skillId,
        releaseId,
        alias: ref.alias,
        displayName: ref.alias ?? skill.name,
        description: skill.description ?? skill.summary ?? null,
        defaultEnabled: ref.enabled !== false,
        manifest: release.manifestJson ?? null,
        artifact: this.toRuntimeArtifact(
          releaseId,
          release.artifactDownloadUrl,
          release.artifactFileSize,
          release.artifactSha256,
          warnings,
          "skill",
          ref.skillId
        ),
        config: ref.configJson ?? null
      });
    }

    const runtimeMcps: ProjectRuntimeMcp[] = [];
    for (const ref of enabledMcpRefs) {
      const server = mcpServerMap.get(ref.mcpServerId);
      const releaseId = ref.mcpReleaseId ?? server?.latestReleaseId ?? null;
      const release = releaseId ? mcpReleaseMap.get(releaseId) : null;
      if (!server || !releaseId || !release) {
        warnings.push({
          code: "project_mcp_release_missing",
          message: "项目 MCP 未解析到具体 release，已从运行上下文省略。",
          targetType: "mcp",
          targetId: String(ref.mcpServerId)
        });
        continue;
      }
      const transport = this.normalizeMcpTransport(release.configJson);
      const riskLevel = this.normalizeRuntimeRisk(ref.riskLevel, transport);
      runtimeMcps.push({
        id: ref.mcpServerId,
        releaseId,
        alias: ref.alias,
        displayName: ref.alias ?? server.name,
        description: server.description ?? server.summary ?? null,
        defaultEnabled: ref.enabled !== false,
        transport,
        manifest: {
          kind: "mcp",
          name: server.name,
          description: server.description ?? server.summary ?? "",
          config: release.configJson ?? {}
        },
        artifact: null,
        config: ref.configOverrideJson ?? release.configJson ?? null,
        runtimePolicy: {
          requiresLocalConfirmation: true,
          allowAutoExposeToModel: transport !== "stdio" && riskLevel === "low",
          riskLevel
        }
      });
    }

    warnings.push({
      code: "project_tenant_fallback",
      message: "当前项目表尚未持久化 tenantId，运行上下文使用 default 作为本地隔离键。",
      targetType: "project",
      targetId: String(project.id)
    });

    return {
      project: {
        id: project.id,
        code: project.code,
        tenantId: "default",
        name: project.name,
        description: project.description,
        version: this.resolveProjectRuntimeVersion(project),
        etag: this.buildRuntimeContextEtag(project, skillReleases, mcpReleases),
        policyEpoch: 1,
        expiresAt: null,
        revokedAt: project.status === "archived" ? project.updatedAt.toISOString() : null,
        deletedAt: null
      },
      skills: runtimeSkills,
      mcps: runtimeMcps,
      warnings
    };
  }

  /** 创建项目并写入初始配置快照。 */
  async createProject(input: CreateProjectInput): Promise<ProjectDetail> {
    console.info("[projects-repository] 开始创建项目事务", {
      code: input.code,
      serviceCount: input.services?.length ?? 0,
      repositoryCount: input.repositories?.length ?? 0,
      apiCount: input.apis?.length ?? 0
    });

    const project = await this.databaseService.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          ownerAccount: input.ownerAccount,
          status: input.status ?? "active",
          createdBy: input.createdBy,
          services: this.createServicesData(input.services),
          repositories: this.createRepositoriesData(input.repositories),
          rongzhiLink: this.createRongzhiLinkData(input.rongzhiLink),
          apis: this.createApisData(input.apis),
          skills: this.createSkillsData(input.skills),
          mcps: this.createMcpsData(input.mcps),
          workflows: this.createWorkflowsData(input.workflows),
          siliconPersons: this.createSiliconPersonsData(input.siliconPersons)
        }
      });

      const detail = await tx.project.findUnique({
        where: { id: created.id },
        include: PROJECT_DETAIL_INCLUDE
      });
      if (!detail) throw new Error(`project_create_readback_failed:${created.id}`);

      await tx.projectConfigSnapshot.create({
        data: {
          projectId: created.id,
          version: 1,
          snapshotJson: this.toSnapshotJson(detail),
          description: "项目创建初始快照",
          createdBy: input.createdBy
        }
      });
      await tx.projectChangeLog.create({
        data: {
          projectId: created.id,
          action: "project.create",
          targetType: "project",
          targetId: String(created.id),
          afterJson: this.toSnapshotJson(detail),
          operatorAccount: input.createdBy
        }
      });

      return detail;
    });

    console.info("[projects-repository] 项目创建完成", { projectId: project.id, code: project.code });
    return this.toProjectDetail(project);
  }

  /** 替换项目配置并写入新的配置快照。 */
  async replaceProjectConfig(projectId: ProjectId, input: ReplaceProjectConfigInput): Promise<ProjectDetail> {
    console.info("[projects-repository] 开始替换项目配置事务", {
      projectId,
      updatedBy: input.updatedBy,
      hasServices: input.services !== undefined,
      hasRepositories: input.repositories !== undefined,
      hasApis: input.apis !== undefined
    });

    const project = await this.databaseService.$transaction(async (tx) => {
      const before = await tx.project.findUnique({
        where: { id: projectId },
        include: PROJECT_DETAIL_INCLUDE
      });
      if (!before) throw new Error(`project_not_found:${projectId}`);

      const projectUpdateData = this.buildProjectUpdateData(input);
      if (Object.keys(projectUpdateData).length > 0) {
        await tx.project.update({
          where: { id: projectId },
          data: projectUpdateData
        });
      }

      await this.replaceServices(tx, projectId, input);

      if (input.repositories !== undefined) {
        await tx.projectRepository.deleteMany({ where: { projectId } });
        if (input.repositories.length > 0) {
          await tx.projectRepository.createMany({
            data: input.repositories.map((item, index) => ({
              projectId,
              name: item.name,
              gitUrl: item.gitUrl,
              repoType: item.repoType ?? "service",
              defaultBranch: item.defaultBranch ?? null,
              description: item.description ?? null,
              enabled: item.enabled ?? true,
              sortOrder: item.sortOrder ?? index
            }))
          });
        }
      }

      if (input.rongzhiLink !== undefined) {
        await tx.projectRongzhiLink.deleteMany({ where: { projectId } });
        if (input.rongzhiLink) {
          await tx.projectRongzhiLink.create({
            data: {
              projectId,
              projectCode: input.rongzhiLink.projectCode,
              projectName: input.rongzhiLink.projectName ?? null,
              baseUrl: input.rongzhiLink.baseUrl ?? null,
              enabled: input.rongzhiLink.enabled ?? true
            }
          });
        }
      }

      await this.replaceApis(tx, projectId, input);
      await this.replaceSkills(tx, projectId, input);
      await this.replaceMcps(tx, projectId, input);
      await this.replaceWorkflows(tx, projectId, input);
      await this.replaceSiliconPersons(tx, projectId, input);

      const after = await tx.project.findUnique({
        where: { id: projectId },
        include: PROJECT_DETAIL_INCLUDE
      });
      if (!after) throw new Error(`project_replace_readback_failed:${projectId}`);

      const snapshotCount = await tx.projectConfigSnapshot.count({ where: { projectId } });
      const snapshotVersion = snapshotCount + 1;
      await tx.projectConfigSnapshot.create({
        data: {
          projectId,
          version: snapshotVersion,
          snapshotJson: this.toSnapshotJson(after),
          description: "项目配置更新快照",
          createdBy: input.updatedBy
        }
      });
      await tx.projectChangeLog.create({
        data: {
          projectId,
          action: "project.config.replace",
          targetType: "project",
          targetId: String(projectId),
          beforeJson: this.toSnapshotJson(before),
          afterJson: this.toSnapshotJson(after),
          operatorAccount: input.updatedBy
        }
      });

      return after;
    });

    console.info("[projects-repository] 项目配置替换完成", { projectId: project.id, code: project.code });
    return this.toProjectDetail(project);
  }

  /** 构造项目基础字段更新数据。 */
  private buildProjectUpdateData(input: ReplaceProjectConfigInput): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.ownerAccount !== undefined) data.ownerAccount = input.ownerAccount;
    if (input.status !== undefined) data.status = input.status;
    data.updatedBy = input.updatedBy;
    return data;
  }

  /** 提取去重后的非空字符串，供 runtime-context 批量查询引用数据。 */
  private uniqueStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
  }

  /** 构造 Desktop 可消费的项目 Skill 工件元数据，并在缺少 hash 时显式告警。 */
  private toRuntimeArtifact(
    releaseId: string,
    downloadUrl: string | null | undefined,
    size: number | null | undefined,
    sha256: string | null | undefined,
    warnings: ProjectRuntimeWarning[],
    targetType: "skill" | "mcp",
    targetId: string
  ): ProjectRuntimeArtifact {
    const normalizedSha256 = sha256?.trim() ?? "";
    if (!normalizedSha256) {
      warnings.push({
        code: "project_artifact_hash_unavailable",
        message: "当前 Cloud release 尚未保存 artifact sha256，Desktop 会同步元数据但拒绝安装该工件。",
        targetType,
        targetId
      });
      console.warn("[projects-repository] runtime-context release 缺少 artifact sha256", {
        releaseId,
        targetType,
        targetId
      });
    }
    if (!downloadUrl) {
      warnings.push({
        code: "project_artifact_download_url_missing",
        message: "当前 release 未保存可下载工件地址，Desktop 需要等待后续同步补齐后才能安装。",
        targetType,
        targetId
      });
    }
    return {
      downloadUrl: downloadUrl ?? "",
      sha256: normalizedSha256,
      size: size ?? 0,
      signature: `release:${releaseId}`
    };
  }

  /** 从 MCP release config 中解析传输类型，兼容旧 http 写法。 */
  private normalizeMcpTransport(configJson: unknown): "stdio" | "sse" | "streamable-http" | "http" {
    if (configJson && typeof configJson === "object" && "transport" in configJson) {
      const transport = String((configJson as { transport?: unknown }).transport);
      if (transport === "stdio" || transport === "sse" || transport === "streamable-http" || transport === "http") {
        return transport;
      }
    }
    return "stdio";
  }

  /** 根据项目风险字段和传输方式收敛运行时风险等级。 */
  private normalizeRuntimeRisk(
    riskLevel: string | null | undefined,
    transport: "stdio" | "sse" | "streamable-http" | "http"
  ): "low" | "medium" | "high" {
    const normalized = riskLevel?.toLowerCase();
    if (normalized === "low" || normalized === "read") return "low";
    if (normalized === "medium" || normalized === "network") return "medium";
    if (normalized === "high" || normalized === "write" || normalized === "exec") return "high";
    return transport === "stdio" ? "high" : "medium";
  }

  /** 解析项目配置版本，优先使用最新快照版本，否则回退更新时间戳。 */
  private resolveProjectRuntimeVersion(project: any): number {
    const latestSnapshot = project.snapshots?.[0];
    if (latestSnapshot?.version && Number.isInteger(latestSnapshot.version)) {
      return latestSnapshot.version;
    }
    return project.updatedAt instanceof Date ? project.updatedAt.getTime() : 1;
  }

  /** 基于项目和 release 更新时间生成稳定 etag，供 Desktop 判断是否需要同步。 */
  private buildRuntimeContextEtag(project: any, skillReleases: any[], mcpReleases: any[]): string {
    const parts = [
      project.id,
      project.updatedAt?.toISOString?.() ?? String(project.updatedAt ?? ""),
      ...project.skills.map((item: any) => `${item.id}:${item.updatedAt?.toISOString?.() ?? ""}`),
      ...project.mcps.map((item: any) => `${item.id}:${item.updatedAt?.toISOString?.() ?? ""}`),
      ...skillReleases.map((item: any) => `${item.id}:${item.updatedAt?.toISOString?.() ?? ""}:${item.artifactSha256 ?? ""}`),
      ...mcpReleases.map((item: any) => `${item.id}:${item.updatedAt?.toISOString?.() ?? ""}`)
    ];
    return createHash("sha256").update(parts.join("|")).digest("hex");
  }

  /** 替换项目服务端点清单。 */
  private async replaceServices(tx: any, projectId: ProjectId, input: ReplaceProjectConfigInput): Promise<void> {
    if (input.services === undefined) return;
    await tx.projectServiceEndpoint.deleteMany({ where: { projectId } });
    if (input.services.length === 0) return;
    await tx.projectServiceEndpoint.createMany({
      data: input.services.map((item, index) => ({
        projectId,
        name: item.name,
        baseUrl: item.baseUrl,
        description: item.description ?? null,
        enabled: item.enabled ?? true,
        sortOrder: item.sortOrder ?? index
      }))
    });
  }

  /** 替换项目接口清单。 */
  private async replaceApis(tx: any, projectId: ProjectId, input: ReplaceProjectConfigInput): Promise<void> {
    if (input.apis === undefined) return;
    await tx.projectApi.deleteMany({ where: { projectId } });
    if (input.apis.length === 0) return;
    await tx.projectApi.createMany({
      data: input.apis.map((item) => ({
        projectId,
        name: item.name,
        serviceName: item.serviceName ?? null,
        direction: item.direction ?? "provided",
        protocol: item.protocol ?? "http",
        method: item.method ?? null,
        path: item.path ?? null,
        description: item.description ?? null,
        source: item.source ?? "manual",
        owner: item.owner ?? null,
        tagsJson: item.tagsJson === undefined ? undefined : item.tagsJson as object,
        parametersJson: item.parametersJson === undefined ? undefined : item.parametersJson as object,
        requestBodyType: item.requestBodyType ?? "none",
        requestBodyContentType: item.requestBodyContentType ?? null,
        requestBodyExampleJson: item.requestBodyExampleJson === undefined ? undefined : item.requestBodyExampleJson as object,
        requestSchemaJson: item.requestSchemaJson === undefined ? undefined : item.requestSchemaJson as object,
        responseSchemaJson: item.responseSchemaJson === undefined ? undefined : item.responseSchemaJson as object,
        enabled: item.enabled ?? true
      }))
    });
  }

  /** 替换项目 Skill 挂载。 */
  private async replaceSkills(tx: any, projectId: ProjectId, input: ReplaceProjectConfigInput): Promise<void> {
    if (input.skills === undefined) return;
    await tx.projectSkillRef.deleteMany({ where: { projectId } });
    if (input.skills.length === 0) return;
    await tx.projectSkillRef.createMany({
      data: input.skills.map((item) => ({
        projectId,
        skillId: item.skillId,
        skillReleaseId: item.skillReleaseId ?? null,
        alias: item.alias ?? null,
        enabled: item.enabled ?? true,
        configJson: item.configJson === undefined ? undefined : item.configJson as object
      }))
    });
  }

  /** 替换项目 MCP 挂载。 */
  private async replaceMcps(tx: any, projectId: ProjectId, input: ReplaceProjectConfigInput): Promise<void> {
    if (input.mcps === undefined) return;
    await tx.projectMcpRef.deleteMany({ where: { projectId } });
    if (input.mcps.length === 0) return;
    await tx.projectMcpRef.createMany({
      data: input.mcps.map((item) => ({
        projectId,
        mcpServerId: item.mcpServerId,
        mcpReleaseId: item.mcpReleaseId ?? null,
        alias: item.alias ?? null,
        riskLevel: item.riskLevel ?? null,
        enabled: item.enabled ?? true,
        configOverrideJson: item.configOverrideJson === undefined ? undefined : item.configOverrideJson as object
      }))
    });
  }

  /** 替换项目工作流预留引用。 */
  private async replaceWorkflows(tx: any, projectId: ProjectId, input: ReplaceProjectConfigInput): Promise<void> {
    if (input.workflows === undefined) return;
    await tx.projectWorkflowRef.deleteMany({ where: { projectId } });
    if (input.workflows.length === 0) return;
    await tx.projectWorkflowRef.createMany({
      data: input.workflows.map((item) => ({
        projectId,
        workflowId: item.workflowId,
        workflowName: item.workflowName ?? null,
        enabled: item.enabled ?? false
      }))
    });
  }

  /** 替换项目硅基员工预留引用。 */
  private async replaceSiliconPersons(tx: any, projectId: ProjectId, input: ReplaceProjectConfigInput): Promise<void> {
    if (input.siliconPersons === undefined) return;
    await tx.projectSiliconPersonRef.deleteMany({ where: { projectId } });
    if (input.siliconPersons.length === 0) return;
    await tx.projectSiliconPersonRef.createMany({
      data: input.siliconPersons.map((item) => ({
        projectId,
        siliconPersonId: item.siliconPersonId,
        roleName: item.roleName ?? null,
        enabled: item.enabled ?? false
      }))
    });
  }

  /** 构造嵌套创建项目服务端点的数据。 */
  private createServicesData(items: CreateProjectInput["services"]) {
    if (!items || items.length === 0) return undefined;
    return {
      create: items.map((item, index) => ({
        name: item.name,
        baseUrl: item.baseUrl,
        description: item.description ?? null,
        enabled: item.enabled ?? true,
        sortOrder: item.sortOrder ?? index
      }))
    };
  }

  /** 构造嵌套创建项目仓库的数据。 */
  private createRepositoriesData(items: CreateProjectInput["repositories"]) {
    if (!items || items.length === 0) return undefined;
    return {
      create: items.map((item, index) => ({
        name: item.name,
        gitUrl: item.gitUrl,
        repoType: item.repoType ?? "service",
        defaultBranch: item.defaultBranch ?? null,
        description: item.description ?? null,
        enabled: item.enabled ?? true,
        sortOrder: item.sortOrder ?? index
      }))
    };
  }

  /** 构造嵌套创建融智链绑定的数据。 */
  private createRongzhiLinkData(item: CreateProjectInput["rongzhiLink"]) {
    if (!item) return undefined;
    return {
      create: {
        projectCode: item.projectCode,
        projectName: item.projectName ?? null,
        baseUrl: item.baseUrl ?? null,
        enabled: item.enabled ?? true
      }
    };
  }

  /** 构造嵌套创建接口清单的数据。 */
  private createApisData(items: CreateProjectInput["apis"]) {
    if (!items || items.length === 0) return undefined;
    return {
      create: items.map((item) => ({
        name: item.name,
        serviceName: item.serviceName ?? null,
        direction: item.direction ?? "provided",
        protocol: item.protocol ?? "http",
        method: item.method ?? null,
        path: item.path ?? null,
        description: item.description ?? null,
        source: item.source ?? "manual",
        owner: item.owner ?? null,
        tagsJson: item.tagsJson === undefined ? undefined : item.tagsJson as object,
        parametersJson: item.parametersJson === undefined ? undefined : item.parametersJson as object,
        requestBodyType: item.requestBodyType ?? "none",
        requestBodyContentType: item.requestBodyContentType ?? null,
        requestBodyExampleJson: item.requestBodyExampleJson === undefined ? undefined : item.requestBodyExampleJson as object,
        requestSchemaJson: item.requestSchemaJson === undefined ? undefined : item.requestSchemaJson as object,
        responseSchemaJson: item.responseSchemaJson === undefined ? undefined : item.responseSchemaJson as object,
        enabled: item.enabled ?? true
      }))
    };
  }

  /** 构造嵌套创建 Skill 挂载的数据。 */
  private createSkillsData(items: CreateProjectInput["skills"]) {
    if (!items || items.length === 0) return undefined;
    return {
      create: items.map((item) => ({
        skillId: item.skillId,
        skillReleaseId: item.skillReleaseId ?? null,
        alias: item.alias ?? null,
        enabled: item.enabled ?? true,
        configJson: item.configJson === undefined ? undefined : item.configJson as object
      }))
    };
  }

  /** 构造嵌套创建 MCP 挂载的数据。 */
  private createMcpsData(items: CreateProjectInput["mcps"]) {
    if (!items || items.length === 0) return undefined;
    return {
      create: items.map((item) => ({
        mcpServerId: item.mcpServerId,
        mcpReleaseId: item.mcpReleaseId ?? null,
        alias: item.alias ?? null,
        riskLevel: item.riskLevel ?? null,
        enabled: item.enabled ?? true,
        configOverrideJson: item.configOverrideJson === undefined ? undefined : item.configOverrideJson as object
      }))
    };
  }

  /** 构造嵌套创建工作流预留引用的数据。 */
  private createWorkflowsData(items: CreateProjectInput["workflows"]) {
    if (!items || items.length === 0) return undefined;
    return {
      create: items.map((item) => ({
        workflowId: item.workflowId,
        workflowName: item.workflowName ?? null,
        enabled: item.enabled ?? false
      }))
    };
  }

  /** 构造嵌套创建硅基员工预留引用的数据。 */
  private createSiliconPersonsData(items: CreateProjectInput["siliconPersons"]) {
    if (!items || items.length === 0) return undefined;
    return {
      create: items.map((item) => ({
        siliconPersonId: item.siliconPersonId,
        roleName: item.roleName ?? null,
        enabled: item.enabled ?? false
      }))
    };
  }

  /** 将 Prisma 项目记录转换为共享契约详情。 */
  private toProjectDetail(project: any): ProjectDetail {
    return {
      id: project.id,
      code: project.code,
      name: project.name,
      description: project.description,
      ownerAccount: project.ownerAccount,
      status: project.status as ProjectStatus,
      services: project.services.map((item: any): ProjectServiceInfo => ({
        id: item.id,
        name: item.name,
        baseUrl: item.baseUrl,
        description: item.description,
        enabled: item.enabled,
        sortOrder: item.sortOrder
      })),
      repositories: project.repositories.map((item: any): ProjectRepositoryInfo => ({
        id: item.id,
        name: item.name,
        gitUrl: item.gitUrl,
        repoType: item.repoType,
        defaultBranch: item.defaultBranch,
        description: item.description,
        enabled: item.enabled,
        sortOrder: item.sortOrder
      })),
      rongzhiLink: project.rongzhiLink ? this.toRongzhiLink(project.rongzhiLink) : null,
      apis: project.apis.map((item: any): ProjectApiInfo => ({
        id: item.id,
        name: item.name,
        serviceName: item.serviceName,
        direction: item.direction,
        protocol: item.protocol,
        method: item.method,
        path: item.path,
        description: item.description,
        source: item.source,
        owner: item.owner,
        tagsJson: item.tagsJson ?? null,
        parametersJson: item.parametersJson ?? null,
        requestBodyType: item.requestBodyType ?? "none",
        requestBodyContentType: item.requestBodyContentType ?? null,
        requestBodyExampleJson: item.requestBodyExampleJson ?? null,
        requestSchemaJson: item.requestSchemaJson ?? null,
        responseSchemaJson: item.responseSchemaJson ?? null,
        enabled: item.enabled
      })),
      skills: project.skills.map((item: any): ProjectSkillRefInfo => ({
        id: item.id,
        skillId: item.skillId,
        skillReleaseId: item.skillReleaseId,
        alias: item.alias,
        enabled: item.enabled,
        configJson: item.configJson ?? null
      })),
      mcps: project.mcps.map((item: any): ProjectMcpRefInfo => ({
        id: item.id,
        mcpServerId: item.mcpServerId,
        mcpReleaseId: item.mcpReleaseId,
        alias: item.alias,
        riskLevel: item.riskLevel,
        enabled: item.enabled,
        configOverrideJson: item.configOverrideJson ?? null
      })),
      workflows: project.workflows.map((item: any): ProjectWorkflowRefInfo => ({
        id: item.id,
        workflowId: item.workflowId,
        workflowName: item.workflowName,
        enabled: item.enabled
      })),
      siliconPersons: project.siliconPersons.map((item: any): ProjectSiliconPersonRefInfo => ({
        id: item.id,
        siliconPersonId: item.siliconPersonId,
        roleName: item.roleName,
        enabled: item.enabled
      })),
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString()
    };
  }

  /** 将融智链记录转换为共享契约。 */
  private toRongzhiLink(item: any): ProjectRongzhiLinkInfo {
    return {
      projectCode: item.projectCode,
      projectName: item.projectName,
      baseUrl: item.baseUrl,
      enabled: item.enabled,
      lastHealthStatus: item.lastHealthStatus,
      lastCheckedAt: item.lastCheckedAt ? item.lastCheckedAt.toISOString() : null
    };
  }

  /** 构造可写入快照表的项目配置 JSON。 */
  private toSnapshotJson(project: any): object {
    return this.toProjectDetail(project) as unknown as object;
  }
}
