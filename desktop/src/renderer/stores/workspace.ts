import { create } from "zustand";

import type {
  ApprovalDecision,
  ApprovalMode,
  ApprovalPolicy,
  ApprovalRequest,
  BuiltinToolApprovalMode,
  ChatSession,
  LocalEmployeeSummary,
  McpServer,
  McpServerConfig,
  ModelCatalogItem,
  ModelProfile,
  ResolvedBuiltinTool,
  ResolvedMcpTool,
  SkillDefinition,
  WorkflowDefinitionSummary,
} from "../../../shared/contracts";

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
  employees: LocalEmployeeSummary[];
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

  // Actions
  loadBootstrap: () => Promise<void>;
  selectSession: (sessionId: string) => void;
  createSession: () => Promise<ChatSession>;
  deleteSession: (sessionId: string) => Promise<unknown>;
  sendMessage: (content: string, options?: {
    onMessageStream?: (snapshot: unknown) => void;
  }) => Promise<void>;

  createModelProfile: (input: Omit<ModelProfile, "id">) => Promise<ModelProfile>;
  updateModelProfile: (profileId: string, input: Omit<ModelProfile, "id">) => Promise<ModelProfile>;
  deleteModelProfile: (profileId: string) => Promise<unknown>;
  setDefaultModelProfile: (profileId: string) => Promise<void>;
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

  importCloudSkill: (input: { releaseId: string; skillName: string }) => Promise<unknown>;
  importCloudMcp: (input: { releaseId: string; servers: McpServerConfig[] }) => Promise<unknown>;
  importCloudEmployeePackage: (input: {
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
  loadEmployees: () => Promise<LocalEmployeeSummary[]>;
  loadEmployeeById: (employeeId: string) => Promise<LocalEmployeeSummary>;
  createEmployee: (input: { name: string; description: string; [key: string]: unknown }) => Promise<LocalEmployeeSummary>;
  updateEmployee: (employeeId: string, input: Partial<LocalEmployeeSummary & { workflowIds: string[] }>) => Promise<LocalEmployeeSummary>;

  // Workflows
  loadWorkflows: () => Promise<WorkflowDefinitionSummary[]>;
  loadWorkflowById: (workflowId: string) => Promise<unknown>;
  createWorkflow: (input: { name: string; description?: string }) => Promise<unknown>;
  updateWorkflow: (workflowId: string, input: unknown) => Promise<unknown>;
  loadWorkflowRuns: () => Promise<unknown[]>;
  startWorkflowRun: (workflowId: string) => Promise<unknown>;
  resumeWorkflowRun: (runId: string) => Promise<unknown>;

  // Skills
  loadSkillDetail: (skillId: string) => Promise<unknown>;

  // Missing actions used by pages
  pushAssistantMessage: (sessionId: string, content: string) => void;
  patchStreamingMessage: (sessionId: string, messageId: string, deltaContent: string) => void;
  applySessionUpdate: (session: ChatSession) => void;
  requestExecutionIntent: (intent: any) => Promise<void>;
  testModelProfileConnectivity: (profileId: string) => Promise<{ success: boolean; error?: string }>;
  fetchModelCatalog: (input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">) => Promise<ModelCatalogItem[]>;
  fetchAvailableModelIds: (input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">) => Promise<string[]>;
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
// Helpers
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

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** Pick the most recently active session (by last message time, then createdAt). */
function getMostRecentSessionId(sessions: ChatSession[]): string | null {
  if (sessions.length === 0) return null;
  const getLastActivity = (s: ChatSession): string => {
    if (s.messages.length > 0) {
      const last = s.messages[s.messages.length - 1];
      if (last.createdAt) return last.createdAt;
    }
    return s.createdAt || "";
  };
  const sorted = [...sessions].sort((a, b) =>
    getLastActivity(b).localeCompare(getLastActivity(a))
  );
  return sorted[0].id;
}

/** Compute current session from state. */
function computeCurrentSession(
  sessions: ChatSession[],
  activeSessionId: string | null,
): ChatSession | null {
  return sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;
}

export const useWorkspaceStore = create<WorkspaceState>()((rawSet, get) => {
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
  employees: [],
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

  webPanel: {
    isOpen: false,
    viewPath: null,
    title: "",
    data: null,
    panelWidth: 420,
  },

  currentSession: null,

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
        employees: payload.employees ?? [],
        workflows: payload.workflows ?? [],
        workflowSummaries: buildWorkflowSummaryMap(payload.workflows ?? []),
        workflowRuns: Object.fromEntries((payload.workflowRuns ?? []).map((r: unknown) => [(r as { id: string }).id, r])),
        cloudHubItems: payload.cloudHubItems ?? [],
        cloudHubDetail: payload.cloudHubDetail ?? null,
        cloudHubManifest: payload.cloudHubManifest ?? null,
        approvals: payload.approvals ?? null,
        approvalRequests: payload.approvalRequests ?? [],
        ready: true,
        error: null,
      });

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
    return payload;
  },

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  async sendMessage(content, options = {}) {
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

    const payload = await window.myClawAPI.sendMessage(
      currentSession.id,
      trimmed,
      options.onMessageStream
        ? { onSnapshot: options.onMessageStream }
        : undefined,
    );

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
    const payload = await window.myClawAPI.setDefaultModelProfile(profileId);
    set({ defaultModelProfileId: payload.defaultModelProfileId });
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

  async importCloudEmployeePackage(input) {
    if (input.manifest.kind !== "employee-package") {
      throw new Error("Cloud manifest is not an employee package.");
    }
    const token = await window.myClawAPI.fetchCloudHubDownloadToken(input.releaseId);
    const payload = await window.myClawAPI.installEmployeePackageFromCloud({
      itemId: input.itemId,
      releaseId: input.releaseId,
      name: input.name,
      ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
      downloadUrl: token.downloadUrl,
      manifest: input.manifest,
    });
    set({ employees: payload.items ?? get().employees });
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

  async loadEmployees() {
    const payload = await window.myClawAPI.fetchEmployees();
    set({ employees: payload.items });
    return payload.items;
  },

  async loadEmployeeById(employeeId) {
    const payload = await window.myClawAPI.getEmployee(employeeId);
    set((s) => {
      const employees = [...s.employees];
      const index = employees.findIndex((e) => e.id === employeeId);
      if (index >= 0) {
        employees[index] = payload.employee;
      } else {
        employees.unshift(payload.employee);
      }
      return { employees };
    });
    return payload.employee;
  },

  async createEmployee(input) {
    const payload = await window.myClawAPI.createEmployee(input as Parameters<typeof window.myClawAPI.createEmployee>[0]);
    set({ employees: payload.items });
    return payload.employee;
  },

  async updateEmployee(employeeId, input) {
    const payload = await window.myClawAPI.updateEmployee(employeeId, input as Parameters<typeof window.myClawAPI.updateEmployee>[1]);
    set((s) => {
      const employees = [...s.employees];
      const index = employees.findIndex((e) => e.id === employeeId);
      if (index >= 0) {
        employees[index] = payload.employee;
      } else {
        employees.unshift(payload.employee);
      }
      return { employees };
    });
    return payload.employee;
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

  async startWorkflowRun(workflowId) {
    const payload = await window.myClawAPI.startWorkflowRun({ workflowId });
    set((s) => ({
      workflowRuns: {
        ...s.workflowRuns,
        ...Object.fromEntries(payload.items.map((r) => [(r as { id: string }).id, r])),
        [(payload.run as { id: string }).id]: payload.run,
      },
    }));
    return payload.run;
  },

  async resumeWorkflowRun(runId) {
    const payload = await window.myClawAPI.resumeWorkflowRun(runId);
    set((s) => ({
      workflowRuns: {
        ...s.workflowRuns,
        ...Object.fromEntries(payload.items.map((r) => [(r as { id: string }).id, r])),
        [(payload.run as { id: string }).id]: payload.run,
      },
    }));
    return payload.run;
  },

  // -------------------------------------------------------------------------
  // Skills
  // -------------------------------------------------------------------------

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

  patchStreamingMessage(sessionId, messageId, deltaContent) {
    set((s) => {
      const sessionIndex = s.sessions.findIndex((item) => item.id === sessionId);
      if (sessionIndex < 0) return {};
      const session = s.sessions[sessionIndex]!;
      const msgIndex = session.messages.findIndex((m) => m.id === messageId);

      let newMessages: typeof session.messages;
      if (msgIndex >= 0) {
        // Append delta to existing streaming message — only copy the messages array
        const existing = session.messages[msgIndex]!;
        newMessages = [...session.messages];
        newMessages[msgIndex] = { ...existing, content: existing.content + deltaContent };
      } else {
        // Create a new in-progress assistant message
        newMessages = [...session.messages, {
          id: messageId,
          role: "assistant" as const,
          content: deltaContent,
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

  async requestExecutionIntent(intent) {
    const { currentSession } = get();
    if (!currentSession) return;
    await window.myClawAPI.requestExecutionIntent(currentSession.id, intent);
  },

  async testModelProfileConnectivity(profileId) {
    return window.myClawAPI.testModelProfile(profileId);
  },

  async fetchAvailableModelIds(input) {
    const result = await window.myClawAPI.fetchAvailableModelIds(input);
    return result.modelIds;
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
