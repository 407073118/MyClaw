/**
 * MCP Server Manager — manages MCP server configurations, persistence,
 * and live connections via McpClient instances.
 *
 * Responsibilities:
 * - CRUD for server configs (persisted to mcp-servers.json)
 * - Lifecycle management (connect / disconnect / refresh)
 * - Tool aggregation across all connected servers
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  McpServer,
  McpServerConfig,
  McpHttpServerConfig,
  McpSource,
  McpStdioServerConfig,
  McpTool,
} from "@shared/contracts";
import { ToolRiskCategory } from "@shared/contracts";

import { McpClient, type McpToolInfo } from "./mcp-client";
import { McpHttpClient } from "./mcp-http-client";
import { createLogger } from "./logger";

/** Unified interface for both stdio and HTTP MCP clients. */
type McpClientLike = {
  connected: boolean;
  tools: McpToolInfo[];
  error: string | null;
  connect(): Promise<McpToolInfo[]>;
  disconnect(): Promise<void>;
  reconnect(): Promise<McpToolInfo[]>;
  callTool(toolName: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string; [key: string]: unknown }>; isError?: boolean }>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeAllListeners(event?: string): unknown;
};

const log = createLogger("mcp-manager");

// ---------------------------------------------------------------------------
// Discovered server type (for external import)
// ---------------------------------------------------------------------------

/** Discovered MCP server from external config (Claude Desktop, Cursor). */
export type DiscoveredMcpServer = {
  source: "claude-desktop" | "cursor" | "codex";
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  alreadyImported: boolean;
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function loadConfigs(filePath: string): McpServerConfig[] {
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    log.warn("Failed to load mcp-servers.json");
  }
  return [];
}

