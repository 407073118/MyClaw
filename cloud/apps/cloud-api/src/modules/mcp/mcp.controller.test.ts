import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { McpServerConfig } from "@myclaw-cloud/shared";
import { McpController } from "./mcp.controller";
import { McpService } from "./mcp.service";

/** 创建 stdio 配置 */
function stdioConfig(): McpServerConfig {
  return {
    transport: "stdio",
    command: "npx",
    args: ["@playwright/mcp@latest"]
  };
}

describe("mcp controller", () => {
  it("通过专用 controller 列出 MCP 条目", async () => {
    const list = vi.fn(async () => [
      {
        id: "playwright",
        name: "Playwright MCP",
        summary: "浏览器自动化 MCP 服务",
        latestVersion: "1.0.0"
      }
    ]);

    const controller = new McpController({
      list,
      findById: vi.fn(),
      publishRelease: vi.fn(),
      createWithInitialRelease: vi.fn(),
      findReleaseById: vi.fn()
    } as unknown as McpService);

    await expect(controller.list()).resolves.toEqual({
      items: [expect.objectContaining({ id: "playwright" })]
    });
  });

  it("MCP 详情不存在时抛出 NotFoundException", async () => {
    const controller = new McpController({
      list: vi.fn(),
      findById: vi.fn(async () => null),
      publishRelease: vi.fn(),
      createWithInitialRelease: vi.fn(),
      findReleaseById: vi.fn()
    } as unknown as McpService);

    await expect(controller.detail("missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("通过 JSON body 发布 MCP 新版本", async () => {
    const config = stdioConfig();
    const publishRelease = vi.fn(async () => ({
      itemId: "playwright",
      release: {
        id: "release-playwright-1.1.0",
        version: "1.1.0",
        releaseNotes: "升级版本",
        config
      }
    }));

    const controller = new McpController({
      list: vi.fn(),
      findById: vi.fn(),
      publishRelease,
      createWithInitialRelease: vi.fn(),
      findReleaseById: vi.fn()
    } as unknown as McpService);

    await expect(
      controller.publishRelease("playwright", {
        version: "1.1.0",
        releaseNotes: "升级版本",
        config
      })
    ).resolves.toMatchObject({
      release: { id: "release-playwright-1.1.0" }
    });
  });

  it("通过 JSON body 创建 MCP 条目（含初始版本）", async () => {
    const config = stdioConfig();
    const createWithInitialRelease = vi.fn(async () => ({
      item: {
        id: "playwright",
        name: "Playwright MCP",
        summary: "浏览器自动化 MCP 服务",
        description: "Playwright 浏览器自动化 MCP 服务器",
        latestVersion: "1.0.0",
        releases: []
      },
      release: {
        id: "release-playwright-1.0.0",
        version: "1.0.0",
        releaseNotes: "初始版本",
        config
      }
    }));

    const controller = new McpController({
      list: vi.fn(),
      findById: vi.fn(),
      publishRelease: vi.fn(),
      createWithInitialRelease,
      findReleaseById: vi.fn()
    } as unknown as McpService);

    await expect(
      controller.createMcp({
        id: "playwright",
        name: "Playwright MCP",
        summary: "浏览器自动化 MCP 服务",
        description: "Playwright 浏览器自动化 MCP 服务器",
        version: "1.0.0",
        releaseNotes: "初始版本",
        config
      })
    ).resolves.toMatchObject({
      release: { id: "release-playwright-1.0.0" }
    });
  });

  it("发布时缺少 version 抛出 BadRequestException", async () => {
    const controller = new McpController({
      list: vi.fn(),
      findById: vi.fn(),
      publishRelease: vi.fn(),
      createWithInitialRelease: vi.fn(),
      findReleaseById: vi.fn()
    } as unknown as McpService);

    await expect(
      controller.publishRelease("playwright", {
        version: "",
        releaseNotes: "缺少版本号",
        config: stdioConfig()
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("发布时缺少 config 抛出 BadRequestException", async () => {
    const controller = new McpController({
      list: vi.fn(),
      findById: vi.fn(),
      publishRelease: vi.fn(),
      createWithInitialRelease: vi.fn(),
      findReleaseById: vi.fn()
    } as unknown as McpService);

    await expect(
      controller.publishRelease("playwright", {
        version: "1.0.0",
        releaseNotes: "缺少配置",
        config: undefined as any
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("版本详情不存在时抛出 NotFoundException", async () => {
    const controller = new McpController({
      list: vi.fn(),
      findById: vi.fn(),
      publishRelease: vi.fn(),
      createWithInitialRelease: vi.fn(),
      findReleaseById: vi.fn(async () => null)
    } as unknown as McpService);

    await expect(
      controller.releaseDetail("release-missing-1.0.0")
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
