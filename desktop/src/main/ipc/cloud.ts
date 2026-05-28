import { ipcMain } from "electron";

import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { platform } from "node:os";

import type {
  AuthIntrospectResponse,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthRefreshResponse,
  McpServerConfig,
  SkillDefinition,
  SkillDetail,
  SiliconPerson,
  WorkflowDefinition,
  WorkflowSummary,
} from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import { appEnv, APP_ENV_NAME } from "../../../config";
import { saveSiliconPerson, saveWorkflow } from "../services/state-persistence";
import { trackSave } from "../services/pending-saves";
import { deriveSiliconPersonPaths } from "../services/directory-service";
import { getOrCreateWorkspace, initializeWorkspaceDirectories, refreshWorkspaceSkills } from "../services/silicon-person-workspace";
import { normalizeMcpManifestConfig } from "../services/mcp-config-normalizer";
import { createLocalPublishDraft } from "../services/publish-draft-service";
import { resolveWorkflowPackageDefinition } from "../services/workflow-package-installer";

// ---------------------------------------------------------------------------
// Hub types (subset of what CloudHubProxy returns)
// ---------------------------------------------------------------------------

type HubItem = {
  id: string;
  name: string;
  description: string;
  kind: "skill" | "workflow" | "employee";
  author?: string;
  version?: string;
  updatedAt?: string;
};

type HubItemDetail = HubItem & {
  readme?: string;
  tags?: string[];
  installCount?: number;
};

type HubManifest = {
  id: string;
  name: string;
  version: string;
  kind: "skill" | "workflow" | "employee";
  entrypoint?: string;
  files?: string[];
};

type CloudProjectSummary = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  ownerAccount: string;
  status: "active" | "archived";
  version: number;
  repositoryCount: number;
  apiCount: number;
  skillCount: number;
  mcpCount: number;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// IPC 处理器
// ---------------------------------------------------------------------------

const CLOUD_API_BASE = process.env.MYCLAW_CLOUD_API_URL ?? appEnv.CLOUD_API_BASE;
console.log(`[cloud] env=${APP_ENV_NAME} api=${CLOUD_API_BASE}`);

type CloudIpcErrorPayload = {
  __myclawCloudError: true;
  channel: string;
  message: string;
  baseUrl: string;
  cause?: string;
  code?: string;
};