function saveConfigs(filePath: string, configs: McpServerConfig[]): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(configs, null, 2), "utf8");
  } catch (err) {
    log.error("Failed to save mcp-servers.json", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Risk heuristic for MCP tools
// ---------------------------------------------------------------------------

export function inferToolRisk(toolName: string): ToolRiskCategory {
  const lower = toolName.toLowerCase();
  if (/exec|run|shell|command|install/.test(lower)) {
    return ToolRiskCategory.Exec;
  }
  if (/write|create|delete|remove|modify|update|patch|put|post/.test(lower)) {
    return ToolRiskCategory.Write;
  }
  if (/fetch|request|http|curl|download|upload/.test(lower)) {
    return ToolRiskCategory.Network;
  }
  // Default to Read for everything else
  return ToolRiskCategory.Read;
}

// ---------------------------------------------------------------------------
// McpServerManager
// ---------------------------------------------------------------------------

export class McpServerManager {
  private configs: McpServerConfig[] = [];
  private clients = new Map<string, McpClientLike>();
  private configFilePath: string;

  constructor(myClawDir: string) {
    this.configFilePath = join(myClawDir, "mcp-servers.json");
    this.configs = loadConfigs(this.configFilePath);
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  /** List all servers with their live state and tools. */
  listServers(): McpServer[] {
    return this.configs.map((config) => this.toMcpServer(config));
  }

  /** Create a new server config, persist, and optionally auto-connect. */
  async createServer(input: Omit<McpServerConfig, "id">): Promise<McpServer> {
    const config: McpServerConfig = {
      id: randomUUID(),
      ...input,
    } as McpServerConfig;

    this.configs.push(config);
    this.persist();

    // Auto-connect if enabled
    if (config.enabled) {
      try {
        await this.connectServer(config.id);
      } catch (err) {
        log.warn("Auto-connect failed for server", { name: config.name, error: String(err) });
      }
    }

    return this.toMcpServer(config);
  }

  /** Delete a server config, disconnect its process, and persist. */
  async deleteServer(id: string): Promise<boolean> {
    const idx = this.configs.findIndex((c) => c.id === id);
    if (idx === -1) return false;

    // Disconnect if running
    await this.disconnectServer(id);

    this.configs.splice(idx, 1);
    this.persist();
    return true;
  }

  /** Update a server config and persist. */
  async updateServer(id: string, updates: Partial<Omit<McpServerConfig, "id">>): Promise<McpServer | null> {
    const config = this.configs.find((c) => c.id === id);
    if (!config) return null;

    Object.assign(config, updates);
    this.persist();

    return this.toMcpServer(config);
  }

  // -----------------------------------------------------------------------
  // Connection lifecycle
  // -----------------------------------------------------------------------

  /** Connect to a single server (stdio or HTTP). */
  async connectServer(id: string): Promise<McpServer> {
    const config = this.configs.find((c) => c.id === id);
    if (!config) throw new Error(`MCP server not found: ${id}`);

    // Disconnect existing client if any
    await this.disconnectServer(id);

    let client: McpClientLike;

    if (config.transport === "http") {
      const httpConfig = config as McpHttpServerConfig;
      client = new McpHttpClient(httpConfig.url, httpConfig.headers);
    } else {
      const stdioConfig = config as McpStdioServerConfig;
      client = new McpClient(
        stdioConfig.command,
        stdioConfig.args ?? [],
        stdioConfig.cwd,
        stdioConfig.env,
      );
    }

    client.on("error", (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error("Server error", { name: config.name, error: message });
    });

    if (config.transport === "stdio") {
      (client as McpClient).on("exit", (code: number | null) => {
        log.info("Server exited", { name: config.name, code });
      });
    }

    this.clients.set(id, client);

    try {
      await client.connect();
      log.info("Connected to server", { name: config.name, transport: config.transport, toolCount: client.tools.length });
    } catch (err) {
      log.error("Failed to connect to server", { name: config.name, error: String(err) });
      throw err;
    }

    return this.toMcpServer(config);
  }

  /** Disconnect a single server. */
  async disconnectServer(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      client.removeAllListeners();
      await client.disconnect();
      this.clients.delete(id);
    }
  }

  /** Refresh (reconnect) a server and re-fetch tools. */
  async refreshServer(id: string): Promise<McpServer> {
    const config = this.configs.find((c) => c.id === id);
    if (!config) throw new Error(`MCP server not found: ${id}`);

    const client = this.clients.get(id);
    if (client?.connected) {
      await client.reconnect();
    } else {
      await this.connectServer(id);
    }

    return this.toMcpServer(config);
  }

  /** Connect all enabled servers (called at app startup). */
  async connectAllEnabled(): Promise<void> {
    const promises = this.configs
      .filter((c) => c.enabled)
      .map((c) =>
        this.connectServer(c.id).catch((err) => {
          log.warn("Failed to auto-connect server", { name: c.name, error: String(err) });
        }),
      );

    await Promise.allSettled(promises);
  }

  /** Disconnect all servers (called at app shutdown). */
  async disconnectAll(): Promise<void> {
    const promises = [...this.clients.keys()].map((id) => this.disconnectServer(id));
    await Promise.allSettled(promises);
  }

  // -----------------------------------------------------------------------
  // Tool execution
  // -----------------------------------------------------------------------

  /** Call a tool on a specific server. */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const client = this.clients.get(serverId);
    if (!client?.connected) {
      throw new Error(`MCP server not connected: ${serverId}`);
    }

    const result = await client.callTool(toolName, args);

    // Flatten result content to text
    if (result.isError) {
      const text = result.content
        .map((c) => c.text ?? JSON.stringify(c))
        .join("\n");
      throw new Error(text || "MCP tool execution failed");
    }

    return result.content
      .map((c) => c.text ?? JSON.stringify(c))
      .join("\n");
  }

  // -----------------------------------------------------------------------
  // Tool aggregation (for building function calling schemas)
  // -----------------------------------------------------------------------

  /** Get all tools from all connected servers. */
  getAllTools(): Array<McpTool & { serverId: string }> {
    const allTools: Array<McpTool & { serverId: string }> = [];

    for (const [serverId, client] of this.clients) {
      if (!client.connected) continue;

      const config = this.configs.find((c) => c.id === serverId);
      const serverName = config?.name ?? serverId;

      for (const tool of client.tools) {
        allTools.push({
          id: `mcp__${serverName}__${tool.name}`,
          serverId,
          name: tool.name,
          description: tool.description,
          risk: inferToolRisk(tool.name),
          inputSchema: tool.inputSchema,
        });
      }
    }

    return allTools;
  }

  // -----------------------------------------------------------------------
  // External import (Claude Desktop, Cursor)
  // -----------------------------------------------------------------------

  /** Discover MCP servers from external tools (Claude Desktop, Cursor). */
  discoverExternalServers(): DiscoveredMcpServer[] {
    const discovered: DiscoveredMcpServer[] = [];
    const home = homedir();

    // Claude Desktop: ~/.claude/claude_desktop_config.json
    try {
      const claudeConfigPath = join(home, ".claude", "claude_desktop_config.json");
      if (existsSync(claudeConfigPath)) {
        const raw = readFileSync(claudeConfigPath, "utf8");
        const config = JSON.parse(raw);
        const servers = config.mcpServers ?? config.mcpservers ?? {};
        for (const [name, def] of Object.entries(servers)) {
          const d = def as Record<string, unknown>;
          if (!d.command) continue;
          discovered.push({
            source: "claude-desktop",
            name,
            command: String(d.command),
            args: Array.isArray(d.args) ? d.args.map(String) : [],
            env:
              d.env && typeof d.env === "object"
                ? (d.env as Record<string, string>)
                : undefined,
            alreadyImported: this.configs.some((c) => c.name === name),
          });
        }
      }
    } catch (err) {
      log.warn("Failed to read Claude Desktop config", { error: String(err) });
    }

    // Cursor: ~/.cursor/mcp.json
    try {
      const cursorConfigPath = join(home, ".cursor", "mcp.json");
      if (existsSync(cursorConfigPath)) {
        const raw = readFileSync(cursorConfigPath, "utf8");
        const config = JSON.parse(raw);
        const servers = config.mcpServers ?? {};
        for (const [name, def] of Object.entries(servers)) {
          const d = def as Record<string, unknown>;
          if (!d.command) continue;
          discovered.push({
            source: "cursor",
            name,
            command: String(d.command),
            args: Array.isArray(d.args) ? d.args.map(String) : [],
            env:
              d.env && typeof d.env === "object"
                ? (d.env as Record<string, string>)
                : undefined,
            alreadyImported: this.configs.some((c) => c.name === name),
          });
        }
      }
    } catch (err) {
      log.warn("Failed to read Cursor config", { error: String(err) });
    }

    return discovered;
  }

  /** Import selected discovered servers into MyClaw. */
  async importServers(servers: DiscoveredMcpServer[]): Promise<McpServer[]> {
    const imported: McpServer[] = [];
    for (const server of servers) {
      if (server.alreadyImported) continue;
      const stdioConfig: Omit<McpStdioServerConfig, "id"> = {
        name: server.name,
        source: (server.source === "claude-desktop" ? "claude" : server.source) as McpSource,
        enabled: true,
        transport: "stdio",
        command: server.command,
        args: server.args,
        env: server.env,
      };
      const result = await this.createServer(stdioConfig);
      imported.push(result);
    }
    return imported;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private persist(): void {
    saveConfigs(this.configFilePath, this.configs);
  }

  private toMcpServer(config: McpServerConfig): McpServer {
    const client = this.clients.get(config.id);
    const connected = client?.connected ?? false;
    const tools: McpTool[] = (client?.tools ?? []).map((t) => ({
      id: `mcp__${config.name}__${t.name}`,
      serverId: config.id,
      name: t.name,
      description: t.description,
      risk: inferToolRisk(t.name),
      inputSchema: t.inputSchema,
    }));

    return {
      ...config,
      health: connected ? "healthy" : (client?.error ? "error" : "unknown"),
      tools,
      state: {
        serverId: config.id,
        health: connected ? "healthy" : (client?.error ? "error" : "unknown"),
        connected,
        toolCount: tools.length,
        lastCheckedAt: connected ? new Date().toISOString() : null,
        recentError: client?.error ?? null,
      },
      recentError: client?.error ?? null,
      lastCheckedAt: connected ? new Date().toISOString() : null,
    };
  }
}
