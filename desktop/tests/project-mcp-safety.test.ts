import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type {
  CapabilityInstallation,
  CloudProjectBinding,
  ProjectCapabilityDetail,
  ProjectCapabilityPref,
  ProjectCapabilityRef,
} from "../shared/contracts";
import { CapabilityBundleResolver } from "../src/main/services/capability-bundle-resolver";
import { ProjectMcpRuntimeService } from "../src/main/services/project-mcp-runtime-service";

const servers: Server[] = [];

/** 构造测试项目基础信息。 */
function buildProject(): CloudProjectBinding {
  const now = "2026-05-18T00:00:00.000Z";
  return {
    id: "local-project-1",
    cloudProjectId: "1",
    tenantId: "default",
    accountId: "local",
    code: "ops",
    name: "Ops Project",
    description: null,
    cloudVersion: 1,
    etag: "etag-1",
    policyEpoch: 1,
    syncedAt: now,
    expiresAt: null,
    revokedAt: null,
    deletedAt: null,
    lastSyncStatus: "synced",
    lastSyncError: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** 构造项目 MCP 引用。 */
function buildMcpRef(project: CloudProjectBinding, patch: Partial<ProjectCapabilityRef> = {}): ProjectCapabilityRef {
  return {
    id: "ref-mcp-1",
    localProjectId: project.id,
    kind: "mcp",
    cloudCapabilityId: "ops-search",
    cloudReleaseId: "release-mcp-1",
    alias: "ops-search",
    displayName: "Ops Search",
    description: "Search ops tickets",
    defaultEnabled: true,
    manifestJson: { inputSchema: { type: "object" } },
    artifactJson: null,
    artifactHash: null,
    runtimePolicyJson: {
      requiresLocalConfirmation: true,
      allowAutoExposeToModel: true,
      riskLevel: "low",
    },
    cloudConfigJson: null,
    syncStatus: "synced",
    syncWarning: null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    ...patch,
  };
}

/** 构造项目 MCP 本地偏好。 */
function buildMcpPref(project: CloudProjectBinding, ref: ProjectCapabilityRef, patch: Partial<ProjectCapabilityPref> = {}): ProjectCapabilityPref {
  return {
    id: "pref-mcp-1",
    localProjectId: project.id,
    capabilityRefId: ref.id,
    localState: "inherit",
    reason: null,
    updatedBy: null,
    updatedAt: project.updatedAt,
    localPolicyJson: { localConfirmed: false, secretsConfigured: false, allowExposeToModel: false },
    ...patch,
  };
}

/** 构造项目详情，只关注 MCP 安全门禁。 */
function buildDetail(input: {
  ref?: Partial<ProjectCapabilityRef>;
  pref?: Partial<ProjectCapabilityPref>;
} = {}): ProjectCapabilityDetail {
  const project = buildProject();
  const ref = buildMcpRef(project, input.ref);
  const pref = buildMcpPref(project, ref, input.pref);
  return {
    project,
    refs: [ref],
    prefs: [pref],
    installations: [] as CapabilityInstallation[],
  };
}

/** 构造 resolver 依赖桩。 */
function resolver(detail: ProjectCapabilityDetail, runtime: ProjectMcpRuntimeService | { listToolsForCapability: ProjectMcpRuntimeService["listToolsForCapability"] } = {
  listToolsForCapability: async () => [{
    name: "search",
    description: "Search ops",
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  }],
}) {
  return new CapabilityBundleResolver({
    getSessionProjectBinding: () => detail.project.id,
    getProjectDetail: () => detail,
  } as never, runtime as ProjectMcpRuntimeService);
}

/** 解析测试会话的项目 MCP 暴露结果。 */
async function resolveProjectMcp(detail: ProjectCapabilityDetail, runtime?: ProjectMcpRuntimeService) {
  const bundle = await resolver(detail, runtime).resolveForSession({
    sessionId: "session-1",
    globalSkills: [],
    globalMcpTools: [],
  });
  return bundle.mcpTools;
}

/** 启动一个最小 HTTP MCP server，用于验证项目 MCP 临时 list/call/finally 断开链路。 */
async function startFakeMcpServer(): Promise<{ url: string; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { id?: number; method?: string; params?: any };
    calls.push(body.method ?? "unknown");
    response.setHeader("content-type", "application/json");
    if (!body.id) {
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (body.method === "initialize") {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } } }));
      return;
    }
    if (body.method === "tools/list") {
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [{
            name: "search",
            description: "Search fake tickets",
            inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
          }],
        },
      }));
      return;
    }
    if (body.method === "tools/call") {
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: `ok:${body.params?.name}:${body.params?.arguments?.q}` }] },
      }));
      return;
    }
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, calls };
}

