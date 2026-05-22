import { create } from "zustand";

import type {
  AvailabilityPolicy,
  ArtifactRecord,
  ArtifactScopeRef,
  ApprovalDecision,
  ApprovalMode,
  ApprovalPolicy,
  ApprovalRequest,
  AgentTask,
  AgentTaskCreateInput,
  BackgroundTaskHandle,
  BuiltinToolApprovalMode,
  CalendarEvent,
  ChatSession,
  CloudProjectBinding,
  ExecutionRun,
  McpServer,
  McpServerConfig,
  ModelCatalogItem,
  ModelProfile,
  ModelRouteProbeResult,
  PersonalPromptProfile,
  ProjectCapabilityDetail,
  ProjectCapabilityLocalState,
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
import type { SessionPatchPayload } from "../../../shared/contracts/session-stream";

const WORKSPACE_SESSION_PATCH_DEBUG_LOGGING = resolveWorkspaceSessionPatchDebugLogging();

/** 读取 workspace 会话补丁调试日志开关，默认关闭以避免每个增量 patch 写 console。 */
function resolveWorkspaceSessionPatchDebugLogging(): boolean {
  try {
    return globalThis.localStorage?.getItem("MYCLAW_DEBUG_WORKSPACE_SESSION_PATCH") === "1";
  } catch {
    return false;
  }
}

/** 输出 workspace 会话补丁调试日志，仅在显式开启时写入 console。 */
function logWorkspaceSessionPatchDebug(message: string, detail: Record<string, unknown>): void {
  if (!WORKSPACE_SESSION_PATCH_DEBUG_LOGGING) {
    return;
  }
  console.debug(message, detail);
}

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

export type CloudProjectSummary = {
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

export type WebPanelTab = {
  id: string;
  viewPath: string | null;
  title: string;
  data: unknown;
  createdAt: string;
};

export type WorkspaceTimeState = {
  calendarEvents: CalendarEvent[];
  taskCommitments: TaskCommitment[];
  reminders: Reminder[];
  scheduleJobs: ScheduleJob[];
  executionRuns: ExecutionRun[];
  availabilityPolicy: AvailabilityPolicy | null;
  todayBrief: TodayBrief | null;
  awarenessSnapshot: Record<string, unknown> | null;
  awarenessDeliveries: Record<string, unknown>[];
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
    awarenessSnapshot: null,
    awarenessDeliveries: [],
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
  agentTasks: AgentTask[];
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
  cloudProjects: CloudProjectSummary[];
  projects: CloudProjectBinding[];
  projectDetails: Record<string, ProjectCapabilityDetail>;
  currentProjectBinding: CloudProjectBinding | null;
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
    tabs: WebPanelTab[];
    activeTabId: string | null;
  };

  // Derived (recalculated after set())
  currentSession: ChatSession | null;
  backgroundTaskSnapshot: BackgroundTaskSnapshot | null;
  artifactsByScope: ArtifactScopeMap;
  recentArtifacts: ArtifactRecord[];

  // 动作
  loadBootstrap: () => Promise<void>;
  selectSession: (sessionId: string) => void;
  loadSessionMessages: (sessionId: string) => Promise<void>;
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
  updateArtifactsRootPath: (path: string) => Promise<string>;
  markArtifactFinal: (artifactId: string, scope?: ArtifactScopeRef) => Promise<ArtifactRecord>;
  openArtifact: (artifactId: string) => Promise<void>;
  revealArtifact: (artifactId: string) => Promise<void>;
  applyArtifactEvent: (event: Record<string, unknown>) => void;
  applyAwarenessDelivery: (delivery: Record<string, unknown>) => void;

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
  loadCloudProjects: () => Promise<CloudProjectSummary[]>;

  loadCloudSkills: (query?: {
    category?: CloudSkillCategory;
    keyword?: string;
    sort?: "latest" | "downloads" | "name";
    tag?: string;
  }) => Promise<CloudSkillSummary[]>;
  loadCloudSkillDetail: (skillId: string) => Promise<CloudSkillDetail>;
  clearCloudSkillDetail: () => void;
  clearCloudHubDetail: () => void;
  loadProjects: () => Promise<CloudProjectBinding[]>;
  loadProjectDetail: (localProjectId: string) => Promise<ProjectCapabilityDetail>;
  bindSessionProject: (sessionId: string, localProjectId: string | null) => Promise<void>;
  loadSessionProjectBinding: (sessionId: string | null) => Promise<CloudProjectBinding | null>;
  setProjectCapabilityState: (capabilityRefId: string, localState: ProjectCapabilityLocalState) => Promise<ProjectCapabilityDetail>;
  bindCloudProject: (input: { cloudProjectId: string; sessionId?: string; accessToken?: string; accountId?: string }) => Promise<ProjectCapabilityDetail>;
  syncProjectRuntimeContext: (localProjectId: string) => Promise<ProjectCapabilityDetail>;
  installProjectCapability: (capabilityRefId: string) => Promise<ProjectCapabilityDetail | null>;
  confirmProjectMcpCapability: (input: {
    capabilityRefId: string;
    localConfirmed: boolean;
    secretsConfigured: boolean;
    allowExposeToModel: boolean;
  }) => Promise<ProjectCapabilityDetail>;

  addApprovalRequest: (request: ApprovalRequest) => void;
  removeApprovalRequest: (approvalId: string) => void;
  resolveApproval: (approvalId: string, decision: ApprovalDecision) => Promise<unknown>;
  updateApprovalPolicy: (input: Partial<ApprovalPolicy>) => Promise<ApprovalPolicy>;
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
  executeScheduleJobNow: (id: string) => Promise<ScheduleJob>;
  refreshExecutionRuns: () => Promise<ExecutionRun[]>;
  deleteExecutionRun: (id: string) => Promise<void>;
  deleteExecutionRunsByJob: (jobId: string) => Promise<void>;
  saveAvailabilityPolicy: (policy: AvailabilityPolicy) => Promise<AvailabilityPolicy>;
  refreshTodayBrief: () => Promise<TodayBrief>;
  suggestTimeboxes: () => Promise<SuggestedTimebox[]>;
  generateTodayDigest: (input: Record<string, unknown>) => Promise<string[]>;

  // ─── 值守 / Awareness ───
  loadAwarenessSnapshot: () => Promise<void>;
  createAwarenessRoutine: (input: Record<string, unknown>) => Promise<void>;
  updateAwarenessRoutine: (id: string, patch: Record<string, unknown>) => Promise<void>;
  deleteAwarenessRoutine: (id: string) => Promise<void>;
  pauseAwarenessRoutine: (id: string) => Promise<void>;
  resumeAwarenessRoutine: (id: string) => Promise<void>;
  runAwarenessRoutineNow: (id: string) => Promise<void>;
  dismissAwarenessSignal: (signalId: string) => Promise<void>;
  acknowledgeAwarenessSignal: (signalId: string) => Promise<void>;
  createStandingOrder: (input: Record<string, unknown>) => Promise<void>;
  deleteStandingOrder: (id: string) => Promise<void>;

  importCloudSkill: (input: { releaseId: string; skillName: string; siliconPersonId?: string }) => Promise<unknown>;
  importCloudMcp: (input: { releaseId?: string; servers?: McpServerConfig[]; manifest?: CloudHubManifest | Record<string, unknown>; siliconPersonId?: string }) => Promise<unknown>;
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
  createAgentTask: (input: AgentTaskCreateInput) => Promise<AgentTask>;
  cancelAgentTask: (taskId: string) => Promise<AgentTask>;
  retryAgentTask: (taskId: string) => Promise<AgentTask>;
  followUpAgentTask: (taskId: string, instruction: string) => Promise<AgentTask>;
  appendAgentTaskResultToSource: (taskId: string) => Promise<AgentTask>;
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
  deleteWorkflowRun: (runId: string) => Promise<{ success: boolean }>;

  // Skills
  refreshSkills: () => Promise<void>;
  openSkillsFolder: () => Promise<void>;
  loadSkillDetail: (skillId: string) => Promise<unknown>;

  // Missing actions used by pages
  pushAssistantMessage: (sessionId: string, content: string) => void;
  patchStreamingMessage: (sessionId: string, messageId: string, deltaContent: string | null, deltaReasoning?: string | null) => void;
  applySessionUpdate: (session: ChatSession) => void;
  /** 应用 main 进程发来的会话增量补丁，避免实时流全量替换 ChatSession。 */
  applySessionPatch: (patch: SessionPatchPayload) => void;
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
  selectWebPanelTab: (tabId: string) => void;
  closeWebPanelTab: (tabId: string) => void;
  createWebPanelTab: () => void;
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

/** 创建右侧面板 tab ID，避免同一路径多次打开时发生节点冲突。 */
function createWebPanelTabId(): string {
  return `web-panel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 从 tab 同步旧版单面板字段，兼容现有页面对 webPanel.viewPath/data 的读取。 */
function panelFieldsFromTab(tab: WebPanelTab | null): Pick<WorkspaceState["webPanel"], "viewPath" | "title" | "data" | "activeTabId"> {
  return {
    viewPath: tab?.viewPath ?? null,
    title: tab?.title ?? "",
    data: tab?.data ?? null,
    activeTabId: tab?.id ?? null,
  };
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

/** 将 scope 转成稳定的字符串 key，便于 store 按组缓存工作文件。 */
function artifactScopeKey(scope: ArtifactScopeRef): string {
  return `${scope.scopeKind}:${scope.scopeId}`;
}

/** 向文件列表中合并最新的 artifact 记录，并按更新时间降序排序。 */
function mergeArtifactRecord(list: ArtifactRecord[], artifact: ArtifactRecord): ArtifactRecord[] {
  const next = list.filter((item) => item.id !== artifact.id);
  next.unshift(artifact);
  return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** 从 session stream 事件中提取 artifact payload，兼容 payload 包裹与扁平结构。 */
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

// ---------------------------------------------------------------------------
// Markdown 渲染缓存 — 避免流式更新时对已完成消息重复调用 marked.parse()
// Key: `${messageId}:${contentHash}`
// ---------------------------------------------------------------------------

const _markdownCache = new Map<string, string>();

function contentHash(content: string): string {
  // Fast hash for cache key — not cryptographic, just needs to detect change
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

export function getCachedMarkdown(messageId: string, content: string, renderer: (c: string) => string): string {
  const key = `${messageId}:${contentHash(content)}`;
  const cached = _markdownCache.get(key);
  if (cached !== undefined) return cached;
  const html = renderer(content);
  _markdownCache.set(key, html);
  return html;
}

export function clearMarkdownCache() {
  _markdownCache.clear();
}

// ---------------------------------------------------------------------------
// Streaming token batch buffer
// ---------------------------------------------------------------------------

type StreamingBuffer = {
  sessionId: string;
  messageId: string;
  content: string;
  reasoning: string;
};

let _streamBuffer: StreamingBuffer | null = null;
let _streamRafId: number | null = null;

/** Flush accumulated streaming deltas into the store in a single update. */
function flushStreamBuffer() {
  _streamRafId = null;
  const buf = _streamBuffer;
  if (!buf) return;
  _streamBuffer = null;
  useWorkspaceStore.getState().patchStreamingMessage(
    buf.sessionId,
    buf.messageId,
    buf.content || null,
    buf.reasoning || null,
  );
}

/** Buffer a streaming delta and schedule a rAF flush (coalesces rapid deltas). */
export function bufferStreamingDelta(
  sessionId: string,
  messageId: string,
  deltaContent: string | null,
  deltaReasoning: string | null,
) {
  if (!_streamBuffer || _streamBuffer.sessionId !== sessionId || _streamBuffer.messageId !== messageId) {
    // New message — flush previous buffer immediately
    if (_streamBuffer && _streamRafId !== null) {
      cancelAnimationFrame(_streamRafId);
      flushStreamBuffer();
    }
    _streamBuffer = { sessionId, messageId, content: "", reasoning: "" };
  }
  if (deltaContent) _streamBuffer.content += deltaContent;
  if (deltaReasoning) _streamBuffer.reasoning += deltaReasoning;
  if (_streamRafId === null) {
    _streamRafId = requestAnimationFrame(flushStreamBuffer);
  }
}

/** Flush any pending streaming buffer immediately (call on stream end). */
export function flushStreamingBufferNow() {
  if (_streamRafId !== null) {
    cancelAnimationFrame(_streamRafId);
  }
  flushStreamBuffer();
}

/** Compute current session from state — only considers main chat sessions. */
function computeCurrentSession(
  sessions: ChatSession[],
  activeSessionId: string | null,
): ChatSession | null {
  const candidates = mainSessions(sessions);
  return candidates.find((s) => s.id === activeSessionId) ?? candidates[0] ?? null;
}

/**
 * 共享 in-flight 引用：让多个 fire-and-forget 的 refreshTodayBrief 调用合并为一次 IPC。
 * 必须放在 store factory 之外（store 实例化只跑一次，但每次 refresh 调用都会读写它）。
 */
let pendingTodayBriefRequest: Promise<TodayBrief> | null = null;

export const useWorkspaceStore = create<WorkspaceState>()((rawSet, get) => {
  let hasSubscribedToAppUpdates = false;
  let hasSubscribedToAgentTasks = false;
  let hasSubscribedToAwareness = false;

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
  agentTasks: [],
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
  cloudProjects: [],
  projects: [],
  projectDetails: {},
  currentProjectBinding: null,
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
    tabs: [],
    activeTabId: null,
  },

  currentSession: null,
  backgroundTaskSnapshot: null,
  artifactsByScope: {},
  recentArtifacts: [],

  // -------------------------------------------------------------------------
  // Bootstrap
  // -------------------------------------------------------------------------

  /** 加载桌面启动数据，并恢复当前会话的项目绑定显示。 */
  async loadBootstrap() {
    const state = get();
    if (state.ready || state.loading) {
      return;
    }

    set({ error: null, loading: true });
    try {
      const agentTaskRequest = window.myClawAPI.listAgentTasks
        ? window.myClawAPI.listAgentTasks().catch(() => ({ items: [] as AgentTask[] }))
        : Promise.resolve({ items: [] as AgentTask[] });
      const projectRequest = window.myClawAPI.projects?.listLocal
        ? window.myClawAPI.projects.listLocal().catch(() => ({ items: [] as CloudProjectBinding[] }))
        : Promise.resolve({ items: [] as CloudProjectBinding[] });
      const [payload, agentTaskPayload, projectPayload] = await Promise.all([
        window.myClawAPI.bootstrap(),
        agentTaskRequest,
        projectRequest,
      ]);
      const activeSessionId = getMostRecentSessionId(payload.sessions);
      let currentProjectBinding: CloudProjectBinding | null = null;
      if (activeSessionId && window.myClawAPI.projects?.getSessionBinding) {
        try {
          const binding = await window.myClawAPI.projects.getSessionBinding(activeSessionId);
          currentProjectBinding = (projectPayload.items ?? []).find((project) => project.id === binding.localProjectId) ?? null;
        } catch (bindingError) {
          console.warn("[workspace] 加载当前会话项目绑定失败", {
            sessionId: activeSessionId,
            error: bindingError instanceof Error ? bindingError.message : String(bindingError),
          });
        }
      }

      set({
        sessions: payload.sessions,
        activeSessionId,
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
        agentTasks: agentTaskPayload.items ?? [],
        workflows: payload.workflows ?? [],
        workflowSummaries: buildWorkflowSummaryMap(payload.workflows ?? []),
        workflowRuns: Object.fromEntries((payload.workflowRuns ?? []).map((r: unknown) => [(r as { id: string }).id, r])),
        cloudHubItems: payload.cloudHubItems ?? [],
        cloudHubDetail: payload.cloudHubDetail ?? null,
        cloudHubManifest: payload.cloudHubManifest ?? null,
        cloudProjects: payload.cloudProjects ?? [],
        projects: projectPayload.items ?? [],
        currentProjectBinding,
        projectDetails: {},
        approvals: payload.approvals ?? null,
        approvalRequests: payload.approvalRequests ?? [],
        personalPrompt: payload.personalPrompt ?? {
          prompt: "",
          summary: "",
          tags: [],
          updatedAt: null,
        },
        appUpdate: payload.updates ?? null,
        time: { ...createEmptyTimeState(), ...payload.time },
        ready: true,
        error: null,
      });

      if (!hasSubscribedToAppUpdates) {
        hasSubscribedToAppUpdates = true;
        window.myClawAPI.onAppUpdateStateChanged((updates) => {
          set({ appUpdate: updates as AppUpdateState });
        });
      }

      if (!hasSubscribedToAgentTasks && window.myClawAPI.onAgentTaskChanged) {
        hasSubscribedToAgentTasks = true;
        window.myClawAPI.onAgentTaskChanged((payload) => {
          if (!payload.task) return;
          set((current) => ({
            agentTasks: [
              payload.task,
              ...current.agentTasks.filter((item) => item.id !== payload.task.id),
            ],
          }));
        });
      }

      // 订阅感知状态变更事件
      if (!hasSubscribedToAwareness) {
        const api = (window as any).myClawAPI;
        if (api?.awareness?.onAwarenessChanged) {
          hasSubscribedToAwareness = true;
          api.awareness.onAwarenessChanged(() => {
            void get().loadAwarenessSnapshot();
          });
          api.awareness.onAwarenessDelivery?.((delivery: Record<string, unknown>) => {
            get().applyAwarenessDelivery(delivery);
          });
        }
      }

      // 加载初始感知快照
      void get().loadAwarenessSnapshot();

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
    void get().refreshTodayBrief();
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
    void get().refreshTodayBrief();
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
    void get().refreshTodayBrief();
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
    void get().refreshTodayBrief();
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
    void get().refreshTodayBrief();
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
    void get().refreshTodayBrief();
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
    void get().refreshTodayBrief();
  },

  async createScheduleJob(input) {
    const { item } = await window.myClawAPI.time.createScheduleJob(input);
    set((state) => ({
      time: {
        ...state.time,
        scheduleJobs: replaceTimeItem(state.time.scheduleJobs, item, "nextRunAt"),
      },
    }));
    void get().refreshTodayBrief();
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
    void get().refreshTodayBrief();
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
    void get().refreshTodayBrief();
  },

  async executeScheduleJobNow(id) {
    const { item } = await window.myClawAPI.time.runScheduleJobNow(id);
    const { items: executionRuns } = await window.myClawAPI.time.listExecutionRuns();
    set((state) => ({
      time: {
        ...state.time,
        scheduleJobs: replaceTimeItem(state.time.scheduleJobs, item, "nextRunAt"),
        executionRuns,
      },
    }));
    void get().refreshTodayBrief();
    return item;
  },

  async refreshExecutionRuns() {
    const { items: executionRuns } = await window.myClawAPI.time.listExecutionRuns();
    set((state) => ({
      time: {
        ...state.time,
        executionRuns,
      },
    }));
    return executionRuns;
  },

  async deleteExecutionRun(id: string) {
    await window.myClawAPI.time.deleteExecutionRun(id);
    await get().refreshExecutionRuns();
  },

  async deleteExecutionRunsByJob(jobId: string) {
    await window.myClawAPI.time.deleteExecutionRunsByJob(jobId);
    await get().refreshExecutionRuns();
  },

  async saveAvailabilityPolicy(policy) {
    const { policy: nextPolicy } = await window.myClawAPI.time.saveAvailabilityPolicy(policy);
    set((state) => ({
      time: {
        ...state.time,
        availabilityPolicy: nextPolicy,
      },
    }));
    void get().refreshTodayBrief();
    return nextPolicy;
  },

  async refreshTodayBrief() {
    // 请求合并：同一时刻多个调用方共享一个 IPC roundtrip。create/update 等 action 调用
    // 此方法（fire-and-forget），避免连续创建 5 个事件触发 5 次全表扫描串行 IPC。
    if (pendingTodayBriefRequest) return pendingTodayBriefRequest;
    pendingTodayBriefRequest = (async () => {
      try {
        const { brief } = await window.myClawAPI.time.getTodayBrief();
        set((state) => ({
          time: {
            ...state.time,
            todayBrief: brief,
          },
        }));
        return brief;
      } finally {
        pendingTodayBriefRequest = null;
      }
    })();
    return pendingTodayBriefRequest;
  },

  async suggestTimeboxes() {
    const { items } = await window.myClawAPI.time.suggestTimeboxes();
    return items;
  },

  async generateTodayDigest(input) {
    const { lines } = await window.myClawAPI.time.generateTodayDigest(input);
    return lines;
  },

  // ─── 值守 / Awareness ───────────────────────────────────────────────────

  async loadAwarenessSnapshot() {
    try {
      const api = (window as any).myClawAPI;
      if (!api?.awareness?.getSnapshot) return;
      const snapshot = await api.awareness.getSnapshot();
      set((s) => ({
        time: { ...s.time, awarenessSnapshot: snapshot as Record<string, unknown> },
      }));
    } catch (error) {
      console.warn("[workspace] loadAwarenessSnapshot 失败", { error: error instanceof Error ? error.message : String(error) });
    }
  },

  async createAwarenessRoutine(input: Record<string, unknown>) {
    try {
      const api = (window as any).myClawAPI;
      if (!api?.awareness?.createRoutine) return;
      await api.awareness.createRoutine(input);
      void get().loadAwarenessSnapshot();
    } catch (error) {
      console.warn("[workspace] createAwarenessRoutine 失败", { error: error instanceof Error ? error.message : String(error) });
    }
  },

  async updateAwarenessRoutine(id: string, patch: Record<string, unknown>) {
    try {
      const api = (window as any).myClawAPI;
      if (!api?.awareness?.updateRoutine) return;
      await api.awareness.updateRoutine(id, patch);
      void get().loadAwarenessSnapshot();
    } catch (error) {
      console.warn("[workspace] updateAwarenessRoutine 失败", { error: error instanceof Error ? error.message : String(error) });
    }
  },

  async deleteAwarenessRoutine(id: string) {
    try {
      const api = (window as any).myClawAPI;
      if (!api?.awareness?.deleteRoutine) return;
      await api.awareness.deleteRoutine(id);
      void get().loadAwarenessSnapshot();
    } catch (error) {
      console.warn("[workspace] deleteAwarenessRoutine 失败", { error: error instanceof Error ? error.message : String(error) });
    }
  },

  async pauseAwarenessRoutine(id: string) {
    try {
      const api = (window as any).myClawAPI;
      if (!api?.awareness?.pauseRoutine) return;
      await api.awareness.pauseRoutine(id);
      void get().loadAwarenessSnapshot();
    } catch (error) {
      console.warn("[workspace] pauseAwarenessRoutine 失败", { error: error instanceof Error ? error.message : String(error) });
    }
  },

  async resumeAwarenessRoutine(id: string) {
    try {
      const api = (window as any).myClawAPI;
      if (!api?.awareness?.resumeRoutine) return;
      await api.awareness.resumeRoutine(id);
      void get().loadAwarenessSnapshot();
    } catch (error) {
      console.warn("[workspace] resumeAwarenessRoutine 失败", { error: error instanceof Error ? error.message : String(error) });
    }
  },

  async runAwarenessRoutineNow(id: string) {
    try {
      const api = (window as any).myClawAPI;
      if (!api?.awareness?.runRoutineNow) return;
      await api.awareness.runRoutineNow(id);
      void get().loadAwarenessSnapshot();
    } catch (error) {
      console.warn("[workspace] runAwarenessRoutineNow 失败", { error: error instanceof Error ? error.message : String(error) });
    }
  },

  async dismissAwarenessSignal(signalId: string) {
    try {
      const api = (window as any).myClawAPI;
      if (!api?.awareness?.dismissSignal) return;
      await api.awareness.dismissSignal(signalId);
      void get().loadAwarenessSnapshot();
    } catch (error) {
      console.warn("[workspace] dismissAwarenessSignal 失败", { error: error instanceof Error ? error.message : String(error) });
    }
  },

  async acknowledgeAwarenessSignal(signalId: string) {
    try {
      const api = (window as any).myClawAPI;
      if (!api?.awareness?.acknowledgeSignal) return;
      await api.awareness.acknowledgeSignal(signalId);
      void get().loadAwarenessSnapshot();
    } catch (error) {
      console.warn("[workspace] acknowledgeAwarenessSignal 失败", { error: error instanceof Error ? error.message : String(error) });
    }
  },

  async createStandingOrder(input: Record<string, unknown>) {
    try {
      const api = (window as any).myClawAPI;
      if (!api?.standingOrders?.create) return;
      await api.standingOrders.create(input);
      void get().loadAwarenessSnapshot();
    } catch (error) {
      console.warn("[workspace] createStandingOrder 失败", { error: error instanceof Error ? error.message : String(error) });
    }
  },

  async deleteStandingOrder(id: string) {
    try {
      const api = (window as any).myClawAPI;
      if (!api?.standingOrders?.delete) return;
      await api.standingOrders.delete(id);
      void get().loadAwarenessSnapshot();
    } catch (error) {
      console.warn("[workspace] deleteStandingOrder 失败", { error: error instanceof Error ? error.message : String(error) });
    }
  },

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /** 选择主聊天会话，并同步刷新该会话的项目绑定显示。 */
  selectSession(sessionId) {
    if (get().sessions.some((s) => s.id === sessionId)) {
      set({ activeSessionId: sessionId });
      void get().loadSessionProjectBinding(sessionId);
    }
  },

  async loadSessionMessages(sessionId) {
    try {
      const messages = await window.myClawAPI.getSessionMessages(sessionId);
      set((s) => {
        const sessions = [...s.sessions];
        const idx = sessions.findIndex((item) => item.id === sessionId);
        if (idx >= 0) {
          const session = sessions[idx]!;
          // 只在消息确实为空时填充，避免覆盖已更新的消息
          if (session.messages.length === 0) {
            sessions[idx] = { ...session, messages };
          }
        }
        return { sessions };
      });
    } catch (error) {
      console.error("[workspace] 加载会话消息失败", { sessionId, error: error instanceof Error ? error.message : String(error) });
    }
  },

  /** 新建主聊天会话，新会话默认没有项目绑定。 */
  async createSession() {
    const payload = await window.myClawAPI.createSession();
    console.info("[workspace] 新建会话并清空当前项目绑定显示", { sessionId: payload.session.id });
    set((s) => ({
      sessions: [payload.session, ...s.sessions],
      activeSessionId: payload.session.id,
      currentProjectBinding: null,
    }));
    return payload.session;
  },

  /** 删除主聊天会话，并把新的当前会话项目绑定刷新到 store。 */
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
    void get().loadSessionProjectBinding(get().activeSessionId);

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

    if (payload?.time) {
      set((s) => ({ time: { ...s.time, ...payload.time } }));
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

  /** 按当前 scope 加载工作文件列表，同步写入 store 缓存。 */
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

  /** 加载全局最近产出的工作文件，供 Files 工作台与快捷入口共享。 */
  async loadRecentArtifacts(input) {
    const artifacts = await window.myClawAPI.listRecentArtifacts(input ?? {});
    set({ recentArtifacts: artifacts });
    return artifacts;
  },

  /** 更新 Files 产物目录，并让后续工具生成与登记使用新路径。 */
  async updateArtifactsRootPath(path) {
    const payload = await window.myClawAPI.updateArtifactsRootPath(path);
    set({ artifactsRootPath: payload.artifactsRootPath });
    return payload.artifactsRootPath;
  },

  /** 将指定 artifact 提升为最终交付，并回写到本地缓存。 */
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

  /** 打开指定文件，并让本地缓存的访问时间同步更新。 */
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

  /** 在系统文件管理器中定位到指定文件，不改写本地状态。 */
  async revealArtifact(artifactId) {
    await window.myClawAPI.revealArtifact(artifactId);
  },

  /** 消费主进程流推送的 artifact 事件，最小更新 store 缓存。 */
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

  /** 将值守投递事件写入时间中心状态，供今日补看和入口徽标消费。 */
  applyAwarenessDelivery(delivery) {
    set((state) => ({
      time: {
        ...state.time,
        awarenessDeliveries: [
          delivery,
          ...state.time.awarenessDeliveries.filter((item) => item.id !== delivery.id),
        ].slice(0, 50),
      },
    }));
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

  /** 加载 Cloud 项目摘要列表，供 Hub 项目入口下载和更新本地绑定。 */
  async loadCloudProjects() {
    console.info("[workspace] 加载 Cloud 项目列表");
    const projects = await window.myClawAPI.fetchCloudProjects();
    set({ cloudProjects: projects });
    return projects;
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
    console.info("[workspace] 加载 Cloud Skill 详情", { skillId });
    const detail = await window.myClawAPI.fetchCloudSkillDetail(skillId);
    if (!detail) {
      console.info("[workspace] Cloud Skill 详情不存在或已下架", { skillId });
      throw new Error(`云端 Skill 不存在或已下架：${skillId}`);
    }
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
  // Projects
  // -------------------------------------------------------------------------

  /** 加载本机已绑定项目列表。 */
  async loadProjects() {
    console.info("[workspace] 加载本机绑定项目列表");
    const payload = await window.myClawAPI.projects.listLocal();
    set({ projects: payload.items ?? [] });
    return payload.items ?? [];
  },

  /** 加载项目能力详情并缓存到 store。 */
  async loadProjectDetail(localProjectId) {
    console.info("[workspace] 加载项目能力详情", { localProjectId });
    const detail = await window.myClawAPI.projects.getDetail(localProjectId);
    set((state) => ({
      projectDetails: {
        ...state.projectDetails,
        [localProjectId]: detail,
      },
    }));
    return detail;
  },

  /** 将指定会话绑定到本地项目，传 null 表示解绑。 */
  async bindSessionProject(sessionId, localProjectId) {
    console.info("[workspace] 绑定会话项目", { sessionId, localProjectId });
    await window.myClawAPI.projects.bindSession({ sessionId, localProjectId });
    const currentProjectBinding = localProjectId
      ? get().projects.find((project) => project.id === localProjectId) ?? null
      : null;
    set({ currentProjectBinding });
  },

  /** 查询指定会话当前绑定项目，并更新顶部运行时显示。 */
  async loadSessionProjectBinding(sessionId) {
    if (!sessionId) {
      set({ currentProjectBinding: null });
      return null;
    }
    console.info("[workspace] 查询会话项目绑定", { sessionId });
    const payload = await window.myClawAPI.projects.getSessionBinding(sessionId);
    const currentProjectBinding = payload.localProjectId
      ? get().projects.find((project) => project.id === payload.localProjectId) ?? null
      : null;
    set({ currentProjectBinding });
    return currentProjectBinding;
  },

  /** 更新项目能力本地启停状态。 */
  async setProjectCapabilityState(capabilityRefId, localState) {
    console.info("[workspace] 更新项目能力本地状态", { capabilityRefId, localState });
    const detail = await window.myClawAPI.projects.setCapabilityState({ capabilityRefId, localState });
    set((state) => ({
      projectDetails: {
        ...state.projectDetails,
        [detail.project.id]: detail,
      },
    }));
    return detail;
  },

  /** 手动同步指定本地项目的 Cloud runtime-context。 */
  async syncProjectRuntimeContext(localProjectId) {
    console.info("[workspace] 同步项目运行上下文", { localProjectId });
    const detail = await window.myClawAPI.projects.sync({ localProjectId });
    set((state) => ({
      projects: [
        detail.project,
        ...state.projects.filter((project) => project.id !== detail.project.id),
      ],
      currentProjectBinding:
        state.currentProjectBinding?.id === detail.project.id
          ? detail.project
          : state.currentProjectBinding,
      projectDetails: {
        ...state.projectDetails,
        [detail.project.id]: detail,
      },
    }));
    return detail;
  },

  /** 安装项目 Skill 工件并重新加载项目详情。 */
  async installProjectCapability(capabilityRefId) {
    console.info("[workspace] 安装项目能力", { capabilityRefId });
    await window.myClawAPI.projects.installCapability({ capabilityRefId });
    const detail = Object.values(get().projectDetails)
      .find((candidate) => candidate.refs.some((ref) => ref.id === capabilityRefId));
    return detail ? get().loadProjectDetail(detail.project.id) : null;
  },

  /** 确认项目 MCP 本地安全策略，不写入任何 secret。 */
  async confirmProjectMcpCapability(input) {
    console.info("[workspace] 确认项目 MCP 本地策略", {
      capabilityRefId: input.capabilityRefId,
      localConfirmed: input.localConfirmed,
      allowExposeToModel: input.allowExposeToModel,
    });
    const detail = await window.myClawAPI.projects.confirmMcpCapability(input);
    set((state) => ({
      projectDetails: {
        ...state.projectDetails,
        [detail.project.id]: detail,
      },
    }));
    return detail;
  },

  /** 绑定 Cloud 项目到本机，并按需绑定当前会话。 */
  async bindCloudProject(input) {
    console.info("[workspace] 绑定 Cloud 项目", {
      cloudProjectId: input.cloudProjectId,
      sessionId: input.sessionId ?? null,
    });
    const detail = await window.myClawAPI.projects.bindCloudProject(input);
    set((state) => ({
      projects: [
        detail.project,
        ...state.projects.filter((project) => project.id !== detail.project.id),
      ],
      currentProjectBinding: input.sessionId ? detail.project : state.currentProjectBinding,
      projectDetails: {
        ...state.projectDetails,
        [detail.project.id]: detail,
      },
    }));
    return detail;
  },

  // -------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------

  addApprovalRequest(request: ApprovalRequest) {
    set((s) => ({
      approvalRequests: [
        ...s.approvalRequests.filter((item) => item.id !== request.id),
        request,
      ],
    }));
  },

  removeApprovalRequest(approvalId: string) {
    set((s) => ({
      approvalRequests: s.approvalRequests.filter((r) => r.id !== approvalId),
    }));
  },

  async resolveApproval(approvalId, decision) {
    const payload = await window.myClawAPI.resolveApproval(approvalId, decision);
    set((s) => ({
      approvals: payload.approvals ?? s.approvals,
      approvalRequests: payload.approvalRequests ?? s.approvalRequests.filter((r) => r.id !== approvalId),
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
      ...(input.siliconPersonId ? { siliconPersonId: input.siliconPersonId } : {}),
    });
    if (input.siliconPersonId) {
      console.info("[workspace] 已安装 Cloud Skill 到硅基员工目录", {
        siliconPersonId: input.siliconPersonId,
        releaseId: input.releaseId,
      });
      return payload;
    }
    set({ skills: payload.skills?.items ?? get().skills, skillDetails: {} });
    return payload;
  },

  async importCloudMcp(input) {
    const payload = await window.myClawAPI.importCloudMcp(input);
    if (input.siliconPersonId) {
      console.info("[workspace] 已安装 Cloud MCP 到硅基员工配置", {
        siliconPersonId: input.siliconPersonId,
      });
      return payload;
    }
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

  /** 创建 Agent Task，并把任务卡同步到当前工作区状态。 */
  async createAgentTask(input) {
    console.info("[workspace] 创建硅基员工 Agent Task", {
      sourceSessionId: input.sourceSessionId,
      assigneeIds: input.assigneeIds,
      instructionLength: input.instruction.trim().length,
    });
    const payload = await window.myClawAPI.createAgentTask(input);
    set((state) => ({
      agentTasks: [
        payload.task,
        ...state.agentTasks.filter((item) => item.id !== payload.task.id),
      ],
    }));
    return payload.task;
  },

  /** 取消 Agent Task，并同步任务卡状态。 */
  async cancelAgentTask(taskId) {
    console.info("[workspace] 取消硅基员工 Agent Task", { taskId });
    const payload = await window.myClawAPI.cancelAgentTask(taskId);
    set((state) => ({
      agentTasks: [
        payload.task,
        ...state.agentTasks.filter((item) => item.id !== payload.task.id),
      ],
    }));
    return payload.task;
  },

  /** 重试 Agent Task，并同步新的子会话与执行状态。 */
  async retryAgentTask(taskId) {
    console.info("[workspace] 重试硅基员工 Agent Task", { taskId });
    const payload = await window.myClawAPI.retryAgentTask(taskId);
    set((state) => ({
      agentTasks: [
        payload.task,
        ...state.agentTasks.filter((item) => item.id !== payload.task.id),
      ],
    }));
    return payload.task;
  },

  /** 创建 Agent Task 追问，并把追问任务加入任务流。 */
  async followUpAgentTask(taskId, instruction) {
    console.info("[workspace] 创建硅基员工 Agent Task 追问", {
      taskId,
      instructionLength: instruction.trim().length,
    });
    const payload = await window.myClawAPI.followUpAgentTask(taskId, instruction);
    set((state) => ({
      agentTasks: [
        payload.task,
        ...state.agentTasks.filter((item) => item.id !== payload.task.id),
      ],
    }));
    return payload.task;
  },

  /** 把已完成 Agent Task 的结果追加到来源主会话，后台负责持久化与去重。 */
  async appendAgentTaskResultToSource(taskId) {
    console.info("[workspace] 追加硅基员工 Agent Task 结果到主会话", { taskId });
    const payload = await window.myClawAPI.appendAgentTaskResultToSource(taskId);
    set((state) => ({
      agentTasks: [
        payload.task,
        ...state.agentTasks.filter((item) => item.id !== payload.task.id),
      ],
    }));
    return payload.task;
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

  async deleteWorkflowRun(runId: string) {
    const payload = await window.myClawAPI.deleteWorkflowRun(runId);
    if (payload.success) {
      set((s) => {
        const { [runId]: _removed, ...rest } = s.workflowRuns as Record<string, unknown>;
        return { workflowRuns: rest };
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
    // Fast path: use rawSet to avoid computeCurrentSession overhead on every token.
    // We know which session is being patched, so we can update currentSession directly.
    const state = get();
    const sessionIndex = state.sessions.findIndex((item) => item.id === sessionId);
    if (sessionIndex < 0) return;
    const session = state.sessions[sessionIndex]!;
    const msgIndex = session.messages.findIndex((m) => m.id === messageId);

    let newMessages: typeof session.messages;
    if (msgIndex >= 0) {
      const existing = session.messages[msgIndex]!;
      const patched: typeof existing = {
        ...existing,
        content: existing.content + (deltaContent ?? ""),
        ...(deltaReasoning ? { reasoning: (existing.reasoning ?? "") + deltaReasoning } : {}),
      };
      newMessages = [...session.messages];
      newMessages[msgIndex] = patched;
    } else {
      newMessages = [...session.messages, {
        id: messageId,
        role: "assistant" as const,
        content: deltaContent ?? "",
        ...(deltaReasoning ? { reasoning: deltaReasoning } : {}),
        createdAt: new Date().toISOString(),
      }];
    }

    const newSession = { ...session, messages: newMessages };
    const newSessions = [...state.sessions];
    newSessions[sessionIndex] = newSession;

    // Update currentSession directly if this is the active session
    const isCurrentSession = state.currentSession?.id === sessionId;
    rawSet({
      sessions: newSessions,
      ...(isCurrentSession ? { currentSession: newSession } : {}),
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

      // 同步 patch 对应硅基员工的 session summary：仅推导 needsApproval
      // （chatRunState.phase === "approval" 即 pending approval），
      // unreadCount/hasUnread/status 等字段由 loadSiliconPersonById 兜底刷新。
      const siliconPersonId = updatedSession.siliconPersonId;
      if (!siliconPersonId) {
        return { sessions };
      }
      const personIndex = s.siliconPersons.findIndex((p) => p.id === siliconPersonId);
      if (personIndex < 0) {
        return { sessions };
      }
      const person = s.siliconPersons[personIndex]!;
      const summaryIndex = person.sessions.findIndex((it) => it.id === updatedSession.id);
      if (summaryIndex < 0) {
        return { sessions };
      }

      const phase = updatedSession.chatRunState?.phase;
      const nextNeedsApproval = phase === "approval";
      const prevSummary = person.sessions[summaryIndex]!;
      if (prevSummary.needsApproval === nextNeedsApproval) {
        return { sessions };
      }
      const nextSummaries = person.sessions.map((item, i) =>
        i === summaryIndex ? { ...item, needsApproval: nextNeedsApproval } : item,
      );
      const nextPerson = {
        ...person,
        sessions: nextSummaries,
        needsApproval: nextSummaries.some((it) => it.needsApproval),
      };
      const siliconPersons = s.siliconPersons.map((p, i) => (i === personIndex ? nextPerson : p));
      return { sessions, siliconPersons };
    });
  },

  applySessionPatch(patch) {
    set((s) => {
      const patchSession = (session: ChatSession): ChatSession => {
        if (session.id !== patch.sessionId) {
          return session;
        }
        switch (patch.kind) {
          case "session.fields":
            return { ...session, ...patch.fields, id: session.id };
          case "messages.append": {
            const existingIds = new Set(session.messages.map((message) => message.id));
            const appended = patch.messages.filter((message) => !existingIds.has(message.id));
            return appended.length > 0
              ? { ...session, messages: [...session.messages, ...appended] }
              : session;
          }
          case "messages.update":
            return {
              ...session,
              messages: session.messages.map((message) =>
                message.id === patch.messageId ? { ...message, ...patch.fields, id: message.id } : message,
              ),
            };
          case "tasks.replace":
            return { ...session, tasks: patch.tasks };
          case "runState.set":
            return { ...session, chatRunState: patch.chatRunState };
          default:
            console.warn("[workspace] 收到未知会话补丁，已忽略", {
              sessionId: (patch as { sessionId?: string }).sessionId,
              kind: (patch as { kind?: string }).kind,
            });
            return session;
        }
      };

      const sessions = s.sessions.map(patchSession);
      const currentSession = s.currentSession?.id === patch.sessionId
        ? patchSession(s.currentSession)
        : s.currentSession;
      logWorkspaceSessionPatchDebug("[workspace] 已应用会话增量补丁", {
        sessionId: patch.sessionId,
        kind: patch.kind,
        revision: patch.revision,
      });
      return { sessions, currentSession };
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
    const current = get().webPanel;
    const existingIndex = current.tabs.findIndex((tab) => tab.viewPath === viewPath);
    const nextTab: WebPanelTab = existingIndex >= 0
      ? {
          ...current.tabs[existingIndex]!,
          title,
          data,
        }
      : {
          id: createWebPanelTabId(),
          viewPath,
          title,
          data,
          createdAt: new Date().toISOString(),
        };
    const tabs = existingIndex >= 0
      ? current.tabs.map((tab, index) => (index === existingIndex ? nextTab : tab))
      : [...current.tabs, nextTab];
    console.info("[workspace] 打开右侧 WebPanel 标签页", {
      tabId: nextTab.id,
      title,
      viewPath,
      reused: existingIndex >= 0,
    });
    set({
      webPanel: {
        ...current,
        isOpen: true,
        tabs,
        ...panelFieldsFromTab(nextTab),
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
        tabs: [],
        activeTabId: null,
      },
    });
  },

  selectWebPanelTab(tabId) {
    const panel = get().webPanel;
    const tab = panel.tabs.find((item) => item.id === tabId) ?? null;
    if (!tab) return;
    console.info("[workspace] 切换右侧 WebPanel 标签页", {
      tabId,
      title: tab.title,
      viewPath: tab.viewPath,
    });
    set({
      webPanel: {
        ...panel,
        isOpen: true,
        ...panelFieldsFromTab(tab),
      },
    });
  },

  closeWebPanelTab(tabId) {
    const panel = get().webPanel;
    const closeIndex = panel.tabs.findIndex((tab) => tab.id === tabId);
    if (closeIndex < 0) return;
    const closingTab = panel.tabs[closeIndex]!;
    const tabs = panel.tabs.filter((tab) => tab.id !== tabId);
    const fallbackTab = tabs[Math.max(0, closeIndex - 1)] ?? tabs[0] ?? null;
    console.info("[workspace] 关闭右侧 WebPanel 标签页", {
      tabId,
      title: closingTab.title,
      remainingTabs: tabs.length,
    });
    set({
      webPanel: {
        ...panel,
        isOpen: tabs.length > 0,
        tabs,
        ...panelFieldsFromTab(fallbackTab),
      },
    });
  },

  createWebPanelTab() {
    const panel = get().webPanel;
    const tab: WebPanelTab = {
      id: createWebPanelTabId(),
      viewPath: null,
      title: "新面板",
      data: null,
      createdAt: new Date().toISOString(),
    };
    console.info("[workspace] 新增右侧空白 WebPanel 标签页", { tabId: tab.id });
    set({
      webPanel: {
        ...panel,
        isOpen: true,
        tabs: [...panel.tabs, tab],
        ...panelFieldsFromTab(tab),
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
      const tabs = panel.tabs.map((tab) =>
        tab.id === panel.activeTabId ? { ...tab, data } : tab,
      );
      set({
        webPanel: { ...panel, tabs, data },
      });
    }
  },
};
});
