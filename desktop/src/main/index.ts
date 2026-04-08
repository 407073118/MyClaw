import { app, BrowserWindow, ipcMain, shell } from "electron";
import { dirname, join, resolve } from "node:path";
import { existsSync, readdirSync, readFileSync, mkdirSync, cpSync, statSync } from "node:fs";

import type {
  ApprovalRequest,
  ChatSession,
  LocalEmployeeSummary,
  ModelProfile,
  PersonalPromptProfile,
  SkillDefinition,
  WorkflowDefinition,
  WorkflowSummary,
} from "@shared/contracts";

import { createRuntimeContext } from "./services/runtime-context";
import { listBuiltinToolDefinitions } from "./services/builtin-tool-stubs";
import { initializeDirectories, redirectUserData } from "./services/directory-service";
import { initLogger, createLogger } from "./services/logger";

const log = createLogger("main");

/** 记录待完成的保存操作，便于优雅退出。 */
const pendingSaves = new Set<Promise<unknown>>();

export function trackSave(promise: Promise<unknown>): void {
  pendingSaves.add(promise);
  promise.finally(() => pendingSaves.delete(promise));
}

import type { MyClawPaths } from "./services/directory-service";
import { loadPersistedState } from "./services/state-persistence";
import { registerAllIpcHandlers } from "./ipc";
import { McpServerManager } from "./services/mcp-server-manager";
import { shutdownToolExecutor } from "./ipc/sessions";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const IS_DEV = process.env.NODE_ENV === "development";
const RENDERER_DEV_URL = "http://localhost:1420";
const RENDERER_PROD_FILE = join(__dirname, "../../renderer/index.html");

// 必须在 app.whenReady() 之前把 Electron userData 重定向到便携目录
redirectUserData();

// ---------------------------------------------------------------------------
// 窗口管理
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

  // 等窗口 ready 后再显示，避免出现白屏闪烁
  win.once("ready-to-show", () => {
    win.show();
  });

  // 外部链接统一交给系统浏览器打开
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
// 内置技能种子器：首次启动时将内置示例复制到用户 skills 目录
// ---------------------------------------------------------------------------

/**
 * 递归复制整个目录树。
 * 可兼容 asar 归档（cpSync 在 Electron 中未必完全可用）。
 */
function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const st = statSync(srcPath);
    if (st.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      const content = readFileSync(srcPath);
      const { writeFileSync: wfs } = require("node:fs") as typeof import("node:fs");
      wfs(destPath, content);
    }
  }
}

function seedBuiltinSkills(skillsDir: string): void {
  // 打包后 builtin-skills 位于 app.asar 根目录
  const candidates = [
    join(app.getAppPath(), "builtin-skills"),           // works for both dev and packed
    join(__dirname, "../../builtin-skills"),             // dev: dist/src/main → builtin-skills
    join(__dirname, "../../../builtin-skills"),           // packed fallback
  ];

  let builtinDir: string | null = null;
  for (const c of candidates) {
    if (existsSync(c)) { builtinDir = c; break; }
  }
  if (!builtinDir) {
    log.warn("No builtin-skills directory found", { candidates });
    return;
  }
  log.info(`Found builtin-skills at: ${builtinDir}`);

  try {
    const entries = readdirSync(builtinDir);
    for (const entry of entries) {
      const src = join(builtinDir, entry);
      const dest = join(skillsDir, entry);
      // 仅当用户目录中不存在时才复制，避免覆盖用户修改
      if (!existsSync(dest)) {
        copyDirRecursive(src, dest);
        log.info(`Seeded builtin skill: ${entry}`);
      }
    }
  } catch (err) {
    log.warn("Failed to seed builtin skills", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// 技能加载器
// ---------------------------------------------------------------------------

/**
 * 扫描 `skillsDir` 中的技能定义。
 *
 * 支持两种磁盘格式：
 *
 * 1. JSON manifest：即 `<name>.json` 文件，内容符合
 *    `SkillDefinition` 结构，这是 newApp 使用的轻量格式。
 *
 * 2. SKILL.md 目录：即包含 `SKILL.md` 文件的子目录，
 *    与 desktop 应用安装的技能兼容。系统会自动推导出最小
 *    `SkillDefinition`，信息来源于目录名以及
 *    markdown 正文中第一条非标题文本。
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

    // --- 形式 1：JSON manifest 文件 ---
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

    // --- 形式 2：SKILL.md 目录 ---
    // 当前条目必须是一个包含 SKILL.md 的目录。
    const skillMdPath = join(fullPath, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      continue;
    }

    try {
      const markdown = readFileSync(skillMdPath, "utf-8");
      const { name, description, workspaceDir } = extractSkillMeta(entry, markdown);

      // 识别标准子目录约定。
      let subEntries: string[] = [];
      try { subEntries = readdirSync(fullPath); } catch { /* ignore */ }
      const subDirs = new Set(subEntries.map((e) => e.toLowerCase()));

      const skillId = `skill-${name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")}`;

      // 扫描技能根目录中的所有 .html 视图文件
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
 * 从 SKILL.md 中提取 `name` 与 `description`。
 * 如果存在 `---` 包裹的 YAML 风格 frontmatter，则优先读取；
 * 否则回退到目录名以及正文中第一条非标题文本。
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
      // 如果 frontmatter 中没有 description，则改为从正文提取。
      if (!description) {
        const bodyLines = lines.slice(closingIdx + 1);
        description = bodyLines.find((l) => l.trim() && !l.trim().startsWith("#"))?.trim() ?? "";
      }
      return { name, description, workspaceDir };
    }
  }

  // 如果没有 frontmatter，就从正文第一条非标题文本中提取描述。
  description = lines.find((l) => l.trim() && !l.trim().startsWith("#"))?.trim() ?? "";
  return { name, description, workspaceDir };
}

