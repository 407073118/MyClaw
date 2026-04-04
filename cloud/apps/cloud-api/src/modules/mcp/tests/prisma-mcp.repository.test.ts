import { describe, expect, it, vi } from "vitest";

import { PrismaMcpRepository } from "../repositories/prisma-mcp.repository";

describe("prisma mcp repository", () => {
  it("lists all mcp servers", async () => {
    const databaseService = {
      mcpServer: {
        findMany: vi.fn(async () => [
          {
            id: "playwright",
            name: "Playwright MCP",
            summary: "浏览器自动化 MCP 服务",
            description: "Playwright 浏览器自动化 MCP 服务器",
            latestVersion: "1.0.0"
          }
        ])
      }
    };

    const repository = new PrismaMcpRepository(databaseService as never);
    const result = await repository.list();

    expect(databaseService.mcpServer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { updatedAt: "desc" }
      })
    );
    expect(result).toEqual([
      {
        id: "playwright",
        name: "Playwright MCP",
        summary: "浏览器自动化 MCP 服务",
        latestVersion: "1.0.0"
      }
    ]);
  });

  it("persists MCP release config into config_json", async () => {
    const create = vi.fn(async () => ({
      id: "release-playwright-1.0.0",
      version: "1.0.0",
      releaseNotes: "初始版本",
      configJson: {
        transport: "stdio",
        command: "npx",
        args: ["@playwright/mcp@latest"]
      }
    }));
    const update = vi.fn(async () => ({}));
    const databaseService = {
      mcpServer: {
        findUnique: vi.fn(async () => ({
          id: "playwright",
          name: "Playwright MCP",
          summary: "浏览器自动化 MCP 服务",
          description: "Playwright 浏览器自动化 MCP 服务器",
          latestVersion: "0.9.0"
        }))
      },
      $transaction: vi.fn(async (callback: (transaction: {
        mcpServerRelease: { create: typeof create };
        mcpServer: { update: typeof update };
      }) => Promise<any>) => callback({
        mcpServerRelease: { create },
        mcpServer: { update }
      }))
    };

    const repository = new PrismaMcpRepository(databaseService as never);
    const result = await repository.createRelease({
      releaseId: "release-playwright-1.0.0",
      itemId: "playwright",
      version: "1.0.0",
      releaseNotes: "初始版本",
      latestVersion: "1.0.0",
      config: {
        transport: "stdio",
        command: "npx",
        args: ["@playwright/mcp@latest"]
      }
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          serverId: "playwright",
          configJson: expect.objectContaining({
            transport: "stdio",
            command: "npx"
          })
        })
      })
    );
    expect(result.config).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["@playwright/mcp@latest"]
    });
  });
});