/** 提取底层网络错误码，方便日志直接定位是拒绝连接还是超时。 */
function extractCloudErrorCode(error: unknown): string | undefined {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/** 生成可恢复的 Cloud IPC 错误，避免 Electron 把可预期离线状态打印成 handler 异常栈。 */
function buildCloudIpcErrorPayload(channel: string, error: unknown): CloudIpcErrorPayload {
  const cause = error instanceof Error ? error.message : String(error);
  const code = extractCloudErrorCode(error);
  console.warn("[cloud] Cloud API 请求失败，返回可恢复错误", {
    channel,
    api: CLOUD_API_BASE,
    code: code ?? "unknown",
    cause,
  });
  return {
    __myclawCloudError: true,
    channel,
    message: `Cloud API 连接失败：无法访问 ${CLOUD_API_BASE}。请先启动 cloud-api，或设置 MYCLAW_CLOUD_API_URL 指向可用服务。`,
    baseUrl: CLOUD_API_BASE,
    cause,
    ...(code ? { code } : {}),
  };
}

async function cloudFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${CLOUD_API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
}

export function registerCloudHandlers(ctx: RuntimeContext): void {
  // List hub items
  ipcMain.handle(
    "cloud:hub-items",
    async (_event, params?: { kind?: string; query?: string }) => {
      const qs = new URLSearchParams();
      if (params?.kind) qs.set("type", params.kind);
      if (params?.query) qs.set("keyword", params.query);
      const suffix = qs.toString() ? `?${qs}` : "";
      const res = await cloudFetch(`/hub/items${suffix}`);
      if (!res.ok) throw new Error(`Cloud hub request failed: ${res.status}`);
      const payload = await res.json() as { items: HubItem[] };
      return payload.items;
    },
  );

  // Get hub item detail
  ipcMain.handle("cloud:hub-detail", async (_event, itemId: string) => {
    const res = await cloudFetch(`/hub/items/${encodeURIComponent(itemId)}`);
    if (!res.ok) throw new Error(`Hub item not found: ${itemId}`);
    return res.json();
  });

  // Get hub item manifest (for install)
  ipcMain.handle("cloud:hub-manifest", async (_event, releaseId: string) => {
    const res = await cloudFetch(`/hub/releases/${encodeURIComponent(releaseId)}/manifest`);
    if (!res.ok) throw new Error(`Hub manifest not found: ${releaseId}`);
    return res.json();
  });

  // List published skills from cloud
  ipcMain.handle(
    "cloud:skills",
    async (_event, query?: { category?: string; keyword?: string; sort?: string; tag?: string }) => {
      try {
        const qs = new URLSearchParams();
        if (query?.category) qs.set("category", query.category);
        if (query?.keyword) qs.set("keyword", query.keyword);
        if (query?.sort) qs.set("sort", query.sort);
        if (query?.tag) qs.set("tag", query.tag);
        const suffix = qs.toString() ? `?${qs}` : "";
        const res = await cloudFetch(`/skills${suffix}`);
        if (!res.ok) throw new Error(`Cloud skills request failed: ${res.status}`);
        const payload = await res.json() as { skills: unknown[] };
        return payload.skills;
      } catch (error) {
        return buildCloudIpcErrorPayload("cloud:skills", error);
      }
    },
  );

  // 查询单个云端 Skill 详情，404 视为资源已下架，避免 Electron IPC 打印异常栈。
  ipcMain.handle("cloud:skill-detail", async (_event, skillId: string) => {
    const res = await cloudFetch(`/skills/${encodeURIComponent(skillId)}`);
    if (res.status === 404) {
      console.info("[cloud] 云端 Skill 详情不存在或已下架", { skillId });
      return null;
    }
    if (!res.ok) throw new Error(`Cloud skill detail request failed: ${res.status}`);
    return res.json();
  });

  // 查询 Cloud 项目摘要列表，用于 Hub 下载、更新和绑定本地项目。
  ipcMain.handle("cloud:projects", async () => {
    console.info("[cloud] 查询 Cloud 项目列表");
    const res = await cloudFetch("/projects");
    if (!res.ok) throw new Error(`Cloud projects request failed: ${res.status}`);
    const payload = await res.json() as { items: CloudProjectSummary[] };
    return payload.items;
  });

  // Get local skill detail by ID (includes SKILL.md content)
  ipcMain.handle("skill:detail", async (_event, skillId: string): Promise<{ skill: SkillDetail }> => {
    const skill = ctx.state.skills.find((s) => s.id === skillId);
    if (!skill) {
      throw new Error(`Local skill not found: ${skillId}`);
    }

    // Read SKILL.md content from the skill's directory
    const skillMdPath = join(skill.path, "SKILL.md");
    let content = "";
    if (existsSync(skillMdPath)) {
      content = readFileSync(skillMdPath, "utf-8");
    }

    return {
      skill: {
        ...skill,
        entryPath: skillMdPath,
        content,
      },
    };
  });

  // Get download token for a release
  ipcMain.handle("cloud:hub-download-token", async (_event, releaseId: string) => {
    const res = await cloudFetch(`/hub/releases/${encodeURIComponent(releaseId)}/download-token`);
    if (!res.ok) throw new Error(`Download token request failed: ${res.status}`);
    return res.json();
  });

  // Create a publish draft
  ipcMain.handle(
    "publish:create-draft",
    async (_event, input: Record<string, unknown>): Promise<{ draft: Record<string, unknown> }> => {
      const result = await createLocalPublishDraft(input, {
        artifactsDir: ctx.runtime.paths.artifactsDir,
        siliconPersons: ctx.state.siliconPersons,
        workflows: ctx.state.getWorkflows(),
        workflowDefinitions: ctx.state.workflowDefinitions,
      });
      console.info("[publish:create-draft] 已返回真实发布草稿 artifact", {
        draftId: result.draft.id,
        filePath: result.draft.filePath,
      });
      return result;
    },
  );

  // ---- Cloud Skill import (download zip → extract → install to skills dir) ----
  // 支持 siliconPersonId：有则安装到员工自己的 skills/，否则安装到全局 skills/
  ipcMain.handle(
    "cloud:import-skill",
    async (_event, input: { releaseId: string; skillName: string; siliconPersonId?: string }) => {
      const releaseId = input.releaseId?.trim();
      const skillName = input.skillName?.trim();
      if (!releaseId || !skillName) throw new Error("releaseId and skillName are required");
      const downloadUrl = `${CLOUD_API_BASE}/artifacts/download/${encodeURIComponent(releaseId)}`;

      // 根据是否指定硅基员工决定安装目标目录
      const targetSkillsDir = input.siliconPersonId
        ? deriveSiliconPersonPaths(ctx.runtime.paths, input.siliconPersonId).skillsDir
        : ctx.runtime.paths.skillsDir;
      await mkdir(targetSkillsDir, { recursive: true });

      // Normalize directory name
      const dirName = skillName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "cloud-skill";
      const workingRoot = await mkdtemp(join(targetSkillsDir, ".cloud-import-"));
      const archivePath = join(workingRoot, "release.zip");
      const extractPath = join(workingRoot, "extracted");
      const destinationPath = join(targetSkillsDir, dirName);

      try {
        await mkdir(extractPath, { recursive: true });

        // Download
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        await writeFile(archivePath, bytes);

        // Extract
        const { execFileSync } = await import("node:child_process");
        if (platform() === "win32") {
          execFileSync("powershell.exe", [
            "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-Command",
            `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractPath.replace(/'/g, "''")}' -Force`,
          ]);
        } else {
          execFileSync("tar", ["-xf", archivePath, "-C", extractPath]);
        }

        // Resolve source (may be nested in a single subdirectory)
        let sourcePath = extractPath;
        if (!existsSync(join(extractPath, "SKILL.md"))) {
          const dirs = (await readdir(extractPath, { withFileTypes: true }))
            .filter((e) => e.isDirectory()).map((e) => e.name);
          if (dirs.length === 1 && existsSync(join(extractPath, dirs[0], "SKILL.md"))) {
            sourcePath = join(extractPath, dirs[0]);
          }
        }

        await rm(destinationPath, { recursive: true, force: true });
        await cp(sourcePath, destinationPath, { recursive: true, force: true });

        // 刷新技能列表：全局或硅基员工工作空间
        let skills: SkillDefinition[];
        if (input.siliconPersonId) {
          const workspace = await getOrCreateWorkspace(ctx.runtime.paths, input.siliconPersonId);
          skills = refreshWorkspaceSkills(workspace);
        } else {
          skills = await ctx.services.refreshSkills();
        }
        const installed = skills.find((s) => resolve(s.path) === resolve(destinationPath));

        return { skill: installed ?? null, skills: { items: skills } };
      } finally {
        await rm(workingRoot, { recursive: true, force: true });
      }
    },
  );

  // ---- Cloud MCP import (register MCP server config locally) ----
  // 支持 siliconPersonId：有则注册到员工的 MCP 管理器，否则注册到全局
  ipcMain.handle(
    "cloud:import-mcp",
    async (_event, input: { manifest: Record<string, unknown>; siliconPersonId?: string }) => {
      const manifest = input.manifest ?? input;
      const config = normalizeMcpManifestConfig(manifest);

      // 全局或硅基员工的 MCP 管理器
      let mcpManager: typeof ctx.services.mcpManager;
      if (input.siliconPersonId) {
        const workspace = await getOrCreateWorkspace(ctx.runtime.paths, input.siliconPersonId);
        mcpManager = workspace.mcpManager;
      } else {
        mcpManager = ctx.services.mcpManager;
      }
      if (!mcpManager) throw new Error("MCP manager not available");

      const server = await mcpManager.createServer(config);
      const servers = mcpManager.listServers();
      return { server, servers };
    },
  );

  // ---- Cloud SiliconPerson Package import ----
  ipcMain.handle(
    "cloud:import-silicon-person-package",
    async (_event, input: Record<string, unknown>) => {
      const manifest = input.manifest as Record<string, unknown> | undefined;
      const siliconPerson: SiliconPerson = {
        id: `sp-${crypto.randomUUID()}`,
        name: ((input.name as string) ?? "").trim(),
        title: ((input.name as string) ?? "").trim(),
        description: (manifest?.description as string) || ((input.summary as string) ?? "").trim() || ((input.name as string) ?? "").trim(),
        status: "idle",
        source: "hub",
        approvalMode: "inherit",
        currentSessionId: null,
        sessions: [],
        unreadCount: 0,
        hasUnread: false,
        needsApproval: false,
        workflowIds: [...((manifest?.defaultWorkflowIds as string[]) ?? [])],
        updatedAt: new Date().toISOString(),
      };

      // 初始化员工独立工作空间目录（skills/、sessions/、内置技能种子）
      initializeWorkspaceDirectories(ctx.runtime.paths, siliconPerson.id);

      ctx.state.siliconPersons.push(siliconPerson);
      trackSave(
        saveSiliconPerson(ctx.runtime.paths, siliconPerson).catch((err) => {
          console.error("[cloud:import-silicon-person-package] 硅基员工持久化失败", err);
        }),
      );

      return { siliconPerson, items: [...ctx.state.siliconPersons] };
    },
  );

  // ---- Cloud Workflow Package import ----
  ipcMain.handle(
    "cloud:import-workflow-package",
    async (_event, input: Record<string, unknown>) => {
      const manifest = input.manifest as { kind: "workflow-package"; name?: string; version?: string; description?: string; entryWorkflowId?: string } | undefined;
      const downloadUrl = typeof input.downloadUrl === "string" ? input.downloadUrl.trim() : "";
      if (!manifest || manifest.kind !== "workflow-package") {
        throw new Error("Cloud manifest is not a workflow package.");
      }
      if (!downloadUrl) {
        throw new Error("Workflow package downloadUrl is required.");
      }

      const { workflow, definition } = await resolveWorkflowPackageDefinition({
        name: typeof input.name === "string" ? input.name : manifest.name,
        summary: typeof input.summary === "string" ? input.summary : undefined,
        downloadUrl,
        manifest,
      });
      ctx.state.getWorkflows().push(workflow);
      ctx.state.workflowDefinitions[workflow.id] = definition;
      trackSave(
        saveWorkflow(ctx.runtime.paths, definition).catch((err) => {
          console.error("[cloud:import-workflow-package] persist failed", err);
        }),
      );
      console.info("[cloud:import-workflow-package] 已安装真实 workflow package artifact", {
        workflowId: workflow.id,
        nodeCount: workflow.nodeCount,
        edgeCount: workflow.edgeCount,
      });

      return { workflow, items: [...ctx.state.getWorkflows()] };
    },
  );

  // Login to cloud account
  ipcMain.handle(
    "cloud:auth-login",
    async (_event, credentials: AuthLoginRequest): Promise<AuthLoginResponse> => {
      const res = await cloudFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Login failed: ${res.status} ${text}`);
      }
      return res.json() as Promise<AuthLoginResponse>;
    },
  );

  // Logout from cloud account
  ipcMain.handle(
    "cloud:auth-logout",
    async (_event, refreshToken: string): Promise<{ success: boolean }> => {
      try {
        await cloudFetch("/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken }),
        });
      } catch {
        // best-effort logout
      }
      return { success: true };
    },
  );

  // Refresh access token
  ipcMain.handle(
    "cloud:auth-refresh",
    async (_event, refreshToken: string): Promise<AuthRefreshResponse> => {
      const res = await cloudFetch("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token refresh failed: ${res.status} ${text}`);
      }
      return res.json() as Promise<AuthRefreshResponse>;
    },
  );

  // Introspect token (check validity + user info)
  ipcMain.handle(
    "cloud:auth-introspect",
    async (_event, accessToken: string): Promise<AuthIntrospectResponse> => {
      const res = await cloudFetch("/auth/introspect", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        return { active: false };
      }
      return res.json() as Promise<AuthIntrospectResponse>;
    },
  );
}
