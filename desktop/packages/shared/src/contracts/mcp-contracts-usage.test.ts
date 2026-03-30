import { ToolRiskCategory } from "./events";
import { describe, expect, it } from "vitest";
import type {
  ApprovalRequest,
  ExecutionIntent,
  McpServerConfig,
  McpServerState,
  McpTool,
  McpToolPreference,
} from "../index";

const serverConfig: McpServerConfig = {
  id: "server-filesystem",
  name: "Filesystem",
  source: "manual",
  transport: "stdio",
  command: "npx",
  args: ["@modelcontextprotocol/server-filesystem", "."],
  enabled: true,
};

const serverState: McpServerState = {
  serverId: serverConfig.id,
  health: "healthy",
  connected: true,
  toolCount: 1,
  lastCheckedAt: "2026-03-20T00:00:00.000Z",
  recentError: null,
};

const mcpTool: McpTool = {
  id: "server-filesystem:read_file",
  serverId: serverConfig.id,
  name: "read_file",
  description: "Read a file from the attached workspace.",
  risk: ToolRiskCategory.Read,
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
    },
  },
};

const preference: McpToolPreference = {
  toolId: mcpTool.id,
  serverId: serverConfig.id,
  enabled: true,
  exposedToModel: false,
  approvalModeOverride: "inherit",
  updatedAt: "2026-03-20T00:00:00.000Z",
};

const executionIntent: ExecutionIntent = {
  source: "mcp-tool",
  toolId: mcpTool.id,
  label: "read_file",
  risk: ToolRiskCategory.Read,
  detail: "Read README.md through the MCP filesystem server.",
  serverId: serverConfig.id,
  toolName: mcpTool.name,
  arguments: {
    path: "README.md",
  },
};

const approvalRequest: ApprovalRequest = {
  id: "approval-read-file",
  sessionId: "session-1",
  source: "mcp-tool",
  toolId: mcpTool.id,
  label: "read_file",
  risk: ToolRiskCategory.Read,
  detail: "Read README.md through the MCP filesystem server.",
  serverId: serverConfig.id,
  toolName: mcpTool.name,
  arguments: executionIntent.arguments,
};

void serverState;
void preference;
void approvalRequest;

describe("mcp contracts usage", () => {
  it("keeps MCP config, intent, and approval request types aligned", () => {
    expect(serverState.serverId).toBe(serverConfig.id);
    expect(mcpTool.risk).toBe(ToolRiskCategory.Read);
    expect(preference.toolId).toBe(mcpTool.id);
    expect(executionIntent.serverId).toBe(serverConfig.id);
    expect(approvalRequest.toolName).toBe(mcpTool.name);
  });
});
