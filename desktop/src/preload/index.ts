import { contextBridge, ipcRenderer, webFrame } from "electron";

// 将整体界面缩放到 85%，让布局密度更接近 Codex 或 Claude Node Desktop 这类 IDE 风格应用
webFrame.setZoomFactor(0.85);

import type {
  ApprovalDecision,
  ApprovalPolicy,
  ArtifactRecord,
  ArtifactScopeRef,
  AsrConfig,
  AuthLoginRequest,
  AvailabilityPolicy,
  CalendarEvent,
  ExecutionRun,
  MeetingEvent,
  MeetingRecord,
  ModelCatalogItem,
  McpServerConfig,
  ModelProfile,
  PersonalPromptProfile,
  Reminder,
  ScheduleJob,
  SuggestedTimebox,
  StructuredTranscript,
  TaskCommitment,
  TodayBrief,
  WorkflowDefinition,
} from "@shared/contracts";

// ---------------------------------------------------------------------------
// 流式事件监听辅助方法
// ---------------------------------------------------------------------------

type UnsubscribeFn = () => void;

function onChannel<T>(channel: string, callback: (payload: T) => void): UnsubscribeFn {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// ---------------------------------------------------------------------------
// 暴露给渲染进程的 API 接口
//
// 方法名必须与渲染层 workspace/auth store 通过 window.myClawAPI
// 调用的名称保持一致，并与 electron.d.ts 中的声明同步。
// ---------------------------------------------------------------------------

const myClawAPI = {
  // ---- 平台信息 ------------------------------------------------------------
  platform: process.platform as NodeJS.Platform,

  // ---- 窗口控制 API（自定义标题栏使用） ------------------------------------
  windowControls: {
    /** 最小化窗口 */
    minimize: () => ipcRenderer.send("window:minimize"),
    /** 最大化或还原窗口 */
    maximize: () => ipcRenderer.send("window:maximize"),
    /** 关闭窗口 */
    close: () => ipcRenderer.send("window:close"),
    /** 查询当前是否为最大化状态 */
    isMaximized: () => ipcRenderer.invoke("window:is-maximized") as Promise<boolean>,
    /** 监听最大化状态变化 */
    onMaximizedChanged: (callback: (isMaximized: boolean) => void): UnsubscribeFn =>
      onChannel("window:maximized-changed", callback),
  },

  // ---- 启动初始化 ----------------------------------------------------------
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  getAppUpdateState: () => ipcRenderer.invoke("update:get-state"),
  checkForAppUpdates: () => ipcRenderer.invoke("update:check"),
  downloadAppUpdate: () => ipcRenderer.invoke("update:download"),
  quitAndInstallAppUpdate: () => ipcRenderer.invoke("update:quit-and-install"),
  openAppUpdateDownloadPage: () => ipcRenderer.invoke("update:open-download-page"),
  onAppUpdateStateChanged: (callback: (payload: Record<string, unknown>) => void): UnsubscribeFn =>
    onChannel("update:state-changed", callback),

  // ---- 时间编排 ------------------------------------------------------------
  time: {
    listCalendarEvents: () =>
      ipcRenderer.invoke("time:list-calendar-events") as Promise<{ items: CalendarEvent[] }>,
    createCalendarEvent: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("time:create-calendar-event", input) as Promise<{ item: CalendarEvent }>,
    updateCalendarEvent: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("time:update-calendar-event", input) as Promise<{ item: CalendarEvent }>,
    listTaskCommitments: () =>
      ipcRenderer.invoke("time:list-task-commitments") as Promise<{ items: TaskCommitment[] }>,
    createTaskCommitment: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("time:create-task-commitment", input) as Promise<{ item: TaskCommitment }>,
    updateTaskCommitment: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("time:update-task-commitment", input) as Promise<{ item: TaskCommitment }>,
    listReminders: () =>
      ipcRenderer.invoke("time:list-reminders") as Promise<{ items: Reminder[] }>,
    createReminder: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("time:create-reminder", input) as Promise<{ item: Reminder }>,
    updateReminder: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("time:update-reminder", input) as Promise<{ item: Reminder }>,
    deleteReminder: (id: string) =>
      ipcRenderer.invoke("time:delete-reminder", id) as Promise<{ ok: boolean }>,
    listScheduleJobs: () =>
      ipcRenderer.invoke("time:list-schedule-jobs") as Promise<{ items: ScheduleJob[] }>,
    createScheduleJob: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("time:create-schedule-job", input) as Promise<{ item: ScheduleJob }>,
    updateScheduleJob: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("time:update-schedule-job", input) as Promise<{ item: ScheduleJob }>,
    deleteScheduleJob: (id: string) =>
      ipcRenderer.invoke("time:delete-schedule-job", id) as Promise<{ ok: boolean }>,
    getAvailabilityPolicy: () =>
      ipcRenderer.invoke("time:get-availability-policy") as Promise<{ policy: AvailabilityPolicy | null }>,
    saveAvailabilityPolicy: (policy: AvailabilityPolicy) =>
      ipcRenderer.invoke("time:save-availability-policy", policy) as Promise<{ policy: AvailabilityPolicy }>,
    getTodayBrief: () =>
      ipcRenderer.invoke("time:get-today-brief") as Promise<{ brief: TodayBrief }>,
    suggestTimeboxes: () =>
      ipcRenderer.invoke("time:suggest-timeboxes") as Promise<{ items: SuggestedTimebox[] }>,
    listExecutionRuns: () =>
      ipcRenderer.invoke("time:list-execution-runs") as Promise<{ items: ExecutionRun[] }>,
    generateTodayDigest: (input: Record<string, unknown>) =>
      ipcRenderer.invoke("time:generate-today-digest", input) as Promise<{ lines: string[] }>,
  },

  // ---- 认证 ----------------------------------------------------------------
  auth: {
    login: (payload: AuthLoginRequest) =>
      ipcRenderer.invoke("cloud:auth-login", payload),

    logout: (refreshToken: string) => ipcRenderer.invoke("cloud:auth-logout", refreshToken),

    refresh: (refreshToken: string) => ipcRenderer.invoke("cloud:auth-refresh", refreshToken),

    introspect: (accessToken: string) =>
      ipcRenderer.invoke("cloud:auth-introspect", accessToken),
  },

  // ---- 会话 ----------------------------------------------------------------
  createSession: (data?: { title?: string; modelProfileId?: string; attachedDirectory?: string | null }) =>
    ipcRenderer.invoke("session:create", data ?? {}),

  deleteSession: (id: string) => ipcRenderer.invoke("session:delete", id),

  sendMessage: (
    sessionId: string,
    content: string,
  ) => ipcRenderer.invoke("session:send-message", sessionId, { content }),

  cancelSessionRun: (
    sessionId: string,
    input?: { runId?: string; messageId?: string; reason?: string },
  ) => ipcRenderer.invoke("session:cancel-run", sessionId, input ?? {}),

  pollBackgroundTask: (sessionId: string) =>
    ipcRenderer.invoke("session:poll-background-task", sessionId),

  cancelBackgroundTask: (sessionId: string) =>
    ipcRenderer.invoke("session:cancel-background-task", sessionId),

  requestExecutionIntent: (sessionId: string, intent: unknown) =>
    ipcRenderer.invoke("session:get-execution-intents", sessionId),

  updateSessionRuntimeIntent: (sessionId: string, intent: Record<string, unknown>) =>
    ipcRenderer.invoke("session:update-runtime-intent", sessionId, intent),

  approvePlan: (sessionId: string) =>
    ipcRenderer.invoke("session:approve-plan", sessionId),

  revisePlan: (sessionId: string, feedback: string) =>
    ipcRenderer.invoke("session:revise-plan", sessionId, { feedback }),

  cancelPlanMode: (sessionId: string) =>
    ipcRenderer.invoke("session:cancel-plan-mode", sessionId),

  // ---- 宸ヤ綔鏂囦欢 ------------------------------------------------------------
  listArtifactsByScope: (scope: ArtifactScopeRef) =>
    ipcRenderer.invoke("artifact:list-by-scope", scope) as Promise<ArtifactRecord[]>,

  listRecentArtifacts: (input?: { limit?: number }) =>
    ipcRenderer.invoke("artifact:list-recent", input ?? {}) as Promise<ArtifactRecord[]>,

  markArtifactFinal: (artifactId: string, scope?: ArtifactScopeRef) =>
    ipcRenderer.invoke("artifact:mark-final", artifactId, scope ?? null) as Promise<ArtifactRecord>,

  openArtifact: (artifactId: string) =>
    ipcRenderer.invoke("artifact:open", artifactId) as Promise<{ success: boolean }>,

  revealArtifact: (artifactId: string) =>
    ipcRenderer.invoke("artifact:reveal", artifactId) as Promise<{ success: boolean }>,

  /** 订阅会话流式事件，例如消息增量、工具调用等 */
  onSessionStream: (callback: (event: Record<string, unknown>) => void): UnsubscribeFn =>
    onChannel("session:stream", callback),

  // ---- 模型 ----------------------------------------------------------------
  listModels: () => ipcRenderer.invoke("model:list"),

  createModelProfile: (data: Omit<ModelProfile, "id">) =>
    ipcRenderer.invoke("model:create", data).then((profile: ModelProfile) => ({ profile })),

  updateModelProfile: (id: string, updates: Partial<Omit<ModelProfile, "id">>) =>
    ipcRenderer.invoke("model:update", id, updates).then((profile: ModelProfile) => ({ profile })),

  deleteModelProfile: (profileId: string) =>
    ipcRenderer.invoke("model:delete", profileId).then((result: any) => ({
      models: result?.models ?? [],
      defaultModelProfileId: result?.defaultModelProfileId ?? null,
      sessions: result?.sessions ?? [],
    })),

  setDefaultModelProfile: (id: string) => ipcRenderer.invoke("model:set-default", id),

  testModelProfile: (id: string) => ipcRenderer.invoke("model:test", id),

  testModelByConfig: (
    input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">,
  ): Promise<{ success: boolean; ok: boolean; latencyMs?: number; error?: string }> =>
    ipcRenderer.invoke("model:test-by-config", input),

  probeModelRoutesByConfig: (
    input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">,
  ) => ipcRenderer.invoke("model:probe-routes-by-config", input),

  fetchModelCatalog: (
    input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">,
  ) =>
    ipcRenderer.invoke("model:catalog-by-config", input)
      .then((result: { modelIds: Array<ModelCatalogItem | string> }) => ({
        modelIds: (result.modelIds ?? [])
          .map((item) => (typeof item === "string" ? null : item))
          .filter((item): item is ModelCatalogItem => item !== null),
      }))
      .catch(() => ({ modelIds: [] as ModelCatalogItem[] })),

  fetchAvailableModelIds: (
    input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">,
  ) => {
    // 创建一个临时配置来复用 model:catalog
    // 这里原本需要一个模型 ID 才能查询，可以先临时创建再删除，
    // 也可以直接调用 model:catalog-by-config。
    return myClawAPI.fetchModelCatalog(input)
      .then((result: { modelIds: Array<{ id: string }> }) => ({
        modelIds: (result.modelIds ?? []).map((m: { id: string } | string) =>
          typeof m === "string" ? m : m.id
        ),
      }))
      .catch(() => ({ modelIds: [] as string[] }));
  },

  // ---- 内置工具 ------------------------------------------------------------
  listBuiltinTools: () => ipcRenderer.invoke("tool:list-builtin"),

  fetchBuiltinTools: () =>
    ipcRenderer.invoke("tool:list-builtin").then((items: unknown[]) => ({ items })),

  updateBuiltinToolPreference: (
    toolId: string,
    input: { enabled: boolean; exposedToModel: boolean; approvalModeOverride: unknown },
  ) => ipcRenderer.invoke("tool:update-builtin-pref", toolId, input)
    .then((tool: unknown) => ({ tool }))
    .catch(() => ({ tool: { id: toolId, ...input } })),

  // ---- MCP 工具 ------------------------------------------------------------
  fetchMcpTools: () =>
    ipcRenderer.invoke("tool:list-mcp").then((items: unknown[]) => ({ items })).catch(() => ({ items: [] })),

  updateMcpToolPreference: (
    toolId: string,
    input: { enabled: boolean; exposedToModel: boolean; approvalModeOverride: unknown },
  ) => ipcRenderer.invoke("tool:update-mcp-pref", toolId, input)
    .then((tool: unknown) => ({ tool }))
    .catch(() => ({ tool: { id: toolId, ...input } })),

  executeBuiltinTool: (input: {
    toolId: string;
    label: string;
    sessionId?: string;
    attachedDirectory?: string | null;
  }) => ipcRenderer.invoke("tool:execute-builtin", input),

  executeMcpTool: (input: {
    serverId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    sessionId?: string;
  }) => ipcRenderer.invoke("tool:execute-mcp", input),

  // ---- MCP 服务 ------------------------------------------------------------
  fetchMcpServers: () =>
    ipcRenderer.invoke("mcp:list-servers").then((servers: unknown[]) => ({ servers })),

  createMcpServer: async (input: McpServerConfig) => {
    const server = await ipcRenderer.invoke("mcp:create-server", input);
    const servers = await ipcRenderer.invoke("mcp:list-servers");
    return { server, servers };
  },

  updateMcpServer: async (id: string, updates: Partial<Omit<McpServerConfig, "id">>) => {
    const server = await ipcRenderer.invoke("mcp:update-server", id, updates);
    const servers = await ipcRenderer.invoke("mcp:list-servers");
    return { server, servers };
  },

  deleteMcpServer: async (id: string) => {
    await ipcRenderer.invoke("mcp:delete-server", id);
    const servers = await ipcRenderer.invoke("mcp:list-servers");
    return { servers };
  },

  refreshMcpServer: async (id: string) => {
    const server = await ipcRenderer.invoke("mcp:refresh-server", id);
    const servers = await ipcRenderer.invoke("mcp:list-servers");
    return { server, servers };
  },

  discoverExternalMcpServers: () =>
    ipcRenderer.invoke("mcp:discover-external"),

  importMcpServers: (servers: unknown[]) =>
    ipcRenderer.invoke("mcp:import-servers", servers),

  // ---- 审批 ----------------------------------------------------------------
  getApprovalPolicy: () => ipcRenderer.invoke("approval:get-policy"),

  resolveApproval: (approvalId: string, decision: ApprovalDecision) => {
    // 传递完整决定到后端，由后端处理 always-allow-tool / allow-session 语义
    return ipcRenderer.invoke("session:resolve-approval", approvalId, decision);
  },

  updateApprovalPolicy: (input: Partial<ApprovalPolicy>) =>
    ipcRenderer.invoke("approval:set-policy", input).then((result: unknown) => ({ approvals: result })),

  // ---- 个人长期 Prompt ----------------------------------------------------
  getPersonalPrompt: () =>
    ipcRenderer.invoke("personal-prompt:get") as Promise<PersonalPromptProfile>,

  updatePersonalPrompt: (input: { prompt: string }) =>
    ipcRenderer.invoke("personal-prompt:set", input) as Promise<PersonalPromptProfile>,

  /** 订阅主进程推送的审批完成事件 */
  onApprovalResolved: (callback: (event: Record<string, unknown>) => void): UnsubscribeFn =>
    onChannel("approval:resolved", callback),

  // ---- 工作流 --------------------------------------------------------------
  fetchWorkflows: () =>
    ipcRenderer.invoke("workflow:list").then((items: unknown[]) => ({ items })),

  getWorkflow: (workflowId: string) =>
    ipcRenderer.invoke("workflow:get", workflowId)
      .then((workflow: unknown) => ({ workflow }))
      .catch(() => ({ workflow: null })),

  createWorkflow: (input: { name: string; description?: string }) =>
    ipcRenderer.invoke("workflow:create", input).catch(() => ({ workflow: null, items: [] })),

  updateWorkflow: (workflowId: string, updates: Partial<WorkflowDefinition>) =>
    ipcRenderer.invoke("workflow:update", workflowId, updates).catch(() => ({ workflow: null, items: [] })),

  fetchWorkflowRuns: () =>
    ipcRenderer.invoke("workflow:list-runs")
      .then((items: unknown[]) => ({ items }))
      .catch(() => ({ items: [] })),

  startWorkflowRun: (input: { workflowId: string; initialState?: Record<string, unknown> }) =>
    ipcRenderer.invoke("workflow:start-run", input).catch(() => ({ runId: null })),

  resumeWorkflowRun: (runId: string, resumeValue?: unknown) =>
    ipcRenderer.invoke("workflow:interrupt-resume", { runId, resumeValue }).catch(() => ({ success: false })),

  deleteWorkflow: (workflowId: string) =>
    ipcRenderer.invoke("workflow:delete", workflowId).catch(() => ({ success: false })),

  cancelWorkflowRun: (runId: string) =>
    ipcRenderer.invoke("workflow:cancel-run", runId).catch(() => ({ success: false })),

  getWorkflowRunDetail: (runId: string) =>
    ipcRenderer.invoke("workflow:get-run-detail", runId).catch(() => null),

  /** 订阅工作流引擎流式事件 */
  onWorkflowStream: (callback: (event: unknown) => void): UnsubscribeFn => {
    const handler = (_: unknown, event: unknown) => callback(event);
    ipcRenderer.on("workflow:stream", handler as any);
    return () => ipcRenderer.removeListener("workflow:stream", handler as any);
  },

  // ---- 云端 / Hub ----------------------------------------------------------
  fetchCloudHubItems: (type?: string) =>
    ipcRenderer.invoke("cloud:hub-items", { kind: type }),

  fetchCloudHubDetail: (itemId: string) => ipcRenderer.invoke("cloud:hub-detail", itemId),

  fetchCloudHubManifest: (releaseId: string) => ipcRenderer.invoke("cloud:hub-manifest", releaseId),

  fetchCloudHubDownloadToken: (releaseId: string) =>
    ipcRenderer.invoke("cloud:hub-download-token", releaseId),

  // ---- 云端技能 ------------------------------------------------------------
  fetchCloudSkills: (query?: Record<string, unknown>) =>
    ipcRenderer.invoke("cloud:skills", query),

  fetchCloudSkillDetail: (skillId: string) => ipcRenderer.invoke("cloud:skill-detail", skillId),

  // ---- 云端导入 ------------------------------------------------------------
  importCloudSkill: (input: { releaseId: string; skillName: string }) =>
    ipcRenderer.invoke("cloud:import-skill", input),

  importCloudMcp: (input: { releaseId?: string; servers?: McpServerConfig[]; manifest?: unknown }) =>
    ipcRenderer.invoke("cloud:import-mcp", input),

  importSiliconPersonPackage: (input: Record<string, unknown>) =>
    ipcRenderer.invoke("cloud:import-silicon-person-package", input),

  installWorkflowPackageFromCloud: (input: Record<string, unknown>) =>
    ipcRenderer.invoke("cloud:import-workflow-package", input),

  // ---- 员工 ----------------------------------------------------------------
  listSiliconPersons: () =>
    ipcRenderer.invoke("silicon-person:list")
      .then((items: unknown[]) => ({ items }))
      .catch(() => ({ items: [] })),

  getSiliconPerson: (siliconPersonId: string) =>
    ipcRenderer.invoke("silicon-person:get", siliconPersonId)
      .then((siliconPerson: unknown) => ({ siliconPerson }))
      .catch(() => ({ siliconPerson: null })),

  createSiliconPerson: (input: Record<string, unknown>) =>
    ipcRenderer.invoke("silicon-person:create", input).catch(() => ({ items: [], siliconPerson: null })),

  updateSiliconPerson: (siliconPersonId: string, input: Record<string, unknown>) =>
    ipcRenderer.invoke("silicon-person:update", siliconPersonId, input).catch(() => ({ siliconPerson: null })),

  deleteSiliconPerson: (siliconPersonId: string) =>
    ipcRenderer.invoke("silicon-person:delete", siliconPersonId).catch(() => ({ items: [] })),

  createSiliconPersonSession: (siliconPersonId: string, input?: { title?: string }) =>
    ipcRenderer.invoke("silicon-person:create-session", siliconPersonId, input ?? {}).catch(() => ({ siliconPerson: null, session: null })),

  switchSiliconPersonSession: (siliconPersonId: string, sessionId: string) =>
    ipcRenderer.invoke("silicon-person:switch-session", siliconPersonId, sessionId).catch(() => ({ siliconPerson: null, session: null })),

  /** fire-and-forget：入队后立即返回，后台按队列串行执行，结果通过 stream 事件推送。 */
  sendSiliconPersonMessage: (siliconPersonId: string, content: string) =>
    ipcRenderer.invoke("silicon-person:send-message", siliconPersonId, { content }).catch(() => ({ dispatched: false, siliconPersonId })),

  /** 标记硅基员工会话为已读，只回写当前会话的未读状态，不改变 currentSession。 */
  markSiliconPersonSessionRead: (siliconPersonId: string, sessionId: string) =>
    ipcRenderer.invoke("silicon-person:mark-session-read", siliconPersonId, sessionId).catch(() => ({ siliconPerson: null, session: null })),

  startSiliconPersonWorkflowRun: (siliconPersonId: string, workflowId: string) =>
    ipcRenderer.invoke("silicon-person:start-workflow-run", siliconPersonId, workflowId).catch(() => ({ siliconPerson: null, session: null, runId: null })),

  /** 获取硅基员工工作空间路径信息。 */
  getSiliconPersonPaths: (siliconPersonId: string) =>
    ipcRenderer.invoke("silicon-person:get-paths", siliconPersonId).catch(() => ({ personDir: "", skillsDir: "", sessionsDir: "" })),

  /** 获取硅基员工独立工作空间的技能列表。 */
  listSiliconPersonSkills: (siliconPersonId: string) =>
    ipcRenderer.invoke("silicon-person:list-skills", siliconPersonId).catch(() => ({ items: [] })),

  /** 刷新硅基员工独立工作空间的技能列表。 */
  refreshSiliconPersonSkills: (siliconPersonId: string) =>
    ipcRenderer.invoke("silicon-person:refresh-skills", siliconPersonId).catch(() => ({ items: [] })),

  /** 获取硅基员工独立工作空间的 MCP 服务列表。 */
  listSiliconPersonMcpServers: (siliconPersonId: string) =>
    ipcRenderer.invoke("silicon-person:list-mcp-servers", siliconPersonId).catch(() => ({ servers: [] })),

  // ---- 技能 ----------------------------------------------------------------
  fetchSkillDetail: (skillId: string) =>
    ipcRenderer.invoke("skill:detail", skillId)
      .catch(() => ({ skill: null })),

  /** 重新扫描磁盘上的 Skills 目录，返回最新列表。 */
  refreshSkills: () =>
    ipcRenderer.invoke("skills:refresh")
      .catch(() => ({ items: [] })),

  /** 在系统文件管理器中打开 Skills 根目录。 */
  openSkillsFolder: () =>
    ipcRenderer.invoke("skills:open-folder")
      .catch(() => {}),

  // ---- 发布草稿 ------------------------------------------------------------
  createPublishDraft: (input: Record<string, unknown>) =>
    ipcRenderer.invoke("publish:create-draft", input).catch(() => null),

  // ---- Web 面板 ------------------------------------------------------------
  webPanelResolvePage: (skillId: string, relativePath: string): Promise<string | null> =>
    ipcRenderer.invoke("web-panel:resolve-page", skillId, relativePath),

  onWebPanelOpen: (callback: (payload: { viewPath: string; title: string; data: unknown }) => void): UnsubscribeFn =>
    onChannel("web-panel:open", callback),

  // ---- 技能文件 ------------------------------------------------------------
  skillReadTree: (skillId: string) => ipcRenderer.invoke("skill:read-tree", skillId),
  skillReadFile: (skillId: string, relativePath: string) => ipcRenderer.invoke("skill:read-file", skillId, relativePath),

  // ---- 会议录音 ------------------------------------------------------------
  meetings: {
    start: (title?: string) =>
      ipcRenderer.invoke("meeting:start", title) as Promise<{ meetingId: string }>,
    stop: () =>
      ipcRenderer.invoke("meeting:stop") as Promise<{ meetingId: string | null }>,
    cancel: () =>
      ipcRenderer.invoke("meeting:cancel") as Promise<{ ok: boolean }>,
    list: () =>
      ipcRenderer.invoke("meeting:list") as Promise<{ items: MeetingRecord[] }>,
    get: (meetingId: string) =>
      ipcRenderer.invoke("meeting:get", meetingId) as Promise<{
        meeting: MeetingRecord | null;
        transcript: StructuredTranscript | null;
        summary: string | null;
      }>,
    buildFollowUps: (meetingId: string) =>
      ipcRenderer.invoke("meeting:build-follow-ups", meetingId) as Promise<{
        commitments: TaskCommitment[];
        reminders: Reminder[];
        suggestedEvents: CalendarEvent[];
      }>,
    delete: (meetingId: string) =>
      ipcRenderer.invoke("meeting:delete", meetingId) as Promise<{ ok: boolean }>,
    updateSpeaker: (meetingId: string, speakerIndex: number, label: string) =>
      ipcRenderer.invoke("meeting:update-speaker", meetingId, speakerIndex, label) as Promise<{ ok: boolean }>,
    updateTitle: (meetingId: string, title: string) =>
      ipcRenderer.invoke("meeting:update-title", meetingId, title) as Promise<{ ok: boolean }>,
    readAudio: (meetingId: string) =>
      ipcRenderer.invoke("meeting:read-audio", meetingId) as Promise<{ buffer: ArrayBuffer | null }>,
    /** 高频音频数据推送 — fire-and-forget */
    sendAudioChunk: (chunk: ArrayBuffer) => {
      ipcRenderer.send("meeting:audio-chunk", chunk);
    },
    /** 订阅录音事件（实时转写、状态变更） */
    onEvent: (callback: (event: MeetingEvent) => void): UnsubscribeFn =>
      onChannel("meeting:event", callback),
  },

  // ---- ASR 配置 ------------------------------------------------------------
  getAsrConfig: () =>
    ipcRenderer.invoke("asr:get-config") as Promise<{ config: AsrConfig }>,

  saveAsrConfig: (config: AsrConfig) =>
    ipcRenderer.invoke("asr:save-config", config) as Promise<{ config: AsrConfig }>,
} as const;

contextBridge.exposeInMainWorld("myClawAPI", myClawAPI);

// ---------------------------------------------------------------------------
// TypeScript 类型声明：渲染进程可通过 window.myClawAPI 使用
// ---------------------------------------------------------------------------

export type MyClawAPI = typeof myClawAPI;
