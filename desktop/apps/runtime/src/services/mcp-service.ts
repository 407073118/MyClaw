import type { McpServer, McpServerConfig, McpServerState, McpTool } from "@myclaw-desktop/shared";

import type {
  MCPorterAdapter,
  MCPorterImportSource,
  MCPorterInvokeResult,
  MCPorterRefreshResult,
} from "./mcporter-adapter";

export type McpServiceInvokeResult = MCPorterInvokeResult & {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
};

type McpServiceOptions = {
  adapter: MCPorterAdapter;
  initialConfigs?: McpServerConfig[];
};

function createUnknownState(serverId: string, recentError: string | null = null): McpServerState {
  return {
    serverId,
    health: recentError ? "error" : "unknown",
    connected: false,
    toolCount: 0,
    lastCheckedAt: null,
    recentError,
  };
}

function normalizeTool(tool: McpTool, serverId: string): McpTool {
  return {
    ...tool,
    id: tool.id || `${serverId}:${tool.name}`,
    serverId: tool.serverId || serverId,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? null,
  };
}

export class McpService {
  private readonly configs = new Map<string, McpServerConfig>();
  private readonly states = new Map<string, McpServerState>();
  private readonly toolsByServer = new Map<string, McpTool[]>();

  constructor(private readonly options: McpServiceOptions) {
    options.initialConfigs?.forEach((config) => {
      this.configs.set(config.id, config);
      this.states.set(config.id, createUnknownState(config.id));
      this.toolsByServer.set(config.id, []);
    });
  }

  listServers(): McpServer[] {
    return [...this.configs.values()].map((config) => {
      const state = this.states.get(config.id) ?? createUnknownState(config.id);
      const tools = this.toolsByServer.get(config.id) ?? [];
      return {
        ...config,
        health: state.health,
        recentError: state.recentError,
        lastCheckedAt: state.lastCheckedAt,
        state,
        tools,
      };
    });
  }

  async importServers(source: MCPorterImportSource): Promise<McpServer[]> {
    const configs = await this.options.adapter.importServers(source);
    for (const config of configs) {
      await this.saveServer(config);
    }
    return this.listServers();
  }

  async saveServer(config: McpServerConfig): Promise<McpServer> {
    this.configs.set(config.id, config);
    this.states.set(config.id, createUnknownState(config.id));
    this.toolsByServer.set(config.id, []);

    if (config.enabled) {
      return this.refreshServer(config.id);
    }

    return this.requireServer(config.id);
  }

  async refreshServer(serverId: string): Promise<McpServer> {
    const config = this.requireConfig(serverId);
    if (!config.enabled) {
      this.states.set(serverId, createUnknownState(serverId));
      this.toolsByServer.set(serverId, []);
      return this.requireServer(serverId);
    }

    try {
      const result = await this.options.adapter.refreshServer(config);
      this.applyRefresh(serverId, result);
      return this.requireServer(serverId);
    } catch (error) {
      this.toolsByServer.set(serverId, []);
      this.states.set(
        serverId,
        createUnknownState(serverId, error instanceof Error ? error.message : "Unknown MCP refresh failure"),
      );
      return this.requireServer(serverId);
    }
  }

  listTools(): McpTool[] {
    return [...this.toolsByServer.values()].flat();
  }

  deleteServer(serverId: string): boolean {
    const existed = this.configs.delete(serverId);
    this.states.delete(serverId);
    this.toolsByServer.delete(serverId);
    return existed;
  }

  async invoke(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpServiceInvokeResult> {
    const config = this.requireConfig(serverId);

    try {
      const result = await this.options.adapter.invokeServerTool(config, toolName, args);
      const state = this.states.get(serverId) ?? createUnknownState(serverId);
      this.states.set(serverId, {
        ...state,
        health: result.ok ? "healthy" : "error",
        connected: result.ok,
        lastCheckedAt: new Date().toISOString(),
        recentError: result.ok ? null : result.summary,
      });
      return {
        ...result,
        serverId,
        toolName,
        arguments: args,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown MCP invocation failure";
      const state = this.states.get(serverId) ?? createUnknownState(serverId);
      this.states.set(serverId, {
        ...state,
        health: "error",
        connected: false,
        lastCheckedAt: new Date().toISOString(),
        recentError: message,
      });
      return {
        ok: false,
        summary: message,
        output: "",
        serverId,
        toolName,
        arguments: args,
      };
    }
  }

  private applyRefresh(serverId: string, result: MCPorterRefreshResult): void {
    const normalizedTools = result.tools.map((tool) => normalizeTool(tool, serverId));
    this.toolsByServer.set(serverId, normalizedTools);
    this.states.set(serverId, {
      serverId,
      health: result.connected ? "healthy" : "unknown",
      connected: result.connected,
      toolCount: normalizedTools.length,
      lastCheckedAt: result.checkedAt ?? new Date().toISOString(),
      recentError: null,
    });
  }

  private requireConfig(serverId: string): McpServerConfig {
    const config = this.configs.get(serverId);
    if (!config) {
      throw new Error(`MCP server not found: ${serverId}`);
    }
    return config;
  }

  private requireServer(serverId: string): McpServer {
    const server = this.listServers().find((item) => item.id === serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${serverId}`);
    }
    return server;
  }
}
