import { createServer } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ToolRiskCategory } from "@myclaw-desktop/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRuntimeApp } from "./server";

function createCloudHubTestServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/api/hub/items") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          items: [
            {
              id: "cloud-skill-security-audit",
              type: url.searchParams.get("type") ?? "skill",
              name: "Security Audit",
              summary: "Audit a codebase for security regressions before release.",
              latestVersion: "1.2.0",
              iconUrl: null,
            },
          ],
        }),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/hub/items/cloud-skill-security-audit") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "cloud-skill-security-audit",
          type: "skill",
          name: "Security Audit",
          summary: "Audit a codebase for security regressions before release.",
          description: "Cloud-hosted audit skill package with curated checks and release metadata.",
          latestVersion: "1.2.0",
          releases: [
            {
              id: "release-skill-security-audit-1-2-0",
              version: "1.2.0",
              releaseNotes: "Adds dependency review and CI guidance.",
            },
          ],
        }),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/hub/releases/release-skill-security-audit-1-2-0/manifest") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          kind: "skill",
          name: "security-audit",
          version: "1.2.0",
          description: "Audit a codebase for security regressions before release.",
          entry: "SKILL.md",
        }),
      );
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/hub/releases/release-skill-security-audit-1-2-0/download-token"
    ) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          downloadUrl: "https://example.com/security-audit.zip",
          expiresIn: 300,
        }),
      );
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind cloud hub test server"));
        return;
      }

      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          }),
      });
    });
  });
}

