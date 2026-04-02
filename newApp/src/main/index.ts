import { app, BrowserWindow, ipcMain, shell } from "electron";
import { dirname, join, resolve } from "node:path";
import { existsSync, readdirSync, readFileSync, mkdirSync, cpSync, statSync } from "node:fs";

import type {
  ApprovalRequest,
  ChatSession,
  LocalEmployeeSummary,
  ModelProfile,
  SkillDefinition,
  WorkflowDefinition,
  WorkflowSummary,
} from "@shared/contracts";

import { createRuntimeContext } from "./services/runtime-context";
import { listBuiltinToolDefinitions } from "./services/builtin-tool-stubs";
import { initializeDirectories, changeRootDir } from "./services/directory-service";
import { initLogger, createLogger } from "./services/logger";

const log = createLogger("main");

/** Track pending save operations for graceful shutdown */
const pendingSaves = new Set<Promise<unknown>>();

export function trackSave(promise: Promise<unknown>): void {
  pendingSaves.add(promise);
  promise.finally(() => pendingSaves.delete(promise));
}

import type { MyClawPaths } from "./services/directory-service";
import {
  loadPersistedState,
  saveSettings,
} from "./services/state-persistence";
import { registerAllIpcHandlers } from "./ipc";
import { McpServerManager } from "./services/mcp-server-manager";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IS_DEV = process.env.NODE_ENV === "development";
const RENDERER_DEV_URL = "http://localhost:1420";
const RENDERER_PROD_FILE = join(__dirname, "../../renderer/index.html");

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  // 根据平台选择标题栏模式：macOS 用 hiddenInset，Windows 用 hidden + titleBarOverlay
  const isMac = process.platform === "darwin";
  const iconPath = join(__dirname, "../../build/icon.png");
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0c0c0c",
    icon: iconPath,
    titleBarStyle: "hidden",
    // Windows 下保留原生最小化/最大化/关闭按钮，自定义颜色融入暗色主题
    ...(isMac ? {} : {
      titleBarOverlay: {
        color: "#0c0c0c",        // 按钮区域背景色（匹配 --bg-base）
        symbolColor: "#a3a3a3",  // 按钮图标颜色（匹配 --text-secondary）
        height: 30,              // 按钮区域高度，与主流桌面应用一致
      },
    }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  // Show the window only once ready to avoid blank flash
  win.once("ready-to-show", () => {
    win.show();
  });

  // Open external links in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (IS_DEV) {
    win.loadURL(RENDERER_DEV_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(RENDERER_PROD_FILE);
  }

  return win;
}

// ---------------------------------------------------------------------------
// Builtin skills seeder — 首次启动时将内置示例复制到用户 skills 目录
// ---------------------------------------------------------------------------