// ---------------------------------------------------------------------------
// 运行时上下文启动（先用启动时加载出的状态初始化）
// ---------------------------------------------------------------------------

function buildRuntimeContext(paths: MyClawPaths, mcpManager: McpServerManager) {
  // 从磁盘加载所有已持久化状态
  const persisted = loadPersistedState(paths);

  // 基于磁盘数据构建可变的内存镜像
  const sessions: ChatSession[] = persisted.sessions;
  const models: ModelProfile[] = persisted.models;
  const employees: LocalEmployeeSummary[] = persisted.employees;
  const workflows: WorkflowSummary[] = persisted.workflows;
  const workflowRuns = persisted.workflowRuns;
  const workflowDefinitions: Record<string, WorkflowDefinition> = persisted.workflowDefinitions;
  const skills: SkillDefinition[] = [];
  let approvalRequests: ApprovalRequest[] = [];
  let defaultModelProfileId: string | null = persisted.defaultModelProfileId;
  const approvalPolicy = persisted.approvalPolicy;
  let personalPromptProfile: PersonalPromptProfile = persisted.personalPrompt;

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
      workflowRuns,
      activeWorkflowRuns: new Map(),
      activeSessionRuns: new Map(),
      skills,
      workflowDefinitions,
      getDefaultModelProfileId: () => {
        // 如果已存储的默认模型仍然有效，则直接返回
        if (defaultModelProfileId && models.some((m) => m.id === defaultModelProfileId)) {
          return defaultModelProfileId;
        }
        // 否则回退到第一个模型
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
      getPersonalPromptProfile: () => personalPromptProfile,
      setPersonalPromptProfile: (profile) => {
        personalPromptProfile = profile;
      },
    },
    services: {
      refreshSkills: async () => {
        const loaded = loadSkillsFromDisk(paths.skillsDir);
        // 保持内存中的 skills 数组同步，确保 skill:detail 查询可用。
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
// 应用生命周期
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  // 初始化数据目录（便携模式下位于可执行文件旁边）
  const paths = await initializeDirectories();

  // 初始化结构化日志
  initLogger(paths.myClawDir);

  // 初始化内置示例技能（仅在目标不存在时复制）
  seedBuiltinSkills(paths.skillsDir);

  // 初始化 MCP 服务管理器
  const mcpManager = new McpServerManager(paths.myClawDir);

  // 初始化运行时上下文并注册所有 IPC 处理器
  const ctx = buildRuntimeContext(paths, mcpManager);
  registerAllIpcHandlers(ctx);

  // 在后台自动连接所有启用中的 MCP 服务
  mcpManager.connectAllEnabled().catch((err) => {
    log.warn("MCP auto-connect failed", { error: String(err) });
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

  // 创建主窗口
  mainWindow = createMainWindow();

  // 窗口最大化状态变化时通知渲染进程
  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window:maximized-changed", true);
  });
  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window:maximized-changed", false);
  });

  // macOS：点击 Dock 图标时重新创建窗口
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

// 当所有窗口关闭时退出应用（macOS 除外）
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// 确保应用在退出前等待待完成保存任务结束
let isQuitting = false;

app.on("before-quit", (event) => {
  // 关闭浏览器进程（如果存在），避免遗留孤儿 Chrome 进程
  shutdownToolExecutor().catch(() => {});

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