describe("runtime server", () => {
  let dispose: (() => Promise<void>) | undefined;
  let tempDir: string | undefined;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-"));
    stateFilePath = join(tempDir, "runtime-state.json");
  }, 30000);

  afterEach(async () => {
    await dispose?.();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("reports runtime health", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/health`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect(payload.service).toBe("runtime");
  });

  it("handles browser CORS preflight requests for runtime APIs", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/model-profiles`, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:1420",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("content-type");
  });

  it("allows PUT, PATCH, and DELETE in browser CORS preflight requests", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const putResponse = await fetch(`${app.baseUrl}/api/model-profiles/model-default`, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:1420",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type",
      },
    });

    const patchResponse = await fetch(`${app.baseUrl}/api/workflows/workflow-default`, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:1420",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "content-type",
      },
    });

    const deleteResponse = await fetch(`${app.baseUrl}/api/model-profiles/model-default`, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:1420",
        "access-control-request-method": "DELETE",
      },
    });

    expect(putResponse.status).toBe(204);
    expect(putResponse.headers.get("access-control-allow-methods")).toContain("PUT");
    expect(patchResponse.status).toBe(204);
    expect(patchResponse.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(deleteResponse.status).toBe(204);
    expect(deleteResponse.headers.get("access-control-allow-methods")).toContain("DELETE");
  });

  it("returns the split-service bootstrap metadata", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/bootstrap`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.services).toContain("desktop-ui");
    expect(payload.services).toContain("runtime-api");
    expect(payload.defaultModelProfileId).toBe("model-default");
    expect(payload.runtimeStateFilePath).toBe(stateFilePath);
    expect(payload.requiresInitialSetup).toBe(false);
    expect(payload.isFirstLaunch).toBe(true);
    expect(payload.approvalRequests).toHaveLength(1);
    expect(payload.approvalRequests[0].sessionId).toBe("session-default");
    expect(payload.mcp.servers).toHaveLength(1);
    expect(payload.skills.items).toHaveLength(1);
    expect(payload.employees).toEqual([]);
    expect(payload.workflows).toEqual([]);
    expect(payload.tools.builtin.length).toBeGreaterThan(0);
    expect(payload.tools.builtin.some((tool: { id: string }) => tool.id === "fs.read")).toBe(true);
    expect(payload.tools.builtin.some((tool: { id: string }) => tool.id === "exec.task")).toBe(true);
    expect(payload.tools.builtin.some((tool: { id: string }) => tool.id === "archive.extract")).toBe(true);
  });

  it("proxies cloud hub APIs through runtime to avoid browser-side cross-origin calls", async () => {
    const cloudHub = await createCloudHubTestServer();
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      cloudHubBaseUrl: cloudHub.baseUrl,
    });
    dispose = async () => {
      await app.close();
      await cloudHub.close();
    };

    const itemsResponse = await fetch(`${app.baseUrl}/api/cloud-hub/items?type=skill`);
    const itemsPayload = await itemsResponse.json();
    const detailResponse = await fetch(`${app.baseUrl}/api/cloud-hub/items/cloud-skill-security-audit`);
    const detailPayload = await detailResponse.json();
    const manifestResponse = await fetch(
      `${app.baseUrl}/api/cloud-hub/releases/release-skill-security-audit-1-2-0/manifest`,
    );
    const manifestPayload = await manifestResponse.json();
    const tokenResponse = await fetch(
      `${app.baseUrl}/api/cloud-hub/releases/release-skill-security-audit-1-2-0/download-token`,
    );
    const tokenPayload = await tokenResponse.json();

    expect(itemsResponse.status).toBe(200);
    expect(itemsPayload.items[0]?.type).toBe("skill");
    expect(detailResponse.status).toBe(200);
    expect(detailPayload.id).toBe("cloud-skill-security-audit");
    expect(manifestResponse.status).toBe(200);
    expect(manifestPayload.kind).toBe("skill");
    expect(tokenResponse.status).toBe(200);
    expect(tokenPayload.downloadUrl).toBe("https://example.com/security-audit.zip");
  });

  it("proxies cloud auth requests and forwards authorization headers to cloud APIs", async () => {
    const seenAuthorizationHeaders: string[] = [];
    const cloudApiServer = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.headers.authorization) {
        seenAuthorizationHeaders.push(request.headers.authorization);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            accessToken: "access-1",
            refreshToken: "refresh-1",
            expiresIn: 7200,
            user: {
              account: "zhangjianing",
              displayName: "张建宁",
              roles: ["admin"],
            },
          }),
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/refresh") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            accessToken: "access-2",
            expiresIn: 7200,
          }),
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/introspect") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            active: true,
            expiresAt: "2026-03-30T12:00:00.000Z",
            user: {
              account: "zhangjianing",
              displayName: "张建宁",
              roles: ["admin"],
            },
          }),
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/hub/items") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ items: [] }));
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    });

    const cloudApi = await new Promise<{
      baseUrl: string;
      close: () => Promise<void>;
    }>((resolve, reject) => {
      cloudApiServer.listen(0, "127.0.0.1", () => {
        const address = cloudApiServer.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to bind cloud auth proxy test server"));
          return;
        }

        resolve({
          baseUrl: `http://127.0.0.1:${address.port}`,
          close: () =>
            new Promise<void>((resolveClose, rejectClose) => {
              cloudApiServer.close((error) => {
                if (error) {
                  rejectClose(error);
                  return;
                }
                resolveClose();
              });
            }),
        });
      });
    });

    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      cloudHubBaseUrl: cloudApi.baseUrl,
    });
    dispose = async () => {
      await app.close();
      await cloudApi.close();
    };

    const loginResponse = await fetch(`${app.baseUrl}/api/cloud-auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        account: "zhangjianing",
        password: "secret",
      }),
    });
    const refreshResponse = await fetch(`${app.baseUrl}/api/cloud-auth/refresh`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        refreshToken: "refresh-1",
      }),
    });
    const introspectResponse = await fetch(`${app.baseUrl}/api/cloud-auth/introspect`, {
      method: "POST",
      headers: {
        authorization: "Bearer access-2",
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const logoutResponse = await fetch(`${app.baseUrl}/api/cloud-auth/logout`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        refreshToken: "refresh-1",
      }),
    });
    const hubResponse = await fetch(`${app.baseUrl}/api/cloud-hub/items`, {
      headers: {
        authorization: "Bearer access-2",
      },
    });

    expect(loginResponse.status).toBe(200);
    expect(refreshResponse.status).toBe(200);
    expect(introspectResponse.status).toBe(200);
    expect(logoutResponse.status).toBe(200);
    expect(hubResponse.status).toBe(200);
    expect(seenAuthorizationHeaders).toContain("Bearer access-2");
  });

  it("reports app-private storage roots and materializes the default session on disk", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/bootstrap`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.myClawRootPath).toBeTypeOf("string");
    expect(payload.skillsRootPath).toBeTypeOf("string");
    expect(payload.sessionsRootPath).toBeTypeOf("string");
    expect(payload.skills.items[0].path).toContain(payload.skillsRootPath);
    expect(existsSync(join(payload.sessionsRootPath, "session-default", "session.json"))).toBe(true);
    expect(existsSync(join(payload.sessionsRootPath, "session-default", "messages.json"))).toBe(true);
  });

  it("updates a builtin tool preference and persists it across restart", async () => {
    const firstApp = await createRuntimeApp({ port: 0, stateFilePath });

    const updateResponse = await fetch(`${firstApp.baseUrl}/api/tools/builtin/fs.read`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        exposedToModel: false,
        approvalModeOverride: "inherit",
      }),
    });
    const updatePayload = await updateResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(updatePayload.tool.id).toBe("fs.read");
    expect(updatePayload.tool.enabled).toBe(true);
    expect(updatePayload.tool.exposedToModel).toBe(false);

    const listResponse = await fetch(`${firstApp.baseUrl}/api/tools/builtin`);
    const listPayload = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listPayload.items.some((tool: { id: string; exposedToModel: boolean }) => tool.id === "fs.read" && tool.exposedToModel === false)).toBe(true);

    await firstApp.close();
    dispose = undefined;

    const secondApp = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = secondApp.close;

    const bootstrapResponse = await fetch(`${secondApp.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();
    const updatedTool = bootstrapPayload.tools.builtin.find((tool: { id: string }) => tool.id === "fs.read");

    expect(updatedTool?.exposedToModel).toBe(false);
  });

  it("passes only exposed builtin tools to chat completion", async () => {
    const seenToolNames: string[][] = [];
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      chatCompletion: async ({ availableTools }) => {
        seenToolNames.push(availableTools.map((tool) => tool.name));
        return "tool visibility captured";
      },
    });
    dispose = app.close;

    const updateResponse = await fetch(`${app.baseUrl}/api/tools/builtin/fs.read`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        exposedToModel: false,
        approvalModeOverride: "inherit",
      }),
    });
    expect(updateResponse.status).toBe(200);

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "检查当前模型可见工具",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.session.messages.at(-1)?.content).toBe("tool visibility captured");
    expect(seenToolNames.at(-1)).not.toContain("fs_read_file");
    expect(seenToolNames.at(-1)).toContain("fs_list_files");
    expect(seenToolNames.at(-1)).toContain("exec_command");
    expect(seenToolNames.at(-1)).toContain("git_status");
  });

  it("passes enabled and exposed MCP tools to chat completion", async () => {
    const seenToolNames: string[][] = [];
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      mcpAdapter: {
        importServers: async () => [],
        refreshServer: async () => ({
          connected: true,
          checkedAt: "2026-03-20T08:00:00.000Z",
          tools: [
            {
              id: "mcp-filesystem:read_file",
              serverId: "mcp-filesystem",
              name: "read_file",
              description: "Read a file from MCP.",
              risk: ToolRiskCategory.Read,
              inputSchema: {
                type: "object",
                properties: {
                  path: { type: "string" },
                },
                required: ["path"],
              },
            },
          ],
        }),
        invokeServerTool: async () => ({
          ok: true,
          summary: "unused",
          output: "",
        }),
      },
      chatCompletion: async ({ availableTools }) => {
        seenToolNames.push(availableTools.map((tool) => tool.name));
        return "mcp tools captured";
      },
    });
    dispose = app.close;

    const refreshResponse = await fetch(`${app.baseUrl}/api/mcp/servers/mcp-filesystem/refresh`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });
    expect(refreshResponse.status).toBe(200);

    const updateMcpToolResponse = await fetch(
      `${app.baseUrl}/api/tools/mcp/${encodeURIComponent("mcp-filesystem:read_file")}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: true,
          exposedToModel: true,
          approvalModeOverride: "inherit",
        }),
      },
    );
    expect(updateMcpToolResponse.status).toBe(200);

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "Trigger MCP model tools exposure.",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.session.messages.at(-1)?.content).toBe("mcp tools captured");

    const lastToolNames = seenToolNames.at(-1) ?? [];
    const mcpToolName = lastToolNames.find((name) => name.startsWith("mcp_"));
    expect(mcpToolName).toBeDefined();
    expect(mcpToolName).toContain("mcp-filesystem");
    expect(mcpToolName).toContain("read_file");
  });

  it("streams session snapshots for chat replies when the client requests SSE", async () => {
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      chatCompletion: async () => ({
        reasoning: "先检查模型配置。",
        content: "已经恢复增量输出。",
      }),
    });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        content: "请继续。",
      }),
    });
    const rawBody = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(rawBody).toContain("event: snapshot");
    expect(rawBody).toContain("event: complete");
    expect(rawBody).toContain("已经恢复增量输出。");
  }, 15000);

  it("streams an error event instead of crashing when streaming chat completion fails", async () => {
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      chatCompletion: async () => {
        throw new Error("streaming failure");
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
        content: "continue",
      }),
    });
    const rawBody = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(rawBody).toContain("event: error");
    expect(rawBody).toContain("model_request_failed");
    expect(rawBody).toContain("streaming failure");
    expect(rawBody).not.toContain("ReferenceError");
  }, 15000);

  it("passes the local skill catalog to the model so it can route requests to matching skills", async () => {
    const seenToolDescriptions: string[] = [];
    const seenSystemMessages: string[] = [];
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      chatCompletion: async ({ availableTools, messages }) => {
        seenToolDescriptions.push(
          availableTools.find((tool) => tool.name === "run_skill")?.description ?? "",
        );
        seenSystemMessages.push(
          messages
            .filter((message) => message.role === "system")
            .map((message) => message.content)
            .join("\n\n"),
        );
        return "skill routing context captured";
      },
    });
    dispose = app.close;

    const bootstrapResponse = await fetch(`${app.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();
    const interviewSkillDir = join(bootstrapPayload.skillsRootPath, "br-interview-workspace");
    mkdirSync(interviewSkillDir, { recursive: true });
    writeFileSync(
      join(interviewSkillDir, "SKILL.md"),
      [
        "---",
        "name: br-interview-workspace",
        "description: Use when 需要在本地文件系统中完成招聘工作流，包括岗位创建、候选人简历分析、自动生成面试题，或根据面试录音和文本生成面试报告。",
        "---",
        "",
        "# br-interview-workspace",
      ].join("\n"),
      "utf8",
    );

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "我想招聘测试开发",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.session.messages.at(-1)?.content).toBe("skill routing context captured");
    expect(seenToolDescriptions.at(-1)).toContain("br-interview-workspace");
    expect(seenToolDescriptions.at(-1)).toContain("招聘工作流");
    expect(seenSystemMessages.at(-1)).toContain("br-interview-workspace");
    expect(seenSystemMessages.at(-1)).toContain("招聘工作流");
  });

  it("records structured execution-chain logs for skill runs without exposing model identity in chat", async () => {
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      modelConversationRunner: async ({ onToolCall, profile }) => {
        await onToolCall({
          id: "tool-call-skill-1",
          name: "run_skill",
          input: {
            invocation: "br-interview-workspace 岗位=测试开发工程师",
          },
        });

        return {
          reasoning: `Using ${profile.model} to orchestrate the skill.`,
          content: "已直接开始为你生成完整招聘与面试材料。",
        };
      },
    });
    dispose = app.close;

    const bootstrapResponse = await fetch(`${app.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();
    const interviewSkillDir = join(bootstrapPayload.skillsRootPath, "br-interview-workspace");
    mkdirSync(interviewSkillDir, { recursive: true });
    writeFileSync(
      join(interviewSkillDir, "SKILL.md"),
      [
        "---",
        "name: br-interview-workspace",
        "description: Generate recruiting and interview materials for a hiring workflow.",
        "---",
        "",
        "# br-interview-workspace",
        "",
        "Generate JD, screening rubric, interview questions, and scorecards.",
      ].join("\n"),
      "utf8",
    );

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "请直接完成测试开发工程师效能工具方向的招聘全流程材料。",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.session.messages.at(-1)?.content).toBe("已直接开始为你生成完整招聘与面试材料。");

    const contents = payload.session.messages.map((message: { content: string }) => message.content);
    expect(contents).toContain("[TOOL_CALL] run_skill invocation=br-interview-workspace 岗位=测试开发工程师");
    expect(contents).toContain("[SKILL] br-interview-workspace");
    expect(contents).toContain("[STATUS] 技能正在执行：br-interview-workspace 岗位=测试开发工程师");
    expect(contents.some((content: string) => content.startsWith("[MODEL]"))).toBe(false);
    expect(contents.some((content: string) => content.includes("Skill activated: br-interview-workspace"))).toBe(true);
  });

  it("passes tool-usage guidance so the model prefers tools for current or external data", async () => {
    const seenSystemMessages: string[] = [];
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      chatCompletion: async ({ messages }) => {
        seenSystemMessages.push(
          messages
            .filter((message) => message.role === "system")
            .map((message) => message.content)
            .join("\n\n"),
        );
        return "tool usage guidance captured";
      },
    });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "今天天气怎么样呀",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.session.messages.at(-1)?.content).toBe("tool usage guidance captured");
    expect(seenSystemMessages.at(-1)).toContain("do not claim that you cannot access");
    expect(seenSystemMessages.at(-1)).toContain("current or external data");
  });

  it("adds weather-specific tool guidance when http fetch is available", async () => {
    const seenSystemMessages: string[] = [];
    const seenToolNames: string[][] = [];
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      chatCompletion: async ({ messages, availableTools }) => {
        seenSystemMessages.push(
          messages
            .filter((message) => message.role === "system")
            .map((message) => message.content)
            .join("\n\n"),
        );
        seenToolNames.push(availableTools.map((tool) => tool.name));
        return "weather guidance captured";
      },
    });
    dispose = app.close;

    const updateResponse = await fetch(`${app.baseUrl}/api/tools/builtin/http.fetch`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        enabled: true,
        exposedToModel: true,
        approvalModeOverride: "inherit",
      }),
    });
    expect(updateResponse.status).toBe(200);

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "今天天气怎么样呀",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.session.messages.at(-1)?.content).toBe("weather guidance captured");
    expect(seenToolNames.at(-1)).toContain("http_fetch");
    expect(seenSystemMessages.at(-1)).toContain("http_fetch");
    expect(seenSystemMessages.at(-1)).toContain("live weather");
    expect(seenSystemMessages.at(-1)).toContain("before answering");
  });

  it("auto-approves builtin read execution intents and appends builtin output", async () => {
    const workspaceRoot = join(tempDir!, "builtin-workspace");
    const attachedDirectory = join(workspaceRoot, "project");
    mkdirSync(attachedDirectory, { recursive: true });
    writeFileSync(join(attachedDirectory, "README.md"), "builtin runtime read", "utf8");

    const app = await createRuntimeApp({ port: 0, stateFilePath, workspaceRoot });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/execution-intents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: "builtin-tool",
        toolId: "fs.read",
        label: "project/README.md",
        risk: "read",
        detail: "读取项目 README",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result.status).toBe("auto-approved");
    expect(payload.session.messages.some((message: { content: string }) => message.content.includes("builtin runtime read"))).toBe(true);
  });

  it("creates a fixed local skills directory under the app-private myClaw root", async () => {
    const workspaceRoot = join(tempDir!, "workspace-root");
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      workspaceRoot,
    });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/bootstrap`);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.skills.items.length).toBeGreaterThan(0);
    expect(String(payload.skills.items[0].path)).toContain(payload.skillsRootPath);
    expect(String(payload.skills.items[0].path)).not.toContain(workspaceRoot);
  });

  it("accepts a chat message and returns an assistant reply", async () => {
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      chatCompletion: async ({ profile }) => `我可以使用 ${profile.name} 帮你处理这个工作区。`,
    });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "你能在这个工作区里帮我做什么？",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.session.id).toBe("session-default");
    const lastUserMessage = [...payload.session.messages]
      .reverse()
      .find((message: { role: string }) => message.role === "user");
    const lastAssistantMessage = [...payload.session.messages]
      .reverse()
      .find((message: { role: string }) => message.role === "assistant");

    expect(lastUserMessage?.content).toBe("你能在这个工作区里帮我做什么？");
    expect(lastAssistantMessage?.content).toContain("默认 Qwen 3.5 Plus");
  });

  it("parses A2UI form payload from assistant response", async () => {
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      chatCompletion: async () =>
        [
          "请填写部署参数。",
          "```a2ui",
          JSON.stringify({
            version: "a2ui-lite/v1",
            text: "请填写部署参数。",
            ui: {
              kind: "form",
              id: "deploy-form",
              title: "部署参数",
              submitLabel: "提交",
              fields: [
                {
                  name: "environment",
                  label: "环境",
                  input: "select",
                  required: true,
                  options: [
                    { label: "Staging", value: "staging" },
                    { label: "Production", value: "production" },
                  ],
                },
                {
                  name: "region",
                  label: "区域",
                  input: "text",
                  required: true,
                },
              ],
            },
          }),
          "```",
        ].join("\n"),
    });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "给我一个部署表单",
      }),
    });
    const payload = await response.json();
    const assistantMessage = payload.session.messages.at(-1);

    expect(response.status).toBe(200);
    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.content).toBe("请填写部署参数。");
    expect(assistantMessage.ui).toBeDefined();
    expect(assistantMessage.ui.kind).toBe("form");
    expect(assistantMessage.ui.id).toBe("deploy-form");
    expect(assistantMessage.ui.fields).toHaveLength(2);
  });

  it("creates a provider profile and updates the global default model", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createResponse = await fetch(`${app.baseUrl}/api/model-profiles`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Moonshot Primary",
        provider: "openai-compatible",
        baseUrl: "https://api.moonshot.cn/v1",
        apiKey: "sk-test",
        model: "moonshot-v1-8k",
        headers: {
          "x-provider-feature": "tool-use",
        },
        requestBody: {
          reasoning_effort: "high",
        },
      }),
    });
    const createdPayload = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createdPayload.profile.name).toBe("Moonshot Primary");
    expect(createdPayload.profile.headers).toEqual({
      "x-provider-feature": "tool-use",
    });
    expect(createdPayload.profile.requestBody).toEqual({
      reasoning_effort: "high",
    });

    const setDefaultResponse = await fetch(`${app.baseUrl}/api/model-profiles/default`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        profileId: createdPayload.profile.id,
      }),
    });
    const defaultPayload = await setDefaultResponse.json();

    expect(setDefaultResponse.status).toBe(200);
    expect(defaultPayload.defaultModelProfileId).toBe(createdPayload.profile.id);

    const bootstrapResponse = await fetch(`${app.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();

    expect(bootstrapPayload.defaultModelProfileId).toBe(createdPayload.profile.id);
    expect(bootstrapPayload.models.at(-1)?.name).toBe("Moonshot Primary");
    expect(bootstrapPayload.models.at(-1)?.headers).toEqual({
      "x-provider-feature": "tool-use",
    });
    expect(bootstrapPayload.models.at(-1)?.requestBody).toEqual({
      reasoning_effort: "high",
    });
    expect(bootstrapPayload.requiresInitialSetup).toBe(false);
  });

  it("tests model profile connectivity and returns latency metrics", async () => {
    const connectivityCheck = async ({ profile }: { profile: { id: string; model: string } }) => {
      expect(profile.id).toBe("model-default");
      expect(profile.model).toBe("qwen3.5-plus");
      return { latencyMs: 123 };
    };
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      profileConnectivityCheck: connectivityCheck,
    });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/model-profiles/model-default/test`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.latencyMs).toBe(123);
  });

  it("lists model ids for an unsaved provider configuration", async () => {
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      profileModelCatalog: async ({ profile }) => {
        expect(profile.provider).toBe("openai-compatible");
        expect(profile.baseUrl).toBe("https://platform.minimaxi.com");
        expect(profile.baseUrlMode).toBe("provider-root");
        expect(profile.apiKey).toBe("sk-minimax");
        return { modelIds: ["MiniMax-M1", "MiniMax-Text-01"] };
      },
    });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/model-profiles/catalog`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        provider: "openai-compatible",
        baseUrl: "https://platform.minimaxi.com",
        baseUrlMode: "provider-root",
        apiKey: "sk-minimax",
        model: "",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.modelIds).toEqual(["MiniMax-M1", "MiniMax-Text-01"]);
  });

  it("rejects model catalog requests without provider credentials", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/model-profiles/catalog`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        provider: "openai-compatible",
        baseUrl: "",
        apiKey: "",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("baseUrl_required");
  });

  it("returns not found when testing connectivity for a missing profile", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/model-profiles/model-missing/test`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe("profile_not_found");
  });

  it("creates a new session using the current global default model", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createProfileResponse = await fetch(`${app.baseUrl}/api/model-profiles`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Qwen Team",
        provider: "openai-compatible",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-qwen",
        model: "qwen-max",
      }),
    });
    const createdProfilePayload = await createProfileResponse.json();

    await fetch(`${app.baseUrl}/api/model-profiles/default`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        profileId: createdProfilePayload.profile.id,
      }),
    });

    const createSessionResponse = await fetch(`${app.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const createSessionPayload = await createSessionResponse.json();

    expect(createSessionResponse.status).toBe(201);
    expect(createSessionPayload.session.title).toBe("新对话");
    expect(createSessionPayload.session.modelProfileId).toBe(createdProfilePayload.profile.id);

    const bootstrapResponse = await fetch(`${app.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();

    expect(bootstrapPayload.sessions[0].id).toBe(createSessionPayload.session.id);
  });

  it("deletes a session and keeps the remaining session selected in bootstrap", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createSessionResponse = await fetch(`${app.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Deletable Thread",
      }),
    });
    const createSessionPayload = await createSessionResponse.json();

    const deleteResponse = await fetch(`${app.baseUrl}/api/sessions/${createSessionPayload.session.id}`, {
      method: "DELETE",
    });
    const deletePayload = await deleteResponse.json();

    expect(deleteResponse.status).toBe(200);
    expect(deletePayload.deletedSessionId).toBe(createSessionPayload.session.id);
    expect(deletePayload.sessions.some((item: { id: string }) => item.id === createSessionPayload.session.id)).toBe(false);
    expect(deletePayload.sessions).toHaveLength(1);
    expect(deletePayload.sessions[0].id).toBe("session-default");
  });

  it("creates a replacement session when deleting the last remaining session", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const deleteResponse = await fetch(`${app.baseUrl}/api/sessions/session-default`, {
      method: "DELETE",
    });
    const deletePayload = await deleteResponse.json();

    expect(deleteResponse.status).toBe(200);
    expect(deletePayload.deletedSessionId).toBe("session-default");
    expect(deletePayload.sessions).toHaveLength(1);
    expect(deletePayload.sessions[0].id).not.toBe("session-default");
    expect(deletePayload.sessions[0].messages.at(0)?.role).toBe("assistant");
  });

  it("updates an existing model profile", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createProfileResponse = await fetch(`${app.baseUrl}/api/model-profiles`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Qwen Team",
        provider: "openai-compatible",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-qwen",
        model: "qwen-max",
        headers: {
          "x-initial-mode": "chat",
        },
        requestBody: {
          enable_thinking: false,
        },
      }),
    });
    const createdProfilePayload = await createProfileResponse.json();

    const updateProfileResponse = await fetch(`${app.baseUrl}/api/model-profiles/${createdProfilePayload.profile.id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Qwen Updated",
        provider: "openai-compatible",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-qwen-updated",
        model: "qwen-plus",
        headers: {
          "x-tool-mode": "required",
        },
        requestBody: {
          enable_thinking: true,
          reasoning_effort: "medium",
        },
      }),
    });
    const updateProfilePayload = await updateProfileResponse.json();

    expect(updateProfileResponse.status).toBe(200);
    expect(updateProfilePayload.profile.id).toBe(createdProfilePayload.profile.id);
    expect(updateProfilePayload.profile.name).toBe("Qwen Updated");
    expect(updateProfilePayload.profile.model).toBe("qwen-plus");
    expect(updateProfilePayload.profile.headers).toEqual({
      "x-tool-mode": "required",
    });
    expect(updateProfilePayload.profile.requestBody).toEqual({
      enable_thinking: true,
      reasoning_effort: "medium",
    });

    const bootstrapResponse = await fetch(`${app.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();
    const updatedProfile = bootstrapPayload.models.find((item: { id: string }) => item.id === createdProfilePayload.profile.id);
    expect(updatedProfile?.name).toBe("Qwen Updated");
    expect(updatedProfile?.headers).toEqual({
      "x-tool-mode": "required",
    });
    expect(updatedProfile?.requestBody).toEqual({
      enable_thinking: true,
      reasoning_effort: "medium",
    });
  });

  it("stores provider reasoning on the final assistant message", async () => {
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      chatCompletion: async () => ({
        content: "已经分析完成。",
        reasoning: "先读取目录结构，再检查模型配置与工具暴露状态。",
      }),
    });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "帮我看看现在为什么没有工具链路",
      }),
    });
    const payload = await response.json();
    const assistantMessage = payload.session.messages.at(-1);

    expect(response.status).toBe(200);
    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.content).toBe("已经分析完成。");
    expect(assistantMessage.reasoning).toBe("先读取目录结构，再检查模型配置与工具暴露状态。");
  });

  it("deletes a model profile and rebinds sessions to the fallback default model", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createProfileResponse = await fetch(`${app.baseUrl}/api/model-profiles`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Qwen Team",
        provider: "openai-compatible",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "sk-qwen",
        model: "qwen-max",
      }),
    });
    const createdProfilePayload = await createProfileResponse.json();

    await fetch(`${app.baseUrl}/api/model-profiles/default`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        profileId: createdProfilePayload.profile.id,
      }),
    });

    const createSessionResponse = await fetch(`${app.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const createSessionPayload = await createSessionResponse.json();

    const deleteProfileResponse = await fetch(`${app.baseUrl}/api/model-profiles/${createdProfilePayload.profile.id}`, {
      method: "DELETE",
    });
    const deleteProfilePayload = await deleteProfileResponse.json();

    expect(deleteProfileResponse.status).toBe(200);
    expect(deleteProfilePayload.deletedProfileId).toBe(createdProfilePayload.profile.id);
    expect(deleteProfilePayload.defaultModelProfileId).toBe("model-default");
    expect(deleteProfilePayload.models).toHaveLength(1);

    const reboundSession = deleteProfilePayload.sessions.find(
      (item: { id: string }) => item.id === createSessionPayload.session.id,
    );
    expect(reboundSession?.modelProfileId).toBe("model-default");
  }, 15000);

  it("deletes the last remaining model profile by restoring the default placeholder profile", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const updateProfileResponse = await fetch(`${app.baseUrl}/api/model-profiles/model-default`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Only Profile",
        provider: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-only",
        model: "only-model",
      }),
    });
    expect(updateProfileResponse.status).toBe(200);

    const deleteProfileResponse = await fetch(`${app.baseUrl}/api/model-profiles/model-default`, {
      method: "DELETE",
    });
    const deleteProfilePayload = await deleteProfileResponse.json();

    expect(deleteProfileResponse.status).toBe(200);
    expect(deleteProfilePayload.deletedProfileId).toBe("model-default");
    expect(deleteProfilePayload.defaultModelProfileId).toBe("model-default");
    expect(deleteProfilePayload.models).toHaveLength(1);
    expect(deleteProfilePayload.models[0]).toMatchObject({
      id: "model-default",
      name: "默认 Qwen 3.5 Plus",
      baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
      baseUrlMode: "manual",
      apiKey: "sk-sp-df8f797f71dc49e2a9de118ad90d62b9",
      model: "qwen3.5-plus",
    });

    const bootstrapResponse = await fetch(`${app.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();

    expect(bootstrapPayload.models).toHaveLength(1);
    expect(bootstrapPayload.models[0]).toMatchObject({
      id: "model-default",
      name: "默认 Qwen 3.5 Plus",
      baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
      baseUrlMode: "manual",
      apiKey: "sk-sp-df8f797f71dc49e2a9de118ad90d62b9",
      model: "qwen3.5-plus",
    });
  });

  it("uses the session-bound model profile when sending messages", async () => {
    const usedProfileIds: string[] = [];
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      chatCompletion: async ({ profile }) => {
        usedProfileIds.push(profile.id);
        return `reply from ${profile.id}`;
      },
    });
    dispose = app.close;

    const createProfileAResponse = await fetch(`${app.baseUrl}/api/model-profiles`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Profile A",
        provider: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-a",
        model: "model-a",
      }),
    });
    const createProfileAPayload = await createProfileAResponse.json();

    const createProfileBResponse = await fetch(`${app.baseUrl}/api/model-profiles`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Profile B",
        provider: "openai-compatible",
        baseUrl: "https://example.com/v1",
        apiKey: "sk-b",
        model: "model-b",
      }),
    });
    const createProfileBPayload = await createProfileBResponse.json();

    await fetch(`${app.baseUrl}/api/model-profiles/default`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        profileId: createProfileAPayload.profile.id,
      }),
    });

    const createSessionResponse = await fetch(`${app.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const createSessionPayload = await createSessionResponse.json();

    await fetch(`${app.baseUrl}/api/model-profiles/default`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        profileId: createProfileBPayload.profile.id,
      }),
    });

    const sendMessageResponse = await fetch(`${app.baseUrl}/api/sessions/${createSessionPayload.session.id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: "Which model profile are you using?",
      }),
    });

    expect(sendMessageResponse.status).toBe(200);
    expect(usedProfileIds.at(-1)).toBe(createSessionPayload.session.modelProfileId);
  });

  it("persists model profiles and the default model across runtime restarts", async () => {
    const firstApp = await createRuntimeApp({ port: 0, stateFilePath });

    const createResponse = await fetch(`${firstApp.baseUrl}/api/model-profiles`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Moonshot Persisted",
        provider: "openai-compatible",
        baseUrl: "https://api.moonshot.cn/v1",
        apiKey: "sk-persisted",
        model: "moonshot-v1-8k",
      }),
    });
    const createdPayload = await createResponse.json();

    await fetch(`${firstApp.baseUrl}/api/model-profiles/default`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        profileId: createdPayload.profile.id,
      }),
    });

    await firstApp.close();
    dispose = undefined;

    const secondApp = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = secondApp.close;

    const bootstrapResponse = await fetch(`${secondApp.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();

    expect(bootstrapPayload.models.some((profile: { name: string }) => profile.name === "Moonshot Persisted")).toBe(
      true,
    );
    expect(bootstrapPayload.defaultModelProfileId).toBe(createdPayload.profile.id);
    expect(bootstrapPayload.isFirstLaunch).toBe(false);
    expect(bootstrapPayload.runtimeStateFilePath).toBe(stateFilePath);
  });

  it("persists created sessions and appended messages across runtime restarts", async () => {
    const firstApp = await createRuntimeApp({
      port: 0,
      stateFilePath,
      chatCompletion: async () => "Persisted assistant reply.",
    });

    const createSessionResponse = await fetch(`${firstApp.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Persisted Thread",
      }),
    });
    const createSessionPayload = await createSessionResponse.json();

    const messageResponse = await fetch(
      `${firstApp.baseUrl}/api/sessions/${createSessionPayload.session.id}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          content: "Remember this thread after restart.",
        }),
      },
    );
    const messagePayload = await messageResponse.json();

    expect(messageResponse.status).toBe(200);
    expect(messagePayload.session.messages.at(-1)?.content).toBe("Persisted assistant reply.");

    await firstApp.close();
    dispose = undefined;

    const secondApp = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = secondApp.close;

    const bootstrapResponse = await fetch(`${secondApp.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();
    const persistedSession = bootstrapPayload.sessions.find(
      (session: { id: string }) => session.id === createSessionPayload.session.id,
    );

    expect(persistedSession?.title).toBe("Persisted Thread");
    const lastUserMessage = [...(persistedSession?.messages ?? [])]
      .reverse()
      .find((message: { role: string }) => message.role === "user");
    const lastAssistantMessage = [...(persistedSession?.messages ?? [])]
      .reverse()
      .find((message: { role: string }) => message.role === "assistant");

    expect(lastUserMessage?.content).toBe("Remember this thread after restart.");
    expect(lastAssistantMessage?.content).toBe("Persisted assistant reply.");
  });

  it("removes the session folder after deleting a session", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const bootstrapResponse = await fetch(`${app.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();

    const createSessionResponse = await fetch(`${app.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Disposable Session",
      }),
    });
    const createSessionPayload = await createSessionResponse.json();

    expect(createSessionResponse.status).toBe(201);
    expect(existsSync(join(bootstrapPayload.sessionsRootPath, createSessionPayload.session.id, "session.json"))).toBe(true);

    const deleteResponse = await fetch(`${app.baseUrl}/api/sessions/${createSessionPayload.session.id}`, {
      method: "DELETE",
    });
    const deletePayload = await deleteResponse.json();

    expect(deleteResponse.status).toBe(200);
    expect(deletePayload.deletedSessionId).toBe(createSessionPayload.session.id);
    expect(existsSync(join(bootstrapPayload.sessionsRootPath, createSessionPayload.session.id))).toBe(false);
  });

  it("resolves an approval request, appends a result message, and updates the allow-list", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const bootstrapResponse = await fetch(`${app.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();
    const approvalId = bootstrapPayload.approvalRequests[0].id;

    const resolveResponse = await fetch(`${app.baseUrl}/api/approvals/${approvalId}/resolve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        decision: "always-allow-tool",
      }),
    });
    const resolvePayload = await resolveResponse.json();

    expect(resolveResponse.status).toBe(200);
    expect(resolvePayload.approvalRequests).toHaveLength(0);
    expect(resolvePayload.approvals.alwaysAllowedTools).toContain("fs.write_file");
    expect(resolvePayload.session.messages.at(-1)?.role).toBe("system");
    expect(resolvePayload.session.messages.at(-1)?.content).toContain("已始终允许执行 write_file");
  });

  it("persists resolved approval state across runtime restarts", async () => {
    const firstApp = await createRuntimeApp({ port: 0, stateFilePath });

    const bootstrapResponse = await fetch(`${firstApp.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();
    const approvalId = bootstrapPayload.approvalRequests[0].id;

    const resolveResponse = await fetch(`${firstApp.baseUrl}/api/approvals/${approvalId}/resolve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        decision: "always-allow-tool",
      }),
    });

    expect(resolveResponse.status).toBe(200);

    await firstApp.close();
    dispose = undefined;

    const secondApp = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = secondApp.close;

    const secondBootstrapResponse = await fetch(`${secondApp.baseUrl}/api/bootstrap`);
    const secondBootstrapPayload = await secondBootstrapResponse.json();

    expect(secondBootstrapPayload.approvalRequests).toHaveLength(0);
    expect(secondBootstrapPayload.approvals.alwaysAllowedTools).toContain("fs.write_file");
    expect(secondBootstrapPayload.sessions[0].messages.at(-1)?.content).toContain("已始终允许执行 write_file");
  });

  it("auto-approves skill execution intents without creating a pending approval", async () => {
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      executeIntent: async () => ({
        ok: true,
        summary: "Skill 执行成功：code-review",
        output: "mocked skill output",
      }),
    });
    dispose = app.close;

    const bootstrapResponse = await fetch(`${app.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/execution-intents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: "skill",
        toolId: "skill.code_review",
        label: "code-review",
        risk: "exec",
        detail: "Skills 准备执行 code-review 脚本。",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result.status).toBe("auto-approved");
    expect(payload.result.approvalRequest).toBeNull();
    expect(payload.approvalRequests).toHaveLength(bootstrapPayload.approvalRequests.length);
    expect(payload.session.messages.some((message: { content: string }) => message.content.includes("Skills 调用"))).toBe(true);
  });

  it("creates a pending approval for shell command execution intents", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const bootstrapResponse = await fetch(`${app.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/execution-intents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: "shell-command",
        toolId: "shell.powershell",
        label: "powershell.exe",
        risk: "exec",
        detail: "运行 PowerShell 命令会修改当前工作区。",
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.result.status).toBe("pending");
    expect(payload.result.approvalRequest?.source).toBe("shell-command");
    expect(payload.result.approvalRequest?.toolId).toBe("shell.powershell");
    expect(payload.approvalRequests).toHaveLength(bootstrapPayload.approvalRequests.length + 1);
    expect(payload.session.messages).toHaveLength(bootstrapPayload.sessions[0].messages.length);
  });

  it("executes shell commands when policy auto-allows execution", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const policyResponse = await fetch(`${app.baseUrl}/api/approvals/policy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "auto-allow-all",
        autoApproveReadOnly: true,
        autoApproveSkills: true,
      }),
    });
    expect(policyResponse.status).toBe(200);

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/execution-intents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: "shell-command",
        toolId: "shell.command",
        label: "Write-Output runtime-shell-ok",
        risk: "exec",
        detail: "执行 PowerShell 命令。",
      }),
    });
    const payload = await response.json();
    const contents = payload.session.messages.map((item: { content: string }) => item.content);

    expect(response.status).toBe(200);
    expect(payload.result.status).toBe("auto-approved");
    expect(contents.some((item: string) => item.includes("命令执行成功"))).toBe(true);
    expect(contents.some((item: string) => item.includes("runtime-shell-ok"))).toBe(true);
  }, 30000);

  it("executes an approved pending intent and appends execution output", async () => {
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      executeIntent: async ({ intent }) => ({
        ok: true,
        summary: `执行完成：${intent.label}`,
        output: "mocked tool output",
      }),
    });
    dispose = app.close;

    const intentResponse = await fetch(`${app.baseUrl}/api/sessions/session-default/execution-intents`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: "shell-command",
        toolId: "shell.command",
        label: "pnpm -v",
        risk: "exec",
        detail: "检查 pnpm 版本。",
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
    expect(resolvePayload.session.messages.some((item: { content: string }) => item.content.includes("执行完成"))).toBe(
      true,
    );
    expect(resolvePayload.session.messages.at(-1)?.role).toBe("tool");
    expect(resolvePayload.session.messages.at(-1)?.content).toContain("mocked tool output");
  }, 30000);

  it("updates the global approval policy", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/approvals/policy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "auto-read-only",
        autoApproveReadOnly: true,
        autoApproveSkills: false,
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.approvals.mode).toBe("auto-read-only");
    expect(payload.approvals.autoApproveReadOnly).toBe(true);
    expect(payload.approvals.autoApproveSkills).toBe(false);
  });

  it("persists the updated approval policy across runtime restarts", async () => {
    const firstApp = await createRuntimeApp({ port: 0, stateFilePath });

    const updateResponse = await fetch(`${firstApp.baseUrl}/api/approvals/policy`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mode: "auto-allow-all",
        autoApproveReadOnly: true,
        autoApproveSkills: true,
      }),
    });

    expect(updateResponse.status).toBe(200);

    await firstApp.close();
    dispose = undefined;

    const secondApp = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = secondApp.close;

    const bootstrapResponse = await fetch(`${secondApp.baseUrl}/api/bootstrap`);
    const bootstrapPayload = await bootstrapResponse.json();

    expect(bootstrapPayload.approvals.mode).toBe("auto-allow-all");
    expect(bootstrapPayload.approvals.autoApproveReadOnly).toBe(true);
    expect(bootstrapPayload.approvals.autoApproveSkills).toBe(true);
  });

  it("imports and refreshes MCP servers through dedicated management APIs", async () => {
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      mcpAdapter: {
        importServers: async () => [
          {
            id: "claude-filesystem",
            name: "Claude Filesystem",
            source: "claude",
            transport: "stdio",
            command: "npx",
            args: ["@modelcontextprotocol/server-filesystem", "."],
            enabled: true,
          },
        ],
        refreshServer: async (config) => ({
          connected: true,
          checkedAt: "2026-03-20T08:00:00.000Z",
          tools: [
            {
              id: `${config.id}:read_file`,
              serverId: config.id,
              name: "read_file",
              description: "Read a file from the imported server.",
              risk: ToolRiskCategory.Read,
              inputSchema: {
                type: "object",
              },
            },
          ],
        }),
        invokeServerTool: async () => ({
          ok: true,
          summary: "unused",
          output: "",
        }),
      },
    });
    dispose = app.close;

    const importResponse = await fetch(`${app.baseUrl}/api/mcp/import`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: "claude",
      }),
    });
    const importPayload = await importResponse.json();

    const listResponse = await fetch(`${app.baseUrl}/api/mcp/servers`);
    const listPayload = await listResponse.json();

    const refreshResponse = await fetch(`${app.baseUrl}/api/mcp/servers/claude-filesystem/refresh`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });
    const refreshPayload = await refreshResponse.json();

    expect(importResponse.status).toBe(200);
    expect(importPayload.servers).toHaveLength(2);
    const importedServer = importPayload.servers.find((server: { id: string }) => server.id === "claude-filesystem");
    expect(importedServer?.id).toBe("claude-filesystem");
    expect(importedServer?.state.health).toBe("healthy");
    expect(importedServer?.tools).toHaveLength(1);

    expect(listResponse.status).toBe(200);
    expect(listPayload.servers).toHaveLength(2);
    expect(listPayload.servers.some((server: { name: string }) => server.name === "Claude Filesystem")).toBe(true);

    expect(refreshResponse.status).toBe(200);
    expect(refreshPayload.server.id).toBe("claude-filesystem");
    expect(refreshPayload.server.state.connected).toBe(true);
  });

  it("creates, updates, and deletes manual MCP servers", async () => {
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      mcpAdapter: {
        importServers: async () => [],
        refreshServer: async () => ({
          connected: false,
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

    const createResponse = await fetch(`${app.baseUrl}/api/mcp/servers`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Docs Gateway",
        source: "manual",
        transport: "http",
        url: "http://127.0.0.1:8123/mcp",
        enabled: true,
      }),
    });
    const createPayload = await createResponse.json();
    const createdId = createPayload.server.id as string;

    const updateResponse = await fetch(`${app.baseUrl}/api/mcp/servers/${createdId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: createdId,
        name: "Docs Gateway Updated",
        source: "manual",
        transport: "http",
        url: "http://127.0.0.1:9000/mcp",
        enabled: false,
      }),
    });
    const updatePayload = await updateResponse.json();

    const deleteResponse = await fetch(`${app.baseUrl}/api/mcp/servers/${createdId}`, {
      method: "DELETE",
    });
    const deletePayload = await deleteResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createPayload.server.name).toBe("Docs Gateway");
    expect(createPayload.server.transport).toBe("http");

    expect(updateResponse.status).toBe(200);
    expect(updatePayload.server.name).toBe("Docs Gateway Updated");
    expect(updatePayload.server.enabled).toBe(false);

    expect(deleteResponse.status).toBe(200);
    expect(deletePayload.deletedServerId).toBe(createdId);
    expect(deletePayload.servers).toHaveLength(1);
    expect(deletePayload.servers[0].id).toBe("mcp-filesystem");
  }, 30000);
});
