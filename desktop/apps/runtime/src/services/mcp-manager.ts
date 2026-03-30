import type { McpServer, McpServerConfig } from "@myclaw-desktop/shared";

import type { MCPorterAdapter, MCPorterImportSource } from "./mcporter-adapter";
import { McpService, type McpServiceInvokeResult } from "./mcp-service";

export class McpManager {
  private readonly service: McpService;

  constructor(adapter: MCPorterAdapter, initialConfigs: McpServerConfig[] = []) {
    this.service = new McpService({
      adapter,
      initialConfigs,
    });
  }

  list(): McpServer[] {
    return this.service.listServers();
  }

  importServers(source: MCPorterImportSource): Promise<McpServer[]> {
    return this.service.importServers(source);
  }

  saveServer(config: McpServerConfig): Promise<McpServer> {
    return this.service.saveServer(config);
  }

  refreshServer(serverId: string): Promise<McpServer> {
    return this.service.refreshServer(serverId);
  }

  deleteServer(serverId: string): boolean {
    return this.service.deleteServer(serverId);
  }

  invoke(serverId: string, toolName: string, args: Record<string, unknown>): Promise<McpServiceInvokeResult> {
    return this.service.invoke(serverId, toolName, args);
  }
}
