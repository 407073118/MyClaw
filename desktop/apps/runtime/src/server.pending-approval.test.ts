import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeApp } from "./server";

describe("runtime server pending approvals from model tool calls", () => {
  let dispose: (() => Promise<void>) | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await dispose?.();
    dispose = undefined;

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("returns approval state with message responses when a model tool call needs approval", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-"));
    const stateFilePath = join(tempDir, "runtime-state.json");

    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      modelConversationRunner: async ({ onToolCall }) => {
        const result = await onToolCall({
          id: "call-1",
          name: "exec_command",
          input: {
            command: "Get-ChildItem E:\\",
          },
        });

        return {
          content: result?.content ?? "tool call result missing",
          reasoning: null,
        };
      },
    });
    dispose = app.close;

    const bootstrapResponse = await fetch(`${app.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "Inspect the E drive",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.approvals.mode).toBe("prompt");
    expect(payload.approvalRequests).toHaveLength(bootstrapPayload.approvalRequests.length + 1);
    expect(payload.approvalRequests.at(-1)?.label).toBe("Get-ChildItem E:\\");
    expect(
      payload.session.messages.some((message: { content: string }) => message.content.includes("Get-ChildItem E:\\")),
    ).toBe(true);
  }, 30000);

  it("preserves exec_command cwd when a model tool call enters approval flow", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-"));
    const stateFilePath = join(tempDir, "runtime-state.db");

    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      modelConversationRunner: async ({ onToolCall }) => {
        const result = await onToolCall({
          id: "call-2",
          name: "exec_command",
          input: {
            command: "python scripts/init_workspace.py",
            cwd: "C:\\Users\\tester\\.myClaw\\skills\\br-interview-workspace",
          },
        });

        return {
          content: result?.content ?? "tool call result missing",
          reasoning: null,
        };
      },
    });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "Initialize the interview workspace skill",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.approvalRequests.at(-1)?.label).toBe("python scripts/init_workspace.py");
    expect(payload.approvalRequests.at(-1)?.arguments).toEqual({
      cwd: "C:\\Users\\tester\\.myClaw\\skills\\br-interview-workspace",
    });
  }, 15000);

  it("streams tool-call snapshots before the final assistant completion event", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-"));
    const stateFilePath = join(tempDir, "runtime-state.json");
    const streamedFilePath = join(tempDir, "streamed-context.txt");
    writeFileSync(streamedFilePath, "stream me", "utf8");

    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      workspaceRoot: tempDir,
      modelConversationRunner: async ({ onToolCall }) => {
        await onToolCall({
          id: "call-stream-1",
          name: "read_file",
          input: {
            path: streamedFilePath,
          },
        });

        await new Promise((resolve) => setTimeout(resolve, 400));

        return {
          content: "Read completed.",
          reasoning: "Checked the file before answering.",
        };
      },
    });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        content: "Read the streamed context file",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.body).toBeTruthy();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let partialBody = "";
    const deadline = Date.now() + 2000;

    while (Date.now() < deadline) {
      const remainingMs = Math.max(deadline - Date.now(), 1);
      const chunk = await Promise.race([
        reader.read().then((result) => ({ kind: "read" as const, result })),
        new Promise<{ kind: "timeout" }>((resolve) =>
          setTimeout(() => resolve({ kind: "timeout" }), Math.min(remainingMs, 25))),
      ]);

      if (chunk.kind === "timeout") {
        continue;
      }

      partialBody += decoder.decode(chunk.result.value ?? new Uint8Array(), {
        stream: !chunk.result.done,
      });
      if ((partialBody.match(/event: snapshot/g) ?? []).length >= 2 || chunk.result.done) {
        break;
      }
    }

    expect((partialBody.match(/event: snapshot/g) ?? []).length).toBeGreaterThanOrEqual(2);

    while (true) {
      const nextChunk = await reader.read();
      partialBody += decoder.decode(nextChunk.value ?? new Uint8Array(), {
        stream: !nextChunk.done,
      });
      if (nextChunk.done) {
        break;
      }
    }

    expect(partialBody).toContain("event: complete");
  }, 15000);

  it("creates a pending approval for manual MCP execution intents with structured context", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-"));
    const stateFilePath = join(tempDir, "runtime-state.db");

    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      mcpAdapter: {
        importServers: async () => [],
        refreshServer: async () => ({
          connected: true,
          tools: [],
        }),
        invokeServerTool: async () => ({
          ok: true,
          summary: "unused",
          output: "",
        }),
      },
    });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/execution-intents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: "mcp-tool",
        toolId: "mcp-filesystem:write_file",
        label: "write_file",
        risk: "write",
        detail: "Write README.md through MCP",
        serverId: "mcp-filesystem",
        toolName: "write_file",
        arguments: {
          path: "README.md",
          content: "updated from MCP",
        },
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result.status).toBe("pending");
    expect(payload.result.approvalRequest.serverId).toBe("mcp-filesystem");
    expect(payload.result.approvalRequest.toolName).toBe("write_file");
    expect(payload.result.approvalRequest.arguments).toEqual({
      path: "README.md",
      content: "updated from MCP",
    });
  });
});