function seedBuiltinSkills(skillsDir: string): void {
  // builtin-skills 在打包后位于 app.asar 同级或 dist 同级
  const candidates = [
    join(__dirname, "../../builtin-skills"),           // dev: dist/src/main → builtin-skills
    join(__dirname, "../../../builtin-skills"),         // packed: app.asar/dist/src/main → builtin-skills
    join(app.getAppPath(), "builtin-skills"),           // fallback
  ];

  let builtinDir: string | null = null;
  for (const c of candidates) {
    if (existsSync(c)) { builtinDir = c; break; }
  }
  if (!builtinDir) return;

  try {
    const entries = readdirSync(builtinDir);
    for (const entry of entries) {
      const src = join(builtinDir, entry);
      const dest = join(skillsDir, entry);
      // 只在用户目录中不存在时复制（不覆盖用户修改）
      if (!existsSync(dest)) {
        cpSync(src, dest, { recursive: true });
        log.info(`Seeded builtin skill: ${entry}`);
      }
    }
  } catch (err) {
    log.warn("Failed to seed builtin skills", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Skills loader
// ---------------------------------------------------------------------------

/**
 * Scan `skillsDir` for skill definitions.
 *
 * Supports two on-disk formats:
 *
 * 1. JSON manifest — a `<name>.json` file whose contents conform to
 *    `SkillDefinition`.  This is the lightweight format used by newApp.
 *
 * 2. SKILL.md directory — a sub-directory containing a `SKILL.md` file,
 *    compatible with skills installed by the desktop app.  A minimal
 *    `SkillDefinition` is synthesised from the directory name and first
 *    non-heading line of the markdown body.
 */
function loadSkillsFromDisk(skillsDir: string): SkillDefinition[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: SkillDefinition[] = [];

  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    const fullPath = resolve(skillsDir, entry);

    // --- Format 1: JSON manifest file ---
    if (entry.endsWith(".json")) {
      try {
        const raw = readFileSync(fullPath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<SkillDefinition>;
        if (parsed && typeof parsed === "object" && typeof parsed.id === "string" && typeof parsed.name === "string") {
          const skillDir = parsed.path ?? fullPath;
          let jsonViewFiles: string[] = [];
          try {
            const dirPath = statSync(skillDir).isDirectory() ? skillDir : dirname(skillDir);
            jsonViewFiles = readdirSync(dirPath).filter((f) => f.endsWith(".html"));
          } catch { /* ignore */ }
          skills.push({
            id: parsed.id,
            name: parsed.name,
            description: parsed.description ?? "",
            path: skillDir,
            enabled: parsed.enabled !== false,
            allowedTools: parsed.allowedTools,
            disableModelInvocation: parsed.disableModelInvocation ?? false,
            workingDirectory: parsed.workingDirectory ?? null,
            entrypoint: parsed.entrypoint ?? null,
            hasScriptsDirectory: parsed.hasScriptsDirectory ?? false,
            hasReferencesDirectory: parsed.hasReferencesDirectory ?? false,
            hasAssetsDirectory: parsed.hasAssetsDirectory ?? false,
            hasTestsDirectory: parsed.hasTestsDirectory ?? false,
            hasAgentsDirectory: parsed.hasAgentsDirectory ?? false,
            hasViewFile: jsonViewFiles.length > 0,
            viewFiles: parsed.viewFiles ?? jsonViewFiles,
          });
        }
      } catch {
        log.warn("Failed to parse JSON skill manifest", { path: fullPath });
      }
      continue;
    }

    // --- Format 2: SKILL.md directory ---
    // Entry must be a directory containing a SKILL.md file.
    const skillMdPath = join(fullPath, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      continue;
    }

    try {
      const markdown = readFileSync(skillMdPath, "utf-8");
      const { name, description, workspaceDir } = extractSkillMeta(entry, markdown);

      // Detect standard sub-directory conventions.
      let subEntries: string[] = [];
      try { subEntries = readdirSync(fullPath); } catch { /* ignore */ }
      const subDirs = new Set(subEntries.map((e) => e.toLowerCase()));

      const skillId = `skill-${name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")}`;

      // Detect all .html view files in the skill root directory
      const viewFiles = subEntries.filter((f) => f.endsWith(".html"));

      skills.push({
        id: skillId,
        name,
        description,
        path: fullPath,
        enabled: true,
        allowedTools: undefined,
        disableModelInvocation: false,
        workingDirectory: workspaceDir,
        entrypoint: null,
        hasScriptsDirectory: subDirs.has("scripts"),
        hasReferencesDirectory: subDirs.has("references"),
        hasAssetsDirectory: subDirs.has("assets"),
        hasTestsDirectory: subDirs.has("tests"),
        hasAgentsDirectory: subDirs.has("agents"),
        hasViewFile: viewFiles.length > 0,
        viewFiles,
      });
    } catch {
      log.warn("Failed to read SKILL.md in directory", { path: fullPath });
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

/**
 * Extract `name` and `description` from a SKILL.md file.
 * Reads YAML-like frontmatter between `---` delimiters when present.
 * Falls back to the directory name and the first non-heading line of the body.
 */
function extractSkillMeta(dirName: string, markdown: string): { name: string; description: string; workspaceDir: string | null } {
  const lines = markdown.split(/\r?\n/);
  let name = dirName;
  let description = "";
  let workspaceDir: string | null = null;

  if (lines[0]?.trim() === "---") {
    const closingIdx = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (closingIdx > 0) {
      for (const rawLine of lines.slice(1, closingIdx)) {
        const line = rawLine.trim();
        const colonIdx = line.indexOf(":");
        if (colonIdx <= 0) continue;
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
        if (key === "name" && value) name = value;
        if (key === "description" && value) description = value;
        if (key === "workspacedir" && value) workspaceDir = value;
      }
      // If description not found in frontmatter, extract from body.
      if (!description) {
        const bodyLines = lines.slice(closingIdx + 1);
        description = bodyLines.find((l) => l.trim() && !l.trim().startsWith("#"))?.trim() ?? "";
      }
      return { name, description, workspaceDir };
    }
  }

  // No frontmatter — extract description from first non-heading body line.
  description = lines.find((l) => l.trim() && !l.trim().startsWith("#"))?.trim() ?? "";
  return { name, description, workspaceDir };
}

// ---------------------------------------------------------------------------
// Runtime context bootstrap (stub state — replace with real persistence)
// ---------------------------------------------------------------------------

function buildRuntimeContext(paths: MyClawPaths, mcpManager: McpServerManager) {
  // Load all persisted state from disk
  const persisted = loadPersistedState(paths);

  // Mutable in-memory mirrors hydrated from disk
  const sessions: ChatSession[] = persisted.sessions;
  const models: ModelProfile[] = persisted.models;
  const employees: LocalEmployeeSummary[] = persisted.employees;
  const workflows: WorkflowSummary[] = persisted.workflows;
  const workflowDefinitions: Record<string, WorkflowDefinition> = persisted.workflowDefinitions;
  const skills: SkillDefinition[] = [];
  let approvalRequests: ApprovalRequest[] = [];
  let defaultModelProfileId: string | null = persisted.defaultModelProfileId;
  const approvalPolicy = persisted.approvalPolicy;

  return createRuntimeContext({
    runtime: {
      myClawRootPath: paths.myClawDir,
      skillsRootPath: paths.skillsDir,
      sessionsRootPath: paths.sessionsDir,
      paths,
    },
    state: {
      models,
      sessions,
      employees,
      skills,
      workflowDefinitions,
      getDefaultModelProfileId: () => {
        // Return stored default if it still points to a valid model
        if (defaultModelProfileId && models.some((m) => m.id === defaultModelProfileId)) {
          return defaultModelProfileId;
        }
        // Fall back to first model
        return models[0]?.id ?? null;
      },
      setDefaultModelProfileId: (id: string | null) => {
        defaultModelProfileId = id;
      },
      getWorkflows: () => workflows,
      getApprovals: () => approvalPolicy,
      getApprovalRequests: () => approvalRequests,
      setApprovalRequests: (updated) => {
        approvalRequests = updated;
      },
    },
    services: {
      refreshSkills: async () => {
        const loaded = loadSkillsFromDisk(paths.skillsDir);
        // Keep the in-memory skills array in sync so skill:detail lookups work.
        skills.splice(0, skills.length, ...loaded);
        return loaded;
      },
      listMcpServers: () => mcpManager.listServers(),
      mcpManager,
    },
    tools: {
      resolveBuiltinTools: () => {
        try {
          return listBuiltinToolDefinitions();
        } catch {
          return [];
        }
      },
      resolveMcpTools: () => [],
    },
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  // Initialize data directories (uses saved config or falls back to default)
  const paths = await initializeDirectories(null);

  // Initialize structured logger
  initLogger(paths.myClawDir);

  // Seed builtin example skills (only copies if not already present)
  seedBuiltinSkills(paths.skillsDir);

  // Initialize MCP server manager
  const mcpManager = new McpServerManager(paths.myClawDir);

  // Initialize runtime context and register all IPC handlers
  const ctx = buildRuntimeContext(paths, mcpManager);
  registerAllIpcHandlers(ctx);

  // Auto-connect enabled MCP servers in the background
  mcpManager.connectAllEnabled().catch((err) => {
    log.warn("MCP auto-connect failed", { error: String(err) });
  });

  // Allow renderer to request changing the root directory
  ipcMain.handle("app:change-root-dir", async () => {
    const newPaths = await changeRootDir(mainWindow);
    if (!newPaths) return null;
    // Update runtime context paths
    ctx.runtime.myClawRootPath = newPaths.myClawDir;
    ctx.runtime.skillsRootPath = newPaths.skillsDir;
    ctx.runtime.sessionsRootPath = newPaths.sessionsDir;
    ctx.runtime.paths = newPaths;

    // Persist settings.json in the new directory
    await saveSettings(newPaths, {
      defaultModelProfileId: ctx.state.getDefaultModelProfileId(),
      approvalPolicy: ctx.state.getApprovals(),
    });

    return {
      myClawRootPath: newPaths.myClawDir,
      skillsRootPath: newPaths.skillsDir,
      sessionsRootPath: newPaths.sessionsDir,
    };
  });

  // 注册窗口控制 IPC 处理器（最小化、最大化/还原、关闭、最大化状态查询）
  ipcMain.on("window:minimize", () => {
    log.info("用户请求最小化窗口");
    mainWindow?.minimize();
  });
  ipcMain.on("window:maximize", () => {
    if (mainWindow?.isMaximized()) {
      log.info("用户请求还原窗口");
      mainWindow.unmaximize();
    } else {
      log.info("用户请求最大化窗口");
      mainWindow?.maximize();
    }
  });
  ipcMain.on("window:close", () => {
    log.info("用户请求关闭窗口");
    mainWindow?.close();
  });
  ipcMain.handle("window:is-maximized", () => {
    return mainWindow?.isMaximized() ?? false;
  });

  // Create the main window
  mainWindow = createMainWindow();

  // 窗口最大化状态变化时通知渲染进程
  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window:maximized-changed", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window:maximized-changed", false);
  });

  // macOS: re-create the window when the dock icon is clicked
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

// Quit the app when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Ensure the app fully quits when asked, waiting for pending saves
let isQuitting = false;

app.on("before-quit", (event) => {
  if (pendingSaves.size > 0 && !isQuitting) {
    event.preventDefault();
    isQuitting = true;
    log.info(`[shutdown] Waiting for ${pendingSaves.size} pending save(s)...`);
    Promise.allSettled([...pendingSaves]).then(() => {
      app.quit();
    });
    return;
  }
  mainWindow = null;
});
