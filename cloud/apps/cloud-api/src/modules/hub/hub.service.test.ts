import type { HubItemDetail } from "@myclaw-cloud/shared";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { HubService } from "./hub.service";

function createArtifactServiceMock() {
  return {
    storeSkillArtifact: vi.fn(async ({ releaseId }: { releaseId: string }) => ({
      fileName: `${releaseId}.zip`,
      fileSize: 128,
      storageKey: `/group1/M00/00/16/${releaseId}.zip`,
      storageUrl: `http://127.0.0.1:8080/group1/M00/00/16/${releaseId}.zip`,
    })),
    createDownloadToken: vi.fn(async (releaseId: string) => ({
      downloadUrl: `/api/artifacts/download/${releaseId}`,
      expiresIn: 300,
    })),
  };
}

async function unusedCreateItem(): Promise<HubItemDetail> {
  throw new Error("not used");
}

describe("hub service", () => {
  it("lists only hub-managed item types from the repository", async () => {
    const repository = {
      list: async () => [
        {
          id: "employee-onboarding-assistant",
          type: "employee-package" as const,
          name: "Onboarding Assistant",
          summary: "Onboarding package",
          description: "Employee package for onboarding",
          latestVersion: "1.0.0",
          releases: [],
        },
      ],
      findById: async () => null,
      createItem: unusedCreateItem,
      createRelease: async () => {
        throw new Error("not used");
      },
    };

    const service = new HubService(repository, createArtifactServiceMock() as any);
    const result = await service.list();

    expect(result).toHaveLength(1);
    expect(result.map((item) => item.type)).toEqual(["employee-package"]);
  });

  it("returns a detail item from the repository", async () => {
    const repository = {
      list: async () => [],
      findById: async (id: string) =>
        id === "workflow-onboarding"
          ? {
              id: "workflow-onboarding",
              type: "workflow-package" as const,
              name: "Onboarding Workflow",
              summary: "Workflow package",
              description: "Workflow package for onboarding",
              latestVersion: "1.0.0",
              releases: [
                {
                  id: "release-workflow-onboarding-1.0.0",
                  version: "1.0.0",
                  releaseNotes: "Initial release",
                },
              ],
            }
          : null,
      createItem: unusedCreateItem,
      createRelease: async () => {
        throw new Error("not used");
      },
    };
    const service = new HubService(repository, createArtifactServiceMock() as any);

    const result = await service.findById("workflow-onboarding");
    expect(result?.type).toBe("workflow-package");
    expect(result?.releases).toHaveLength(1);
  });

  it("does not expose skill publishing APIs anymore", () => {
    const service = new HubService(
      {
        list: async () => [],
        findById: async () => null,
        createItem: unusedCreateItem,
        createRelease: async () => {
          throw new Error("not used");
        },
      },
      createArtifactServiceMock() as any,
    );

    expect("publishSkillRelease" in service).toBe(false);
    expect("createSkillWithInitialRelease" in service).toBe(false);
    expect("publishMcpRelease" in service).toBe(false);
    expect("createMcpWithInitialRelease" in service).toBe(false);
  });

  it("publishes an employee package release", async () => {
    const createRelease = vi.fn(async (input: any) => ({
      itemId: input.itemId,
      releaseId: input.releaseId,
      version: input.version,
      latestVersion: input.version,
      manifest: input.manifest,
      artifact: {
        fileName: "employee-onboarding.zip",
        fileSize: 128,
        downloadUrl: "/api/artifacts/download/release-employee-onboarding-assistant-1.1.0",
        expiresIn: 300,
      },
    }));

    const service = new HubService(
      {
        list: async () => [],
        findById: async () => ({
          id: "employee-onboarding-assistant",
          type: "employee-package" as const,
          name: "Onboarding Assistant",
          summary: "Employee package",
          description: "Employee package for onboarding",
          latestVersion: "1.0.0",
          releases: [],
        }),
        createItem: unusedCreateItem,
        createRelease,
      },
      createArtifactServiceMock() as any,
    );

    const result = await service.publishEmployeePackageRelease("employee-onboarding-assistant", {
      version: "1.1.0",
      releaseNotes: "Employee package release",
      fileName: "employee-onboarding.zip",
      contentType: "application/zip",
      fileBytes: Buffer.from("zip-data"),
    });

    expect(result.manifest.kind).toBe("employee-package");
    expect(createRelease).toHaveBeenCalledTimes(1);
  });

  it("publishes a workflow package release", async () => {
    const createRelease = vi.fn(async (input: any) => ({
      itemId: input.itemId,
      releaseId: input.releaseId,
      version: input.version,
      latestVersion: input.version,
      manifest: input.manifest,
      artifact: {
        fileName: "workflow-onboarding.zip",
        fileSize: 128,
        downloadUrl: "/api/artifacts/download/release-workflow-onboarding-1.1.0",
        expiresIn: 300,
      },
    }));

    const service = new HubService(
      {
        list: async () => [],
        findById: async () => ({
          id: "workflow-onboarding",
          type: "workflow-package" as const,
          name: "Onboarding Workflow",
          summary: "Workflow package",
          description: "Workflow package for onboarding",
          latestVersion: "1.0.0",
          releases: [],
        }),
        createItem: unusedCreateItem,
        createRelease,
      },
      createArtifactServiceMock() as any,
    );

    const result = await service.publishWorkflowPackageRelease("workflow-onboarding", {
      version: "1.1.0",
      releaseNotes: "Workflow package release",
      fileName: "workflow-onboarding.zip",
      contentType: "application/zip",
      fileBytes: Buffer.from("zip-data"),
    });

    expect(result.manifest.kind).toBe("workflow-package");
    expect(createRelease).toHaveBeenCalledTimes(1);
  });

  it("rejects publishing an employee package against a non-employee item", async () => {
    const service = new HubService(
      {
        list: async () => [],
        findById: async () => ({
          id: "mcp-filesystem-managed",
          type: "mcp" as const,
          name: "Filesystem MCP",
          summary: "Managed filesystem connector",
          description: "Injects a managed MCP connector for local filesystem tooling",
          latestVersion: "2.1.0",
          releases: [],
        }),
        createItem: unusedCreateItem,
        createRelease: async () => {
          throw new Error("not used");
        },
      },
      createArtifactServiceMock() as any,
    );

    await expect(
      service.publishEmployeePackageRelease("mcp-filesystem-managed", {
        version: "1.0.0",
        releaseNotes: "wrong target",
        fileName: "x.zip",
        contentType: "application/zip",
        fileBytes: Buffer.from("zip-data"),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws not found when publishing for a missing item", async () => {
    const service = new HubService(
      {
        list: async () => [],
        findById: async () => null,
        createItem: unusedCreateItem,
        createRelease: async () => {
          throw new Error("not used");
        },
      },
      createArtifactServiceMock() as any,
    );

    await expect(
      service.publishWorkflowPackageRelease("missing", {
        version: "1.0.0",
        releaseNotes: "missing item",
        fileName: "x.zip",
        contentType: "application/zip",
        fileBytes: Buffer.from("zip-data"),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
