import type { McpServerConfig, McpSource, McpTool } from "@myclaw-desktop/shared";

export type MCPorterImportSource = Exclude<McpSource, "manual">;

export type MCPorterRefreshResult = {
  connected: boolean;
  tools: McpTool[];
  checkedAt?: string;
};

export type MCPorterInvokeResult = {
  ok: boolean;
  summary: string;
  output: string;
  structuredContent?: Record<string, unknown> | null;
};

export interface MCPorterAdapter {
  importServers(source: MCPorterImportSource): Promise<McpServerConfig[]>;
  refreshServer(config: McpServerConfig): Promise<MCPorterRefreshResult>;
  invokeServerTool(
    config: McpServerConfig,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPorterInvokeResult>;
}

export class NoopMCPorterAdapter implements MCPorterAdapter {
  async importServers(): Promise<McpServerConfig[]> {
    return [];
  }

  async refreshServer(): Promise<MCPorterRefreshResult> {
    return {
      connected: false,
      tools: [],
    };
  }

  async invokeServerTool(): Promise<MCPorterInvokeResult> {
    throw new Error("No MCP transport adapter is configured.");
  }
}
