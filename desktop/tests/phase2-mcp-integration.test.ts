/**
 * Phase 2: MCP Integration
 *
 * 测试内容：
 * - MCP-02: Config persistence (mcp-servers.json)
 * - MCP-07: MCP tools auto-registered as OpenAI function tools
 * - MCP-11: Server health state tracking
 * - Tool schema generation with MCP tools
 *
 * Note: MCP-03/04/05/06/08 require real child processes — tested in integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { buildToolSchemas } from "../src/main/services/tool-schemas";
import { McpServerManager } from "../src/main/services/mcp-server-manager";
import type { McpTool } from "../shared/contracts/mcp";
import { ToolRiskCategory } from "../shared/contracts/events";
import { EXPECTED_BUILTIN_TOOL_NAMES } from "./shared/builtin-tool-contract";

// ---------------------------------------------------------------------------
// Test directory setup
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `myclaw-test-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore cleanup errors */ }
});

// ---------------------------------------------------------------------------
// MCP-02: Config persistence
// ---------------------------------------------------------------------------

describe("Phase 2: MCP server config persistence", () => {
  it("should start with empty servers when no config file", () => {
    const manager = new McpServerManager(testDir);
    expect(manager.listServers()).toEqual([]);
  });

  it("should reject duplicate server ids on create and keep persisted configs unchanged", async () => {
    const manager = new McpServerManager(testDir);

    await manager.createServer({
      id: "playwright",
      name: "Playwright",
      source: "manual",
      enabled: false,
      transport: "stdio",
      command: "npx",
      args: ["@playwright/mcp@latest"],
    } as any);

    await expect(
      manager.createServer({
        id: "playwright",
        name: "Playwright Duplicate",
        source: "manual",
        enabled: false,
        transport: "stdio",
        command: "node",
        args: ["server.js"],
      } as any),
    ).rejects.toThrow("MCP server id already exists: playwright");

    const configs = JSON.parse(readFileSync(join(testDir, "mcp-servers.json"), "utf8"));
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe("playwright");
    expect(configs[0].name).toBe("Playwright");
  });

  it("should persist server configs to mcp-servers.json", async () => {
    const manager = new McpServerManager(testDir);
    await manager.createServer({
      name: "test-server",
      source: "manual",
      enabled: false, // Don't auto-connect in test
      transport: "stdio",
      command: "echo",
      args: ["hello"],
    } as any);

    // Check file was written
    const configPath = join(testDir, "mcp-servers.json");
    expect(existsSync(configPath)).toBe(true);

    const configs = JSON.parse(readFileSync(configPath, "utf8"));
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe("test-server");
    expect(configs[0].command).toBe("echo");
    expect(configs[0].id).toBeTruthy();
  });

  it("should load configs from existing file", () => {
    const configPath = join(testDir, "mcp-servers.json");
    writeFileSync(configPath, JSON.stringify([{
      id: "existing-1",
      name: "pre-existing",
      source: "manual",
      enabled: true,
      transport: "stdio",
      command: "node",
      args: ["server.js"],
    }]), "utf8");

    const manager = new McpServerManager(testDir);
    const servers = manager.listServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("pre-existing");
    expect(servers[0].id).toBe("existing-1");
  });

  it("should delete server config and persist", async () => {
    const manager = new McpServerManager(testDir);
    const server = await manager.createServer({
      name: "to-delete",
      source: "manual",
      enabled: false, // disabled so it won't try to connect
      transport: "stdio",
      command: "echo",
    } as any);

    expect(manager.listServers()).toHaveLength(1);

    const deleted = await manager.deleteServer(server.id);
    expect(deleted).toBe(true);
    expect(manager.listServers()).toHaveLength(0);

    // Verify persisted
    const configs = JSON.parse(readFileSync(join(testDir, "mcp-servers.json"), "utf8"));
    expect(configs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// MCP-07: Tool schema generation with MCP tools
// ---------------------------------------------------------------------------

describe("Phase 2: MCP tool schema generation", () => {
  it("should include MCP tools in buildToolSchemas output", () => {
    const mcpTools: Array<McpTool & { serverId: string }> = [
      {
        id: "mcp__test-server__read_file",
        serverId: "server-1",
        name: "read_file",
        description: "Read a file from disk",
        risk: ToolRiskCategory.Read,
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
          },
          required: ["path"],
        },
      },
      {
        id: "mcp__test-server__write_file",
        serverId: "server-1",
        name: "write_file",
        description: "Write to a file",
        risk: ToolRiskCategory.Write,
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
      },
    ];

    const tools = buildToolSchemas("/test", undefined, mcpTools);
    expect(tools.map((tool) => tool.function.name)).toEqual([
      ...EXPECTED_BUILTIN_TOOL_NAMES,
      "mcp__test-server__read_file",
      "mcp__test-server__write_file",
    ]);

    const mcpReadTool = tools.find((t) => t.function.name.includes("read_file"));
    expect(mcpReadTool).toBeDefined();
    expect(mcpReadTool!.function.description).toBe("Read a file from disk");
    expect((mcpReadTool!.function.parameters as any).properties.path).toBeDefined();
  });

  it("should combine builtin + MCP + skill tools", () => {
    const mcpTools: Array<McpTool & { serverId: string }> = [{
      id: "mcp__s1__tool1",
      serverId: "s1",
      name: "tool1",
      description: "MCP tool 1",
      risk: ToolRiskCategory.Read,
      inputSchema: null,
    }];
    const skills = [{
      id: "skill-1",
      name: "My Skill",
      description: "desc",
      path: "/path",
      enabled: true,
      disableModelInvocation: false,
      hasScriptsDirectory: false,
      hasReferencesDirectory: false,
      hasAssetsDirectory: false,
      hasTestsDirectory: false,
      hasAgentsDirectory: false,
    }];

    const tools = buildToolSchemas("/test", skills, mcpTools);
    expect(tools.map((tool) => tool.function.name)).toEqual([
      ...EXPECTED_BUILTIN_TOOL_NAMES,
      "mcp__s1__tool1",
      "skill_invoke__skill-1",
    ]);
  });
});

// ---------------------------------------------------------------------------
// MCP-11: Server health state
// ---------------------------------------------------------------------------

describe("Phase 2: MCP server health tracking", () => {
  it("should report unknown health for unconnected servers", () => {
    const configPath = join(testDir, "mcp-servers.json");
    writeFileSync(configPath, JSON.stringify([{
      id: "s1",
      name: "my-server",
      source: "manual",
      enabled: true,
      transport: "stdio",
      command: "node",
    }]), "utf8");

    const manager = new McpServerManager(testDir);
    const servers = manager.listServers();
    expect(servers[0].health).toBe("unknown");
    expect(servers[0].state?.connected).toBe(false);
    expect(servers[0].state?.toolCount).toBe(0);
  });
});

describe("Phase 2: MCP server runtime reconfiguration", () => {
  it("should refresh enabled servers after saving runtime config changes", async () => {
    const configPath = join(testDir, "mcp-servers.json");
    writeFileSync(configPath, JSON.stringify([{
      id: "http-1",
      name: "tms",
      source: "manual",
      enabled: true,
      transport: "http",
      url: "https://example.com/mcp",
      headers: {
        "X-MCP-Token": "old-user",
      },
    }]), "utf8");

    const manager = new McpServerManager(testDir);
    const refreshSpy = vi
      .spyOn(manager, "refreshServer")
      .mockImplementation(async () => manager.listServers()[0]!);

    await manager.updateServer("http-1", {
      headers: {
        "X-MCP-Token": "new-user",
      },
    });

    expect(refreshSpy).toHaveBeenCalledWith("http-1");

    const configs = JSON.parse(readFileSync(configPath, "utf8"));
    expect(configs[0].headers["X-MCP-Token"]).toBe("new-user");
  });

  it("should rebuild connected servers when refresh is requested", async () => {
    const configPath = join(testDir, "mcp-servers.json");
    writeFileSync(configPath, JSON.stringify([{
      id: "http-1",
      name: "tms",
      source: "manual",
      enabled: true,
      transport: "http",
      url: "https://example.com/mcp",
      headers: {
        "X-MCP-Token": "user-a",
      },
    }]), "utf8");

    const manager = new McpServerManager(testDir);
    const oldClient = {
      connected: true,
      tools: [],
      error: null,
      connect: vi.fn(),
      disconnect: vi.fn(async () => {}),
      reconnect: vi.fn(async () => []),
      callTool: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    (manager as any).clients.set("http-1", oldClient);

    const connectSpy = vi
      .spyOn(manager, "connectServer")
      .mockImplementation(async () => {
        await manager.disconnectServer("http-1");
        const freshClient = {
          connected: true,
          tools: [],
          error: null,
          connect: vi.fn(),
          disconnect: vi.fn(async () => {}),
          reconnect: vi.fn(async () => []),
          callTool: vi.fn(),
          on: vi.fn(),
          removeAllListeners: vi.fn(),
        };
        (manager as any).clients.set("http-1", freshClient);
        return manager.listServers()[0]!;
      });

    await manager.refreshServer("http-1");

    expect(connectSpy).toHaveBeenCalledWith("http-1");
    expect(oldClient.reconnect).not.toHaveBeenCalled();
    expect((manager as any).clients.get("http-1")).not.toBe(oldClient);
  });
});
