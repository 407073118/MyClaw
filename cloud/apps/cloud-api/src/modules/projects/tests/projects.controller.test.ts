import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { ProjectsController } from "../controllers/projects.controller";

/** 构造项目控制器依赖，便于验证路由 ID 在控制器层完成数字化。 */
function createProjectsService() {
  return {
    list: vi.fn(async () => []),
    findById: vi.fn(async (_projectId: number): Promise<any | null> => null),
    getRuntimeContext: vi.fn(async (_projectId: number): Promise<any> => ({
      project: { id: 1 },
      skills: [],
      mcps: [],
      warnings: []
    })),
    createProject: vi.fn(async () => ({})),
    replaceProjectConfig: vi.fn(async () => ({}))
  };
}

describe("projects controller", () => {
  it("查询详情时把路由项目 ID 转为数字再进入服务层", async () => {
    const projectsService = createProjectsService();
    projectsService.findById.mockResolvedValueOnce({
      id: 1,
      code: "customer-service"
    });
    const controller = new ProjectsController(projectsService as never);

    await controller.detail("1");

    expect(projectsService.findById).toHaveBeenCalledWith(1);
  });

  it("查询详情时拒绝非数字项目 ID", async () => {
    const projectsService = createProjectsService();
    const controller = new ProjectsController(projectsService as never);

    await expect(controller.detail("cmpaw6dpt0001jr1wy3v1f693")).rejects.toBeInstanceOf(BadRequestException);
    expect(projectsService.findById).not.toHaveBeenCalled();
  });

  it("查询运行上下文时把路由项目 ID 转为数字再进入服务层", async () => {
    const projectsService = createProjectsService();
    const controller = new ProjectsController(projectsService as never);

    await controller.getRuntimeContext("1");

    expect(projectsService.getRuntimeContext).toHaveBeenCalledWith(1);
  });

  it("查询运行上下文时拒绝非数字项目 ID", async () => {
    const projectsService = createProjectsService();
    const controller = new ProjectsController(projectsService as never);

    await expect(controller.getRuntimeContext("bad-id")).rejects.toBeInstanceOf(BadRequestException);
    expect(projectsService.getRuntimeContext).not.toHaveBeenCalled();
  });

  it("替换配置时把路由项目 ID 转为数字再进入服务层", async () => {
    const projectsService = createProjectsService();
    const controller = new ProjectsController(projectsService as never);

    await controller.replaceProjectConfig("2", { updatedBy: "admin" });

    expect(projectsService.replaceProjectConfig).toHaveBeenCalledWith(2, { updatedBy: "admin" });
  });
});
