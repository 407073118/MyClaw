import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { McpService } from "./mcp.service";

function createArtifactServiceMock() {
  return {
    storeSkillArtifact: vi.fn(async ({ releaseId }: { releaseId: string }) => ({
      fileName: `${releaseId}.zip`,
      fileSize: 128,
      storageKey: `/group1/M00/00/16/${releaseId}.zip`,
      storageUrl: `http://127.0.0.1:8080/group1/M00/00/16/${releaseId}.zip`
    })),
    createDownloadToken: vi.fn(async (releaseId: string) => ({
      downloadUrl: `/api/artifacts/download/${releaseId}`,
      expiresIn: 300
    })),
    getManifest: vi.fn(async () => ({
      kind: "mcp",
      name: "Filesystem MCP",
      version: "1.0.0",
      description: "Managed filesystem connector",
      transport: "stdio"
    }))
  };
}

describe("mcp service", () => {
  it("lists mcp items from the independent repository", async () => {
    const repository = {
      list: vi.fn(async () => [
        {
          id: "mcp-filesystem-managed",
          name: "Filesystem MCP",
          summary: "Managed filesystem connector",
          description: "Managed filesystem connector",
          latestVersion: "1.0.0",
          updatedAt: "2026-03-27T11:00:00.000Z"
        }
      ]),
      findById: vi.fn(),
      createItem: vi.fn(),
      createRelease: vi.fn()
    };

    const service = new McpService(repository as any, createArtifactServiceMock() as any);
    const result = await service.list();

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("mcp-filesystem-managed");
  });

  it("creates mcp item with initial release through the independent repository", async () => {
    const findById = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: "mcp-filesystem-managed",
        name: "Filesystem MCP",
        summary: "Managed filesystem connector",
        description: "Managed filesystem connector",
        latestVersion: "1.0.0",
        releases: [],
        createdAt: "2026-03-27T11:00:00.000Z",
        updatedAt: "2026-03-27T11:00:00.000Z"
      });

    const repository = {
      list: vi.fn(async () => []),
      findById,
      createItem: vi.fn(async () => ({
        id: "mcp-filesystem-managed",
        name: "Filesystem MCP",
        summary: "Managed filesystem connector",
        description: "Managed filesystem connector",
        latestVersion: "1.0.0",
        releases: [],
        createdAt: "2026-03-27T11:00:00.000Z",
        updatedAt: "2026-03-27T11:00:00.000Z"
      })),
      createRelease: vi.fn(async (input: any) => ({
        itemId: input.itemId,
        releaseId: input.releaseId,
        version: input.version,
        latestVersion: input.version,
        manifest: input.manifest,
        artifact: {
          fileName: input.artifact.fileName,
          fileSize: input.artifact.fileSize,
          downloadUrl: input.artifact.downloadUrl,
          expiresIn: input.artifact.downloadExpiresIn
        }
      }))
    };

    const service = new McpService(repository as any, createArtifactServiceMock() as any);
    const result = await service.createMcpWithInitialRelease({
      id: "mcp-filesystem-managed",
      name: "Filesystem MCP",
      summary: "Managed filesystem connector",
      description: "Managed filesystem connector",
      version: "1.0.0",
      releaseNotes: "Initial release",
      fileName: "filesystem.zip",
      contentType: "application/zip",
      fileBytes: Buffer.from("zip-data")
    });

    expect(result.item.id).toBe("mcp-filesystem-managed");
    expect(result.releaseId).toBe("release-mcp-filesystem-managed-1.0.0");
  });

  it("publishes mcp release from the independent repository", async () => {
    const createRelease = vi.fn(async (input: any) => ({
      itemId: input.itemId,
      releaseId: input.releaseId,
      version: input.version,
      latestVersion: input.version,
      manifest: input.manifest,
      artifact: {
        fileName: input.artifact.fileName,
        fileSize: input.artifact.fileSize,
        downloadUrl: input.artifact.downloadUrl,
        expiresIn: input.artifact.downloadExpiresIn
      }
    }));

    const repository = {
      list: vi.fn(async () => []),
      findById: vi.fn(async () => ({
        id: "mcp-filesystem-managed",
        name: "Filesystem MCP",
        summary: "Managed filesystem connector",
        description: "Managed filesystem connector",
        latestVersion: "1.0.0",
        releases: [],
        createdAt: "2026-03-27T11:00:00.000Z",
        updatedAt: "2026-03-27T11:00:00.000Z"
      })),
      createItem: vi.fn(),
      createRelease
    };

    const service = new McpService(repository as any, createArtifactServiceMock() as any);
    const result = await service.publishMcpRelease("mcp-filesystem-managed", {
      version: "1.1.0",
      releaseNotes: "Managed MCP update",
      fileName: "filesystem.zip",
      contentType: "application/zip",
      fileBytes: Buffer.from("zip-data")
    });

    expect(result.releaseId).toBe("release-mcp-filesystem-managed-1.1.0");
    expect(createRelease).toHaveBeenCalledTimes(1);
  });

  it("rejects non-zip mcp artifacts", async () => {
    const repository = {
      list: vi.fn(async () => []),
      findById: vi.fn(async () => ({
        id: "mcp-filesystem-managed",
        name: "Filesystem MCP",
        summary: "Managed filesystem connector",
        description: "Managed filesystem connector",
        latestVersion: "1.0.0",
        releases: [],
        createdAt: "2026-03-27T11:00:00.000Z",
        updatedAt: "2026-03-27T11:00:00.000Z"
      })),
      createItem: vi.fn(),
      createRelease: vi.fn()
    };

    const service = new McpService(repository as any, createArtifactServiceMock() as any);

    await expect(
      service.publishMcpRelease("mcp-filesystem-managed", {
        version: "1.1.0",
        releaseNotes: "bad package",
        fileName: "filesystem.txt",
        contentType: "text/plain",
        fileBytes: Buffer.from("zip-data")
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws not found when publishing for missing mcp", async () => {
    const repository = {
      list: vi.fn(async () => []),
      findById: vi.fn(async () => null),
      createItem: vi.fn(),
      createRelease: vi.fn()
    };

    const service = new McpService(repository as any, createArtifactServiceMock() as any);

    await expect(
      service.publishMcpRelease("missing", {
        version: "1.1.0",
        releaseNotes: "missing item",
        fileName: "filesystem.zip",
        contentType: "application/zip",
        fileBytes: Buffer.from("zip-data")
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
