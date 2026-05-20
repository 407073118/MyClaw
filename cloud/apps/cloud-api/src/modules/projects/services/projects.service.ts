import type {
  CreateProjectInput,
  ProjectApiInput,
  ProjectApiParameterInfo,
  ProjectApiParameterLocation,
  ProjectApiRequestBodyType,
  ProjectDetail,
  ProjectId,
  ProjectMcpRefInput,
  ProjectRepositoryInput,
  ProjectRuntimeContext,
  ProjectSiliconPersonRefInput,
  ProjectSkillRefInput,
  ProjectSummary,
  ProjectWorkflowRefInput,
  ReplaceProjectConfigInput
} from "@myclaw-cloud/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { DatabaseService } from "../../database/services/database.service";
import { PROJECTS_REPOSITORY, type ProjectsRepository } from "../ports/projects.repository";

const API_PARAMETER_LOCATIONS: ProjectApiParameterLocation[] = ["path", "query", "header", "cookie"];
const API_REQUEST_BODY_TYPES: ProjectApiRequestBodyType[] = [
  "none",
  "json",
  "form-data",
  "x-www-form-urlencoded",
  "raw",
  "binary",
  "graphql"
];

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PROJECTS_REPOSITORY)
    private readonly projectsRepository: ProjectsRepository,
    private readonly databaseService: DatabaseService
  ) {}

  /** 查询项目列表，供 Cloud 项目维护台展示。 */
  async list(): Promise<ProjectSummary[]> {
    console.info("[projects-service] 查询项目列表");
    return this.projectsRepository.list();
  }

  /** 查询项目详情，缺失时返回空值交由控制器处理。 */
  async findById(id: ProjectId): Promise<ProjectDetail | null> {
    console.info("[projects-service] 查询项目详情", { projectId: id });
    return this.projectsRepository.findById(id);
  }

  /** 获取 Desktop 绑定项目时使用的运行上下文快照。 */
  async getRuntimeContext(projectId: ProjectId): Promise<ProjectRuntimeContext> {
    console.info("[projects-service] 查询项目运行上下文", { projectId });
    const context = await this.projectsRepository.findRuntimeContextById(projectId);
    if (!context) {
      console.warn("[projects-service] 项目运行上下文不存在", { projectId });
      throw new NotFoundException("Project not found");
    }
    return context;
  }

  /** 创建项目并保存第一版项目配置。 */
  async createProject(input: CreateProjectInput): Promise<ProjectDetail> {
    const normalized = this.normalizeCreateInput(input);
    console.info("[projects-service] 准备创建项目", {
      code: normalized.code,
      serviceCount: normalized.services?.length ?? 0,
      repositoryCount: normalized.repositories?.length ?? 0,
      apiCount: normalized.apis?.length ?? 0,
      skillCount: normalized.skills?.length ?? 0,
      mcpCount: normalized.mcps?.length ?? 0
    });

    const existing = await this.projectsRepository.findByCode(normalized.code);
    if (existing) {
      console.warn("[projects-service] 项目编码已存在，拒绝创建", { code: normalized.code });
      throw new BadRequestException("project_code_already_exists");
    }

    await this.validateCapabilityRefs(normalized.skills, normalized.mcps);
    return this.projectsRepository.createProject(normalized);
  }

  /** 替换项目配置，支持仓库、融智链、接口、Skill、MCP 以及预留引用。 */
  async replaceProjectConfig(projectId: ProjectId, input: ReplaceProjectConfigInput): Promise<ProjectDetail> {
    const normalized = this.normalizeReplaceInput(input);
    console.info("[projects-service] 准备替换项目配置", {
      projectId,
      updatedBy: normalized.updatedBy,
      hasRepositories: normalized.repositories !== undefined,
      hasServices: normalized.services !== undefined,
      hasApis: normalized.apis !== undefined,
      hasSkills: normalized.skills !== undefined,
      hasMcps: normalized.mcps !== undefined,
      hasWorkflows: normalized.workflows !== undefined,
      hasSiliconPersons: normalized.siliconPersons !== undefined
    });

    const existing = await this.projectsRepository.findById(projectId);
    if (!existing) {
      console.warn("[projects-service] 项目不存在，无法替换配置", { projectId });
      throw new NotFoundException("project_not_found");
    }

    await this.validateCapabilityRefs(normalized.skills, normalized.mcps);
    return this.projectsRepository.replaceProjectConfig(projectId, normalized);
  }

  /** 标准化创建输入，避免空白字段进入数据库。 */
  private normalizeCreateInput(input: CreateProjectInput): CreateProjectInput {
    const code = input.code?.trim();
    const name = input.name?.trim();
    const ownerAccount = input.ownerAccount?.trim();
    const createdBy = input.createdBy?.trim();
    if (!code) throw new BadRequestException("project_code_required");
    if (!name) throw new BadRequestException("project_name_required");
    if (!ownerAccount) throw new BadRequestException("project_owner_required");
    if (!createdBy) throw new BadRequestException("project_created_by_required");

    const normalized: CreateProjectInput = {
      ...input,
      code,
      name,
      description: this.trimNullable(input.description),
      ownerAccount,
      status: input.status ?? "active",
      createdBy,
      services: this.normalizeServices(input.services),
      repositories: this.normalizeRepositories(input.repositories),
      rongzhiLink: input.rongzhiLink
        ? {
            ...input.rongzhiLink,
            projectCode: this.required(input.rongzhiLink.projectCode, "rongzhi_project_code_required"),
            projectName: this.trimNullable(input.rongzhiLink.projectName),
            baseUrl: this.trimNullable(input.rongzhiLink.baseUrl),
            enabled: input.rongzhiLink.enabled ?? true
          }
        : input.rongzhiLink,
      apis: this.normalizeApis(input.apis),
      skills: this.normalizeSkills(input.skills),
      mcps: this.normalizeMcps(input.mcps),
      workflows: this.normalizeWorkflows(input.workflows),
      siliconPersons: this.normalizeSiliconPersons(input.siliconPersons)
    };
    this.assertUniqueNames(normalized.services ?? [], "name", "project_service_name_duplicated");
    this.assertUniqueNames(normalized.repositories ?? [], "name", "project_repository_name_duplicated");
    this.assertUniqueNames(normalized.skills ?? [], "skillId", "project_skill_id_duplicated");
    this.assertUniqueNames(normalized.mcps ?? [], "mcpServerId", "project_mcp_server_id_duplicated");
    return normalized;
  }

  /** 标准化配置替换输入，保持未传字段不被误删。 */
  private normalizeReplaceInput(input: ReplaceProjectConfigInput): ReplaceProjectConfigInput {
    const updatedBy = input.updatedBy?.trim();
    if (!updatedBy) throw new BadRequestException("project_updated_by_required");

    const normalized: ReplaceProjectConfigInput = {
      ...input,
      name: input.name === undefined ? undefined : this.required(input.name, "project_name_required"),
      description: input.description === undefined ? undefined : this.trimNullable(input.description),
      ownerAccount: input.ownerAccount === undefined ? undefined : this.required(input.ownerAccount, "project_owner_required"),
      updatedBy,
      services: this.normalizeServices(input.services),
      repositories: this.normalizeRepositories(input.repositories),
      rongzhiLink: input.rongzhiLink === undefined
        ? undefined
        : input.rongzhiLink
          ? {
              ...input.rongzhiLink,
              projectCode: this.required(input.rongzhiLink.projectCode, "rongzhi_project_code_required"),
              projectName: this.trimNullable(input.rongzhiLink.projectName),
              baseUrl: this.trimNullable(input.rongzhiLink.baseUrl),
              enabled: input.rongzhiLink.enabled ?? true
            }
          : null,
      apis: this.normalizeApis(input.apis),
      skills: this.normalizeSkills(input.skills),
      mcps: this.normalizeMcps(input.mcps),
      workflows: this.normalizeWorkflows(input.workflows),
      siliconPersons: this.normalizeSiliconPersons(input.siliconPersons)
    };
    this.assertUniqueNames(normalized.services ?? [], "name", "project_service_name_duplicated");
    this.assertUniqueNames(normalized.repositories ?? [], "name", "project_repository_name_duplicated");
    this.assertUniqueNames(normalized.skills ?? [], "skillId", "project_skill_id_duplicated");
    this.assertUniqueNames(normalized.mcps ?? [], "mcpServerId", "project_mcp_server_id_duplicated");
    return normalized;
  }

  /** 标准化项目服务端点输入。 */
  private normalizeServices(input?: CreateProjectInput["services"]): CreateProjectInput["services"] | undefined {
    return input?.map((item, index) => ({
      ...item,
      name: this.required(item.name, "project_service_name_required"),
      baseUrl: this.required(item.baseUrl, "project_service_base_url_required"),
      description: this.trimNullable(item.description),
      enabled: item.enabled ?? true,
      sortOrder: item.sortOrder ?? index
    }));
  }

  /** 标准化项目仓库输入。 */
  private normalizeRepositories(input?: ProjectRepositoryInput[]): ProjectRepositoryInput[] | undefined {
    return input?.map((item, index) => ({
      ...item,
      name: this.required(item.name, "project_repository_name_required"),
      gitUrl: this.required(item.gitUrl, "project_repository_git_url_required"),
      repoType: item.repoType ?? "service",
      defaultBranch: this.trimNullable(item.defaultBranch),
      description: this.trimNullable(item.description),
      enabled: item.enabled ?? true,
      sortOrder: item.sortOrder ?? index
    }));
  }

  /** 标准化项目接口输入。 */
  private normalizeApis(input?: ProjectApiInput[]): ProjectApiInput[] | undefined {
    return input?.map((item) => ({
      ...item,
      name: this.required(item.name, "project_api_name_required"),
      serviceName: this.trimNullable(item.serviceName),
      direction: item.direction ?? "provided",
      protocol: item.protocol ?? "http",
      method: this.trimNullable(item.method),
      path: this.trimNullable(item.path),
      description: this.trimNullable(item.description),
      source: item.source ?? "manual",
      owner: this.trimNullable(item.owner),
      tagsJson: this.normalizeStringArray(item.tagsJson, "project_api_tags_invalid"),
      parametersJson: this.normalizeApiParameters(item.parametersJson),
      requestBodyType: this.normalizeApiRequestBodyType(item.requestBodyType),
      requestBodyContentType: this.trimNullable(item.requestBodyContentType),
      requestBodyExampleJson: this.normalizeJsonValue(item.requestBodyExampleJson),
      requestSchemaJson: this.normalizeJsonObject(item.requestSchemaJson, "project_api_request_schema_invalid"),
      responseSchemaJson: this.normalizeJsonObject(item.responseSchemaJson, "project_api_response_schema_invalid"),
      enabled: item.enabled ?? true
    }));
  }

  /** 标准化项目 Skill 挂载输入。 */
  private normalizeSkills(input?: ProjectSkillRefInput[]): ProjectSkillRefInput[] | undefined {
    return input?.map((item) => ({
      ...item,
      skillId: this.required(item.skillId, "project_skill_id_required"),
      skillReleaseId: this.trimNullable(item.skillReleaseId),
      alias: this.trimNullable(item.alias),
      configJson: this.normalizeJsonObject(item.configJson, "project_skill_config_invalid"),
      enabled: item.enabled ?? true
    }));
  }

  /** 标准化项目 MCP 挂载输入。 */
  private normalizeMcps(input?: ProjectMcpRefInput[]): ProjectMcpRefInput[] | undefined {
    return input?.map((item) => ({
      ...item,
      mcpServerId: this.required(item.mcpServerId, "project_mcp_server_id_required"),
      mcpReleaseId: this.trimNullable(item.mcpReleaseId),
      alias: this.trimNullable(item.alias),
      riskLevel: this.trimNullable(item.riskLevel),
      configOverrideJson: this.normalizeJsonObject(
        item.configOverrideJson,
        "project_mcp_config_override_invalid"
      ),
      enabled: item.enabled ?? true
    }));
  }

  /** 校验项目关联的 Skill 与 MCP 引用是否真实存在，避免保存后无法消费。 */
  private async validateCapabilityRefs(
    skills?: ProjectSkillRefInput[],
    mcps?: ProjectMcpRefInput[]
  ): Promise<void> {
    await this.validateSkillRefs(skills);
    await this.validateMcpRefs(mcps);
  }

  /** 校验项目 Skill 挂载引用与 release 归属关系。 */
  private async validateSkillRefs(skills?: ProjectSkillRefInput[]): Promise<void> {
    if (!skills?.length) {
      return;
    }

    const skillIds = this.uniqueValues(skills.map((item) => item.skillId));
    console.info("[projects-service] 开始校验项目 Skill 引用", {
      skillCount: skillIds.length
    });
    const existingSkills = await this.databaseService.skill.findMany({
      where: {
        id: {
          in: skillIds
        }
      },
      select: {
        id: true
      }
    });
    const existingSkillIds = new Set(existingSkills.map((item) => item.id));
    const missingSkillId = skillIds.find((skillId) => !existingSkillIds.has(skillId));
    if (missingSkillId) {
      console.warn("[projects-service] 项目 Skill 引用不存在，拒绝保存", {
        missingSkillId
      });
      throw new BadRequestException("project_skill_not_found");
    }

    const releaseRefs = skills
      .filter((item): item is ProjectSkillRefInput & { skillReleaseId: string } => Boolean(item.skillReleaseId))
      .map((item) => ({
        skillId: item.skillId,
        releaseId: item.skillReleaseId
      }));
    if (!releaseRefs.length) {
      return;
    }

    const releaseIds = this.uniqueValues(releaseRefs.map((item) => item.releaseId));
    const releases = await this.databaseService.skillRelease.findMany({
      where: {
        id: {
          in: releaseIds
        }
      },
      select: {
        id: true,
        skillId: true
      }
    });
    const releaseMap = new Map(releases.map((item) => [item.id, item]));

    for (const releaseRef of releaseRefs) {
      const release = releaseMap.get(releaseRef.releaseId);
      if (!release) {
        console.warn("[projects-service] 项目 Skill release 不存在，拒绝保存", {
          releaseId: releaseRef.releaseId,
          skillId: releaseRef.skillId
        });
        throw new BadRequestException("project_skill_release_not_found");
      }

      if (release.skillId !== releaseRef.skillId) {
        console.warn("[projects-service] 项目 Skill release 与 Skill 不匹配，拒绝保存", {
          releaseId: releaseRef.releaseId,
          expectedSkillId: releaseRef.skillId,
          actualSkillId: release.skillId
        });
        throw new BadRequestException("project_skill_release_mismatch");
      }
    }
  }

  /** 校验项目 MCP 挂载引用与 release 归属关系。 */
  private async validateMcpRefs(mcps?: ProjectMcpRefInput[]): Promise<void> {
    if (!mcps?.length) {
      return;
    }

    const mcpServerIds = this.uniqueValues(mcps.map((item) => item.mcpServerId));
    console.info("[projects-service] 开始校验项目 MCP 引用", {
      mcpCount: mcpServerIds.length
    });
    const existingMcps = await this.databaseService.mcpServer.findMany({
      where: {
        id: {
          in: mcpServerIds
        }
      },
      select: {
        id: true
      }
    });
    const existingMcpIds = new Set(existingMcps.map((item) => item.id));
    const missingMcpId = mcpServerIds.find((mcpServerId) => !existingMcpIds.has(mcpServerId));
    if (missingMcpId) {
      console.warn("[projects-service] 项目 MCP 引用不存在，拒绝保存", {
        missingMcpId
      });
      throw new BadRequestException("project_mcp_not_found");
    }

    const releaseRefs = mcps
      .filter((item): item is ProjectMcpRefInput & { mcpReleaseId: string } => Boolean(item.mcpReleaseId))
      .map((item) => ({
        mcpServerId: item.mcpServerId,
        releaseId: item.mcpReleaseId
      }));
    if (!releaseRefs.length) {
      return;
    }

    const releaseIds = this.uniqueValues(releaseRefs.map((item) => item.releaseId));
    const releases = await this.databaseService.mcpServerRelease.findMany({
      where: {
        id: {
          in: releaseIds
        }
      },
      select: {
        id: true,
        serverId: true
      }
    });
    const releaseMap = new Map(releases.map((item) => [item.id, item]));

    for (const releaseRef of releaseRefs) {
      const release = releaseMap.get(releaseRef.releaseId);
      if (!release) {
        console.warn("[projects-service] 项目 MCP release 不存在，拒绝保存", {
          releaseId: releaseRef.releaseId,
          mcpServerId: releaseRef.mcpServerId
        });
        throw new BadRequestException("project_mcp_release_not_found");
      }

      if (release.serverId !== releaseRef.mcpServerId) {
        console.warn("[projects-service] 项目 MCP release 与 MCP 不匹配，拒绝保存", {
          releaseId: releaseRef.releaseId,
          expectedMcpServerId: releaseRef.mcpServerId,
          actualMcpServerId: release.serverId
        });
        throw new BadRequestException("project_mcp_release_mismatch");
      }
    }
  }

  /** 标准化项目工作流预留引用。 */
  private normalizeWorkflows(input?: ProjectWorkflowRefInput[]): ProjectWorkflowRefInput[] | undefined {
    return input?.map((item) => ({
      ...item,
      workflowId: this.required(item.workflowId, "project_workflow_id_required"),
      workflowName: this.trimNullable(item.workflowName),
      enabled: item.enabled ?? false
    }));
  }

  /** 标准化项目硅基员工预留引用。 */
  private normalizeSiliconPersons(input?: ProjectSiliconPersonRefInput[]): ProjectSiliconPersonRefInput[] | undefined {
    return input?.map((item) => ({
      ...item,
      siliconPersonId: this.required(item.siliconPersonId, "project_silicon_person_id_required"),
      roleName: this.trimNullable(item.roleName),
      enabled: item.enabled ?? false
    }));
  }

  /** 必填字符串裁剪，裁剪后为空则抛出业务错误。 */
  private required(value: string | null | undefined, errorCode: string): string {
    const trimmed = value?.trim();
    if (!trimmed) throw new BadRequestException(errorCode);
    return trimmed;
  }

  /** 可空字符串裁剪，空字符串统一写为 null。 */
  private trimNullable(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  /** 归一化对象类 JSON 字段，拒绝字符串化 JSON 混入项目配置。 */
  private normalizeJsonObject(
    value: unknown,
    errorCode: string
  ): Record<string, unknown> | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(errorCode);
    }

    return value as Record<string, unknown>;
  }

  /** 归一化字符串数组字段，确保标签等列表数据可直接消费。 */
  private normalizeStringArray(value: unknown, errorCode: string): string[] | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new BadRequestException(errorCode);
    }

    return value.map((item) => item.trim()).filter(Boolean);
  }

  /** 标准化接口请求参数，兼容 path、query、header、cookie 四类 HTTP 参数。 */
  private normalizeApiParameters(value: unknown): ProjectApiParameterInfo[] | null | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    if (!Array.isArray(value)) {
      console.warn("[projects-service] 接口请求参数不是数组，拒绝保存");
      throw new BadRequestException("project_api_parameters_invalid");
    }

    console.info("[projects-service] 标准化接口请求参数", { parameterCount: value.length });
    return value.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new BadRequestException("project_api_parameters_invalid");
      }

      const item = raw as Partial<ProjectApiParameterInfo>;
      const location = item.in;
      if (!location || !API_PARAMETER_LOCATIONS.includes(location)) {
        throw new BadRequestException("project_api_parameter_location_invalid");
      }

      const required = item.required ?? (location === "path");
      if (location === "path" && !required) {
        console.warn("[projects-service] 路径参数被标记为非必填，拒绝保存", { parameterName: item.name });
        throw new BadRequestException("project_api_path_parameter_required");
      }

      return {
        name: this.required(item.name, "project_api_parameter_name_required"),
        in: location,
        required,
        type: this.trimNullable(item.type),
        description: this.trimNullable(item.description),
        example: this.trimNullable(item.example),
        enabled: item.enabled ?? true
      };
    });
  }

  /** 标准化接口请求 Body 类型，避免未知类型进入数据库。 */
  private normalizeApiRequestBodyType(value: unknown): ProjectApiRequestBodyType {
    if (value === undefined || value === null || value === "") {
      return "none";
    }

    if (typeof value !== "string" || !API_REQUEST_BODY_TYPES.includes(value as ProjectApiRequestBodyType)) {
      console.warn("[projects-service] 接口请求 Body 类型不合法，拒绝保存", { bodyType: value });
      throw new BadRequestException("project_api_request_body_type_invalid");
    }

    return value as ProjectApiRequestBodyType;
  }

  /** 标准化任意 JSON 值，保留 Body 示例中的对象、数组、字符串、数字和布尔值。 */
  private normalizeJsonValue(value: unknown): unknown {
    if (value === undefined) {
      return undefined;
    }

    return value;
  }

  /** 检查列表内指定字段是否重复。 */
  private assertUniqueNames<T extends Record<string, unknown>>(items: T[], key: keyof T, errorCode: string): void {
    const seen = new Set<string>();
    for (const item of items) {
      const value = String(item[key] ?? "");
      if (seen.has(value)) throw new BadRequestException(errorCode);
      seen.add(value);
    }
  }

  /** 提取去重后的字符串集合，供批量查询数据库引用时复用。 */
  private uniqueValues(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
  }
}
