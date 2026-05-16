import { app, BrowserWindow, ipcMain, protocol, session, shell } from "electron";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

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
  ResolvedBuiltinTool,
  ResolvedMcpTool,
  ScheduleJobSessionMode,
  SkillDefinition,
  SiliconPerson,
  WorkflowDefinition,
  WorkflowSummary,
} from "@shared/contracts";
import { SESSION_RUNTIME_VERSION, textOfContent } from "@shared/contracts";

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
import { MemoryVaultService } from "./services/memory-vault/service";
import { canonicalize, PathAccessPolicy } from "./services/path-access-policy";
import { resolveAppIconPath } from "./services/app-icon-path";
import { createAwarenessStore } from "./services/awareness-store";
import { createAwarenessSignalCollector } from "./services/awareness-signal-collector";
import { createAwarenessDecisionEngine } from "./services/awareness-decision-engine";
import { createStandingOrderService } from "./services/standing-order-service";
import { createLongRunLedger } from "./services/long-run-ledger";
import { createAwarenessRuntime } from "./services/awareness-runtime";
import { createAwarenessSourceAdapter, type AwarenessSourceSnapshot } from "./services/awareness-source-adapter";

const log = createLogger("main");

type ToolPreferenceSnapshot = Record<string, {
  enabled?: boolean;
  exposedToModel?: boolean;
  approvalModeOverride?: unknown;
}>;

/** 读取工具中心偏好文件，供列表展示与模型暴露快照共用。 */
function loadToolPreferenceSnapshot(prefsPath: string): ToolPreferenceSnapshot {
  try {
    if (existsSync(prefsPath)) {
      return JSON.parse(readFileSync(prefsPath, "utf8")) as ToolPreferenceSnapshot;
    }
  } catch (error) {
    console.warn("[main] 读取工具偏好失败，将使用默认工具配置", { prefsPath, error: String(error) });
  }
  return {};
}

/** 合并内置工具默认定义与用户偏好，保证工具中心状态可被运行时读取。 */
function resolveBuiltinToolsWithPreferences(prefsPath: string): ResolvedBuiltinTool[] {
  const prefs = loadToolPreferenceSnapshot(prefsPath);
  return listBuiltinToolDefinitions().map((tool) => {
    const pref = prefs[tool.id];
    return {
      ...tool,
      enabled: pref?.enabled ?? tool.enabled,
      exposedToModel: pref?.exposedToModel ?? tool.exposedToModel,
      effectiveApprovalMode: (pref?.approvalModeOverride as ResolvedBuiltinTool["effectiveApprovalMode"] | undefined) ?? tool.effectiveApprovalMode,
    };
  });
}

import { trackSave, waitForPendingSaves, getPendingSavesCount } from "./services/pending-saves";
export { trackSave };

import type { MyClawPaths } from "./services/directory-service";
import { getSessionDatabase, loadPersistedState, saveSession } from "./services/state-persistence";
import { syncSessionBackgroundTaskSnapshot } from "./services/session-background-task";
import { registerAllIpcHandlers } from "./ipc";
import { McpServerManager } from "./services/mcp-server-manager";
import { invokeRegisteredSessionSendMessage, shutdownToolExecutor } from "./ipc/sessions";
import { invokeRegisteredWorkflowStartRun } from "./ipc/workflows";
import { ensureSiliconPersonCurrentSession } from "./services/silicon-person-session";
import { shutdownAllWorkspaces } from "./services/silicon-person-workspace";
import { PANEL_PARTITION, PanelViewManager } from "./services/panel-view-manager";

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const IS_DEV = process.env.NODE_ENV === "development";
const RENDERER_DEV_URL = "http://localhost:1420";
const RENDERER_PROD_FILE = join(__dirname, "../../renderer/index.html");

