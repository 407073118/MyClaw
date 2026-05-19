import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { ProjectsService } from "../services/projects.service";

/** 创建项目仓储模拟对象，便于验证服务层编排逻辑。 */
function createRepository(overrides: Record<string, unknown> = {}) {
  return {
    list: vi.fn(async () => []),
    findById: vi.fn(async () => null),
    findByCode: vi.fn(async () => null),
    findRuntimeContextById: vi.fn(async () => null),
    createProject: vi.fn(async (input) => ({
      id: 1,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      ownerAccount: input.ownerAccount,
      status: input.status ?? "active",
      services: input.services ?? [],
      repositories: input.repositories ?? [],
      rongzhiLink: input.rongzhiLink ?? null,
      apis: input.apis ?? [],
      skills: input.skills ?? [],
      mcps: input.mcps ?? [],
      workflows: input.workflows ?? [],
      siliconPersons: input.siliconPersons ?? [],
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z"
    })),
    replaceProjectConfig: vi.fn(async (_projectId, input) => ({
      id: 1,
      code: "customer-service",
      name: input.name ?? "客服平台",
      description: input.description ?? null,
      ownerAccount: input.ownerAccount ?? "owner",
      status: input.status ?? "active",
      services: input.services ?? [],
      repositories: input.repositories ?? [],
      rongzhiLink: input.rongzhiLink ?? null,
      apis: input.apis ?? [],
      skills: input.skills ?? [],
      mcps: input.mcps ?? [],
      workflows: input.workflows ?? [],
      siliconPersons: input.siliconPersons ?? [],
      createdAt: "2026-05-18T00:00:00.000Z",
      updatedAt: "2026-05-18T00:00:00.000Z"
    })),
    ...overrides
  };
}

/** 创建项目能力引用查询桩，供服务层校验 Skill / MCP / 接口 JSON 时复用。 */
function createDatabaseService(overrides: Record<string, unknown> = {}) {
  return {
    skill: {
      findMany: vi.fn(async () => [])
    },
    skillRelease: {
      findMany: vi.fn(async () => [])
    },
    mcpServer: {
      findMany: vi.fn(async () => [])
    },
    mcpServerRelease: {
      findMany: vi.fn(async () => [])
    },
    ...overrides
  };
}

