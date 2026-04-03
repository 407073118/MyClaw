import type { BuiltinToolApprovalMode } from "./builtin-tool";
import { ToolRiskCategory } from "./events";

export type McpTransport = "stdio" | "http";
export type McpSource = "manual" | "claude" | "codex" | "cursor";
export type McpServerHealth = "unknown" | "healthy" | "error";

type McpServerConfigBase = {
  id: string;
  name: string;
  source: McpSource;
  enabled: boolean;
};

export type McpStdioServerConfig = McpServerConfigBase & {
  transport: "stdio";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export type McpHttpServerConfig = McpServerConfigBase & {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
};

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export type McpServerState = {
  serverId: string;
  health: McpServerHealth;
  connected: boolean;
  toolCount: number;
  lastCheckedAt: string | null;
  recentError: string | null;
};

export type McpTool = {
  id: string;
  serverId: string;
  name: string;
  description: string;
  risk: ToolRiskCategory;
  inputSchema: Record<string, unknown> | null;
};

export type McpToolPreference = {
  toolId: string;
  serverId: string;
  enabled: boolean;
  exposedToModel: boolean;
  approvalModeOverride: BuiltinToolApprovalMode | null;
  updatedAt: string;
};

export type ResolvedMcpTool = McpTool & {
  enabled: boolean;
  exposedToModel: boolean;
  effectiveApprovalMode: BuiltinToolApprovalMode;
};

export type McpServer = McpServerConfig & {
  health: McpServerHealth;
  tools: McpTool[];
  state?: McpServerState;
  recentError?: string | null;
  lastCheckedAt?: string | null;
};
