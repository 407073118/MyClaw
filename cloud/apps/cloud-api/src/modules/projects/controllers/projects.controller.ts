import type { CreateProjectInput, ProjectRuntimeContext, ReplaceProjectConfigInput } from "@myclaw-cloud/shared";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put
} from "@nestjs/common";

import { ProjectsService } from "../services/projects.service";

@Controller("api/projects")
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /** 获取所有项目摘要，供项目维护台列表使用。 */
  @Get()
  async list() {
    console.info("[projects-controller] 收到项目列表查询请求");
    return {
      items: await this.projectsService.list()
    };
  }

  /** 获取单个项目完整维护配置。 */
  @Get(":id")
  async detail(@Param("id") id: string) {
    const projectId = this.parseProjectId(id);
    console.info("[projects-controller] 收到项目详情查询请求", { projectId });
    const project = await this.projectsService.findById(projectId);
    if (!project) {
      throw new NotFoundException("project_not_found");
    }
    return project;
  }

  /** 查询项目运行上下文，供 Desktop 绑定项目时缓存到本地。 */
  @Get(":id/runtime-context")
  async getRuntimeContext(@Param("id") id: string): Promise<ProjectRuntimeContext> {
    const projectId = this.parseProjectId(id);
    console.info("[projects-controller] 收到项目运行上下文查询请求", { projectId });
    return this.projectsService.getRuntimeContext(projectId);
  }

  /** 创建项目并写入初始仓库、融智链、接口、Skill 与 MCP 配置。 */
  @Post()
  async createProject(@Body() body: CreateProjectInput) {
    console.info("[projects-controller] 收到创建项目请求", {
      code: body?.code,
      repositoryCount: body?.repositories?.length ?? 0,
      apiCount: body?.apis?.length ?? 0
    });
    return this.projectsService.createProject(body);
  }

  /** 替换项目维护配置，并生成配置快照和变更日志。 */
  @Put(":id/config")
  async replaceProjectConfig(
    @Param("id") id: string,
    @Body() body: ReplaceProjectConfigInput
  ) {
    const projectId = this.parseProjectId(id);
    console.info("[projects-controller] 收到替换项目配置请求", {
      projectId,
      updatedBy: body?.updatedBy
    });
    return this.projectsService.replaceProjectConfig(projectId, body);
  }

  /** 解析路由项目 ID，只允许数字自增主键进入服务层。 */
  private parseProjectId(id: string): number {
    const projectId = Number(id);
    if (!Number.isInteger(projectId) || projectId <= 0 || String(projectId) !== id.trim()) {
      console.warn("[projects-controller] 项目 ID 非法，拒绝继续处理", { rawProjectId: id });
      throw new BadRequestException("project_id_invalid");
    }
    console.info("[projects-controller] 项目 ID 解析成功", { projectId });
    return projectId;
  }
}
