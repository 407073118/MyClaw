import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { McpServerConfig } from "@myclaw-cloud/shared";
import { McpService } from "../services/mcp.service";

/** 创建 stdio 配置 */
function stdioConfig(overrides?: Partial<McpServerConfig>): McpServerConfig {
  return {
    transport: "stdio",
    command: "npx",
    args: ["@playwright/mcp@latest"],
    ...overrides
  } as McpServerConfig;
}

/** 创建 SSE 配置 */
function sseConfig(): McpServerConfig {
  return {
    transport: "sse",
    url: "https://mcp.example.com/sse"
  };
}

describe("mcp service", () => {
  it("列出独立仓储中的 MCP 条目", async () => {
    const repository = {
      list: vi.fn(async () => [
        {
          id: "playwright",
          name: "Playwright MCP",
          summary: "浏览器自动化 MCP 服务",
          latestVersion: "1.0.0"
        }
      ]),
      findById: vi.fn(),
      createItem: vi.fn(),
      createRelease: vi.fn(),
      findReleaseById: vi.fn()
    };

    const service = new McpService(repository as any);
    const result = await service.list();

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("playwright");
  });

  it("创建 MCP 条目并发布初始 stdio 配置版本", async () => {
    const config = stdioConfig();

    const findById = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        id: "playwright",
        name: "Playwright MCP",
        summary: "浏览器自动化 MCP 服务",
        description: "Playwright 浏览器自动化 MCP 服务器",
        latestVersion: "1.0.0",
        releases: []
      });

    const repository = {
      list: vi.fn(async () => []),
      findById,
      createItem: vi.fn(async () => ({
        id: "playwright",
        name: "Playwright MCP",
        summary: "浏览器自动化 MCP 服务",
        description: "Playwright 浏览器自动化 MCP 服务器",
        latestVersion: "1.0.0",
        releases: []
      })),
      createRelease: vi.fn(async (input: any) => ({
        id: input.releaseId,
        version: input.version,
        releaseNotes: input.releaseNotes,
        config: input.config
      })),
      findReleaseById: vi.fn()
    };

    const service = new McpService(repository as any);
    const result = await service.createWithInitialRelease({
      id: "playwright",
      name: "Playwright MCP",
      summary: "浏览器自动化 MCP 服务",
      description: "Playwright 浏览器自动化 MCP 服务器",
      version: "1.0.0",
      releaseNotes: "初始版本",
      config
    });

    expect(result.item.id).toBe("playwright");
    expect(result.release.config).toEqual(config);
    expect(result.release.id).toBe("release-playwright-1.0.0");
  });

  it("创建 MCP 条目并发布 SSE 配置版本", async () => {
    const config = sseConfig();

    const repository = {
      list: vi.fn(async () => []),
      findById: vi.fn().mockResolvedValueOnce(null),
      createItem: vi.fn(async () => ({
        id: "remote-mcp",
        name: "Remote MCP",
        summary: "远程 MCP 服务",
        description: "基于 SSE 传输的远程 MCP 服务器",
        latestVersion: "1.0.0",
        releases: []
      })),
      createRelease: vi.fn(async (input: any) => ({
        id: input.releaseId,
        version: input.version,
        releaseNotes: input.releaseNotes,
        config: input.config
      })),
      findReleaseById: vi.fn()
    };

    const service = new McpService(repository as any);
    const result = await service.createWithInitialRelease({
      id: "remote-mcp",
      name: "Remote MCP",
      summary: "远程 MCP 服务",
      description: "基于 SSE 传输的远程 MCP 服务器",
      version: "1.0.0",
      releaseNotes: "初始版本",
      config
    });

    expect(result.release.config).toEqual(config);
  });

  it("为已有 MCP 条目发布新版本", async () => {
    const config = stdioConfig({ args: ["@playwright/mcp@1.1.0"] } as any);

    const repository = {
      list: vi.fn(async () => []),
      findById: vi.fn(async () => ({
        id: "playwright",
        name: "Playwright MCP",
        summary: "浏览器自动化 MCP 服务",
        description: "Playwright 浏览器自动化 MCP 服务器",
        latestVersion: "1.0.0",
        releases: []
      })),
      createItem: vi.fn(),
      createRelease: vi.fn(async (input: any) => ({
        id: input.releaseId,
        version: input.version,
        releaseNotes: input.releaseNotes,
        config: input.config
      })),
      findReleaseById: vi.fn()
    };

    const service = new McpService(repository as any);
    const result = await service.publishRelease("playwright", {
      version: "1.1.0",
      releaseNotes: "升级 Playwright 版本",
      config
    });

    expect(result.release.id).toBe("release-playwright-1.1.0");
    expect(result.itemId).toBe("playwright");
    expect(repository.createRelease).toHaveBeenCalledTimes(1);
  });

  it("发布时 MCP 条目不存在则抛出 NotFoundException", async () => {
    const repository = {
      list: vi.fn(async () => []),
      findById: vi.fn(async () => null),
      createItem: vi.fn(),
      createRelease: vi.fn(),
      findReleaseById: vi.fn()
    };

    const service = new McpService(repository as any);

    await expect(
      service.publishRelease("missing", {
        version: "1.0.0",
        releaseNotes: "不存在的条目",
        config: stdioConfig()
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("创建已存在的 MCP 条目则抛出 BadRequestException", async () => {
    const repository = {
      list: vi.fn(async () => []),
      findById: vi.fn(async () => ({
        id: "playwright",
        name: "Playwright MCP",
        summary: "已存在",
        description: "已存在",
        latestVersion: "1.0.0",
        releases: []
      })),
      createItem: vi.fn(),
      createRelease: vi.fn(),
      findReleaseById: vi.fn()
    };

    const service = new McpService(repository as any);

    await expect(
      service.createWithInitialRelease({
        id: "playwright",
        name: "Playwright MCP",
        summary: "重复创建",
        description: "重复创建",
        version: "1.0.0",
        releaseNotes: "重复",
        config: stdioConfig()
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("stdio 配置缺少 command 则抛出 BadRequestException", async () => {
    const repository = {
      list: vi.fn(async () => []),
      findById: vi.fn(async () => ({
        id: "bad-mcp",
        name: "Bad MCP",
        summary: "测试",
        description: "测试",
        latestVersion: "1.0.0",
        releases: []
      })),
      createItem: vi.fn(),
      createRelease: vi.fn(),
      findReleaseById: vi.fn()
    };

    const service = new McpService(repository as any);

    await expect(
      service.publishRelease("bad-mcp", {
        version: "1.0.0",
        releaseNotes: "缺少 command",
        config: { transport: "stdio", command: "" } as any
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("SSE 配置缺少 url 则抛出 BadRequestException", async () => {
    const repository = {
      list: vi.fn(async () => []),
      findById: vi.fn(async () => ({
        id: "bad-mcp",
        name: "Bad MCP",
        summary: "测试",
        description: "测试",
        latestVersion: "1.0.0",
        releases: []
      })),
      createItem: vi.fn(),
      createRelease: vi.fn(),
      findReleaseById: vi.fn()
    };

    const service = new McpService(repository as any);

    await expect(
      service.publishRelease("bad-mcp", {
        version: "1.0.0",
        releaseNotes: "缺少 url",
        config: { transport: "sse", url: "" } as any
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
