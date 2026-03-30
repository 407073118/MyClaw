import { describe, expect, it, vi } from "vitest";

import { PrismaMcpRepository } from "./prisma-mcp.repository";

describe("prisma mcp repository", () => {
  it("lists only hub items of type mcp", async () => {
    const databaseService = {
      hubItem: {
        findMany: vi.fn(async () => [
          {
            id: "playwright",
            type: "mcp",
            name: "Playwright MCP",
            summary: "浏览器自动化 MCP 服务",
            description: "Playwright 浏览器自动化 MCP 服务器",
            latestVersion: "1.0.0",
            releases: []
          }
        ])
      }
    };

    const repository = new PrismaMcpRepository(databaseService as never);
    const result = await repository.list();

    expect(databaseService.hubItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { type: "mcp" }
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

  it("persists MCP release config into hub release manifestJson", async () => {
    const create = vi.fn(async () => ({
      id: "release-playwright-1.0.0",
      version: "1.0.0",
      releaseNotes: "初始版本",
      manifestJson: {
        kind: "mcp",
        name: "Playwright MCP",
        version: "1.0.0",
        description: "Playwright 浏览器自动化 MCP 服务器",
        config: {
          transport: "stdio",
          command: "npx",
          args: ["@playwright/mcp@latest"]
        }
      }
    }));
    const update = vi.fn(async () => ({}));
    const databaseService = {
      hubItem: {
        findUnique: vi.fn(async () => ({
          id: "playwright",
          type: "mcp",
          name: "Playwright MCP",
          summary: "浏览器自动化 MCP 服务",
          description: "Playwright 浏览器自动化 MCP 服务器",
          latestVersion: "0.9.0"
        }))
      },
      $transaction: vi.fn(async (callback: (transaction: {
        hubRelease: { create: typeof create };
        hubItem: { update: typeof update };
      }) => Promise<any>) => callback({
        hubRelease: { create },
        hubItem: { update }
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
          itemId: "playwright",
          manifestJson: expect.objectContaining({
            kind: "mcp",
            config: expect.objectContaining({
              transport: "stdio",
              command: "npx"
            })
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
