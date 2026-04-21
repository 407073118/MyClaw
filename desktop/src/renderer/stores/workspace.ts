import { create } from "zustand";

import type {
  AvailabilityPolicy,
  ArtifactRecord,
  ArtifactScopeRef,
  ApprovalDecision,
  ApprovalMode,
  ApprovalPolicy,
  ApprovalRequest,
  BackgroundTaskHandle,
  BuiltinToolApprovalMode,
  CalendarEvent,
  ChatSession,
  ExecutionRun,
  McpServer,
  McpServerConfig,
  ModelCatalogItem,
  ModelProfile,
  ModelRouteProbeResult,
  PersonalPromptProfile,
  Reminder,
  ResolvedBuiltinTool,
  ResolvedMcpTool,
  ScheduleJob,
  SkillDefinition,
  SiliconPerson,
  SuggestedTimebox,
  TaskCommitment,
  TodayBrief,
  WorkflowDefinitionSummary,
} from "../../../shared/contracts";
import type { BrMiniMaxRuntimeDiagnostics } from "../../../shared/br-minimax";

// ---------------------------------------------------------------------------
// Cloud Hub types (mirror of desktop cloud-hub-client)
// ---------------------------------------------------------------------------

export type CloudHubItemType = "skill" | "employee-package" | "workflow-package" | "mcp";

export type CloudHubItem = {
  id: string;
  type: CloudHubItemType;
  name: string;
  summary: string;
  publisher: string;
  tags: string[];
  latestReleaseId: string | null;
  downloads: number;
  updatedAt: string;
};

export type CloudHubItemDetail = CloudHubItem & {
  description: string;
  releases: Array<{
    id: string;
    version: string;
    changelog: string;
    publishedAt: string;
  }>;
};

export type CloudHubManifest = {
  kind: CloudHubItemType;
  name: string;
  description: string;
  version: string;
  [key: string]: unknown;
};

export type CloudDownloadToken = {
  downloadUrl: string;
  expiresAt: string;
};

export type CloudSkillCategory = "productivity" | "development" | "data" | "communication" | "other";

export type CloudSkillSummary = {
  id: string;
  name: string;
  summary: string;
  category: CloudSkillCategory;
  tags: string[];
  downloads: number;
  latestReleaseId: string | null;
  updatedAt: string;
};

export type CloudSkillDetail = CloudSkillSummary & {
  description: string;
  releases: Array<{
    id: string;
    version: string;
    changelog: string;
    publishedAt: string;
  }>;
};

export type AppUpdateState = {
  enabled: boolean;
  stage: "disabled" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "no-update" | "error";
  currentVersion: string;
  latestVersion: string | null;
  progressPercent: number | null;
  message: string;
  feedLabel: string | null;
  downloadPageUrl: string | null;
};

type CancelSessionRunInput = {
  runId?: string;
  messageId?: string;
  reason?: string;
};

type BackgroundTaskSnapshot = {
  sessionId: string;
  outcomeId: string;
  task: BackgroundTaskHandle | null;
  status: string;
  outputText: string;
};

type ArtifactScopeMap = Record<string, ArtifactRecord[]>;

export type WorkspaceTimeState = {
  calendarEvents: CalendarEvent[];
  taskCommitments: TaskCommitment[];
  reminders: Reminder[];
  scheduleJobs: ScheduleJob[];
  executionRuns: ExecutionRun[];
  availabilityPolicy: AvailabilityPolicy | null;
  todayBrief: TodayBrief | null;
};

function createEmptyTimeState(): WorkspaceTimeState {
  return {
    calendarEvents: [],
    taskCommitments: [],
    reminders: [],
    scheduleJobs: [],
    executionRuns: [],
    availabilityPolicy: null,
    todayBrief: null,
  };
}

function sortTimeItemsByField<T extends { id: string }>(
  items: T[],
  field: keyof T,
): T[] {
  return [...items].sort((left, right) =>
    String(left[field] ?? "9999-12-31T23:59:59.999Z").localeCompare(
      String(right[field] ?? "9999-12-31T23:59:59.999Z"),
    ),
  );
}

function replaceTimeItem<T extends { id: string }>(items: T[], item: T, field: keyof T): T[] {
  return sortTimeItemsByField(
    [...items.filter((candidate) => candidate.id !== item.id), item],
    field,
  );
}

// ---------------------------------------------------------------------------
// Workspace state shape
// ---------------------------------------------------------------------------

