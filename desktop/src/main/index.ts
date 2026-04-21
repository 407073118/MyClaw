import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// 防止 EPIPE 错误导致应用崩溃。
// 开发模式下 stdout/stderr 管道可能被父进程关闭（如终端退出），
// 此时 console.log/console.info 会抛 EPIPE，不应终止整个应用。
// ---------------------------------------------------------------------------
for (const stream of [process.stdout, process.stderr]) {
  stream?.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") return;
    throw err;
  });
}

import type {
  ApprovalRequest,
  ChatSession,
  ModelProfile,
  PersonalPromptProfile,
  ResolvedMcpTool,
  SkillDefinition,
  SiliconPerson,
  WorkflowDefinition,
  WorkflowSummary,
} from "@shared/contracts";

import { createRuntimeContext } from "./services/runtime-context";
import type { RuntimeContext } from "./services/runtime-context";
import { ArtifactManager } from "./services/artifact-manager";
import { ArtifactRegistry } from "./services/artifact-registry";
import { listBuiltinToolDefinitions } from "./services/builtin-tool-stubs";
import { initializeDirectories, redirectUserData } from "./services/directory-service";
import { initLogger, createLogger } from "./services/logger";
import { loadSkillsFromDisk, seedBuiltinSkills } from "./services/skill-loader";
import { createAppUpdaterService } from "./services/app-updater";
import { resolveAppUpdaterConfig } from "./services/update-config";
import { AsrClient } from "./services/asr-client";
import { DirectAsrProvider } from "./services/meeting-intelligence-provider";
import { MeetingRecorder } from "./services/meeting-recorder";
import { callModel } from "./services/model-client";
import { createTimeApplicationService } from "./services/time-application-service";
import { createTimeJobExecutor } from "./services/time-job-executor";
import { createTimeNotificationService } from "./services/time-notification-service";
import { createTimeScheduler } from "./services/time-scheduler";
import { TimeOrchestrationStore } from "./services/time-orchestration-store";

const log = createLogger("main");

import { trackSave, waitForPendingSaves, getPendingSavesCount } from "./services/pending-saves";
export { trackSave };

import type { MyClawPaths } from "./services/directory-service";
import { getSessionDatabase, loadPersistedState } from "./services/state-persistence";
import { syncSessionBackgroundTaskSnapshot } from "./services/session-background-task";
import { registerAllIpcHandlers } from "./ipc";
import { McpServerManager } from "./services/mcp-server-manager";
import { invokeRegisteredSessionSendMessage, shutdownToolExecutor } from "./ipc/sessions";
import { invokeRegisteredWorkflowStartRun } from "./ipc/workflows";
import { ensureSiliconPersonCurrentSession } from "./services/silicon-person-session";
import { shutdownAllWorkspaces } from "./services/silicon-person-workspace";

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
let runtimeContext: RuntimeContext | null = null;

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
// 运行时上下文启动（先用启动时加载出的状态初始化）
// ---------------------------------------------------------------------------

