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

// ---------------------------------------------------------------------------
// IPC 处理器
// ---------------------------------------------------------------------------

const CLOUD_API_BASE = process.env.MYCLAW_CLOUD_API_URL ?? appEnv.CLOUD_API_BASE;
console.log(`[cloud] env=${APP_ENV_NAME} api=${CLOUD_API_BASE}`);

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
    },
  );

  // Get a single cloud skill detail
  ipcMain.handle("cloud:skill-detail", async (_event, skillId: string) => {
    const res = await cloudFetch(`/skills/${encodeURIComponent(skillId)}`);
    if (!res.ok) throw new Error(`Skill not found: ${skillId}`);
    return res.json();
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
      // Stub: real impl creates a draft on cloud API
      console.log("[publish:create-draft] stub", input);
      return {
        draft: {
          id: `draft-${Date.now()}`,
          status: "draft",
          ...input,
          createdAt: new Date().toISOString(),
        },
      };
    },
  );

  // ---- Cloud Skill import (download zip → extract → install to skills dir) ----
  ipcMain.handle(
    "cloud:import-skill",
    async (_event, input: { releaseId: string; skillName: string }) => {
      const releaseId = input.releaseId?.trim();
      const skillName = input.skillName?.trim();
      if (!releaseId || !skillName) throw new Error("releaseId and skillName are required");
      const downloadUrl = `${CLOUD_API_BASE}/artifacts/download/${encodeURIComponent(releaseId)}`;

      const skillsDir = ctx.runtime.paths.skillsDir;
      await mkdir(skillsDir, { recursive: true });

      // Normalize directory name
      const dirName = skillName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "cloud-skill";
      const workingRoot = await mkdtemp(join(skillsDir, ".cloud-import-"));
      const archivePath = join(workingRoot, "release.zip");
      const extractPath = join(workingRoot, "extracted");
      const destinationPath = join(skillsDir, dirName);

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

        // Refresh skills list
        const skills = await ctx.services.refreshSkills();
        const installed = skills.find((s) => resolve(s.path) === resolve(destinationPath));

        return { skill: installed ?? null, skills: { items: skills } };
      } finally {
        await rm(workingRoot, { recursive: true, force: true });
      }
    },
  );

  // ---- Cloud MCP import (register MCP server config locally) ----
  ipcMain.handle(
    "cloud:import-mcp",
    async (_event, input: { manifest: Record<string, unknown> }) => {
      const manifest = input.manifest ?? input;
      const mcpManager = ctx.services.mcpManager;
      if (!mcpManager) throw new Error("MCP manager not available");

      const transport = (manifest.transport as string) ?? "stdio";
      const name = (manifest.name as string) ?? "Cloud MCP";
      const config = transport === "http"
        ? {
            name,
            source: "manual" as const,
            transport: "http" as const,
            url: (manifest.endpoint as string) ?? "",
            headers: (manifest.headers as Record<string, string>) ?? undefined,
            enabled: true,
          }
        : {
            name,
            source: "manual" as const,
            transport: "stdio" as const,
            command: (manifest.command as string) ?? "",
            args: (manifest.args as string[]) ?? [],
            enabled: true,
          };

      const server = await mcpManager.createServer(config);
      const servers = ctx.services.listMcpServers();
      return { server, servers };
    },
  );

  // ---- Cloud Employee Package import ----
  ipcMain.handle(
    "cloud:import-employee-package",
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

      ctx.state.siliconPersons.push(siliconPerson);
      saveSiliconPerson(ctx.runtime.paths, siliconPerson).catch((err) => {
        console.error("[cloud:import-employee-package] 硅基员工持久化失败", err);
      });

      return { siliconPerson, items: [...ctx.state.siliconPersons] };
    },
  );

  // ---- Cloud Workflow Package import ----
  ipcMain.handle(
    "cloud:import-workflow-package",
    async (_event, input: Record<string, unknown>) => {
      const manifest = input.manifest as Record<string, unknown> | undefined;
      const workflow: WorkflowSummary = {
        id: `workflow-${crypto.randomUUID()}`,
        name: ((input.name as string) ?? "").trim(),
        description: (manifest?.description as string) || ((input.summary as string) ?? "").trim() || ((input.name as string) ?? "").trim(),
        status: "draft",
        source: "hub",
        updatedAt: new Date().toISOString(),
        version: 1,
        nodeCount: 0,
        edgeCount: 0,
        libraryRootId: "",
      };

      ctx.state.getWorkflows().push(workflow);

      const definition: WorkflowDefinition = {
        ...workflow,
        entryNodeId: "",
        nodes: [],
        edges: [],
        stateSchema: [],
      };
      ctx.state.workflowDefinitions[workflow.id] = definition;
      saveWorkflow(ctx.runtime.paths, definition).catch((err) => {
        console.error("[cloud:import-workflow-package] persist failed", err);
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
