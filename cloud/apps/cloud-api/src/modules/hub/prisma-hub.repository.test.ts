import { describe, expect, it, vi } from "vitest";

import { PrismaHubRepository } from "./prisma-hub.repository";

describe("prisma hub repository", () => {
  it("persists artifact metadata when creating a release", async () => {
    const create = vi.fn(async () => ({}));
    const update = vi.fn(async () => ({}));
    const databaseService = {
      $transaction: vi.fn(async (callback: (transaction: {
        hubRelease: { create: typeof create };
        hubItem: { update: typeof update };
      }) => Promise<void>) => callback({
        hubRelease: { create },
        hubItem: { update },
      })),
    };

    const repository = new PrismaHubRepository(databaseService as never);

    const result = await repository.createRelease({
      itemId: "mcp-filesystem-managed",
      releaseId: "release-mcp-filesystem-managed-2.2.0",
      version: "2.2.0",
      latestVersion: "2.2.0",
      releaseNotes: "Managed MCP update",
      manifest: {
        kind: "mcp",
        name: "Filesystem MCP",
        version: "2.2.0",
        description: "Managed filesystem connector",
        transport: "stdio",
      },
      artifact: {
        fileName: "release-mcp-filesystem-managed-2.2.0.zip",
        fileSize: 256,
        storagePath: "group1/M00/00/01/wKjAb1Skill.zip",
        downloadUrl: "/api/artifacts/download/release-mcp-filesystem-managed-2.2.0",
        downloadExpiresIn: 300,
      },
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        id: "release-mcp-filesystem-managed-2.2.0",
        artifactFileName: "release-mcp-filesystem-managed-2.2.0.zip",
        artifactFileSize: 256,
        artifactStoragePath: "group1/M00/00/01/wKjAb1Skill.zip",
        artifactDownloadUrl: "/api/artifacts/download/release-mcp-filesystem-managed-2.2.0",
        artifactDownloadExpires: 300,
      }),
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "mcp-filesystem-managed" },
    }));
    expect(result.artifact).toEqual({
      fileName: "release-mcp-filesystem-managed-2.2.0.zip",
      fileSize: 256,
      downloadUrl: "/api/artifacts/download/release-mcp-filesystem-managed-2.2.0",
      expiresIn: 300,
    });
  });
});
