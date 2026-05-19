import { describe, expect, it, vi } from "vitest";

import { PrismaProjectsRepository } from "../repositories/prisma-projects.repository";

/** 构造项目详情记录，模拟 Prisma include 后的返回结构。 */
function createProjectRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    code: "customer-service",
    name: "客服平台",
    description: "客服项目",
    ownerAccount: "zhangsan",
    status: "active",
    createdAt: new Date("2026-05-18T00:00:00.000Z"),
    updatedAt: new Date("2026-05-18T00:00:00.000Z"),
    services: [],
    repositories: [],
    rongzhiLink: null,
    apis: [],
    skills: [],
    mcps: [],
    workflows: [],
    siliconPersons: [],
    snapshots: [],
    ...overrides
  };
}

describe("prisma projects repository", () => {
  it("查询运行上下文时解析启用的 Skill 与 MCP release 并省略禁用引用", async () => {
    const project = createProjectRecord({
      snapshots: [{ version: 3 }],
      skills: [
        {
          id: 11,
          skillId: "skill-project-qa",
          skillReleaseId: "release-skill-1",
          alias: "项目问答",
          enabled: true,
          configJson: { scope: "project" },
          createdAt: new Date("2026-05-18T00:00:00.000Z"),
          updatedAt: new Date("2026-05-18T00:01:00.000Z")
        },
        {
          id: 12,
          skillId: "skill-disabled",
          skillReleaseId: "release-disabled",
          alias: null,
          enabled: false,
          configJson: null,
          createdAt: new Date("2026-05-18T00:00:00.000Z"),
          updatedAt: new Date("2026-05-18T00:01:00.000Z")
        }
      ],
      mcps: [
        {
          id: 21,
          mcpServerId: "mcp-project-gateway",
          mcpReleaseId: "release-mcp-1",
          alias: null,
          riskLevel: "exec",
          enabled: true,
          configOverrideJson: null,
          createdAt: new Date("2026-05-18T00:00:00.000Z"),
          updatedAt: new Date("2026-05-18T00:02:00.000Z")
        }
      ]
    });
    const databaseService = {
      project: { findUnique: vi.fn(async () => project) },
      skill: {
        findMany: vi.fn(async () => [
          {
            id: "skill-project-qa",
            name: "项目问答",
            summary: "处理项目问题",
            description: "处理项目问题",
            latestReleaseId: "release-skill-1"
          }
        ])
      },
      skillRelease: {
        findMany: vi.fn(async () => [
          {
            id: "release-skill-1",
            skillId: "skill-project-qa",
            manifestJson: { name: "project-qa" },
            artifactDownloadUrl: "https://example.com/project-qa.zip",
            artifactFileSize: 2048,
            artifactSha256: "c".repeat(64),
            updatedAt: new Date("2026-05-18T00:03:00.000Z")
          }
        ])
      },
      mcpServer: {
        findMany: vi.fn(async () => [
          {
            id: "mcp-project-gateway",
            name: "项目网关",
            summary: "项目网关 MCP",
            description: "项目网关 MCP",
            latestReleaseId: "release-mcp-1"
          }
        ])
      },
      mcpServerRelease: {
        findMany: vi.fn(async () => [
          {
            id: "release-mcp-1",
            serverId: "mcp-project-gateway",
            configJson: { transport: "stdio", command: "node" },
            updatedAt: new Date("2026-05-18T00:04:00.000Z")
          }
        ])
      }
    };
    const repository = new PrismaProjectsRepository(databaseService as never);

    const result = await repository.findRuntimeContextById(1);

    expect(databaseService.project.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
    expect(result?.project.version).toBe(3);
    expect(result?.skills).toHaveLength(1);
    expect(result?.skills[0]).toMatchObject({
      id: "skill-project-qa",
      releaseId: "release-skill-1",
      displayName: "项目问答",
      artifact: { sha256: "c".repeat(64) }
    });
    expect(result?.mcps[0]?.runtimePolicy).toMatchObject({
      requiresLocalConfirmation: true,
      allowAutoExposeToModel: false,
      riskLevel: "high"
    });
    expect(result?.skills.some((item) => item.id === "skill-disabled")).toBe(false);
  });

  it("创建项目时在同一事务内写入仓库、融智链、接口、Skills 和 MCP", async () => {
    const created = createProjectRecord({
      services: [
        {
          id: 10,
          projectId: 1,
          name: "customer-api",
          baseUrl: "https://api.example.com/customer",
          description: "客服核心接口",
          enabled: true,
          sortOrder: 0,
          createdAt: new Date("2026-05-18T00:00:00.000Z"),
          updatedAt: new Date("2026-05-18T00:00:00.000Z")
        }
      ],
      repositories: [
        {
          id: 1,
          projectId: 1,
          name: "frontend",
          gitUrl: "https://git.example.com/customer/frontend.git",
          repoType: "frontend",
          defaultBranch: "main",
          description: null,
          enabled: true,
          sortOrder: 0,
          createdAt: new Date("2026-05-18T00:00:00.000Z"),
          updatedAt: new Date("2026-05-18T00:00:00.000Z")
        }
      ],
      rongzhiLink: {
        projectId: 1,
        projectCode: "RZL-CS",
        projectName: "客服项目",
        baseUrl: null,
        enabled: true,
        lastHealthStatus: null,
        lastCheckedAt: null,
        updatedAt: new Date("2026-05-18T00:00:00.000Z")
      },
      apis: [],
      skills: [],
      mcps: []
    });
    const projectCreate = vi.fn(async () => ({ id: 1 }));
    const projectFindUnique = vi.fn(async () => created);
    const snapshotCreate = vi.fn(async () => ({}));
    const changeLogCreate = vi.fn(async () => ({}));
    const transaction = {
      project: {
        create: projectCreate,
        findUnique: projectFindUnique
      },
      projectConfigSnapshot: { create: snapshotCreate },
      projectChangeLog: { create: changeLogCreate }
    };
    const databaseService = {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction))
    };
    const repository = new PrismaProjectsRepository(databaseService as never);

    const result = await repository.createProject({
      code: "customer-service",
      name: "客服平台",
      description: "客服项目",
      ownerAccount: "zhangsan",
      status: "archived",
      services: [
        {
          name: "customer-api",
          baseUrl: "https://api.example.com/customer",
          description: "客服核心接口"
        }
      ],
      createdBy: "admin",
      repositories: [
        {
          name: "frontend",
          gitUrl: "https://git.example.com/customer/frontend.git",
          repoType: "frontend",
          defaultBranch: "main"
        }
      ],
      rongzhiLink: {
        projectCode: "RZL-CS",
        projectName: "客服项目"
      },
      apis: [],
      skills: [],
      mcps: [],
      workflows: [],
      siliconPersons: []
    });

    expect(projectCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        code: "customer-service",
        status: "archived",
        services: expect.objectContaining({
          create: expect.arrayContaining([
            expect.objectContaining({ name: "customer-api", baseUrl: "https://api.example.com/customer" })
          ])
        }),
        repositories: expect.objectContaining({
          create: expect.arrayContaining([
            expect.objectContaining({ name: "frontend", repoType: "frontend" })
          ])
        }),
        rongzhiLink: expect.objectContaining({
          create: expect.objectContaining({ projectCode: "RZL-CS" })
        })
      })
    }));
    expect(snapshotCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        projectId: 1,
        version: 1
      })
    }));
    expect(changeLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        projectId: 1,
        action: "project.create"
      })
    }));
    expect(result.repositories[0]?.name).toBe("frontend");
    expect(result.services[0]?.baseUrl).toBe("https://api.example.com/customer");
    expect(result.rongzhiLink?.projectCode).toBe("RZL-CS");
  });

  it("替换配置时删除旧子项并生成新的配置快照", async () => {
    const projectFindUnique = vi
      .fn()
      .mockResolvedValueOnce(createProjectRecord())
      .mockResolvedValueOnce(createProjectRecord({
        repositories: [
          {
            id: 2,
            projectId: 1,
            name: "backend",
            gitUrl: "https://git.example.com/customer/backend.git",
            repoType: "backend",
            defaultBranch: "master",
            description: null,
            enabled: true,
            sortOrder: 0,
            createdAt: new Date("2026-05-18T00:00:00.000Z"),
            updatedAt: new Date("2026-05-18T00:00:00.000Z")
          }
        ]
      }));
    const transaction = {
      project: {
        findUnique: projectFindUnique,
        update: vi.fn(async () => ({}))
      },
      projectServiceEndpoint: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
      projectRepository: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
      projectRongzhiLink: { deleteMany: vi.fn(async () => ({})), create: vi.fn(async () => ({})) },
      projectApi: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
      projectSkillRef: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
      projectMcpRef: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
      projectWorkflowRef: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
      projectSiliconPersonRef: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
      projectConfigSnapshot: { count: vi.fn(async () => 1), create: vi.fn(async () => ({})) },
      projectChangeLog: { create: vi.fn(async () => ({})) }
    };
    const databaseService = {
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction))
    };
    const repository = new PrismaProjectsRepository(databaseService as never);

    const result = await repository.replaceProjectConfig(1, {
      updatedBy: "admin",
      services: [
        {
          name: "customer-api",
          baseUrl: "https://api.example.com/customer/v2"
        }
      ],
      repositories: [
        {
          name: "backend",
          gitUrl: "https://git.example.com/customer/backend.git",
          repoType: "backend",
          defaultBranch: "master"
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

    expect(transaction.projectRepository.deleteMany).toHaveBeenCalledWith({ where: { projectId: 1 } });
    expect(transaction.projectServiceEndpoint.deleteMany).toHaveBeenCalledWith({ where: { projectId: 1 } });
    expect(transaction.projectServiceEndpoint.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ projectId: 1, name: "customer-api", baseUrl: "https://api.example.com/customer/v2" })
      ])
    }));
    expect(transaction.projectRepository.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ projectId: 1, name: "backend" })
      ])
    }));
    expect(transaction.projectWorkflowRef.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ workflowId: "workflow-release-check", enabled: false })
      ])
    }));
    expect(transaction.projectSiliconPersonRef.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ siliconPersonId: "employee-release-assistant", enabled: false })
      ])
    }));
    expect(transaction.projectConfigSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ version: 2 })
    }));
    expect(result.repositories[0]?.name).toBe("backend");
  });
});