type WorkspaceState = {
  ready: boolean;
  loading: boolean;
  error: string | null;
  myClawRootPath: string | null;
  skillsRootPath: string | null;
  sessionsRootPath: string | null;
  workspaceRootPath: string | null;
  artifactsRootPath: string | null;
  cacheRootPath: string | null;
  requiresInitialSetup: boolean;
  defaultModelProfileId: string | null;
  activeSessionId: string | null;
  sessions: ChatSession[];
  models: ModelProfile[];
  builtinTools: ResolvedBuiltinTool[];
  mcpTools: ResolvedMcpTool[];
  mcpServers: McpServer[];
  skills: SkillDefinition[];
  skillDetails: Record<string, unknown>;
  siliconPersons: SiliconPerson[];
  /** 当前被选中的硅基员工聊天对象 ID；为空时表示主聊天对象。 */
  activeSiliconPersonId: string | null;
  workflows: WorkflowDefinitionSummary[];
  workflowSummaries: Record<string, WorkflowDefinitionSummary>;
  workflowDefinitions: Record<string, unknown>;
  workflowRuns: Record<string, unknown>;
  cloudHubItems: CloudHubItem[];
  cloudHubDetail: CloudHubItemDetail | null;
  cloudHubManifest: CloudHubManifest | null;
  cloudSkills: CloudSkillSummary[];
  cloudSkillDetail: CloudSkillDetail | null;
  approvals: ApprovalPolicy | null;
  approvalRequests: ApprovalRequest[];
  personalPrompt: PersonalPromptProfile;
  appUpdate: AppUpdateState | null;
  time: WorkspaceTimeState;
  /** 切换默认模型后的通知标记，提示用户新建对话。 */
  modelSwitchNotice: { fromName: string; toName: string } | null;

  // WebPanel
  webPanel: {
    isOpen: boolean;
    viewPath: string | null;
    title: string;
    data: unknown;
    panelWidth: number;
  };

  // Derived (recalculated after set())
  currentSession: ChatSession | null;
  backgroundTaskSnapshot: BackgroundTaskSnapshot | null;
  artifactsByScope: ArtifactScopeMap;
  recentArtifacts: ArtifactRecord[];

  // 动作
  loadBootstrap: () => Promise<void>;
  selectSession: (sessionId: string) => void;
  createSession: () => Promise<ChatSession>;
  deleteSession: (sessionId: string) => Promise<unknown>;
  sendMessage: (content: string) => Promise<void>;
  cancelSessionRun: (input?: CancelSessionRunInput) => Promise<void>;
  pollBackgroundTask: () => Promise<BackgroundTaskSnapshot | null>;
  cancelBackgroundTask: () => Promise<BackgroundTaskSnapshot | null>;
  updateSessionRuntimeIntent: (intent: Record<string, unknown>) => Promise<void>;
  approvePlan: () => Promise<void>;
  revisePlan: (feedback: string) => Promise<void>;
  cancelPlanMode: () => Promise<void>;
  loadArtifactsByScope: (scope: ArtifactScopeRef) => Promise<ArtifactRecord[]>;
  loadRecentArtifacts: (input?: { limit?: number }) => Promise<ArtifactRecord[]>;
  markArtifactFinal: (artifactId: string, scope?: ArtifactScopeRef) => Promise<ArtifactRecord>;
  openArtifact: (artifactId: string) => Promise<void>;
  revealArtifact: (artifactId: string) => Promise<void>;
  applyArtifactEvent: (event: Record<string, unknown>) => void;

  createModelProfile: (input: Omit<ModelProfile, "id">) => Promise<ModelProfile>;
  updateModelProfile: (profileId: string, input: Omit<ModelProfile, "id">) => Promise<ModelProfile>;
  deleteModelProfile: (profileId: string) => Promise<unknown>;
  setDefaultModelProfile: (profileId: string) => Promise<void>;
  dismissModelSwitchNotice: () => void;
  /** Called from SetupPage after creating the first model — updates store so AppShell stops redirecting */
  addModelAndClearSetup: (profile: ModelProfile) => void;

  loadMcpServers: () => Promise<McpServer[]>;
  fetchMcpServers: () => Promise<McpServer[]>;
  createMcpServer: (input: McpServerConfig) => Promise<McpServer>;
  updateMcpServer: (serverId: string, input: McpServerConfig) => Promise<McpServer>;
  deleteMcpServer: (serverId: string) => Promise<unknown>;
  refreshMcpServer: (serverId: string) => Promise<McpServer>;

  loadCloudHubItems: (type?: "all" | CloudHubItemType) => Promise<CloudHubItem[]>;
  loadCloudHubDetail: (itemId: string) => Promise<CloudHubItemDetail>;
  loadCloudHubManifest: (releaseId: string) => Promise<CloudHubManifest>;

  loadCloudSkills: (query?: {
    category?: CloudSkillCategory;
    keyword?: string;
    sort?: "latest" | "downloads" | "name";
    tag?: string;
  }) => Promise<CloudSkillSummary[]>;
  loadCloudSkillDetail: (skillId: string) => Promise<CloudSkillDetail>;
  clearCloudSkillDetail: () => void;
  clearCloudHubDetail: () => void;

  addApprovalRequest: (request: ApprovalRequest) => void;
  removeApprovalRequest: (approvalId: string) => void;
  resolveApproval: (approvalId: string, decision: ApprovalDecision) => Promise<unknown>;
  updateApprovalPolicy: (input: {
    mode: ApprovalMode;
    autoApproveReadOnly: boolean;
    autoApproveSkills: boolean;
  }) => Promise<ApprovalPolicy>;
  loadPersonalPrompt: () => Promise<PersonalPromptProfile>;
  updatePersonalPrompt: (prompt: string) => Promise<PersonalPromptProfile>;
  checkForAppUpdates: () => Promise<AppUpdateState>;
  downloadAppUpdate: () => Promise<AppUpdateState>;
  quitAndInstallAppUpdate: () => Promise<{ accepted: boolean }>;
  openAppUpdateDownloadPage: () => Promise<{ opened: boolean }>;
  createCalendarEvent: (input: Record<string, unknown>) => Promise<CalendarEvent>;
  updateCalendarEvent: (input: Record<string, unknown>) => Promise<CalendarEvent>;
  createTaskCommitment: (input: Record<string, unknown>) => Promise<TaskCommitment>;
  updateTaskCommitment: (input: Record<string, unknown>) => Promise<TaskCommitment>;
  createReminder: (input: Record<string, unknown>) => Promise<Reminder>;
  updateReminder: (input: Record<string, unknown>) => Promise<Reminder>;
  deleteReminder: (id: string) => Promise<void>;
  createScheduleJob: (input: Record<string, unknown>) => Promise<ScheduleJob>;
  updateScheduleJob: (input: Record<string, unknown>) => Promise<ScheduleJob>;
  deleteScheduleJob: (id: string) => Promise<void>;
  saveAvailabilityPolicy: (policy: AvailabilityPolicy) => Promise<AvailabilityPolicy>;
  refreshTodayBrief: () => Promise<TodayBrief>;
  suggestTimeboxes: () => Promise<SuggestedTimebox[]>;

  importCloudSkill: (input: { releaseId: string; skillName: string }) => Promise<unknown>;
  importCloudMcp: (input: { releaseId: string; servers: McpServerConfig[] }) => Promise<unknown>;
  importCloudSiliconPersonPackage: (input: {
    itemId: string;
    releaseId: string;
    name: string;
    summary?: string;
    manifest: CloudHubManifest;
  }) => Promise<unknown>;
  importCloudWorkflowPackage: (input: {
    itemId: string;
    releaseId: string;
    name: string;
    summary?: string;
    manifest: CloudHubManifest;
  }) => Promise<unknown>;

  // Employees
  loadSiliconPersons: () => Promise<SiliconPerson[]>;
  loadSiliconPersonById: (siliconPersonId: string) => Promise<SiliconPerson>;
  createSiliconPerson: (input: { name: string; title?: string; description: string; [key: string]: unknown }) => Promise<SiliconPerson>;
  updateSiliconPerson: (siliconPersonId: string, input: Partial<SiliconPerson>) => Promise<SiliconPerson>;
  deleteSiliconPerson: (siliconPersonId: string) => Promise<SiliconPerson[]>;
  createSiliconPersonSession: (siliconPersonId: string, input?: { title?: string }) => Promise<ChatSession>;
  switchSiliconPersonSession: (siliconPersonId: string, sessionId: string) => Promise<ChatSession>;
  /** fire-and-forget：入队后立即返回，不阻塞 UI。 */
  sendSiliconPersonMessage: (siliconPersonId: string, content: string) => Promise<void>;
  /** 将指定硅基员工会话标记为已读，只同步未读状态，不改变 currentSession。 */
  markSiliconPersonSessionRead: (siliconPersonId: string, sessionId: string) => Promise<ChatSession>;
  startSiliconPersonWorkflowRun: (siliconPersonId: string, workflowId: string) => Promise<{
    siliconPerson: SiliconPerson;
    session: ChatSession;
    runId: string | null;
  }>;
  /** 切换当前共享聊天容器中的硅基员工聊天对象（切换或取消选中）。 */
  setActiveSiliconPersonId: (id: string | null) => void;

  // Workflows
  loadWorkflows: () => Promise<WorkflowDefinitionSummary[]>;
  loadWorkflowById: (workflowId: string) => Promise<unknown>;
  createWorkflow: (input: { name: string; description?: string }) => Promise<unknown>;
  updateWorkflow: (workflowId: string, input: unknown) => Promise<unknown>;
  deleteWorkflow: (workflowId: string) => Promise<{ success: boolean }>;
  loadWorkflowRuns: () => Promise<unknown[]>;
  startWorkflowRun: (workflowId: string, initialState?: Record<string, unknown>) => Promise<{ runId: string | null }>;
  resumeWorkflowRun: (runId: string, resumeValue?: unknown) => Promise<{ success: boolean }>;
  cancelWorkflowRun: (runId: string) => Promise<{ success: boolean }>;

  // Skills
  refreshSkills: () => Promise<void>;
  openSkillsFolder: () => Promise<void>;
  loadSkillDetail: (skillId: string) => Promise<unknown>;

  // Missing actions used by pages
  pushAssistantMessage: (sessionId: string, content: string) => void;
  patchStreamingMessage: (sessionId: string, messageId: string, deltaContent: string | null, deltaReasoning?: string | null) => void;
  applySessionUpdate: (session: ChatSession) => void;
  patchSessionTasks: (sessionId: string, tasks: import("@shared/contracts").Task[]) => void;
  requestExecutionIntent: (intent: any) => Promise<void>;
  testModelProfileConnectivity: (profileId: string) => Promise<{
    success: boolean;
    ok?: boolean;
    latencyMs?: number;
    error?: string;
    diagnostics?: BrMiniMaxRuntimeDiagnostics;
    profile?: ModelProfile;
  }>;
  fetchModelCatalog: (input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">) => Promise<ModelCatalogItem[]>;
  fetchAvailableModelIds: (input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">) => Promise<string[]>;
  probeModelRoutes: (input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">) => Promise<ModelRouteProbeResult>;
  createPublishDraft: (data: any) => Promise<any>;
  loadBuiltinTools: () => Promise<ResolvedBuiltinTool[]>;
  loadMcpTools: () => Promise<ResolvedMcpTool[]>;
  updateBuiltinToolPreference: (toolId: string, pref: any) => Promise<void>;
  updateMcpToolPreference: (serverId: string, toolNameOrPref: any, pref?: any) => Promise<void>;

  // WebPanel actions
  openWebPanel: (viewPath: string, title: string, data: unknown) => void;
  closeWebPanel: () => void;
  setWebPanelWidth: (width: number) => void;
  updateWebPanelData: (data: unknown) => void;
};

// ---------------------------------------------------------------------------
// 辅助方法
// ---------------------------------------------------------------------------

function isConfiguredModelProfile(profile: ModelProfile): boolean {
  const apiKey = profile.apiKey.trim();
  return Boolean(profile.baseUrl.trim() && profile.model.trim() && apiKey && apiKey !== "replace-me");
}

function hasConfiguredModel(models: ModelProfile[]): boolean {
  return models.some((p) => isConfiguredModelProfile(p));
}

function resolveDefaultModelProfileId(payload: {
  defaultModelProfileId?: string | null;
  models: ModelProfile[];
}): string | null {
  const id = payload.defaultModelProfileId;
  // 有值且在列表中 → 使用
  if (id && payload.models.some((m) => m.id === id)) {
    return id;
  }
  // 无效或 null → fallback 到第一个模型
  return payload.models[0]?.id ?? null;
}

function buildWorkflowSummaryMap(
  workflows: WorkflowDefinitionSummary[],
): Record<string, WorkflowDefinitionSummary> {
  return Object.fromEntries(workflows.map((w) => [w.id, w]));
}

/** 统一把硅基员工会话 payload 合并回 store，避免会话正文与员工摘要分叉。 */
function mergeSiliconPersonSessionPayload(
  state: Pick<WorkspaceState, "siliconPersons" | "sessions" | "workflowRuns">,
  payload: { siliconPerson: SiliconPerson; session: ChatSession },
): Pick<WorkspaceState, "siliconPersons" | "sessions" | "workflowRuns"> {
  const siliconPersons = [...state.siliconPersons];
  const siliconPersonIndex = siliconPersons.findIndex((item) => item.id === payload.siliconPerson.id);
  if (siliconPersonIndex >= 0) {
    siliconPersons[siliconPersonIndex] = payload.siliconPerson;
  } else {
    siliconPersons.unshift(payload.siliconPerson);
  }

  const sessions = [...state.sessions];
  const sessionIndex = sessions.findIndex((item) => item.id === payload.session.id);
  if (sessionIndex >= 0) {
    sessions[sessionIndex] = payload.session;
  } else {
    sessions.unshift(payload.session);
  }

  return { siliconPersons, sessions, workflowRuns: state.workflowRuns };
}

/** 灏?scope 杞垚绋冲畾鐨勫瓧绗︿覆 key锛屼究浜?store 鎸夌粍缂撳瓨宸ヤ綔鏂囦欢銆?*/
function artifactScopeKey(scope: ArtifactScopeRef): string {
  return `${scope.scopeKind}:${scope.scopeId}`;
}

/** 鍚戞枃浠跺垪琛ㄤ腑鍚堝苟鏈€鏂扮殑 artifact 璁板綍锛屽苟鎸夋洿鏂版椂闂撮檷搴忔帓搴忋€?*/
function mergeArtifactRecord(list: ArtifactRecord[], artifact: ArtifactRecord): ArtifactRecord[] {
  const next = list.filter((item) => item.id !== artifact.id);
  next.unshift(artifact);
  return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** 浠?session stream 浜嬩欢涓彁鍙?artifact payload锛屽吋瀹?payload 鍖呰９涓庢壆骞崇粨鏋勩€?*/
function readArtifactEventPayload(event: Record<string, unknown>): ArtifactRecord | null {
  const candidate = event.payload && typeof event.payload === "object"
    ? event.payload as Record<string, unknown>
    : event;
  if (typeof candidate.artifact !== "object" || candidate.artifact === null) {
    return null;
  }
  const artifact = candidate.artifact as Record<string, unknown>;
  if (typeof artifact.id !== "string" || typeof artifact.relativePath !== "string") {
    return null;
  }
  return artifact as ArtifactRecord;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** 只保留主聊天 session（siliconPersonId 为空的）。 */
function mainSessions(sessions: ChatSession[]): ChatSession[] {
  return sessions.filter((s) => !s.siliconPersonId);
}

/** Pick the most recently active session (by last message time, then createdAt). */
function getMostRecentSessionId(sessions: ChatSession[]): string | null {
  const candidates = mainSessions(sessions);
  if (candidates.length === 0) return null;
  const getLastActivity = (s: ChatSession): string => {
    if (s.messages.length > 0) {
      const last = s.messages[s.messages.length - 1];
      if (last.createdAt) return last.createdAt;
    }
    return s.createdAt || "";
  };
  const sorted = [...candidates].sort((a, b) =>
    getLastActivity(b).localeCompare(getLastActivity(a))
  );
  return sorted[0].id;
}

/** Compute current session from state — only considers main chat sessions. */
function computeCurrentSession(
  sessions: ChatSession[],
  activeSessionId: string | null,
): ChatSession | null {
  const candidates = mainSessions(sessions);
  return candidates.find((s) => s.id === activeSessionId) ?? candidates[0] ?? null;
}

export const useWorkspaceStore = create<WorkspaceState>()((rawSet, get) => {
  let hasSubscribedToAppUpdates = false;

  // Wrap set() so currentSession is recomputed after every state change.
  const set = (
    partial:
      | Partial<WorkspaceState>
      | ((state: WorkspaceState) => Partial<WorkspaceState>),
  ) => {
    rawSet(partial as Parameters<typeof rawSet>[0]);
    const state = get();
    const cs = computeCurrentSession(state.sessions, state.activeSessionId);
    if (state.currentSession !== cs) {
      rawSet({ currentSession: cs });
    }
  };

  return {
  ready: false,
  loading: false,
  error: null,
  myClawRootPath: null,
  skillsRootPath: null,
  sessionsRootPath: null,
  workspaceRootPath: null,
  artifactsRootPath: null,
  cacheRootPath: null,
  requiresInitialSetup: true,
  defaultModelProfileId: null,
  activeSessionId: null,
  sessions: [],
  models: [],
  builtinTools: [],
  mcpTools: [],
  mcpServers: [],
  skills: [],
  skillDetails: {},
  siliconPersons: [],
  activeSiliconPersonId: null,
  workflows: [],
  workflowSummaries: {},
  workflowDefinitions: {},
  workflowRuns: {},
  cloudHubItems: [],
  cloudHubDetail: null,
  cloudHubManifest: null,
  cloudSkills: [],
  cloudSkillDetail: null,
  approvals: null,
  approvalRequests: [],
  personalPrompt: {
    prompt: "",
    summary: "",
    tags: [],
    updatedAt: null,
  },
  appUpdate: null,
  time: createEmptyTimeState(),
  modelSwitchNotice: null,

  webPanel: {
    isOpen: false,
    viewPath: null,
    title: "",
    data: null,
    panelWidth: 420,
  },

  currentSession: null,
  backgroundTaskSnapshot: null,
  artifactsByScope: {},
  recentArtifacts: [],

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------

  async loadBootstrap() {
    const state = get();
    if (state.ready || state.loading) {
      return;
    }

    set({ error: null, loading: true });
    try {
      const payload = await window.myClawAPI.bootstrap();

      set({
        sessions: payload.sessions,
        activeSessionId: getMostRecentSessionId(payload.sessions),
        models: payload.models,
        myClawRootPath: payload.myClawRootPath ?? null,
        skillsRootPath: payload.skillsRootPath ?? null,
        sessionsRootPath: payload.sessionsRootPath ?? null,
        workspaceRootPath: payload.workspaceRootPath ?? null,
        artifactsRootPath: payload.artifactsRootPath ?? null,
        cacheRootPath: payload.cacheRootPath ?? null,
        requiresInitialSetup:
          typeof payload.requiresInitialSetup === "boolean"
            ? payload.requiresInitialSetup
            : !hasConfiguredModel(payload.models),
        defaultModelProfileId: resolveDefaultModelProfileId({
          defaultModelProfileId: payload.defaultModelProfileId,
          models: payload.models,
        }),
        builtinTools: payload.tools?.builtin ?? [],
        mcpTools: payload.tools?.mcp ?? [],
        mcpServers: payload.mcp?.servers ?? [],
        skills: payload.skills?.items ?? [],
        skillDetails: {},
        siliconPersons: payload.siliconPersons ?? [],
        workflows: payload.workflows ?? [],
        workflowSummaries: buildWorkflowSummaryMap(payload.workflows ?? []),
        workflowRuns: Object.fromEntries((payload.workflowRuns ?? []).map((r: unknown) => [(r as { id: string }).id, r])),
        cloudHubItems: payload.cloudHubItems ?? [],
        cloudHubDetail: payload.cloudHubDetail ?? null,
        cloudHubManifest: payload.cloudHubManifest ?? null,
        approvals: payload.approvals ?? null,
        approvalRequests: payload.approvalRequests ?? [],
        personalPrompt: payload.personalPrompt ?? {
          prompt: "",
          summary: "",
          tags: [],
          updatedAt: null,
        },
        appUpdate: payload.updates ?? null,
        time: payload.time ?? createEmptyTimeState(),
        ready: true,
        error: null,
      });

      if (!hasSubscribedToAppUpdates) {
        hasSubscribedToAppUpdates = true;
        window.myClawAPI.onAppUpdateStateChanged((updates) => {
          set({ appUpdate: updates as AppUpdateState });
        });
      }

      // Auto-create a default session if none exist (e.g. fresh install)
      if (!payload.sessions || payload.sessions.length === 0) {
        await get().createSession();
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "加载工作区初始化数据失败" });
    } finally {
      set({ loading: false });
    }
  },

  async createCalendarEvent(input) {
    const { item } = await window.myClawAPI.time.createCalendarEvent(input);
    set((state) => ({
      time: {
        ...state.time,
        calendarEvents: replaceTimeItem(state.time.calendarEvents, item, "startsAt"),
      },
    }));
    await get().refreshTodayBrief();
    return item;
  },

  async updateCalendarEvent(input) {
    const { item } = await window.myClawAPI.time.updateCalendarEvent(input);
    set((state) => ({
      time: {
        ...state.time,
        calendarEvents: replaceTimeItem(state.time.calendarEvents, item, "startsAt"),
      },
    }));
    await get().refreshTodayBrief();
    return item;
  },

  async createTaskCommitment(input) {
    const { item } = await window.myClawAPI.time.createTaskCommitment(input);
    set((state) => ({
      time: {
        ...state.time,
        taskCommitments: replaceTimeItem(state.time.taskCommitments, item, "dueAt"),
      },
    }));
    await get().refreshTodayBrief();
    return item;
  },

  async updateTaskCommitment(input) {
    const { item } = await window.myClawAPI.time.updateTaskCommitment(input);
    set((state) => ({
      time: {
        ...state.time,
        taskCommitments: replaceTimeItem(state.time.taskCommitments, item, "dueAt"),
      },
    }));
    await get().refreshTodayBrief();
    return item;
  },

  async createReminder(input) {
    const { item } = await window.myClawAPI.time.createReminder(input);
    set((state) => ({
      time: {
        ...state.time,
        reminders: replaceTimeItem(state.time.reminders, item, "triggerAt"),
      },
    }));
    await get().refreshTodayBrief();
    return item;
  },

  async updateReminder(input) {
    const { item } = await window.myClawAPI.time.updateReminder(input);
    set((state) => ({
      time: {
        ...state.time,
        reminders: replaceTimeItem(state.time.reminders, item, "triggerAt"),
      },
    }));
    await get().refreshTodayBrief();
    return item;
  },

  async deleteReminder(id) {
    await window.myClawAPI.time.deleteReminder(id);
    set((state) => ({
      time: {
        ...state.time,
        reminders: state.time.reminders.filter((item) => item.id !== id),
      },
    }));
    await get().refreshTodayBrief();
  },

  async createScheduleJob(input) {
    const { item } = await window.myClawAPI.time.createScheduleJob(input);
    set((state) => ({
      time: {
        ...state.time,
        scheduleJobs: replaceTimeItem(state.time.scheduleJobs, item, "nextRunAt"),
      },
    }));
    await get().refreshTodayBrief();
    return item;
  },

  async updateScheduleJob(input) {
    const { item } = await window.myClawAPI.time.updateScheduleJob(input);
    set((state) => ({
      time: {
        ...state.time,
        scheduleJobs: replaceTimeItem(state.time.scheduleJobs, item, "nextRunAt"),
      },
    }));
    await get().refreshTodayBrief();
    return item;
  },

  async deleteScheduleJob(id) {
    await window.myClawAPI.time.deleteScheduleJob(id);
    set((state) => ({
      time: {
        ...state.time,
        scheduleJobs: state.time.scheduleJobs.filter((item) => item.id !== id),
      },
    }));
    await get().refreshTodayBrief();
  },

  async saveAvailabilityPolicy(policy) {
    const { policy: nextPolicy } = await window.myClawAPI.time.saveAvailabilityPolicy(policy);
    set((state) => ({
      time: {
        ...state.time,
        availabilityPolicy: nextPolicy,
      },
    }));
    await get().refreshTodayBrief();
    return nextPolicy;
  },

  async refreshTodayBrief() {
    const { brief } = await window.myClawAPI.time.getTodayBrief();
    set((state) => ({
      time: {
        ...state.time,
        todayBrief: brief,
      },
    }));
    return brief;
  },

  async suggestTimeboxes() {
    const { items } = await window.myClawAPI.time.suggestTimeboxes();
    return items;
  },

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  selectSession(sessionId) {
    if (get().sessions.some((s) => s.id === sessionId)) {
      set({ activeSessionId: sessionId });
    }
  },

  async createSession() {
    const payload = await window.myClawAPI.createSession();
    set((s) => ({ sessions: [payload.session, ...s.sessions], activeSessionId: payload.session.id }));
    return payload.session;
  },

  async deleteSession(sessionId) {
    // 删除前记录该 session 是否归属硅基员工
    const deletedSession = get().sessions.find((s) => s.id === sessionId);
    const ownerSiliconPersonId = deletedSession?.siliconPersonId ?? null;

    const payload = await window.myClawAPI.deleteSession(sessionId);
    set((s) => {
      const sessions: ChatSession[] = payload.sessions;
      const approvalRequests: ApprovalRequest[] = payload.approvalRequests ?? s.approvalRequests;
      const activeSessionId =
        s.activeSessionId === sessionId || !sessions.some((item) => item.id === s.activeSessionId)
          ? (sessions[0]?.id ?? null)
          : s.activeSessionId;
      return { sessions, approvalRequests, activeSessionId };
    });

    // 如果被删的 session 归属硅基员工，刷新该员工摘要以同步 sessions 列表
    if (ownerSiliconPersonId) {
      try {
        await get().loadSiliconPersonById(ownerSiliconPersonId);
      } catch {
        // 员工可能已被删除，忽略
      }
    }

    return payload;
  },

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  async sendMessage(content) {
    let { currentSession } = get();
    if (!currentSession || !content.trim()) {
      return;
    }

    const trimmed = content.trim();

    // Optimistically add user message so it appears immediately in the UI
    const optimisticMessage = {
      id: `msg-optimistic-${Date.now()}`,
      role: "user" as const,
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    set((s) => {
      const sessions = [...s.sessions];
      const index = sessions.findIndex((item) => item.id === currentSession.id);
      if (index >= 0) {
        const session = sessions[index]!;
        sessions[index] = { ...session, messages: [...session.messages, optimisticMessage] };
      }
      return { sessions };
    });

    const payload = await window.myClawAPI.sendMessage(currentSession.id, trimmed);

    if (payload?.session) {
      set((s) => {
        const sessions = [...s.sessions];
        const index = sessions.findIndex((item) => item.id === payload.session.id);
        if (index >= 0) {
          sessions[index] = payload.session;
        } else {
          sessions.unshift(payload.session);
        }
        return {
          sessions,
          approvals: payload.approvals ?? s.approvals,
          approvalRequests: payload.approvalRequests ?? s.approvalRequests,
        };
      });
    }
  },

  async cancelSessionRun(input) {
    const { currentSession } = get();
    if (!currentSession) return;
    const payload = await window.myClawAPI.cancelSessionRun(currentSession.id, input);
    if (!payload?.session) return;
    set((s) => {
      const sessions = [...s.sessions];
      const index = sessions.findIndex((item) => item.id === payload.session.id);
      if (index >= 0) {
        sessions[index] = payload.session;
      } else {
        sessions.unshift(payload.session);
      }
      return {
        sessions,
        approvals: payload.approvals ?? s.approvals,
        approvalRequests: payload.approvalRequests ?? s.approvalRequests,
      };
    });
  },

  /** 轮询当前会话的后台任务，并把主进程回写后的 session 快照同步回 store。 */
  async pollBackgroundTask() {
    const { currentSession } = get();
    if (!currentSession?.backgroundTask) return null;
    const payload = await window.myClawAPI.pollBackgroundTask(currentSession.id);
    if (!payload?.session) return null;
    set({ backgroundTaskSnapshot: {
      sessionId: currentSession.id,
      outcomeId: payload.outcomeId,
      task: payload.task,
      status: payload.status,
      outputText: payload.outputText,
    } });
    get().applySessionUpdate(payload.session);
    return {
      sessionId: currentSession.id,
      outcomeId: payload.outcomeId,
      task: payload.task,
      status: payload.status,
      outputText: payload.outputText,
    };
  },

  /** 取消当前会话的后台任务，并立即同步最新 session 状态。 */
  async cancelBackgroundTask() {
    const { currentSession } = get();
    if (!currentSession?.backgroundTask) return null;
    const payload = await window.myClawAPI.cancelBackgroundTask(currentSession.id);
    if (!payload?.session) return null;
    set({ backgroundTaskSnapshot: {
      sessionId: currentSession.id,
      outcomeId: payload.outcomeId,
      task: payload.task,
      status: payload.status,
      outputText: payload.outputText,
    } });
    get().applySessionUpdate(payload.session);
    return {
      sessionId: currentSession.id,
      outcomeId: payload.outcomeId,
      task: payload.task,
      status: payload.status,
      outputText: payload.outputText,
    };
  },

  async updateSessionRuntimeIntent(intent) {
    const { currentSession } = get();
    if (!currentSession) return;
    const { session } = await window.myClawAPI.updateSessionRuntimeIntent(currentSession.id, intent);
    set((s) => {
      const sessions = [...s.sessions];
      const index = sessions.findIndex((item) => item.id === session.id);
      if (index >= 0) {
        sessions[index] = session;
      }
      return { sessions };
    });
  },

  /** 将当前计划标记为已批准，并同步最新会话状态。 */
  async approvePlan() {
    const { currentSession } = get();
    if (!currentSession) return;
    const { session } = await window.myClawAPI.approvePlan(currentSession.id);
    set((s) => {
      const sessions = [...s.sessions];
      const index = sessions.findIndex((item) => item.id === session.id);
      if (index >= 0) {
        sessions[index] = session;
      }
      return { sessions };
    });
  },

  /** 请求继续完善计划，让界面留在计划阶段而不是直接执行。 */
  async revisePlan(feedback) {
    const { currentSession } = get();
    if (!currentSession) return;
    const { session } = await window.myClawAPI.revisePlan(currentSession.id, feedback ?? "");
    set((s) => {
      const sessions = [...s.sessions];
      const index = sessions.findIndex((item) => item.id === session.id);
      if (index >= 0) {
        sessions[index] = session;
      }
      return { sessions };
    });
  },

  /** 取消计划模式，让会话回到普通对话入口。 */
  async cancelPlanMode() {
    const { currentSession } = get();
    if (!currentSession) return;
    const { session } = await window.myClawAPI.cancelPlanMode(currentSession.id);
    set((s) => {
      const sessions = [...s.sessions];
      const index = sessions.findIndex((item) => item.id === session.id);
      if (index >= 0) {
        sessions[index] = session;
      }
      return { sessions };
    });
  },

  /** 鎸夊綋鍓?scope 鍔犺浇宸ヤ綔鏂囦欢鍒楄〃锛屽悓姝ュ啓鍏?store 缂撳瓨銆?*/
  async loadArtifactsByScope(scope) {
    const artifacts = await window.myClawAPI.listArtifactsByScope(scope);
    const key = artifactScopeKey(scope);
    set((state) => ({
      artifactsByScope: {
        ...state.artifactsByScope,
        [key]: artifacts,
      },
    }));
    return artifacts;
  },

  /** 鍔犺浇鍏ㄥ眬鏈€杩戜骇鍑虹殑宸ヤ綔鏂囦欢锛屼緵 Files 宸ヤ綔鍙颁笌蹇嵎鍏ュ彛鍏变韩銆?*/
  async loadRecentArtifacts(input) {
    const artifacts = await window.myClawAPI.listRecentArtifacts(input ?? {});
    set({ recentArtifacts: artifacts });
    return artifacts;
  },

  /** 灏嗘寚瀹?artifact 鎻愬崌涓烘渶缁堜氦浠橈紝骞跺洖鍐欏埌鏈湴缂撳瓨銆?*/
  async markArtifactFinal(artifactId, scope) {
    const artifact = await window.myClawAPI.markArtifactFinal(artifactId, scope);
    set((state) => {
      const nextScopes = Object.fromEntries(
        Object.entries(state.artifactsByScope).map(([key, list]) => [
          key,
          list.some((item) => item.id === artifact.id) ? mergeArtifactRecord(list, artifact) : list,
        ]),
      );
      return {
        artifactsByScope: nextScopes,
        recentArtifacts: mergeArtifactRecord(state.recentArtifacts, artifact),
      };
    });
    return artifact;
  },

  /** 鎵撳紑鎸囧畾鏂囦欢锛屽苟璁╂湰鍦扮紦瀛樼殑璁块棶鏃堕棿鍚屾鏇存柊銆?*/
  async openArtifact(artifactId) {
    await window.myClawAPI.openArtifact(artifactId);
    const artifact = get().recentArtifacts.find((item) => item.id === artifactId)
      ?? Object.values(get().artifactsByScope).flat().find((item) => item.id === artifactId)
      ?? null;
    if (!artifact) {
      return;
    }
    get().applyArtifactEvent({
      type: "artifact.updated",
      artifact: {
        ...artifact,
        lastOpenedAt: new Date().toISOString(),
        openCount: (artifact.openCount ?? 0) + 1,
      },
    });
  },

  /** 鍦ㄧ郴缁熸枃浠剁鐞嗗櫒涓畾浣嶅埌鎸囧畾鏂囦欢锛屼笉鏀瑰啓鏈湴鐘舵€併€?*/
  async revealArtifact(artifactId) {
    await window.myClawAPI.revealArtifact(artifactId);
  },

  /** 娑堣垂涓诲線姹夋祦鎺ㄩ€佺殑 artifact 浜嬩欢锛屾渶灏忔洿鏂?store 缂撳瓨銆?*/
  applyArtifactEvent(event) {
    const artifact = readArtifactEventPayload(event);
    if (!artifact) {
      return;
    }
    set((state) => {
      const nextScopes = Object.fromEntries(
        Object.entries(state.artifactsByScope).map(([key, list]) => [
          key,
          list.some((item) => item.id === artifact.id) ? mergeArtifactRecord(list, artifact) : list,
        ]),
      );
      return {
        artifactsByScope: nextScopes,
        recentArtifacts: mergeArtifactRecord(state.recentArtifacts, artifact),
      };
    });
  },


  // -------------------------------------------------------------------------
  // Model profiles
  // -------------------------------------------------------------------------

  async createModelProfile(input) {
    const payload = await window.myClawAPI.createModelProfile(input);
    set((s) => {
      const models = [...s.models, payload.profile];
      return {
        models,
        requiresInitialSetup: !hasConfiguredModel(models),
        defaultModelProfileId: s.defaultModelProfileId ?? payload.profile.id,
      };
    });
    return payload.profile;
  },

  addModelAndClearSetup(profile) {
    set((s) => {
      const models = [...s.models, profile];
      return {
        models,
        requiresInitialSetup: false,
        defaultModelProfileId: s.defaultModelProfileId ?? profile.id,
      };
    });
  },

  async updateModelProfile(profileId, input) {
    const payload = await window.myClawAPI.updateModelProfile(profileId, input);
    set((s) => {
      const models = [...s.models];
      const index = models.findIndex((m) => m.id === profileId);
      if (index >= 0) {
        models[index] = payload.profile;
      }
      return { models };
    });
    return payload.profile;
  },

  async deleteModelProfile(profileId) {
    const payload = await window.myClawAPI.deleteModelProfile(profileId);
    set((s) => {
      const sessions: ChatSession[] = payload.sessions;
      const activeSessionId =
        s.activeSessionId && !sessions.some((item) => item.id === s.activeSessionId)
          ? (sessions[0]?.id ?? null)
          : s.activeSessionId;
      return {
        models: payload.models,
        defaultModelProfileId: payload.defaultModelProfileId,
        sessions,
        activeSessionId,
        requiresInitialSetup: !hasConfiguredModel(payload.models),
      };
    });
    return payload;
  },

  async setDefaultModelProfile(profileId) {
    const { defaultModelProfileId: prevId, models } = get();
    const payload = await window.myClawAPI.setDefaultModelProfile(profileId);
    const nextId = payload.defaultModelProfileId;

    // 如果默认模型确实发生了切换，设置通知以提示用户新建对话。
    if (prevId && nextId && prevId !== nextId) {
      const fromName = models.find((m) => m.id === prevId)?.name ?? "未知模型";
      const toName = models.find((m) => m.id === nextId)?.name ?? "未知模型";
      set({ defaultModelProfileId: nextId, modelSwitchNotice: { fromName, toName } });
    } else {
      set({ defaultModelProfileId: nextId });
    }
  },

  dismissModelSwitchNotice() {
    set({ modelSwitchNotice: null });
  },

  // -------------------------------------------------------------------------
  // MCP servers
  // -------------------------------------------------------------------------

  async loadMcpServers() {
    const payload = await window.myClawAPI.fetchMcpServers();
    set({ mcpServers: payload.servers });
    return payload.servers;
  },

  async fetchMcpServers() {
    return get().loadMcpServers();
  },

  async createMcpServer(input) {
    const payload = await window.myClawAPI.createMcpServer(input);
    set({ mcpServers: payload.servers });
    return payload.server;
  },

  async updateMcpServer(serverId, input) {
    const payload = await window.myClawAPI.updateMcpServer(serverId, input);
    set({ mcpServers: payload.servers });
    return payload.server;
  },

  async deleteMcpServer(serverId) {
    const payload = await window.myClawAPI.deleteMcpServer(serverId);
    set({ mcpServers: payload.servers });
    return payload;
  },

  async refreshMcpServer(serverId) {
    const payload = await window.myClawAPI.refreshMcpServer(serverId);
    set({ mcpServers: payload.servers });
    return payload.server;
  },

  // -------------------------------------------------------------------------
  // Cloud Hub
  // -------------------------------------------------------------------------

  async loadCloudHubItems(type = "all") {
    const items = await window.myClawAPI.fetchCloudHubItems(type);
    set((s) => ({
      cloudHubItems: items,
      cloudHubDetail:
        type !== "all" && s.cloudHubDetail && s.cloudHubDetail.type !== type
          ? null
          : s.cloudHubDetail,
      cloudHubManifest:
        type !== "all" && s.cloudHubManifest && s.cloudHubManifest.kind !== type
          ? null
          : s.cloudHubManifest,
    }));
    return items;
  },

  async loadCloudHubDetail(itemId) {
    const detail = await window.myClawAPI.fetchCloudHubDetail(itemId);
    set({ cloudHubDetail: detail });
    return detail;
  },

  async loadCloudHubManifest(releaseId) {
    const manifest = await window.myClawAPI.fetchCloudHubManifest(releaseId);
    set({ cloudHubManifest: manifest });
    return manifest;
  },

  // -------------------------------------------------------------------------
  // Cloud Skills
  // -------------------------------------------------------------------------

  async loadCloudSkills(query) {
    const skills = await window.myClawAPI.fetchCloudSkills(query);
    set({ cloudSkills: skills });
    return skills;
  },

  async loadCloudSkillDetail(skillId) {
    const detail = await window.myClawAPI.fetchCloudSkillDetail(skillId);
    set({ cloudSkillDetail: detail });
    return detail;
  },

  clearCloudSkillDetail() {
    set({ cloudSkillDetail: null });
  },

  clearCloudHubDetail() {
    set({ cloudHubDetail: null, cloudHubManifest: null });
  },

  // -------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------

  addApprovalRequest(request: ApprovalRequest) {
    set((s) => ({
      approvalRequests: [...s.approvalRequests, request],
    }));
  },

  removeApprovalRequest(approvalId: string) {
    set((s) => ({
      approvalRequests: s.approvalRequests.filter((r) => r.id !== approvalId),
    }));
  },

  async resolveApproval(approvalId, decision) {
    const payload = await window.myClawAPI.resolveApproval(approvalId, decision);
    // Remove the resolved approval from local state
    set((s) => ({
      approvalRequests: s.approvalRequests.filter((r) => r.id !== approvalId),
    }));
    return payload;
  },

  async updateApprovalPolicy(input) {
    const payload = await window.myClawAPI.updateApprovalPolicy(input);
    set({ approvals: payload.approvals });
    return payload.approvals;
  },

  async loadPersonalPrompt() {
    const profile = await window.myClawAPI.getPersonalPrompt();
    set({ personalPrompt: profile });
    return profile;
  },

  async updatePersonalPrompt(prompt) {
    const profile = await window.myClawAPI.updatePersonalPrompt({ prompt });
    set({ personalPrompt: profile });
    return profile;
  },

  async checkForAppUpdates() {
    const updates = await window.myClawAPI.checkForAppUpdates();
    set({ appUpdate: updates });
    return updates;
  },

  async downloadAppUpdate() {
    const updates = await window.myClawAPI.downloadAppUpdate();
    set({ appUpdate: updates });
    return updates;
  },

  async quitAndInstallAppUpdate() {
    return window.myClawAPI.quitAndInstallAppUpdate();
  },

  async openAppUpdateDownloadPage() {
    return window.myClawAPI.openAppUpdateDownloadPage();
  },

  // -------------------------------------------------------------------------
  // Cloud imports
  // -------------------------------------------------------------------------

  async importCloudSkill(input) {
    const payload = await window.myClawAPI.importCloudSkill({
      releaseId: input.releaseId,
      skillName: input.skillName,
    });
    set({ skills: payload.skills?.items ?? get().skills, skillDetails: {} });
    return payload;
  },

  async importCloudMcp(input) {
    const payload = await window.myClawAPI.importCloudMcp(input);
    set({ mcpServers: payload.servers ?? get().mcpServers });
    return payload;
  },

  async importCloudSiliconPersonPackage(input) {
    if (input.manifest.kind !== "employee-package") {
      throw new Error("Cloud manifest is not an employee package.");
    }
    const token = await window.myClawAPI.fetchCloudHubDownloadToken(input.releaseId);
    const payload = await window.myClawAPI.importSiliconPersonPackage({
      itemId: input.itemId,
      releaseId: input.releaseId,
      name: input.name,
      ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
      downloadUrl: token.downloadUrl,
      manifest: input.manifest,
    });
    set({ siliconPersons: payload.items ?? get().siliconPersons });
    return payload;
  },

  async importCloudWorkflowPackage(input) {
    if (input.manifest.kind !== "workflow-package") {
      throw new Error("Cloud manifest is not a workflow package.");
    }
    const token = await window.myClawAPI.fetchCloudHubDownloadToken(input.releaseId);
    const payload = await window.myClawAPI.installWorkflowPackageFromCloud({
      itemId: input.itemId,
      releaseId: input.releaseId,
      name: input.name,
      ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
      downloadUrl: token.downloadUrl,
      manifest: input.manifest,
    });
    set((s) => {
      const workflows = payload.items ?? s.workflows;
      return { workflows, workflowSummaries: buildWorkflowSummaryMap(workflows) };
    });
    return payload;
  },

  // -------------------------------------------------------------------------
  // Employees
  // -------------------------------------------------------------------------

  async loadSiliconPersons() {
    const payload = await window.myClawAPI.listSiliconPersons();
    set({ siliconPersons: payload.items });
    return payload.items;
  },

  async loadSiliconPersonById(siliconPersonId) {
    const payload = await window.myClawAPI.getSiliconPerson(siliconPersonId);
    set((s) => {
      const siliconPersons = [...s.siliconPersons];
      const index = siliconPersons.findIndex((item) => item.id === siliconPersonId);
      if (index >= 0) {
        siliconPersons[index] = payload.siliconPerson;
      } else {
        siliconPersons.unshift(payload.siliconPerson);
      }
      return { siliconPersons };
    });
    return payload.siliconPerson;
  },

  async createSiliconPerson(input) {
    const payload = await window.myClawAPI.createSiliconPerson(input as Parameters<typeof window.myClawAPI.createSiliconPerson>[0]);
    set({ siliconPersons: payload.items });
    return payload.siliconPerson;
  },

  async updateSiliconPerson(siliconPersonId, input) {
    const payload = await window.myClawAPI.updateSiliconPerson(siliconPersonId, input as Parameters<typeof window.myClawAPI.updateSiliconPerson>[1]);
    set((s) => {
      const siliconPersons = [...s.siliconPersons];
      const index = siliconPersons.findIndex((item) => item.id === siliconPersonId);
      if (index >= 0) {
        siliconPersons[index] = payload.siliconPerson;
      } else {
        siliconPersons.unshift(payload.siliconPerson);
      }
      return { siliconPersons };
    });
    return payload.siliconPerson;
  },

  async deleteSiliconPerson(siliconPersonId) {
    const payload = await window.myClawAPI.deleteSiliconPerson(siliconPersonId);
    set((s) => ({
      siliconPersons: payload.items,
      sessions: s.sessions.filter((session) => session.siliconPersonId !== siliconPersonId),
      activeSiliconPersonId: s.activeSiliconPersonId === siliconPersonId ? null : s.activeSiliconPersonId,
    }));
    return payload.items;
  },

  /** 手动新建硅基员工会话，并把主线程返回的 currentSession 同步回本地。 */
  async createSiliconPersonSession(siliconPersonId, input) {
    console.info("[workspace] 手动新建硅基员工会话", {
      siliconPersonId,
      title: input?.title?.trim() || null,
    });
    const payload = await window.myClawAPI.createSiliconPersonSession(siliconPersonId, input);
    set((s) => mergeSiliconPersonSessionPayload(s, payload));
    return payload.session;
  },

  /** 显式切换硅基员工 currentSession，保持 renderer 与主线程路由一致。 */
  async switchSiliconPersonSession(siliconPersonId, sessionId) {
    console.info("[workspace] 切换硅基员工当前会话", {
      siliconPersonId,
      sessionId,
    });
    const payload = await window.myClawAPI.switchSiliconPersonSession(siliconPersonId, sessionId);
    set((s) => mergeSiliconPersonSessionPayload(s, payload));
    return payload.session;
  },

  /** fire-and-forget：指令入队后立即返回，后台串行执行，结果通过 stream 推送。 */
  async sendSiliconPersonMessage(siliconPersonId, content) {
    console.info("[workspace] 投递硅基员工消息（fire-and-forget）", {
      siliconPersonId,
      contentLength: content.trim().length,
    });
    await window.myClawAPI.sendSiliconPersonMessage(siliconPersonId, content);
  },

  /** 将指定硅基员工会话标记为已读，只同步当前会话未读状态，不改变 currentSession。 */
  async markSiliconPersonSessionRead(siliconPersonId: string, sessionId: string) {
    console.info("[workspace] 标记硅基员工会话已读", {
      siliconPersonId,
      sessionId,
    });
    const payload = await window.myClawAPI.markSiliconPersonSessionRead(siliconPersonId, sessionId);
    set((s) => mergeSiliconPersonSessionPayload(s, payload));
    return payload.session;
  },

  /** 为硅基员工当前会话启动已绑定 workflow run，并把会话与 run 摘要一起并回本地。 */
  async startSiliconPersonWorkflowRun(siliconPersonId, workflowId) {
    console.info("[workspace] 为硅基员工启动工作流运行", {
      siliconPersonId,
      workflowId,
    });
    const payload = await window.myClawAPI.startSiliconPersonWorkflowRun(siliconPersonId, workflowId);
    set((s) => {
      const nextState = mergeSiliconPersonSessionPayload(s, payload);
      if (!payload.runId) {
        return nextState;
      }
      return {
        ...nextState,
        workflowRuns: {
          ...nextState.workflowRuns,
          [payload.runId]: {
            id: payload.runId,
            workflowId,
            status: "running",
            startedAt: new Date().toISOString(),
          },
        },
      };
    });
    return payload;
  },

  setActiveSiliconPersonId(id) {
    set({ activeSiliconPersonId: id });
  },

  // -------------------------------------------------------------------------
  // Workflows
  // -------------------------------------------------------------------------

  async loadWorkflows() {
    const payload = await window.myClawAPI.fetchWorkflows();
    set((s) => ({
      workflows: payload.items,
      workflowSummaries: buildWorkflowSummaryMap(payload.items),
      // preserve existing definitions
      workflowDefinitions: s.workflowDefinitions,
    }));
    return payload.items;
  },

  async loadWorkflowById(workflowId) {
    const payload = await window.myClawAPI.getWorkflow(workflowId);
    set((s) => ({
      workflowDefinitions: { ...s.workflowDefinitions, [workflowId]: payload.workflow },
    }));
    return payload.workflow;
  },

  async createWorkflow(input) {
    const payload = await window.myClawAPI.createWorkflow(input);
    set((s) => {
      const workflows = payload.items ?? s.workflows;
      return {
        workflows,
        workflowSummaries: buildWorkflowSummaryMap(workflows),
        // Don't store the summary in workflowDefinitions — the full definition
        // (with nodes/edges) will be loaded by loadWorkflowById when the studio page mounts.
      };
    });
    return payload.workflow;
  },

  async updateWorkflow(workflowId, input) {
    const payload = await window.myClawAPI.updateWorkflow(workflowId, input);
    set((s) => {
      const workflows = payload.items ?? s.workflows;
      // The backend returns a summary (no nodes/edges). Merge the input into
      // the existing definition instead of replacing it with the summary,
      // which would wipe out nodes/edges/stateSchema and crash the canvas.
      const existingDef = s.workflowDefinitions[workflowId];
      const mergedDef = existingDef
        ? { ...existingDef, ...(input as Record<string, unknown>) }
        : undefined;
      return {
        workflows,
        workflowSummaries: buildWorkflowSummaryMap(workflows),
        workflowDefinitions: {
          ...s.workflowDefinitions,
          ...(mergedDef ? { [workflowId]: mergedDef } : {}),
        },
      };
    });
    return payload.workflow;
  },

  async loadWorkflowRuns() {
    const payload = await window.myClawAPI.fetchWorkflowRuns();
    set((s) => ({
      workflowRuns: {
        ...s.workflowRuns,
        ...Object.fromEntries(payload.items.map((r) => [(r as { id: string }).id, r])),
      },
    }));
    return payload.items;
  },

  async startWorkflowRun(workflowId, initialState) {
    const payload = await window.myClawAPI.startWorkflowRun({ workflowId, initialState });
    if (payload.runId) {
      set((s) => ({
        workflowRuns: {
          ...s.workflowRuns,
          [payload.runId!]: { id: payload.runId, workflowId, status: "running", startedAt: new Date().toISOString() },
        },
      }));
    }
    return payload;
  },

  async resumeWorkflowRun(runId, resumeValue) {
    const payload = await window.myClawAPI.resumeWorkflowRun(runId, resumeValue);
    return payload;
  },

  async deleteWorkflow(workflowId) {
    const payload = await window.myClawAPI.deleteWorkflow(workflowId);
    if (payload.success) {
      set((s) => {
        const workflows = s.workflows.filter((w) => w.id !== workflowId);
        const { [workflowId]: _removed, ...workflowDefinitions } = s.workflowDefinitions;
        const { [workflowId]: _removedSummary, ...workflowSummaries } = s.workflowSummaries;
        return { workflows, workflowDefinitions, workflowSummaries };
      });
    }
    return payload;
  },

  async cancelWorkflowRun(runId) {
    const payload = await window.myClawAPI.cancelWorkflowRun(runId);
    if (payload.success) {
      set((s) => {
        const existing = s.workflowRuns[runId] as Record<string, unknown> | undefined;
        if (existing) {
          return {
            workflowRuns: {
              ...s.workflowRuns,
              [runId]: { ...existing, status: "canceled", updatedAt: new Date().toISOString() },
            },
          };
        }
        return {};
      });
    }
    return payload;
  },

  // -------------------------------------------------------------------------
  // Skills
  // -------------------------------------------------------------------------

  async refreshSkills() {
    const payload = await window.myClawAPI.refreshSkills();
    set({ skills: payload.items ?? [], skillDetails: {} });
  },

  async openSkillsFolder() {
    await window.myClawAPI.openSkillsFolder();
  },

  async loadSkillDetail(skillId) {
    const state = get();
    if (state.skillDetails[skillId]) {
      return state.skillDetails[skillId];
    }
    const payload = await window.myClawAPI.fetchSkillDetail(skillId);
    set((s) => ({
      skillDetails: { ...s.skillDetails, [(payload.skill as { id: string }).id]: payload.skill },
    }));
    return payload.skill;
  },

  // -------------------------------------------------------------------------
  // Missing actions used by pages
  // -------------------------------------------------------------------------

  pushAssistantMessage(sessionId, content) {
    set((s) => {
      const sessions = [...s.sessions];
      const index = sessions.findIndex((item) => item.id === sessionId);
      if (index >= 0) {
        const session = sessions[index]!;
        const newMessage = {
          id: `msg-${Date.now()}`,
          role: "assistant" as const,
          content,
          createdAt: new Date().toISOString(),
        };
        sessions[index] = { ...session, messages: [...session.messages, newMessage] };
      }
      return { sessions };
    });
  },

  patchStreamingMessage(sessionId, messageId, deltaContent, deltaReasoning) {
    set((s) => {
      const sessionIndex = s.sessions.findIndex((item) => item.id === sessionId);
      if (sessionIndex < 0) return {};
      const session = s.sessions[sessionIndex]!;
      const msgIndex = session.messages.findIndex((m) => m.id === messageId);

      let newMessages: typeof session.messages;
      if (msgIndex >= 0) {
        // Append delta to existing streaming message — only copy the messages array
        const existing = session.messages[msgIndex]!;
        const patched: typeof existing = {
          ...existing,
          content: existing.content + (deltaContent ?? ""),
          ...(deltaReasoning ? { reasoning: (existing.reasoning ?? "") + deltaReasoning } : {}),
        };
        newMessages = [...session.messages];
        newMessages[msgIndex] = patched;
      } else {
        // Create a new in-progress assistant message
        newMessages = [...session.messages, {
          id: messageId,
          role: "assistant" as const,
          content: deltaContent ?? "",
          ...(deltaReasoning ? { reasoning: deltaReasoning } : {}),
          createdAt: new Date().toISOString(),
        }];
      }

      // Only create new references for the changed session, not the entire array
      const newSession = { ...session, messages: newMessages };
      const newSessions = [...s.sessions];
      newSessions[sessionIndex] = newSession;
      return { sessions: newSessions };
    });
  },

  applySessionUpdate(updatedSession) {
    set((s) => {
      const sessions = [...s.sessions];
      const index = sessions.findIndex((item) => item.id === updatedSession.id);
      if (index >= 0) {
        sessions[index] = updatedSession;
      } else {
        sessions.unshift(updatedSession);
      }
      return { sessions };
    });
  },

  patchSessionTasks(sessionId, tasks) {
    set((s) => {
      const sessions = [...s.sessions];
      const index = sessions.findIndex((item) => item.id === sessionId);
      if (index >= 0) {
        sessions[index] = { ...sessions[index]!, tasks };
      }
      return { sessions };
    });
  },

  async requestExecutionIntent(intent) {
    const { currentSession } = get();
    if (!currentSession) return;
    await window.myClawAPI.requestExecutionIntent(currentSession.id, intent);
  },

  async testModelProfileConnectivity(profileId) {
    const payload = await window.myClawAPI.testModelProfile(profileId);
    if (payload.profile) {
      set((state) => ({
        models: state.models.map((model) => (model.id === payload.profile?.id ? payload.profile : model)),
      }));
    }
    return payload;
  },

  async fetchModelCatalog(input) {
    const result = await window.myClawAPI.fetchModelCatalog(input);
    return result.modelIds;
  },

  async fetchAvailableModelIds(input) {
    const result = await window.myClawAPI.fetchAvailableModelIds(input);
    return result.modelIds;
  },

  async probeModelRoutes(input) {
    return window.myClawAPI.probeModelRoutesByConfig(input);
  },

  async createPublishDraft(data) {
    const result = await (window.myClawAPI as any).createPublishDraft(data);
    return result;
  },

  async loadBuiltinTools() {
    const payload = await window.myClawAPI.fetchBuiltinTools();
    set({ builtinTools: payload.items });
    return payload.items;
  },

  async loadMcpTools() {
    const payload = await window.myClawAPI.fetchMcpTools();
    const tools = payload.items ?? [];
    set({ mcpTools: tools });
    return tools;
  },

  async updateBuiltinToolPreference(toolId, pref) {
    const payload = await window.myClawAPI.updateBuiltinToolPreference(toolId, pref);
    set((s) => {
      const builtinTools = [...s.builtinTools];
      const index = builtinTools.findIndex((t) => t.id === toolId);
      if (index >= 0) {
        builtinTools[index] = payload.tool;
      }
      return { builtinTools };
    });
  },

  async updateMcpToolPreference(toolId, pref) {
    const payload = await window.myClawAPI.updateMcpToolPreference(toolId, pref);
    set((s) => {
      const mcpTools = [...s.mcpTools];
      const index = mcpTools.findIndex((t) => (t as any).id === toolId);
      if (index >= 0) {
        mcpTools[index] = payload.tool;
      }
      return { mcpTools };
    });
  },

  // -------------------------------------------------------------------------
  // WebPanel
  // -------------------------------------------------------------------------

  openWebPanel(viewPath, title, data) {
    set({
      webPanel: {
        ...get().webPanel,
        isOpen: true,
        viewPath,
        title,
        data,
      },
    });
  },

  closeWebPanel() {
    set({
      webPanel: {
        ...get().webPanel,
        isOpen: false,
        viewPath: null,
        title: "",
        data: null,
      },
    });
  },

  setWebPanelWidth(width) {
    set({
      webPanel: {
        ...get().webPanel,
        panelWidth: width,
      },
    });
  },

  updateWebPanelData(data) {
    const panel = get().webPanel;
    if (panel.isOpen) {
      set({
        webPanel: { ...panel, data },
      });
    }
  },
};
});
