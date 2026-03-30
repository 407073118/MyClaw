import { ToolRiskCategory, type McpServerConfig, type McpTool } from "@myclaw-desktop/shared";
import { describe, expect, it } from "vitest";

import type { MCPorterAdapter, MCPorterInvokeResult, MCPorterRefreshResult } from "./mcporter-adapter";
import { McpService } from "./mcp-service";

class FakeMCPorterAdapter implements MCPorterAdapter {
  readonly importCalls: Array<"claude" | "codex" | "cursor"> = [];
  readonly refreshCalls: string[] = [];
  readonly invokeCalls: Array<{ serverId: string; toolName: string; args: Record<string, unknown> }> = [];

  constructor(
    private readonly data: {
      imports?: Partial<Record<"claude" | "codex" | "cursor", McpServerConfig[]>>;
      refreshes?: Record<string, MCPorterRefreshResult>;
      refreshErrors?: Record<string, Error>;
      invokes?: Record<string, MCPorterInvokeResult>;
    } = {},
  ) {}

  async importServers(source: "claude" | "codex" | "cursor"): Promise<McpServerConfig[]> {
    this.importCalls.push(source);
    return this.data.imports?.[source] ?? [];
  }

  async refreshServer(config: McpServerConfig): Promise<MCPorterRefreshResult> {
    this.refreshCalls.push(config.id);
    const error = this.data.refreshErrors?.[config.id];
    if (error) {
      throw error;
    }

    return (
      this.data.refreshes?.[config.id] ?? {
        connected: false,
        tools: [],
      }
    );
  }

  async invokeServerTool(
    config: McpServerConfig,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPorterInvokeResult> {
    this.invokeCalls.push({ serverId: config.id, toolName, args });
    return (
      this.data.invokes?.[`${config.id}:${toolName}`] ?? {
        ok: true,
        summary: `Invoked ${toolName}`,
        output: JSON.stringify(args),
      }
    );
  }
}

function createFilesystemConfig(): McpServerConfig {
  return {
    id: "mcp-filesystem",
    name: "Filesystem MCP",
    source: "manual",
    transport: "stdio",
    command: "npx",
    args: ["@modelcontextprotocol/server-filesystem", "."],
    enabled: true,
  };
}

function createReadFileTool(serverId: string): McpTool {
  return {
    id: `${serverId}:read_file`,
    serverId,
    name: "read_file",
    description: "Read a file from the workspace.",
    risk: ToolRiskCategory.Read,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
    },
  };
}

describe("mcp service", () => {
  it("imports server configs, refreshes enabled servers, and caches discovered tools", async () => {
    const config = createFilesystemConfig();
    const tool = createReadFileTool(config.id);
    const adapter = new FakeMCPorterAdapter({
      imports: {
        claude: [config],
      },
      refreshes: {
        [config.id]: {
          connected: true,
          tools: [tool],
          checkedAt: "2026-03-20T06:00:00.000Z",
        },
      },
    });
    const service = new McpService({ adapter });

    const servers = await service.importServers("claude");

    expect(adapter.importCalls).toEqual(["claude"]);
    expect(adapter.refreshCalls).toEqual([config.id]);
    expect(servers).toHaveLength(1);
    expect(servers[0].state?.health).toBe("healthy");
    expect(servers[0].state?.connected).toBe(true);
    expect(service.listTools()).toEqual([tool]);
  });

  it("saves manual servers and surfaces refresh failures as error state snapshots", async () => {
    const config: McpServerConfig = {
      id: "mcp-broken-http",
      name: "Broken HTTP MCP",
      source: "manual",
      transport: "http",
      url: "http://127.0.0.1:7777/mcp",
      enabled: true,
    };
    const adapter = new FakeMCPorterAdapter({
      refreshErrors: {
        [config.id]: new Error("connection refused"),
      },
    });
    const service = new McpService({ adapter });

    const saved = await service.saveServer(config);

    expect(adapter.refreshCalls).toEqual([config.id]);
    expect(saved.state?.health).toBe("error");
    expect(saved.recentError).toContain("connection refused");
    expect(service.listTools()).toEqual([]);
  });

  it("invokes server tools and normalizes results with MCP context", async () => {
    const config = createFilesystemConfig();
    const tool = createReadFileTool(config.id);
    const adapter = new FakeMCPorterAdapter({
      refreshes: {
        [config.id]: {
          connected: true,
          tools: [tool],
          checkedAt: "2026-03-20T06:00:00.000Z",
        },
      },
      invokes: {
        [`${config.id}:read_file`]: {
          ok: true,
          summary: "Read README.md",
          output: "# README\nfrom MCP",
        },
      },
    });
    const service = new McpService({ adapter, initialConfigs: [config] });

    await service.refreshServer(config.id);
    const result = await service.invoke(config.id, "read_file", { path: "README.md" });

    expect(adapter.invokeCalls).toEqual([
      {
        serverId: config.id,
        toolName: "read_file",
        args: { path: "README.md" },
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      serverId: config.id,
      toolName: "read_file",
      arguments: { path: "README.md" },
      summary: "Read README.md",
      output: "# README\nfrom MCP",
    });
    expect(service.listServers()[0].state?.health).toBe("healthy");
  });
});
