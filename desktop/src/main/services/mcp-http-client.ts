/**
 * MCP 的 HTTP/SSE 客户端实现。
 *
 * 通过 JSON-RPC 2.0 与 MCP 服务端通信，支持：
 * - 通过 POST 发送请求 / 响应
 * - 使用可选 SSE 接收服务端推送通知
 *
 * 它对外暴露与 `McpClient`（stdio 版）一致的公共接口，
 * 这样上层 manager 就能统一处理两种传输方式。
 */

import { EventEmitter } from "node:events";
import { createLogger } from "./logger";
import type { McpToolInfo, McpCallResult } from "./mcp-client";

const log = createLogger("mcp-http-client");

// ---------------------------------------------------------------------------
// McpHttpClient 主体
// ---------------------------------------------------------------------------

export class McpHttpClient extends EventEmitter {
  private _connected = false;
  private _tools: McpToolInfo[] = [];
  private _error: string | null = null;
  private nextId = 1;
  private sessionId: string | null = null;
  private abortController: AbortController | null = null;

  constructor(
    private readonly url: string,
    private readonly headers?: Record<string, string>,
  ) {
    super();
  }

  get connected(): boolean { return this._connected; }
  get tools(): McpToolInfo[] { return this._tools; }
  get error(): string | null { return this._error; }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  async connect(): Promise<McpToolInfo[]> {
    if (this._connected) {
      return this._tools;
    }

    this.abortController = new AbortController();

    await this.initialize();
    this._tools = await this.listTools();
    this._connected = true;
    this._error = null;
    this.emit("connected", this._tools);
    return this._tools;
  }

  async disconnect(): Promise<void> {
    this._connected = false;
    this._tools = [];
    this.sessionId = null;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.emit("disconnected");
  }

  async reconnect(): Promise<McpToolInfo[]> {
    await this.disconnect();
    return this.connect();
  }

  // -------------------------------------------------------------------------
  // 对外 API
  // -------------------------------------------------------------------------

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    if (!this._connected) {
      throw new Error("MCP HTTP client not connected");
    }

    const result = await this.sendRequest("tools/call", {
      name: toolName,
      arguments: args,
    }) as McpCallResult;

    return result;
  }

  async refreshTools(): Promise<McpToolInfo[]> {
    if (!this._connected) {
      throw new Error("MCP HTTP client not connected");
    }
    this._tools = await this.listTools();
    return this._tools;
  }

  // -------------------------------------------------------------------------
  // 私有方法：HTTP JSON-RPC 传输层
  // -------------------------------------------------------------------------

  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const body = {
      jsonrpc: "2.0" as const,
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const reqHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...(this.headers ?? {}),
    };

    if (this.sessionId) {
      reqHeaders["Mcp-Session-Id"] = this.sessionId;
    }

    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(body),
        signal: this.abortController?.signal,
      });
    } catch (err) {
      const msg = `MCP HTTP request failed: ${err instanceof Error ? err.message : String(err)}`;
      this._error = msg;
      throw new Error(msg);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const msg = `MCP HTTP error ${response.status}: ${text.slice(0, 500)}`;
      this._error = msg;
      throw new Error(msg);
    }

    // 从响应头中提取会话 ID。
    const newSessionId = response.headers.get("mcp-session-id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    const contentType = response.headers.get("content-type") ?? "";

    // 处理 SSE 响应（`text/event-stream`）。
    if (contentType.includes("text/event-stream")) {
      return this.parseSSEResponse(response, id);
    }

    // 处理标准 JSON 响应。
    const json = await response.json();

    // 兼容批量 JSON-RPC 响应。
    if (Array.isArray(json)) {
      const match = json.find((r: { id?: number | string }) => r.id === id);
      if (match?.error) {
        throw new Error(`MCP error ${match.error.code}: ${match.error.message}`);
      }
      return match?.result;
    }

    if (json.error) {
      throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
    }

    return json.result;
  }

  private async parseSSEResponse(response: Response, requestId: number): Promise<unknown> {
    const text = await response.text();
    const lines = text.split("\n");

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;

      try {
        const msg = JSON.parse(data);
        if (msg.id === requestId) {
          if (msg.error) {
            throw new Error(`MCP error ${msg.error.code}: ${msg.error.message}`);
          }
          return msg.result;
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("MCP error")) throw err;
        log.warn("Failed to parse SSE data", { data: data.slice(0, 200) });
      }
    }

    throw new Error("No matching response found in SSE stream");
  }

  // -------------------------------------------------------------------------
  // 私有方法：MCP 协议调用
  // -------------------------------------------------------------------------

  private async initialize(): Promise<void> {
    const result = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: "MyClaw",
        version: "1.0.0",
      },
    });

    // 发送 `initialized` 通知，完成握手。
    await this.sendNotification("initialized");

    log.info("initialized (HTTP)", { result: JSON.stringify(result).slice(0, 200) });
  }

  private async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    const body = {
      jsonrpc: "2.0" as const,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const reqHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.headers ?? {}),
    };

    if (this.sessionId) {
      reqHeaders["Mcp-Session-Id"] = this.sessionId;
    }

    try {
      await fetch(this.url, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(body),
        signal: this.abortController?.signal,
      });
    } catch {
      // Notifications are fire-and-forget
      log.warn("Failed to send notification", { method });
    }
  }

  private async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.sendRequest("tools/list")) as {
      tools?: Array<{
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }>;
    };

    if (!result?.tools || !Array.isArray(result.tools)) {
      return [];
    }

    return result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema ?? null,
    }));
  }
}