/** 启动分页 tools/list 的临时 MCP server，用来锁定 nextCursor 能完整拉取。 */
async function startFakePaginatedMcpServer(): Promise<{ url: string; cursors: Array<string | null> }> {
  const cursors: Array<string | null> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { id?: number; method?: string; params?: any };
    response.setHeader("content-type", "application/json");
    if (!body.id) {
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (body.method === "initialize") {
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } } }));
      return;
    }
    if (body.method === "tools/list") {
      const cursor = typeof body.params?.cursor === "string" ? body.params.cursor : null;
      cursors.push(cursor);
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: cursor === "page-2"
          ? { tools: [{ name: "second", description: "Second page", inputSchema: { type: "object", properties: {}, required: [] } }] }
          : { tools: [{ name: "first", description: "First page", inputSchema: { type: "object", properties: {}, required: [] } }], nextCursor: "page-2" },
      }));
      return;
    }
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, cursors };
}

describe("project MCP safety gate", () => {
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("excludes project stdio MCP by default when runtime policy disallows auto exposure", async () => {
    const detail = buildDetail({
      ref: { runtimePolicyJson: { requiresLocalConfirmation: true, allowAutoExposeToModel: false, riskLevel: "high" } },
      pref: { localPolicyJson: { localConfirmed: true, secretsConfigured: true, allowExposeToModel: true } },
    });

    expect(await resolveProjectMcp(detail)).toHaveLength(0);
  });

  it("excludes project HTTP or SSE MCP until locally confirmed", async () => {
    const detail = buildDetail({
      pref: { localPolicyJson: { localConfirmed: false, secretsConfigured: true, allowExposeToModel: true } },
    });

    expect(await resolveProjectMcp(detail)).toHaveLength(0);
  });

  it("excludes locally disabled MCP even when Cloud default is enabled", async () => {
    const detail = buildDetail({
      pref: {
        localState: "disabled",
        localPolicyJson: { localConfirmed: true, secretsConfigured: true, allowExposeToModel: true },
      },
    });

    expect(await resolveProjectMcp(detail)).toHaveLength(0);
  });

  it("includes confirmed project MCP when local and runtime policies are safe", async () => {
    const detail = buildDetail({
      pref: { localPolicyJson: { localConfirmed: true, secretsConfigured: true, allowExposeToModel: true } },
    });

    const mcpTools = await resolveProjectMcp(detail);

    expect(mcpTools).toHaveLength(1);
    expect(mcpTools[0]).toEqual(expect.objectContaining({
      source: "project",
      kind: "mcp",
      id: "ops-search",
      toolName: "search",
    }));
  });

  it("lists and calls a confirmed project HTTP MCP through the temporary runtime", async () => {
    const server = await startFakeMcpServer();
    const detail = buildDetail({
      ref: {
        cloudConfigJson: { transport: "http", url: server.url },
        manifestJson: { config: { transport: "http", url: server.url } },
      },
      pref: { localPolicyJson: { localConfirmed: true, secretsConfigured: true, allowExposeToModel: true } },
    });
    const runtime = new ProjectMcpRuntimeService();

    const mcpTools = await resolveProjectMcp(detail, runtime);
    const output = await runtime.callToolForCapability(mcpTools[0]!, { q: "INC-1" });

    expect(mcpTools[0]).toMatchObject({
      source: "project",
      serverId: "ref-mcp-1",
      toolName: "search",
      inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    });
    expect(output).toBe("ok:search:INC-1");
    expect(server.calls.filter((item) => item === "tools/list")).toHaveLength(2);
    expect(server.calls.filter((item) => item === "tools/call")).toHaveLength(1);
  });

  it("follows MCP tools/list pagination for project HTTP MCP", async () => {
    const server = await startFakePaginatedMcpServer();
    const detail = buildDetail({
      ref: {
        cloudConfigJson: { transport: "http", url: server.url },
        manifestJson: { config: { transport: "http", url: server.url } },
      },
      pref: { localPolicyJson: { localConfirmed: true, secretsConfigured: true, allowExposeToModel: true } },
    });

    const mcpTools = await resolveProjectMcp(detail, new ProjectMcpRuntimeService());

    expect(mcpTools.map((tool) => tool.toolName)).toEqual(["first", "second"]);
    expect(server.cursors).toEqual([null, "page-2"]);
  });
});
