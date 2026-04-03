import { ipcMain } from "electron";

import type { McpServer, McpServerConfig } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import type { DiscoveredMcpServer } from "../services/mcp-server-manager";

type CreateMcpServerInput = Omit<McpServerConfig, "id">;
type UpdateMcpServerInput = Partial<Omit<McpServerConfig, "id">>;

export function registerMcpHandlers(ctx: RuntimeContext): void {
  // List all configured MCP servers with their live state
  ipcMain.handle("mcp:list-servers", async (): Promise<McpServer[]> => {
    return ctx.services.listMcpServers();
  });

  // Create a new MCP server configuration
  ipcMain.handle(
    "mcp:create-server",
    async (_event, input: CreateMcpServerInput): Promise<McpServer> => {
      if (!ctx.services.mcpManager) {
        throw new Error("MCP manager not initialized");
      }
      return ctx.services.mcpManager.createServer(input);
    },
  );

  // Update an existing MCP server configuration
  ipcMain.handle(
    "mcp:update-server",
    async (_event, id: string, updates: UpdateMcpServerInput): Promise<McpServer> => {
      if (!ctx.services.mcpManager) {
        throw new Error("MCP manager not initialized");
      }
      const result = await ctx.services.mcpManager.updateServer(id, updates);
      if (!result) {
        throw new Error(`MCP server not found: ${id}`);
      }
      return result;
    },
  );

  // Delete an MCP server configuration
  ipcMain.handle("mcp:delete-server", async (_event, id: string): Promise<{ success: boolean }> => {
    if (!ctx.services.mcpManager) {
      return { success: false };
    }
    const deleted = await ctx.services.mcpManager.deleteServer(id);
    return { success: deleted };
  });

  // Refresh (reconnect / re-probe) an MCP server
  ipcMain.handle(
    "mcp:refresh-server",
    async (_event, id: string): Promise<McpServer> => {
      if (!ctx.services.mcpManager) {
        throw new Error("MCP manager not initialized");
      }
      return ctx.services.mcpManager.refreshServer(id);
    },
  );

  // Connect a specific server
  ipcMain.handle(
    "mcp:connect-server",
    async (_event, id: string): Promise<McpServer> => {
      if (!ctx.services.mcpManager) {
        throw new Error("MCP manager not initialized");
      }
      return ctx.services.mcpManager.connectServer(id);
    },
  );

  // Discover MCP servers from external tools (Claude Desktop, Cursor)
  ipcMain.handle("mcp:discover-external", async (): Promise<DiscoveredMcpServer[]> => {
    if (!ctx.services.mcpManager) return [];
    return ctx.services.mcpManager.discoverExternalServers();
  });

  // Import selected discovered servers
  ipcMain.handle(
    "mcp:import-servers",
    async (_event, servers: DiscoveredMcpServer[]): Promise<McpServer[]> => {
      if (!ctx.services.mcpManager) return [];
      return ctx.services.mcpManager.importServers(servers);
    },
  );
}
