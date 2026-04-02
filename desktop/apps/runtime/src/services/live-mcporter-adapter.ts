import type { McpServerConfig, McpTool } from "@myclaw-desktop/shared";
import { ToolRiskCategory } from "@myclaw-desktop/shared";
import { spawn, type ChildProcess } from "node:child_process";

import type { MCPorterAdapter, MCPorterImportSource, MCPorterInvokeResult, MCPorterRefreshResult } from "./mcporter-adapter";

// ── JSON-RPC 2.0 types ────────────────────────────────────────────

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type McpToolSchema = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type McpToolCallResult = {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
};

// ── Stdio transport ────────────────────────────────────────────────

async function connectStdio(
  config: McpServerConfig & { transport: "stdio" },
  timeoutMs = 15_000,
): Promise<{ call: (method: string, params?: Record<string, unknown>) => Promise<unknown>; close: () => void }> {
  const child: ChildProcess = spawn(config.command, config.args ?? [], {
    cwd: config.cwd,
    env: { ...process.env, ...(config.env ?? {}) },
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  if (!child.stdin || !child.stdout) {
    child.kill();
    throw new Error("Failed to open stdio pipes for MCP server.");
  }

  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let buffer = "";

  child.stdout.setEncoding("utf-8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse;
        if (msg.id != null && pending.has(msg.id)) {
          const handler = pending.get(msg.id)!;
          pending.delete(msg.id);
          if (msg.error) {
            handler.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
          } else {
            handler.resolve(msg.result);
          }
        }
      } catch {
        // Ignore non-JSON lines (notifications, logs)
      }
    }
  });

  function call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };

      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);

      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });

      child.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  function close() {
    for (const [, handler] of pending) {
      handler.reject(new Error("MCP connection closed."));
    }
    pending.clear();
    child.kill();
  }

  return { call, close };
}

// ── HTTP transport ─────────────────────────────────────────────────

async function connectHttp(
  config: McpServerConfig & { transport: "http" },
  timeoutMs = 15_000,
): Promise<{ call: (method: string, params?: Record<string, unknown>) => Promise<unknown>; close: () => void }> {
  let nextId = 1;

  async function call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = nextId++;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.headers ?? {}),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`MCP HTTP error: ${response.status} ${response.statusText}`);
      }

      const msg = (await response.json()) as JsonRpcResponse;
      if (msg.error) {
        throw new Error(`MCP error ${msg.error.code}: ${msg.error.message}`);
      }
      return msg.result;
    } finally {
      clearTimeout(timer);
    }
  }

  function close() {
    // HTTP is stateless, nothing to close.
  }

  return { call, close };
}

// ── MCP session helpers ────────────────────────────────────────────

type McpConnection = {
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  close: () => void;
};

async function openMcpConnection(config: McpServerConfig): Promise<McpConnection> {
  if (config.transport === "stdio") {
    return connectStdio(config as McpServerConfig & { transport: "stdio" });
  }
  return connectHttp(config as McpServerConfig & { transport: "http" });
}

async function initializeSession(conn: McpConnection): Promise<void> {
  await conn.call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "MyClaw Desktop", version: "0.1.0" },
  });

  // Send initialized notification (no response expected, but send as a request with a new id to keep it simple)
  try {
    await conn.call("notifications/initialized");
  } catch {
    // Some servers don't respond to notifications — that's fine.
  }
}

async function listRemoteTools(conn: McpConnection): Promise<McpToolSchema[]> {
  const result = (await conn.call("tools/list")) as { tools?: McpToolSchema[] } | null;
  return result?.tools ?? [];
}

async function callRemoteTool(
  conn: McpConnection,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  const result = (await conn.call("tools/call", { name: toolName, arguments: args })) as McpToolCallResult | null;
  return result ?? { content: [] };
}

function mapToolRisk(_tool: McpToolSchema): ToolRiskCategory {
  const name = _tool.name.toLowerCase();
  if (/write|create|delete|update|set|put|post|patch|remove/i.test(name)) {
    return ToolRiskCategory.Write;
  }
  if (/exec|run|shell|command|spawn/i.test(name)) {
    return ToolRiskCategory.Exec;
  }
  if (/fetch|request|http|url|web|search|browse|network|download/i.test(name)) {
    return ToolRiskCategory.Network;
  }
  return ToolRiskCategory.Read;
}

function normalizeTools(serverId: string, remoteTools: McpToolSchema[]): McpTool[] {
  return remoteTools.map((tool) => ({
    id: `${serverId}:${tool.name}`,
    serverId,
    name: tool.name,
    description: tool.description ?? "",
    risk: mapToolRisk(tool),
    inputSchema: (tool.inputSchema as Record<string, unknown>) ?? null,
  }));
}

function extractTextFromResult(result: McpToolCallResult): string {
  if (!result.content || !Array.isArray(result.content)) {
    return "";
  }
  return result.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

// ── LiveMCPorterAdapter ────────────────────────────────────────────

/**
 * 真正的 MCP 适配器：通过 stdio 或 HTTP 连接 MCP 服务器，
 * 执行 initialize → tools/list 发现工具，tools/call 调用工具。
 */
export class LiveMCPorterAdapter implements MCPorterAdapter {
  async importServers(_source: MCPorterImportSource): Promise<McpServerConfig[]> {
    // Cloud import 逻辑暂不实现，返回空列表。
    console.info(`[live-mcporter] importServers called with source=${_source}, not yet implemented.`);
    return [];
  }

  async refreshServer(config: McpServerConfig): Promise<MCPorterRefreshResult> {
    let conn: McpConnection | null = null;
    try {
      conn = await openMcpConnection(config);
      await initializeSession(conn);
      const remoteTools = await listRemoteTools(conn);
      const tools = normalizeTools(config.id, remoteTools);

      console.info(`[live-mcporter] refreshServer ${config.id}: found ${tools.length} tools`);
      return {
        connected: true,
        tools,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.warn(`[live-mcporter] refreshServer ${config.id} failed:`, error instanceof Error ? error.message : error);
      return {
        connected: false,
        tools: [],
        checkedAt: new Date().toISOString(),
      };
    } finally {
      conn?.close();
    }
  }

  async invokeServerTool(
    config: McpServerConfig,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPorterInvokeResult> {
    let conn: McpConnection | null = null;
    try {
      conn = await openMcpConnection(config);
      await initializeSession(conn);
      const result = await callRemoteTool(conn, toolName, args);
      const output = extractTextFromResult(result);

      if (result.isError) {
        return { ok: false, summary: output || "Tool returned an error.", output };
      }

      return { ok: true, summary: "ok", output };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown invocation failure";
      return { ok: false, summary: message, output: "" };
    } finally {
      conn?.close();
    }
  }
}