protocol.registerSchemesAsPrivileged([
  { scheme: "myclaw-skill", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: "myclaw-viewer", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: "myclaw-file", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: "myclaw-vendor", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// 必须在 app.whenReady() 之前把 Electron userData 重定向到便携目录
redirectUserData();

// ---------------------------------------------------------------------------
// 窗口管理
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;
let runtimeContext: RuntimeContext | null = null;
let panelViewManager: PanelViewManager | null = null;

/** 注册右侧面板使用的自定义协议，覆盖默认会话和独立面板会话。 */
function registerPanelProtocolHandlers(manager: PanelViewManager): void {
  const handler = (request: Request) =>
    manager.handleProtocolRequest(request.url);
  protocol.handle("myclaw-skill", handler);
  protocol.handle("myclaw-viewer", handler);
  protocol.handle("myclaw-file", handler);
  protocol.handle("myclaw-vendor", handler);

  const panelProtocol = session.fromPartition(PANEL_PARTITION).protocol;
  panelProtocol.handle("myclaw-skill", handler);
  panelProtocol.handle("myclaw-viewer", handler);
  panelProtocol.handle("myclaw-file", handler);
  panelProtocol.handle("myclaw-vendor", handler);
}

function createMainWindow(): BrowserWindow {
  // 根据平台选择标题栏模式：macOS 用 hiddenInset，Windows 用 hidden + titleBarOverlay
  const isMac = process.platform === "darwin";
  const iconPath = resolveAppIconPath({ mainDir: __dirname });
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

/**
 * 首次启动时自动创建默认值守 Routine，让心跳系统"装上就用"。
 * 如果已有任何 routine 则跳过（用户可能手动删除过默认值）。
 */
async function seedDefaultAwarenessRoutines(
  store: ReturnType<typeof import("./services/awareness-store").createAwarenessStore>,
): Promise<void> {
  const existing = await store.listRoutines();
  if (existing.length > 0) return;

  console.info("[awareness] 首次启动，自动创建默认值守 Routine");

  await store.createRoutine({
    name: "个人巡检",
    scope: { kind: "personal" },
    purpose: "自动监控员工任务失败、定时任务异常、工作流卡住、审批等待过久等系统状态",
    cadenceMinutes: 30,
    signalSources: [
      "agent_task",
      "schedule_job",
      "workflow_run",
      "background_task",
      "session_stuck",
      "approval_pending",
      "system_health",
    ],
  });

  await store.createRoutine({
    name: "员工值守",
    scope: { kind: "silicon_person" },
    purpose: "监控所有硅基员工的执行状态、异常和等待用户处理的事项",
    cadenceMinutes: 60,
    signalSources: [
      "agent_task",
      "system_health",
    ],
  });
}

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
  const migrationResult = await timeStore.migrateAssistantPromptSessionMode();
  log.info("assistant_prompt sessionMode migrated", migrationResult);
  const memoryVault = await MemoryVaultService.create({
    indexBaseDir: join(paths.cacheDir, "memory-index"),
    // 记忆库根目录复用 PathAccessPolicy 校验，managed 需要写权限，reference 只需要读权限。
    authorizeRoot: async (rootPath, mode) => {
      const canonicalPath = await canonicalize(rootPath);
      const policy = new PathAccessPolicy(
        paths.workspaceDir,
        approvalPolicy.pathGrants ?? { allowedDirs: [], deniedPaths: [] },
        null,
      );
      policy.setTurnUserReferencedPaths([canonicalPath]);
      const decision = policy.checkSyncOnly(canonicalPath, mode === "managed" ? "write" : "read");
      console.info("[memory-vault] 记忆库根目录权限校验完成", {
        canonicalPath,
        mode,
        granted: decision.granted,
        tier: decision.tier,
        reason: decision.reason,
      });
      if (!decision.granted) {
        throw new Error(`Memory root path is not allowed: ${decision.reason}`);
      }
    },
  });
  const timeApplication = createTimeApplicationService({ store: timeStore });
  const timeNotificationService = createTimeNotificationService({
    onDelivered: (payload) => {
      console.info("[time-notification] 广播提醒到渲染进程", {
        id: payload.id,
        title: payload.title,
      });
      mainWindow?.webContents.send("time:reminder-delivered", payload);
    },
  });
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
    runAssistantPrompt: async ({ job, prompt }) => {
      // 双态分支：sessionMode=shared 走重构前的「单一长期累积 session」路径；
      // sessionMode=per_run（默认）每次到点触发都新建独立 session，token 干净，
      // ExecutionRun.sessionId 直接指向本次产出的会话，详情页可逐次展开消息流。
      const profileId = job.modelProfileId
        ?? defaultModelProfileId
        ?? models[0]?.id
        ?? "";
      if (!profileId) {
        throw new Error("未配置任何模型，assistant_prompt 计划任务无法执行");
      }
      const sessionMode: ScheduleJobSessionMode = job.sessionMode ?? "per_run";
      const now = new Date().toISOString();

      // ---- shared 路径：尽量复用 job.sessionId（与重构前完全一致的行为）----
      if (sessionMode === "shared") {
        let session: ChatSession | null = job.sessionId
          ? sessions.find((item) => item.id === job.sessionId) ?? null
          : null;
        if (!session) {
          session = {
            id: randomUUID(),
            title: `[定时] ${job.title}`,
            modelProfileId: profileId,
            attachedDirectory: null,
            createdAt: now,
            runtimeVersion: SESSION_RUNTIME_VERSION,
            associatedScheduleJobId: job.id,
            messages: [],
          };
          if (job.reasoningEffort || job.reasoningEnabled !== undefined) {
            session.runtimeIntent = {
              ...(job.reasoningEffort ? { reasoningEffort: job.reasoningEffort } : {}),
              ...(job.reasoningEnabled !== undefined ? { reasoningEnabled: job.reasoningEnabled } : {}),
            };
          }
          sessions.push(session);
          await saveSession(paths, session);
          // 把新 session id 回写到 job（保持原行为），并固化 sessionMode=shared
          await timeStore.upsertScheduleJob({
            id: job.id,
            title: job.title,
            description: job.description,
            scheduleKind: job.scheduleKind,
            timezone: job.timezone,
            ownerScope: job.ownerScope,
            ownerId: job.ownerId,
            status: job.status,
            source: job.source,
            externalRef: job.externalRef,
            startsAt: job.startsAt,
            intervalMinutes: job.intervalMinutes,
            cronExpression: job.cronExpression,
            executor: job.executor,
            executorTargetId: job.executorTargetId,
            sessionId: session.id,
            sessionMode: "shared",
            modelProfileId: job.modelProfileId,
            reasoningEffort: job.reasoningEffort,
            reasoningEnabled: job.reasoningEnabled,
            lastRunAt: job.lastRunAt,
            nextRunAt: job.nextRunAt,
          });
        }
        const sendResult = await invokeRegisteredSessionSendMessage(session.id, {
          content: prompt,
        });
        const lastAssistant = [...sendResult.session.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        const outputSummary = lastAssistant ? textOfContent(lastAssistant.content) : "";
        return { outputSummary, sessionId: session.id };
      }

      // ---- per_run 路径：每次到点触发都新建独立 session，不回写 job.sessionId ----
      const triggerStamp = new Intl.DateTimeFormat("zh-CN", {
        timeZone: job.timezone,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(now));
      const session: ChatSession = {
        id: randomUUID(),
        title: `[定时] ${job.title} · ${triggerStamp}`,
        modelProfileId: profileId,
        attachedDirectory: null,
        createdAt: now,
        runtimeVersion: SESSION_RUNTIME_VERSION,
        associatedScheduleJobId: job.id,
        messages: [],
      };
      if (job.reasoningEffort || job.reasoningEnabled !== undefined) {
        session.runtimeIntent = {
          ...(job.reasoningEffort ? { reasoningEffort: job.reasoningEffort } : {}),
          ...(job.reasoningEnabled !== undefined ? { reasoningEnabled: job.reasoningEnabled } : {}),
        };
      }
      sessions.push(session);
      await saveSession(paths, session);
      const sendResult = await invokeRegisteredSessionSendMessage(session.id, {
        content: prompt,
      });
      const lastAssistant = [...sendResult.session.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      const outputSummary = lastAssistant ? textOfContent(lastAssistant.content) : "";
      return { outputSummary, sessionId: session.id };
    },
  });

  // ─── 心跳感知服务 ───
  const awarenessDb = (timeStore as any).database;
  const awarenessStore = createAwarenessStore({
    db: awarenessDb,
    getAvailabilityPolicy: () => timeStore.getAvailabilityPolicy(),
  });
  const awarenessSourceAdapter = createAwarenessSourceAdapter({
    timeStore,
    getSessions: () => sessions,
    getWorkflowRuns: () => workflowRuns,
    getApprovalRequests: () => approvalRequests,
    getSiliconPersons: () => siliconPersons,
    getActiveSessionRuns: () => runtimeCtxRef?.state.activeSessionRuns ?? new Map(),
  });
  let latestAwarenessSourceSnapshot: AwarenessSourceSnapshot | null = null;
  const awarenessSignalCollector = createAwarenessSignalCollector({
    getActiveSessionRuns: () => {
      // 优先使用 tick 前统一采集的快照，避免同一轮值守读取到前后不一致的运行态。
      return latestAwarenessSourceSnapshot?.activeSessionRuns ?? runtimeCtxRef?.state.activeSessionRuns ?? new Map();
    },
    getAgentTasks: () => {
      try { return (require("./ipc/agent-tasks") as any).getCachedAgentTasks() ?? []; }
      catch { return []; }
    },
    getScheduleJobs: () => (latestAwarenessSourceSnapshot?.scheduleJobs ?? []).map((job) => {
      const latestRun = latestAwarenessSourceSnapshot?.latestExecutionRunsByScheduleJobId.get(job.id);
      return latestRun ? { ...job, executionRuns: [latestRun] } : job;
    }),
    getWorkflowRuns: () => {
      return (latestAwarenessSourceSnapshot?.workflowRuns ?? []).map((run) => ({
        id: run.id,
        status: run.status,
        workflowId: run.workflowId,
        interruptRequested: run.status === "waiting-input",
      }));
    },
    getBackgroundTasks: () => {
      return (latestAwarenessSourceSnapshot?.sessions ?? sessions).filter((s) => s.backgroundTask).map((s) => ({
        sessionId: s.id,
        backgroundTask: s.backgroundTask ? { status: s.backgroundTask.status } : undefined,
      }));
    },
    getApprovalRequests: () => latestAwarenessSourceSnapshot?.approvalRequests ?? approvalRequests,
    getSiliconPersons: () => latestAwarenessSourceSnapshot?.siliconPersons ?? siliconPersons,
    getAvailabilityPolicy: () => approvalPolicy,
  });
  const standingOrderService = createStandingOrderService(awarenessDb);
  const longRunLedger = createLongRunLedger(awarenessDb);
  const awarenessDecisionEngine = createAwarenessDecisionEngine({
    callModel: async (prompt: string) => {
      const profile = models.find((m) => m.id === defaultModelProfileId) ?? models[0];
      if (!profile) return "";
      const result = await callModel({
        profile,
        messages: [{ role: "user", content: prompt }],
      });
      return result.content;
    },
    getModelCallsToday: (routineId) => awarenessRuntime?.getModelCallsToday(routineId) ?? 0,
    incrementModelCalls: (routineId) => awarenessRuntime?.incrementModelCalls(routineId),
  });
  let awarenessRuntime: ReturnType<typeof createAwarenessRuntime> | undefined;
  awarenessRuntime = createAwarenessRuntime({
    store: awarenessStore,
    signalCollector: awarenessSignalCollector,
    decisionEngine: awarenessDecisionEngine,
    standingOrderService,
    ledger: longRunLedger,
    getAvailabilityPolicy: () => timeStore.getAvailabilityPolicy(),
    broadcastEvent: (type, payload) => {
      const { BrowserWindow: BW } = require("electron") as { BrowserWindow: typeof Electron.BrowserWindow };
      for (const win of BW.getAllWindows()) {
        win.webContents.send("session:stream", {
          id: `awareness-${Date.now()}`,
          type,
          createdAt: new Date().toISOString(),
          payload,
        });
      }
    },
  });

  // 将 awarenessTick 注入 timeScheduler（通过闭包引用）
  const schedulerWithAwareness = createTimeScheduler({
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
      return await timeJobExecutor.execute(job);
    },
    awarenessTick: async () => {
      latestAwarenessSourceSnapshot = await awarenessSourceAdapter.snapshot();
      await awarenessRuntime.tick();
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
      timeStore,
      memoryVault,
      awarenessRuntime,
      awarenessStore,
      awarenessSignalCollector,
      standingOrderService,
      longRunLedger,
      timeScheduler: schedulerWithAwareness,
    },
    tools: {
      resolveBuiltinTools: () => {
        try {
          return resolveBuiltinToolsWithPreferences(join(paths.myClawDir, "tool-preferences.json"));
        } catch (error) {
          console.warn("[main] 解析内置工具列表失败，将返回空列表", { error: String(error) });
          return [];
        }
      },
      resolveMcpTools: (): ResolvedMcpTool[] => {
        const rawTools = mcpManager.getAllTools();
        // 读取用户偏好设置，与原始工具列表合并
        const prefsPath = join(paths.myClawDir, "mcp-tool-preferences.json");
        const prefs = loadToolPreferenceSnapshot(prefsPath);
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

  // 首次启动自动创建默认值守 Routine，确保"装上就用"
  seedDefaultAwarenessRoutines(awarenessStore).catch((error) => {
    console.warn("[main] seedDefaultAwarenessRoutines 失败", { error: error instanceof Error ? error.message : String(error) });
  });

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
  panelViewManager = new PanelViewManager({
    getMainWindow: () => mainWindow,
    runtimeContext: ctx,
    panelPreloadPath: join(__dirname, "../preload/panel-preload.js"),
  });
  registerPanelProtocolHandlers(panelViewManager);
  registerAllIpcHandlers(ctx, panelViewManager);

  // 注入员工任务状态变更钩子，同步感知账本
  const { setAgentTaskStatusChangedHook } = require("./ipc/agent-tasks") as { setAgentTaskStatusChangedHook: (hook: (task: any) => void) => void };
  const ledgerService = ctx.services.longRunLedger;
  if (ledgerService) {
    setAgentTaskStatusChangedHook((task: { id: string; status: string }) => {
      if (task.status === "failed" || task.status === "succeeded" || task.status === "waiting_user") {
        const record = ledgerService.createRecord("agent_task", task.id, { kind: "personal" });
        record.status = task.status === "succeeded" ? "succeeded" : task.status === "failed" ? "failed" : "waiting_user";
        record.startedAt = new Date().toISOString();
        ledgerService.upsertRecord(record).catch(() => {});
      }
    });
  }

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
  if (!runtimeContext) return;

  // 阻止立即退出，等所有清理完成后再真正退出
  event.preventDefault();

  if (isQuitting) return;
  isQuitting = true;

  // 关闭浏览器进程（如果存在），避免遗留孤儿 Chrome 进程
  shutdownToolExecutor().catch((err) => {
    log.warn("[shutdown] 关闭工具执行器失败", { error: err instanceof Error ? err.message : String(err) });
  });
  // 关闭所有硅基员工工作空间的 MCP 连接
  shutdownAllWorkspaces().catch((err) => {
    log.warn("[shutdown] 关闭硅基员工工作空间失败", { error: err instanceof Error ? err.message : String(err) });
  });

  // 先停调度器（同步），不再触发新任务
  runtimeContext.services.timeScheduler?.stop();

  // 等待所有 pending saves 完成后再关闭数据库，防止写入被截断
  const pendingCount = getPendingSavesCount();
  const waitForSaves = pendingCount > 0
    ? (log.info(`[shutdown] Waiting for ${pendingCount} pending save(s)...`), waitForPendingSaves())
    : Promise.resolve();

  waitForSaves.then(() => {
    panelViewManager?.close();
    runtimeContext?.services.timeStore?.close();
    runtimeContext?.services.memoryVault?.close();
    mainWindow = null;
    panelViewManager = null;
    runtimeContext = null;
    app.quit();
  }).catch((err) => {
    log.warn("[shutdown] 等待 pending saves 失败，强制关闭", { error: err instanceof Error ? err.message : String(err) });
    panelViewManager?.close();
    runtimeContext?.services.timeStore?.close();
    runtimeContext?.services.memoryVault?.close();
    mainWindow = null;
    panelViewManager = null;
    runtimeContext = null;
    app.quit();
  });
});
