import { ipcMain } from "electron";

import type { McpServer, McpServerConfig } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import type { DiscoveredMcpServer } from "../services/mcp-server-manager";

type CreateMcpServerInput = McpServerConfig;
type UpdateMcpServerInput = Partial<Omit<McpServerConfig, "id">>;

/** 注册 MCP 相关 IPC 处理器。 */
export function registerMcpHandlers(ctx: RuntimeContext): void {
  // 列出全部 MCP 服务及其实时状态。
  ipcMain.handle("mcp:list-servers", async (): Promise<McpServer[]> => {
    return ctx.services.listMcpServers();
  });

  // 创建新的 MCP 服务配置。
  ipcMain.handle(
    "mcp:create-server",
    async (_event, input: CreateMcpServerInput): Promise<McpServer> => {
      if (!ctx.services.mcpManager) {
        throw new Error("MCP manager not initialized");
      }
      return ctx.services.mcpManager.createServer(input);
    },
  );

  // 更新现有 MCP 服务配置。
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

  // 删除 MCP 服务配置。
  ipcMain.handle("mcp:delete-server", async (_event, id: string): Promise<{ success: boolean }> => {
    if (!ctx.services.mcpManager) {
      return { success: false };
    }
    const deleted = await ctx.services.mcpManager.deleteServer(id);
    return { success: deleted };
  });

  // 刷新 MCP 服务，包含重连和重新探测。
  ipcMain.handle(
    "mcp:refresh-server",
    async (_event, id: string): Promise<McpServer> => {
      if (!ctx.services.mcpManager) {
        throw new Error("MCP manager not initialized");
      }
      return ctx.services.mcpManager.refreshServer(id);
    },
  );

  // 主动连接指定 MCP 服务。
  ipcMain.handle(
    "mcp:connect-server",
    async (_event, id: string): Promise<McpServer> => {
      if (!ctx.services.mcpManager) {
        throw new Error("MCP manager not initialized");
      }
      return ctx.services.mcpManager.connectServer(id);
    },
  );

  // 从外部工具配置中发现 MCP 服务。
  ipcMain.handle("mcp:discover-external", async (): Promise<DiscoveredMcpServer[]> => {
    if (!ctx.services.mcpManager) return [];
    return ctx.services.mcpManager.discoverExternalServers();
  });

  // 导入选中的外部 MCP 服务。
  ipcMain.handle(
    "mcp:import-servers",
    async (_event, servers: DiscoveredMcpServer[]): Promise<McpServer[]> => {
      if (!ctx.services.mcpManager) return [];
      return ctx.services.mcpManager.importServers(servers);
    },
  );
}