async function buildRuntimeContext(
  paths: MyClawPaths,
  mcpManager: McpServerManager,
  appUpdater: ReturnType<typeof createAppUpdaterService>,
) {
  // 从磁盘加载所有已持久化状态
  const persisted = await loadPersistedState(paths);

  // 清理上次异常退出时遗留的运行态（running/canceling → idle），
  // 避免 UI 显示"正在响应"但实际无活跃进程的死锁状态。
  for (const session of persisted.sessions) {
    if (session.chatRunState
      && (session.chatRunState.status === "running" || session.chatRunState.status === "canceling")) {
      console.info("[startup] 清理遗留运行态", {
        sessionId: session.id,
        staleStatus: session.chatRunState.status,
      });
      session.chatRunState = {
        ...session.chatRunState,
        status: "failed",
        lastReason: "process_exit_cleanup",
      };
    }

    syncSessionBackgroundTaskSnapshot(paths, session);
    if (session.backgroundTask) {
      console.info("[startup] 已恢复会话后台任务快照", {
        sessionId: session.id,
        responseId: session.backgroundTask.providerResponseId,
        status: session.backgroundTask.status,
      });
    }
  }

  // 基于磁盘数据构建可变的内存镜像
  const sessions: ChatSession[] = persisted.sessions;
  const models: ModelProfile[] = persisted.models;
  const siliconPersons: SiliconPerson[] = persisted.siliconPersons;
  const workflows: WorkflowSummary[] = persisted.workflows;
  const workflowRuns = persisted.workflowRuns;
  const workflowDefinitions: Record<string, WorkflowDefinition> = persisted.workflowDefinitions;
  const skills: SkillDefinition[] = [];
  let approvalRequests: ApprovalRequest[] = [];
  let defaultModelProfileId: string | null = persisted.defaultModelProfileId;
  const approvalPolicy = persisted.approvalPolicy;
  let personalPromptProfile: PersonalPromptProfile = persisted.personalPrompt;
  let asrConfig = persisted.asrConfig;
  const artifactRegistry = new ArtifactRegistry(getSessionDatabase());
  const artifactManager = new ArtifactManager(paths, artifactRegistry);
  const timeStore = await TimeOrchestrationStore.create(paths);
  const timeApplication = createTimeApplicationService({ store: timeStore });
  const timeNotificationService = createTimeNotificationService();
  let runtimeCtxRef: RuntimeContext | null = null;
  const timeJobExecutor = createTimeJobExecutor({
    startWorkflowRun: async ({ workflowId, siliconPersonId }) => {
      if (siliconPersonId) {
        if (!runtimeCtxRef) {
          throw new Error("runtime context is unavailable");
        }
        const { session } = await ensureSiliconPersonCurrentSession(runtimeCtxRef, {
          siliconPersonId,
        });
        await invokeRegisteredWorkflowStartRun({
          workflowId,
          initialState: {
            siliconPersonId,
            sessionId: session.id,
          },
        });
        return;
      }
      await invokeRegisteredWorkflowStartRun({ workflowId });
    },
    sendSiliconPersonMessage: async ({ siliconPersonId, content }) => {
      if (!runtimeCtxRef) {
        throw new Error("runtime context is unavailable");
      }
      const { session } = await ensureSiliconPersonCurrentSession(runtimeCtxRef, {
        siliconPersonId,
      });
      await invokeRegisteredSessionSendMessage(session.id, {
        content,
      });
    },
  });
  const timeScheduler = createTimeScheduler({
    listDueReminders: async (at) => timeStore.listDueReminders(at),
    listDueJobs: async (at) => timeStore.listDueScheduleJobs(at),
    notifyReminder: async (reminder, policy) => {
      return timeNotificationService.deliverReminder(reminder, policy);
    },
    markReminderDelivered: async (id, deliveredAt) => {
      await timeStore.markReminderDelivered(id, deliveredAt);
    },
    recordExecutionRun: async (run) => {
      await timeStore.recordExecutionRun(run);
    },
    getAvailabilityPolicy: async () => timeStore.getAvailabilityPolicy(),
    saveScheduleJob: async (job) => {
      await timeStore.upsertScheduleJob(job);
    },
    runScheduleJob: async (job) => {
      await timeJobExecutor.execute(job);
    },
  });

  // 会议录音：AsrClient + DirectAsrProvider + MeetingRecorder
  const asrClient = new AsrClient();
  const meetingProvider = new DirectAsrProvider(asrClient);
  const meetingRecorder = new MeetingRecorder(
    meetingProvider,
    paths,
    () => asrConfig,
    async (transcriptText: string) => {
      // 选择模型：优先 asrConfig.summaryModelProfileId，回退默认模型
      const targetId = asrConfig.summaryModelProfileId ?? defaultModelProfileId;
      const profile = models.find((m) => m.id === targetId) ?? models[0];
      if (!profile) {
        throw new Error("未配置任何模型，无法生成会议纪要");
      }
      const result = await callModel({
        profile,
        messages: [
          { role: "system", content: MeetingRecorder.SUMMARY_SYSTEM_PROMPT },
          { role: "user", content: transcriptText },
        ],
      });
      return result.content;
    },
  );

  const ctx = createRuntimeContext({
    runtime: {
      myClawRootPath: paths.myClawDir,
      skillsRootPath: paths.skillsDir,
      workspaceRootPath: paths.workspaceDir,
      artifactsRootPath: paths.artifactsDir,
      cacheRootPath: paths.cacheDir,
      sessionsRootPath: paths.sessionsDir,
      paths,
    },
    state: {
      models,
      sessions,
      siliconPersons,
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
      getAsrConfig: () => asrConfig,
      setAsrConfig: (next) => {
        asrConfig = next;
      },
    },
    services: {
      artifactRegistry,
      artifactManager,
      refreshSkills: async () => {
        const loaded = loadSkillsFromDisk(paths.skillsDir);
        // 保持内存中的 skills 数组同步，确保 skill:detail 查询可用。
        skills.splice(0, skills.length, ...loaded);
        return loaded;
      },
      listMcpServers: () => mcpManager.listServers(),
      mcpManager,
      appUpdater,
      meetingRecorder,
      timeApplication,
      timeJobExecutor,
      timeNotificationService,
      timeScheduler,
      timeStore,
    },
    tools: {
      resolveBuiltinTools: () => {
        try {
          return listBuiltinToolDefinitions();
        } catch {
          return [];
        }
      },
      resolveMcpTools: (): ResolvedMcpTool[] => {
        const rawTools = mcpManager.getAllTools();
        // 读取用户偏好设置，与原始工具列表合并
        const prefsPath = join(paths.myClawDir, "mcp-tool-preferences.json");
        let prefs: Record<string, { enabled?: boolean; exposedToModel?: boolean; approvalModeOverride?: unknown }> = {};
        try {
          if (existsSync(prefsPath)) {
            prefs = JSON.parse(readFileSync(prefsPath, "utf8"));
          }
        } catch { /* ignore */ }
        return rawTools.map((tool) => {
          const pref = prefs[tool.id];
          return {
            ...tool,
            enabled: pref?.enabled ?? true,
            exposedToModel: pref?.exposedToModel ?? true,
            effectiveApprovalMode: (pref?.approvalModeOverride as string) ?? "inherit",
          } as ResolvedMcpTool;
        });
      },
    },
  });
  runtimeCtxRef = ctx;
  return ctx;
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
  const updaterLog = createLogger("app-updater");
  const appUpdater = createAppUpdaterService({
    packaged: app.isPackaged,
    currentVersion: app.getVersion(),
    config: resolveAppUpdaterConfig(),
    logger: updaterLog,
  });

  // 初始化运行时上下文并注册所有 IPC 处理器
  const ctx = await buildRuntimeContext(paths, mcpManager, appUpdater);
  runtimeContext = ctx;
  registerAllIpcHandlers(ctx);
  ctx.services.timeScheduler?.start();

  // 在后台自动连接所有启用中的 MCP 服务，将 Promise 存入 ctx 以便 bootstrap 等待
  ctx.services.mcpReady = mcpManager.connectAllEnabled().catch((err) => {
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
  appUpdater.subscribe((snapshot) => {
    mainWindow?.webContents.send("update:state-changed", snapshot);
  });

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
  // 关闭所有硅基员工工作空间的 MCP 连接
  shutdownAllWorkspaces().catch(() => {});
  runtimeContext?.services.timeScheduler?.stop();
  runtimeContext?.services.timeStore?.close();

  const pendingCount = getPendingSavesCount();
  if (pendingCount > 0 && !isQuitting) {
    event.preventDefault();
    isQuitting = true;
    log.info(`[shutdown] Waiting for ${pendingCount} pending save(s)...`);
    waitForPendingSaves().then(() => {
      app.quit();
    });
    return;
  }
  mainWindow = null;
  runtimeContext = null;
});