describe("projects service", () => {
  it("创建项目时保存项目基础信息和完整维护配置", async () => {
    const repository = createRepository();
    const databaseService = createDatabaseService({
      skill: {
        findMany: vi.fn(async () => [{ id: "skill-project-qa" }])
      },
      mcpServer: {
        findMany: vi.fn(async () => [{ id: "mcp-project-gateway" }])
      }
    });
    const service = new ProjectsService(repository as never, databaseService as never);

    const result = await service.createProject({
      code: " customer-service ",
      name: " 客服平台 ",
      ownerAccount: "zhangsan",
      createdBy: "admin",
      services: [
        {
          name: " customer-api ",
          baseUrl: " https://api.example.com/customer ",
          description: " 客服核心接口 "
        }
      ],
      repositories: [
        {
          name: "frontend",
          gitUrl: "https://git.example.com/customer/frontend.git",
          repoType: "frontend",
          defaultBranch: "main"
        },
        {
          name: "backend",
          gitUrl: "https://git.example.com/customer/backend.git",
          repoType: "backend",
          defaultBranch: "master"
        }
      ],
      rongzhiLink: {
        projectCode: "RZL-CS",
        projectName: "客服项目"
      },
      apis: [
        {
          name: "查询客户",
          serviceName: "customer-service",
          direction: "provided",
          protocol: "http",
          method: "GET",
          path: "/api/customers/{id}"
        }
      ],
      skills: [{ skillId: "skill-project-qa", enabled: true }],
      mcps: [{ mcpServerId: "mcp-project-gateway", enabled: true }]
    });

    expect(repository.createProject).toHaveBeenCalledWith(expect.objectContaining({
      code: "customer-service",
      name: "客服平台",
      ownerAccount: "zhangsan",
      createdBy: "admin",
      services: expect.arrayContaining([
        expect.objectContaining({
          name: "customer-api",
          baseUrl: "https://api.example.com/customer",
          description: "客服核心接口"
        })
      ]),
      repositories: expect.arrayContaining([
        expect.objectContaining({ name: "frontend", repoType: "frontend" }),
        expect.objectContaining({ name: "backend", repoType: "backend" })
      ]),
      rongzhiLink: expect.objectContaining({ projectCode: "RZL-CS" }),
      apis: expect.arrayContaining([
        expect.objectContaining({ name: "查询客户", path: "/api/customers/{id}" })
      ])
    }));
    expect(result.repositories).toHaveLength(2);
    expect(result.services[0]?.baseUrl).toBe("https://api.example.com/customer");
    expect(result.skills[0]?.skillId).toBe("skill-project-qa");
    expect(result.mcps[0]?.mcpServerId).toBe("mcp-project-gateway");
  });

  it("项目编码重复时拒绝创建", async () => {
    const repository = createRepository({
      findByCode: vi.fn(async () => ({ id: 1, code: "customer-service" }))
    });
    const service = new ProjectsService(repository as never, createDatabaseService() as never);

    await expect(
      service.createProject({
        code: "customer-service",
        name: "客服平台",
        ownerAccount: "zhangsan",
        createdBy: "admin"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("替换项目配置时保留工作流和硅基员工预留引用", async () => {
    const repository = createRepository({
      findById: vi.fn(async () => ({ id: 1, code: "customer-service" }))
    });
    const service = new ProjectsService(repository as never, createDatabaseService() as never);

    const result = await service.replaceProjectConfig(1, {
      updatedBy: "admin",
      services: [
        {
          name: "customer-api",
          baseUrl: " https://api.example.com/customer/v2 "
        }
      ],
      workflows: [
        {
          workflowId: "workflow-release-check",
          workflowName: "版本发布检查",
          enabled: false
        }
      ],
      siliconPersons: [
        {
          siliconPersonId: "employee-release-assistant",
          roleName: "发布助手",
          enabled: false
        }
      ]
    });

    expect(repository.replaceProjectConfig).toHaveBeenCalledWith(1, expect.objectContaining({
      updatedBy: "admin",
      services: expect.arrayContaining([
        expect.objectContaining({ name: "customer-api", baseUrl: "https://api.example.com/customer/v2" })
      ]),
      workflows: expect.arrayContaining([
        expect.objectContaining({ workflowId: "workflow-release-check", enabled: false })
      ]),
      siliconPersons: expect.arrayContaining([
        expect.objectContaining({ siliconPersonId: "employee-release-assistant", enabled: false })
      ])
    }));
    expect(result.workflows[0]?.workflowId).toBe("workflow-release-check");
    expect(result.siliconPersons[0]?.siliconPersonId).toBe("employee-release-assistant");
  });

  it("替换不存在的项目配置时抛出 NotFoundException", async () => {
    const repository = createRepository();
    const service = new ProjectsService(repository as never, createDatabaseService() as never);

    await expect(
      service.replaceProjectConfig(999, {
        updatedBy: "admin",
        repositories: []
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("查询运行上下文时返回仓储解析后的 Skill 和 MCP release", async () => {
    const repository = createRepository({
      findRuntimeContextById: vi.fn(async () => ({
        project: {
          id: 1,
          code: "customer-service",
          tenantId: "default",
          name: "客服平台",
          description: null,
          version: 1,
          etag: "etag-1",
          policyEpoch: 1,
          expiresAt: null,
          revokedAt: null,
          deletedAt: null
        },
        skills: [
          {
            id: "skill-project-qa",
            releaseId: "release-skill-1",
            alias: null,
            displayName: "项目问答",
            description: null,
            defaultEnabled: true,
            manifest: {},
            artifact: { downloadUrl: "https://example.com/skill.zip", sha256: "", size: 12 },
            config: null
          }
        ],
        mcps: [
          {
            id: "mcp-project-gateway",
            releaseId: "release-mcp-1",
            alias: null,
            displayName: "项目网关",
            description: null,
            defaultEnabled: true,
            transport: "stdio",
            manifest: {},
            artifact: null,
            config: {},
            runtimePolicy: {
              requiresLocalConfirmation: true,
              allowAutoExposeToModel: false,
              riskLevel: "high"
            }
          }
        ],
        warnings: []
      }))
    });
    const service = new ProjectsService(repository as never, createDatabaseService() as never);

    const result = await service.getRuntimeContext(1);

    expect(repository.findRuntimeContextById).toHaveBeenCalledWith(1);
    expect(result.skills[0]?.releaseId).toBe("release-skill-1");
    expect(result.mcps[0]?.releaseId).toBe("release-mcp-1");
    expect(result.mcps[0]?.runtimePolicy).toMatchObject({
      requiresLocalConfirmation: true,
      allowAutoExposeToModel: false
    });
  });

  it("查询运行上下文时项目不存在会抛出 NotFoundException", async () => {
    const repository = createRepository({
      findRuntimeContextById: vi.fn(async () => null)
    });
    const service = new ProjectsService(repository as never, createDatabaseService() as never);

    await expect(service.getRuntimeContext(404)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("创建项目时如果 Skill 引用不存在则拒绝保存", async () => {
    const repository = createRepository();
    const databaseService = createDatabaseService({
      skill: {
        findMany: vi.fn(async () => [])
      }
    });
    const service = new ProjectsService(repository as never, databaseService as never);

    await expect(
      service.createProject({
        code: "customer-service",
        name: "客服平台",
        ownerAccount: "zhangsan",
        createdBy: "admin",
        skills: [
          {
            skillId: "skill-project-qa",
            enabled: true
          }
        ]
      })
    ).rejects.toMatchObject({
      message: "project_skill_not_found"
    });
  });

  it("替换项目配置时如果接口请求 Schema 不是对象则拒绝保存", async () => {
    const repository = createRepository({
      findById: vi.fn(async () => ({ id: 1, code: "customer-service" }))
    });
    const service = new ProjectsService(repository as never, createDatabaseService() as never);

    await expect(
      service.replaceProjectConfig(1, {
        updatedBy: "admin",
        apis: [
          {
            name: "查询客户",
            protocol: "http",
            method: "GET",
            path: "/api/customers/{id}",
            requestSchemaJson: "bad-schema" as unknown as object
          }
        ]
      })
    ).rejects.toMatchObject({
      message: "project_api_request_schema_invalid"
    });
  });

  it("替换项目配置时如果 MCP release 不属于当前 MCP 则拒绝保存", async () => {
    const repository = createRepository({
      findById: vi.fn(async () => ({ id: 1, code: "customer-service" }))
    });
    const databaseService = createDatabaseService({
      mcpServer: {
        findMany: vi.fn(async () => [{ id: "mcp-project-gateway" }])
      },
      mcpServerRelease: {
        findMany: vi.fn(async () => [
          {
            id: "release-other-mcp-1.0.0",
            serverId: "mcp-other"
          }
        ])
      }
    });
    const service = new ProjectsService(repository as never, databaseService as never);

    await expect(
      service.replaceProjectConfig(1, {
        updatedBy: "admin",
        mcps: [
          {
            mcpServerId: "mcp-project-gateway",
            mcpReleaseId: "release-other-mcp-1.0.0",
            enabled: true
          }
        ]
      })
    ).rejects.toMatchObject({
      message: "project_mcp_release_mismatch"
    });
  });
});
