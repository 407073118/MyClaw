import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeApp } from "./server";

describe("runtime server approval resume", () => {
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

  it("continues the model conversation after approving a model tool call", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-"));
    const stateFilePath = join(tempDir, "runtime-state.db");
    let modelCallCount = 0;

    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      modelConversationRunner: async ({ messages, onToolCall }) => {
        modelCallCount += 1;
        const hasToolOutput = messages.some(
          (message) => message.role === "tool" && message.content.includes("drive-listing-output"),
        );

        if (!hasToolOutput) {
          const result = await onToolCall({
            id: "call-1",
            name: "exec_command",
            input: {
              command: "Get-ChildItem E:\\",
            },
          });

          return {
            content: result?.content ?? "missing tool result",
            reasoning: null,
          };
        }

        return {
          content: "I reviewed the approved command output and found the target entries.",
          reasoning: null,
        };
      },
      executeIntent: async ({ intent }) => ({
        ok: true,
        summary: `Executed ${intent.label}`,
        output: "drive-listing-output",
      }),
    });
    dispose = app.close;

    const sendResponse = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "Inspect E drive",
      }),
    });
    const sendPayload = await sendResponse.json();
    const approvalId = sendPayload.approvalRequests.at(-1)?.id as string;

    const resolveResponse = await fetch(`${app.baseUrl}/api/approvals/${approvalId}/resolve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        decision: "allow-once",
      }),
    });
    const resolvePayload = await resolveResponse.json();

    expect(sendResponse.status).toBe(200);
    expect(resolveResponse.status).toBe(200);
    expect(modelCallCount).toBe(2);
    expect(resolvePayload.session.messages.at(-1)?.role).toBe("assistant");
    expect(resolvePayload.session.messages.at(-1)?.content).toBe(
      "I reviewed the approved command output and found the target entries.",
    );
  }, 15000);

  it("executes approved MCP intents and appends MCP output to the session", async () => {
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
        invokeServerTool: async (_config, toolName, args) => ({
          ok: true,
          summary: `MCP ${toolName} completed`,
          output: JSON.stringify(args),
        }),
      },
    });
    dispose = app.close;

    const intentResponse = await fetch(`${app.baseUrl}/api/sessions/session-default/execution-intents`, {
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
    const intentPayload = await intentResponse.json();
    const approvalId = intentPayload.result.approvalRequest.id as string;

    const resolveResponse = await fetch(`${app.baseUrl}/api/approvals/${approvalId}/resolve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        decision: "allow-once",
      }),
    });
    const resolvePayload = await resolveResponse.json();

    expect(resolveResponse.status).toBe(200);
    expect(resolvePayload.approvalRequests).toHaveLength(1);
    expect(resolvePayload.session.messages.some((message: { content: string }) => message.content.includes("MCP write_file completed"))).toBe(
      true,
    );
    expect(resolvePayload.session.messages.at(-1)?.content).toContain('"content":"updated from MCP"');
  }, 15000);
});
