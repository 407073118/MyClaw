/**
 * MCP (Model Context Protocol) stdio client.
 *
 * Manages a single child process communicating via JSON-RPC 2.0 over stdin/stdout.
 * Implements: initialize/initialized handshake, tools/list, tools/call.
 *
 * Protocol reference: https://modelcontextprotocol.io/specification
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createLogger } from "./logger";

const log = createLogger("mcp-client");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpToolInfo = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown> | null;
};

export type McpCallResult = {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
};

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// ---------------------------------------------------------------------------
// McpClient
// ---------------------------------------------------------------------------

export class McpClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private buffer = "";
  private _connected = false;
  private _tools: McpToolInfo[] = [];
  private _error: string | null = null;

  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
    private readonly cwd?: string,
    private readonly env?: Record<string, string>,
  ) {
    super();
  }

  get connected(): boolean { return this._connected; }
  get tools(): McpToolInfo[] { return this._tools; }
  get error(): string | null { return this._error; }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Spawn the child process, perform initialize handshake, and fetch tools.
   * Returns the tool list on success.
   */
  async connect(): Promise<McpToolInfo[]> {
    if (this._connected) {
      return this._tools;
    }

    await this.spawnProcess();
    await this.initialize();
    this._tools = await this.listTools();
    this._connected = true;
    this._error = null;
    this.emit("connected", this._tools);
    return this._tools;
  }

  /** Stop the child process and clean up. */
  async disconnect(): Promise<void> {
    this._connected = false;
    this._tools = [];

    // Reject all pending requests
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error("MCP client disconnected"));
    }
    this.pending.clear();

    if (this.process) {
      try {
        this.process.stdin?.end();
        this.process.kill("SIGTERM");
      } catch { /* ignore */ }
      this.process = null;
    }

    this.emit("disconnected");
  }

  /** Reconnect: disconnect + connect again. */
  async reconnect(): Promise<McpToolInfo[]> {
    await this.disconnect();
    return this.connect();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Call a tool on the MCP server. */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    if (!this._connected) {
      throw new Error("MCP client not connected");
    }

    const result = await this.sendRequest("tools/call", {
      name: toolName,
      arguments: args,
    }) as McpCallResult;

    return result;
  }

  /** Re-fetch the tool list from the server. */
  async refreshTools(): Promise<McpToolInfo[]> {
    if (!this._connected) {
      throw new Error("MCP client not connected");
    }
    this._tools = await this.listTools();
    return this._tools;
  }

  // -------------------------------------------------------------------------
  // Private: process management
  // -------------------------------------------------------------------------

  private spawnProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      const envVars = {
        ...process.env,
        ...(this.env || {}),
      };

      try {
        this.process = spawn(this.command, this.args, {
          cwd: this.cwd,
          env: envVars,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          shell: process.platform === "win32",
        });
      } catch (err) {
        const msg = `Failed to spawn MCP process: ${this.command} ${this.args.join(" ")}`;
        this._error = msg;
        reject(new Error(msg));
        return;
      }

      const proc = this.process;

      // Listen for data on stdout
      proc.stdout?.on("data", (chunk: Buffer) => {
        this.onData(chunk.toString("utf8"));
      });

      // Stderr for debug logging
      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8").trim();
        if (text) {
          log.warn("stderr output", { command: this.command, text });
        }
      });

      proc.on("error", (err) => {
        this._error = err.message;
        this._connected = false;
        this.emit("error", err);
      });

      proc.on("exit", (code, signal) => {
        this._connected = false;
        this._error = `Process exited (code=${code}, signal=${signal})`;
        this.emit("exit", code, signal);
      });

      // Give the process a moment to start, then resolve
      // We'll know it's truly ready after initialize handshake
      setTimeout(() => {
        if (proc.exitCode !== null) {
          reject(new Error(`MCP process exited immediately with code ${proc.exitCode}`));
        } else {
          resolve();
        }
      }, 200);
    });
  }

  // -------------------------------------------------------------------------
  // Private: JSON-RPC 2.0 transport (newline-delimited JSON over stdio)
  // -------------------------------------------------------------------------

  private onData(data: string): void {
    this.buffer += data;

    // Try to parse complete JSON objects from the buffer.
    // MCP over stdio uses newline-delimited JSON (one JSON object per line).
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch {
        // Not valid JSON — might be partial, skip
        log.warn("non-JSON line received", { line: line.slice(0, 200) });
      }
    }
  }

  private handleMessage(msg: JsonRpcResponse | JsonRpcNotification): void {
    // Response to a request we sent
    if ("id" in msg && msg.id != null) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);

        const resp = msg as JsonRpcResponse;
        if (resp.error) {
          pending.reject(new Error(`MCP error ${resp.error.code}: ${resp.error.message}`));
        } else {
          pending.resolve(resp.result);
        }
      }
      return;
    }

    // Server-initiated notification — log but don't handle yet
    if ("method" in msg) {
      this.emit("notification", msg.method, (msg as JsonRpcNotification).params);
    }
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("MCP process stdin not writable"));
        return;
      }

      const id = this.nextId++;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined ? { params } : {}),
      };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 30_000);

      this.pending.set(id, { resolve, reject, timer });

      const json = JSON.stringify(request) + "\n";
      this.process.stdin.write(json);
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) return;

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const json = JSON.stringify(notification) + "\n";
    this.process.stdin.write(json);
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

    // Send initialized notification to complete handshake
    this.sendNotification("initialized");

    log.info("initialized", { result: JSON.stringify(result).slice(0, 200) });
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
