import type { RuntimeCapabilityRef } from "@shared/contracts";

import { McpClient, type McpCallResult, type McpToolInfo } from "./mcp-client";
import { McpHttpClient } from "./mcp-http-client";

type ProjectMcpTransport = "stdio" | "http" | "sse" | "streamable-http";

type ProjectMcpRuntimeConfig = {
  transport: ProjectMcpTransport;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

type ProjectMcpClient = {
  connected: boolean;
  tools: McpToolInfo[];
  error: string | null;
  connect(): Promise<McpToolInfo[]>;
  disconnect(): Promise<void>;
  callTool(toolName: string, args: Record<string, unknown>): Promise<McpCallResult>;
};

/** 判断 unknown 是否是普通对象，供 MCP runtime 配置解析复用。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 把 unknown 数组安全收敛成字符串数组，避免把非字符串参数传给 stdio MCP。 */
function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => String(item));
}

/** 把 unknown 对象安全收敛成字符串字典，用于 env 和 headers。 */
function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

/** 项目 MCP 一次性运行时：只临时连接、枚举或调用，不写入全局 MCP 配置。 */
export class ProjectMcpRuntimeService {
  /** 为项目 MCP 能力临时连接并枚举 tools，完成后立即断开。 */
  async listToolsForCapability(ref: RuntimeCapabilityRef): Promise<McpToolInfo[]> {
    const config = this.resolveConfig(ref);
    const client = this.createClient(config);
    console.info("[project-mcp-runtime] 开始临时枚举项目 MCP 工具", {
      capabilityRefId: ref.capabilityRefId ?? ref.id,
      transport: config.transport,
    });
    try {
      const tools = await client.connect();
      console.info("[project-mcp-runtime] 项目 MCP 工具枚举完成", {
        capabilityRefId: ref.capabilityRefId ?? ref.id,
        toolCount: tools.length,
      });
      return tools;
    } catch (error) {
      console.warn("[project-mcp-runtime] 项目 MCP 工具枚举失败", {
        capabilityRefId: ref.capabilityRefId ?? ref.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await this.disconnectQuietly(client, ref);
    }
  }

  /** 为项目 MCP 能力临时连接并调用指定 tool，完成后立即断开。 */
  async callToolForCapability(ref: RuntimeCapabilityRef, args: Record<string, unknown>): Promise<string> {
    if (!ref.toolName) {
      console.warn("[project-mcp-runtime] 拒绝调用缺少 toolName 的项目 MCP", {
        capabilityRefId: ref.capabilityRefId ?? ref.id,
      });
      throw new Error("project_mcp_tool_name_missing");
    }
    const config = this.resolveConfig(ref);
    const client = this.createClient(config);
    console.info("[project-mcp-runtime] 开始临时调用项目 MCP 工具", {
      capabilityRefId: ref.capabilityRefId ?? ref.id,
      toolName: ref.toolName,
      transport: config.transport,
    });
    try {
      await client.connect();
      const result = await client.callTool(ref.toolName, args);
      const output = this.flattenResult(result);
      console.info("[project-mcp-runtime] 项目 MCP 工具调用完成", {
        capabilityRefId: ref.capabilityRefId ?? ref.id,
        toolName: ref.toolName,
        outputLength: output.length,
      });
      return output;
    } catch (error) {
      console.warn("[project-mcp-runtime] 项目 MCP 工具调用失败", {
        capabilityRefId: ref.capabilityRefId ?? ref.id,
        toolName: ref.toolName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await this.disconnectQuietly(client, ref);
    }
  }

  /** 从 bundle ref 中解析项目 MCP 运行配置，优先 runtimeConfigJson，兼容 manifestJson.config。 */
  private resolveConfig(ref: RuntimeCapabilityRef): ProjectMcpRuntimeConfig {
    const rawConfig = isRecord(ref.runtimeConfigJson)
      ? ref.runtimeConfigJson
      : isRecord(ref.manifestJson) && isRecord(ref.manifestJson.config)
        ? ref.manifestJson.config
        : null;
    if (!rawConfig) {
      console.warn("[project-mcp-runtime] 项目 MCP 缺少运行配置", {
        capabilityRefId: ref.capabilityRefId ?? ref.id,
      });
      throw new Error("project_mcp_runtime_config_missing");
    }

    const transport = String(rawConfig.transport ?? "");
    if (transport === "stdio") {
      const command = String(rawConfig.command ?? "").trim();
      if (!command) {
        console.warn("[project-mcp-runtime] 项目 stdio MCP 缺少 command", {
          capabilityRefId: ref.capabilityRefId ?? ref.id,
        });
        throw new Error("project_mcp_stdio_command_missing");
      }
      return {
        transport,
        command,
        args: readStringArray(rawConfig.args),
        cwd: typeof rawConfig.cwd === "string" && rawConfig.cwd.trim() ? rawConfig.cwd : undefined,
        env: readStringRecord(rawConfig.env),
      };
    }

    if (transport === "http" || transport === "sse" || transport === "streamable-http") {
      const url = String(rawConfig.url ?? "").trim();
      if (!url) {
        console.warn("[project-mcp-runtime] 项目 HTTP MCP 缺少 url", {
          capabilityRefId: ref.capabilityRefId ?? ref.id,
          transport,
        });
        throw new Error("project_mcp_http_url_missing");
      }
      return {
        transport,
        url,
        headers: readStringRecord(rawConfig.headers),
      };
    }

    console.warn("[project-mcp-runtime] 项目 MCP transport 不受支持", {
      capabilityRefId: ref.capabilityRefId ?? ref.id,
      transport,
    });
    throw new Error("project_mcp_transport_invalid");
  }

  /** 按项目 MCP transport 创建一次性 client。 */
  private createClient(config: ProjectMcpRuntimeConfig): ProjectMcpClient {
    if (config.transport === "stdio") {
      return new McpClient(config.command!, config.args ?? [], config.cwd, config.env);
    }
    return new McpHttpClient(config.url!, config.headers);
  }

  /** 将 MCP content 数组压平成与全局 MCP manager 一致的文本输出。 */
  private flattenResult(result: McpCallResult): string {
    const text = result.content.map((item) => item.text ?? JSON.stringify(item)).join("\n");
    if (result.isError) {
      throw new Error(text || "MCP tool execution failed");
    }
    return text;
  }

  /** 安静断开临时 client，并记录中文日志便于排查泄漏。 */
  private async disconnectQuietly(client: ProjectMcpClient, ref: RuntimeCapabilityRef): Promise<void> {
    try {
      await client.disconnect();
      console.info("[project-mcp-runtime] 项目 MCP 临时连接已断开", {
        capabilityRefId: ref.capabilityRefId ?? ref.id,
      });
    } catch (error) {
      console.warn("[project-mcp-runtime] 项目 MCP 临时连接断开失败", {
        capabilityRefId: ref.capabilityRefId ?? ref.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
