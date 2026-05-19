import type {
  CreateProjectInput,
  ProjectDetail,
  ProjectId,
  ProjectRuntimeContext,
  ProjectSummary,
  ReplaceProjectConfigInput
} from "@myclaw-cloud/shared";

/** 项目仓储接口：封装项目维护台的列表、详情、创建与配置替换能力。 */
export interface ProjectsRepository {
  /** 查询项目摘要列表，并返回项目下仓库、接口、Skill 与 MCP 的数量。 */
  list(): Promise<ProjectSummary[]>;

  /** 根据项目 ID 查询项目完整详情。 */
  findById(id: ProjectId): Promise<ProjectDetail | null>;

  /** 根据项目编码查询项目完整详情，用于创建前去重。 */
  findByCode(code: string): Promise<ProjectDetail | null>;

  /** 查询项目运行上下文所需的完整项目、Skill release、MCP release 和工件信息。 */
  findRuntimeContextById(id: ProjectId): Promise<ProjectRuntimeContext | null>;

  /** 创建项目并写入初始配置、初始快照和变更日志。 */
  createProject(input: CreateProjectInput): Promise<ProjectDetail>;

  /** 替换项目配置并写入新的配置快照和变更日志。 */
  replaceProjectConfig(projectId: ProjectId, input: ReplaceProjectConfigInput): Promise<ProjectDetail>;
}

export const PROJECTS_REPOSITORY = Symbol("PROJECTS_REPOSITORY");
