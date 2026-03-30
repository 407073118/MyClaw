import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";

describe("mcp controller", () => {
  it("lists mcp items via dedicated controller", async () => {
    const list = vi.fn(async () => [
      {
        id: "mcp-filesystem-managed",
        name: "Filesystem MCP",
        summary: "Managed filesystem connector",
        description: "Managed filesystem connector",
        latestVersion: "1.0.0",
        updatedAt: "2026-03-27T11:00:00.000Z"
      }
    ]);

    const controller = new McpController({
      list,
      findById: vi.fn(),
      publishMcpRelease: vi.fn(),
      createMcpWithInitialRelease: vi.fn()
    } as unknown as McpService);

    await expect(controller.list()).resolves.toEqual({
      items: [expect.objectContaining({ id: "mcp-filesystem-managed" })]
    });
  });

  it("throws not found when mcp detail missing", async () => {
    const controller = new McpController({
      list: vi.fn(),
      findById: vi.fn(async () => null),
      publishMcpRelease: vi.fn(),
      createMcpWithInitialRelease: vi.fn()
    } as unknown as McpService);

    await expect(controller.detail("missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("publishes mcp release via dedicated endpoint", async () => {
    const publishMcpRelease = vi.fn(async () => ({
      itemId: "mcp-filesystem-managed",
      releaseId: "release-mcp-filesystem-managed-1.1.0",
      version: "1.1.0",
      latestVersion: "1.1.0",
      manifest: {
        kind: "mcp",
        name: "Filesystem MCP",
        version: "1.1.0",
        description: "Managed filesystem connector",
        transport: "stdio"
      },
      artifact: {
        fileName: "filesystem.zip",
        fileSize: 128,
        downloadUrl: "/api/artifacts/download/release-mcp-filesystem-managed-1.1.0",
        expiresIn: 300
      }
    }));

    const controller = new McpController({
      list: vi.fn(),
      findById: vi.fn(),
      publishMcpRelease,
      createMcpWithInitialRelease: vi.fn()
    } as unknown as McpService);

    await expect(
      controller.publishRelease(
        "mcp-filesystem-managed",
        { version: "1.1.0", releaseNotes: "Managed MCP update" },
        {
          buffer: Buffer.from("zip-data"),
          mimetype: "application/zip",
          originalname: "filesystem.zip",
          size: 128
        }
      )
    ).resolves.toMatchObject({
      releaseId: "release-mcp-filesystem-managed-1.1.0"
    });
  });

  it("creates mcp with initial release via dedicated endpoint", async () => {
    const createMcpWithInitialRelease = vi.fn(async () => ({
      item: {
        id: "mcp-filesystem-managed",
        name: "Filesystem MCP",
        summary: "Managed filesystem connector",
        description: "Managed filesystem connector",
        latestVersion: "1.0.0",
        releases: [],
        createdAt: "2026-03-27T11:00:00.000Z",
        updatedAt: "2026-03-27T11:00:00.000Z"
      },
      itemId: "mcp-filesystem-managed",
      releaseId: "release-mcp-filesystem-managed-1.0.0",
      version: "1.0.0",
      latestVersion: "1.0.0",
      manifest: {
        kind: "mcp",
        name: "Filesystem MCP",
        version: "1.0.0",
        description: "Managed filesystem connector",
        transport: "stdio"
      },
      artifact: {
        fileName: "filesystem.zip",
        fileSize: 128,
        downloadUrl: "/api/artifacts/download/release-mcp-filesystem-managed-1.0.0",
        expiresIn: 300
      }
    }));

    const controller = new McpController({
      list: vi.fn(),
      findById: vi.fn(),
      publishMcpRelease: vi.fn(),
      createMcpWithInitialRelease
    } as unknown as McpService);

    await expect(
      controller.createMcp(
        {
          id: "mcp-filesystem-managed",
          name: "Filesystem MCP",
          summary: "Managed filesystem connector",
          description: "Managed filesystem connector",
          version: "1.0.0",
          releaseNotes: "Initial release"
        },
        {
          buffer: Buffer.from("zip-data"),
          mimetype: "application/zip",
          originalname: "filesystem.zip",
          size: 128
        }
      )
    ).resolves.toMatchObject({
      releaseId: "release-mcp-filesystem-managed-1.0.0"
    });
  });

  it("throws when mcp zip is missing", async () => {
    const controller = new McpController({
      list: vi.fn(),
      findById: vi.fn(),
      publishMcpRelease: vi.fn(),
      createMcpWithInitialRelease: vi.fn()
    } as unknown as McpService);

    await expect(
      controller.publishRelease("mcp-filesystem-managed", {
        version: "1.1.0",
        releaseNotes: "missing file"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
