/**
 * MCP (Model Context Protocol) HTTP/SSE client.
 *
 * Communicates with MCP servers over HTTP using JSON-RPC 2.0.
 * Supports the "Streamable HTTP" transport:
 * - POST requests for JSON-RPC request/response
 * - Optional SSE for server-initiated notifications
 *
 * Exposes the same public API surface as McpClient (stdio) so the
 * manager can treat both transports uniformly.
 */

import { EventEmitter } from "node:events";
import { createLogger } from "./logger";
import type { McpToolInfo, McpCallResult } from "./mcp-client";

const log = createLogger("mcp-http-client");

// ---------------------------------------------------------------------------
// McpHttpClient
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
  // Lifecycle
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
  // Public API
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
  // Private: HTTP JSON-RPC transport
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

    // Capture session ID from response headers
    const newSessionId = response.headers.get("mcp-session-id");
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    const contentType = response.headers.get("content-type") ?? "";

    // Handle SSE response (text/event-stream)
    if (contentType.includes("text/event-stream")) {
      return this.parseSSEResponse(response, id);
    }

    // Standard JSON response
    const json = await response.json();

    // Handle batched responses
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
  // Private: MCP protocol methods
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

    // Send initialized notification
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
