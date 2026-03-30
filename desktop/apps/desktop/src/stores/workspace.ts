import type {
  ApprovalDecision,
  ApprovalMode,
  ApprovalPolicy,
  ApprovalRequest,
  BuiltinToolApprovalMode,
  ChatSession,
  ExecutionIntent,
  LocalEmployeeSummary,
  McpServer,
  McpServerConfig,
  ModelProfile,
  ResolvedMcpTool,
  ResolvedBuiltinTool,
  SkillDetail,
  SkillDefinition,
  WorkflowDefinition,
  WorkflowDefinitionSummary,
  WorkflowRunSummary,
  WorkflowSummary,
} from "@myclaw-desktop/shared";
import { defineStore } from "pinia";

import type {
  CloudDownloadToken,
  CloudHubItem,
  CloudHubItemDetail,
  CloudHubItemType,
  CloudHubManifest,
} from "@/services/cloud-hub-client";
import {
  fetchCloudHubDetail,
  fetchCloudHubDownloadToken,
  fetchCloudHubItems,
  fetchCloudHubManifest,
} from "@/services/cloud-hub-client";
import {
  createEmployee as createEmployeeRequest,
  createWorkflow as createWorkflowRequest,
  createModelProfile as createModelProfileRequest,
  createSession as createSessionRequest,
  createMcpServer as createMcpServerRequest,
  fetchEmployees as fetchEmployeesRequest,
  deleteSession as deleteSessionRequest,
  deleteMcpServer as deleteMcpServerRequest,
  deleteModelProfile as deleteModelProfileRequest,
  fetchBuiltinTools,
  fetchBootstrap,
  fetchSkillDetail as fetchSkillDetailRequest,
  fetchWorkflowRuns as fetchWorkflowRunsRequest,
  fetchWorkflows as fetchWorkflowsRequest,
  getEmployee as getEmployeeRequest,
  getWorkflow as getWorkflowRequest,
  fetchMcpTools,
  fetchMcpServers,
  importCloudSkillRelease as importCloudSkillReleaseRequest,
  installEmployeePackageFromCloud as installEmployeePackageFromCloudRequest,
  installWorkflowPackageFromCloud as installWorkflowPackageFromCloudRequest,
  importMcpServers as importMcpServersRequest,
  postSessionMessageStream,
  refreshMcpServer as refreshMcpServerRequest,
  requestExecutionIntent as requestExecutionIntentRequest,
  resolveApproval as resolveApprovalRequest,
  setDefaultModelProfile as setDefaultModelProfileRequest,
  testModelProfile as testModelProfileRequest,
  updateBuiltinToolPreference as updateBuiltinToolPreferenceRequest,
  updateEmployee as updateEmployeeRequest,
  updateMcpToolPreference as updateMcpToolPreferenceRequest,
  updateMcpServer as updateMcpServerRequest,
  updateModelProfile as updateModelProfileRequest,
  updateWorkflow as updateWorkflowRequest,
  startWorkflowRun as startWorkflowRunRequest,
  resumeWorkflowRun as resumeWorkflowRunRequest,
  updateApprovalPolicy as updateApprovalPolicyRequest,
  createPublishDraft as createPublishDraftRequest,
  type CreateEmployeeInput,
  type CreateWorkflowInput,
  type UpdateEmployeeInput,
  type UpdateWorkflowInput,
} from "@/services/runtime-client";
import { useShellStore } from "@/stores/shell";

function isConfiguredModelProfile(profile: ModelProfile): boolean {
  const apiKey = profile.apiKey.trim();
  return Boolean(profile.baseUrl.trim() && profile.model.trim() && apiKey && apiKey !== "replace-me");
}

function hasConfiguredModel(models: ModelProfile[]): boolean {
  return models.some((profile) => isConfiguredModelProfile(profile));
}

function createCloudMcpServerId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `mcp-cloud-${slug || "connector"}-${Date.now()}`;
}

type WorkspaceState = {
  ready: boolean;
  loading: boolean;
  error: string | null;
  myClawRootPath: string | null;
  skillsRootPath: string | null;
  sessionsRootPath: string | null;
  runtimeStateFilePath: string | null;
  requiresInitialSetup: boolean;
  isFirstLaunch: boolean;
  defaultModelProfileId: string | null;
  activeSessionId: string | null;
  sessions: ChatSession[];
  models: ModelProfile[];
  builtinTools: ResolvedBuiltinTool[];
  mcpTools: ResolvedMcpTool[];
  mcpServers: McpServer[];
  skills: SkillDefinition[];
  skillDetails: Record<string, SkillDetail>;
  employees: LocalEmployeeSummary[];
  workflows: WorkflowDefinitionSummary[];
  workflowSummaries: Record<string, WorkflowSummary>;
  workflowDefinitions: Record<string, WorkflowDefinition>;
  workflowRuns: Record<string, WorkflowRunSummary>;
  cloudHubItems: CloudHubItem[];
  cloudHubDetail: CloudHubItemDetail | null;
  cloudHubManifest: CloudHubManifest | null;
  approvals: ApprovalPolicy | null;
  approvalRequests: ApprovalRequest[];
};

type WorkflowCanvasPoint = {
  x: number;
  y: number;
};

type WorkflowCanvasNodeLayout = {
  nodeId: string;
  position: WorkflowCanvasPoint;
};

type WorkflowEditorMetadata = {
  canvas: {
    viewport: {
      offsetX: number;
      offsetY: number;
    };
    nodes: WorkflowCanvasNodeLayout[];
  };
};

type WorkflowDefinitionWithEditor = WorkflowDefinition & {
  editor?: WorkflowEditorMetadata;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 为缺少 editor 的旧工作流生成可预测的默认画布布局。 */
function buildFallbackCanvasLayouts(definition: WorkflowDefinition): WorkflowCanvasNodeLayout[] {
  return definition.nodes.map((node, index) => ({
    nodeId: node.id,
    position: {
      x: 120 + index * 280,
      y: 180,
    },
  }));
}

/** 将 runtime 返回的 editor 元数据归一化，确保坐标完整且与节点列表一致。 */
function normalizeWorkflowEditorMetadata(
  definition: WorkflowDefinition,
  editor?: WorkflowEditorMetadata,
): WorkflowEditorMetadata {
  const fallbackLayouts = buildFallbackCanvasLayouts(definition);
  if (!editor || !editor.canvas) {
    return {
      canvas: {
        viewport: { offsetX: 0, offsetY: 0 },
        nodes: fallbackLayouts,
      },
    };
  }

  const viewport = {
    offsetX: isFiniteNumber(editor.canvas.viewport?.offsetX) ? editor.canvas.viewport.offsetX : 0,
    offsetY: isFiniteNumber(editor.canvas.viewport?.offsetY) ? editor.canvas.viewport.offsetY : 0,
  };

  const validNodeIds = new Set(definition.nodes.map((node) => node.id));
  const nodeLayoutMap = new Map<string, WorkflowCanvasPoint>();
  for (const layout of editor.canvas.nodes ?? []) {
    if (!layout || typeof layout.nodeId !== "string" || !validNodeIds.has(layout.nodeId)) {
      continue;
    }
    if (!isFiniteNumber(layout.position?.x) || !isFiniteNumber(layout.position?.y)) {
      continue;
    }
    if (nodeLayoutMap.has(layout.nodeId)) {
      continue;
    }
    nodeLayoutMap.set(layout.nodeId, {
      x: layout.position.x,
      y: layout.position.y,
    });
  }

  return {
    canvas: {
      viewport,
      nodes: definition.nodes.map((node, index) => ({
        nodeId: node.id,
        position: nodeLayoutMap.get(node.id) ?? fallbackLayouts[index]!.position,
      })),
    },
  };
}

/** 统一补齐工作流 editor 元数据，并在响应缺失时保留已有布局。 */
function normalizeWorkflowDefinition(
  definition: WorkflowDefinition,
  previousDefinition?: WorkflowDefinition,
): WorkflowDefinition {
  const nextDefinition = { ...definition } as WorkflowDefinitionWithEditor;
  const previousEditor = (previousDefinition as WorkflowDefinitionWithEditor | undefined)?.editor;
  nextDefinition.editor = normalizeWorkflowEditorMetadata(definition, nextDefinition.editor ?? previousEditor);
  return nextDefinition as WorkflowDefinition;
}

/** 归一化 workflow 摘要，兼容旧 payload 的可选索引字段。*/
function normalizeWorkflowSummary(workflow: WorkflowDefinitionSummary): WorkflowSummary {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    source: workflow.source,
    updatedAt: workflow.updatedAt,
    version: typeof workflow.version === "number" && Number.isFinite(workflow.version) ? workflow.version : 1,
    nodeCount: typeof workflow.nodeCount === "number" && Number.isFinite(workflow.nodeCount) ? workflow.nodeCount : 0,
    edgeCount: typeof workflow.edgeCount === "number" && Number.isFinite(workflow.edgeCount) ? workflow.edgeCount : 0,
    libraryRootId:
      typeof workflow.libraryRootId === "string" && workflow.libraryRootId.trim().length > 0
        ? workflow.libraryRootId
        : "personal",
  };
}

/** 按 id 构建 workflow 摘要索引，供 library 与 studio 共用。*/
function buildWorkflowSummaryMap(workflows: WorkflowDefinitionSummary[]): Record<string, WorkflowSummary> {
  return Object.fromEntries(workflows.map((workflow) => {
    const normalized = normalizeWorkflowSummary(workflow);
    return [normalized.id, normalized] as const;
  }));
}

/** 按 id 构建 workflow 运行摘要索引，避免 UI 层重复遍历。*/
function buildWorkflowRunMap(workflowRuns: WorkflowRunSummary[]): Record<string, WorkflowRunSummary> {
  return Object.fromEntries(workflowRuns.map((run) => [run.id, run] as const));
}

function mergeWorkflowRunMap(
  currentRuns: Record<string, WorkflowRunSummary>,
  workflowRuns: WorkflowRunSummary[],
): Record<string, WorkflowRunSummary> {
  return {
    ...currentRuns,
    ...buildWorkflowRunMap(workflowRuns),
  };
}

function upsertWorkflowSummaryList(
  workflows: WorkflowDefinitionSummary[],
  workflow: WorkflowDefinitionSummary,
): WorkflowDefinitionSummary[] {
  const normalized = normalizeWorkflowSummary(workflow);
  const index = workflows.findIndex((item) => item.id === normalized.id);
  if (index < 0) {
    return [normalized, ...workflows];
  }

  const nextWorkflows = [...workflows];
  nextWorkflows[index] = normalized;
  return nextWorkflows;
}

function resolveDefaultModelProfileId(
  payload: { defaultModelProfileId?: string | null; models: ModelProfile[] },
): string | null {
  if (Object.prototype.hasOwnProperty.call(payload, "defaultModelProfileId")) {
    return payload.defaultModelProfileId === undefined ? payload.models[0]?.id ?? null : payload.defaultModelProfileId;
  }

  return payload.models[0]?.id ?? null;
}

export const useWorkspaceStore = defineStore("workspace", {
  state: (): WorkspaceState => ({
    ready: false,
    loading: false,
    error: null,
    myClawRootPath: null,
    skillsRootPath: null,
    sessionsRootPath: null,
    runtimeStateFilePath: null,
    requiresInitialSetup: true,
    isFirstLaunch: false,
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
    approvals: null,
    approvalRequests: [],
  }),
  getters: {
    currentSession(state): ChatSession | null {
      return state.sessions.find((item) => item.id === state.activeSessionId) ?? state.sessions[0] ?? null;
    },
  },
  actions: {
    /** 将运行时返回的会话快照合并回本地 store，供流式消息持续刷新 UI。 */
    applySessionPayload(payload: {
      session: ChatSession;
      approvals?: ApprovalPolicy;
      approvalRequests?: ApprovalRequest[];
    }) {
      const index = this.sessions.findIndex((item) => item.id === payload.session.id);
      if (index >= 0) {
        this.sessions[index] = payload.session;
      } else {
        this.sessions.unshift(payload.session);
      }

      if (payload.approvals) {
        this.approvals = payload.approvals;
      }
      if (payload.approvalRequests) {
        this.approvalRequests = payload.approvalRequests;
      }
    },
    hydrate(payload: {
      defaultModelProfileId?: string | null;
      sessions: ChatSession[];
      models: ModelProfile[];
      myClawRootPath?: string;
      skillsRootPath?: string;
      sessionsRootPath?: string;
      runtimeStateFilePath?: string;
      requiresInitialSetup?: boolean;
      isFirstLaunch?: boolean;
      builtinTools?: ResolvedBuiltinTool[];
      mcpTools?: ResolvedMcpTool[];
      mcpServers: McpServer[];
      skills: SkillDefinition[];
      employees?: LocalEmployeeSummary[];
      workflows?: WorkflowDefinitionSummary[];
      workflowRuns?: WorkflowRunSummary[];
      cloudHubItems?: CloudHubItem[];
      cloudHubDetail?: CloudHubItemDetail | null;
      cloudHubManifest?: CloudHubManifest | null;
      approvals: ApprovalPolicy;
      approvalRequests?: ApprovalRequest[];
    }) {
      this.sessions = payload.sessions;
      this.activeSessionId = payload.sessions[0]?.id ?? null;
      this.models = payload.models;
      this.myClawRootPath = payload.myClawRootPath ?? this.myClawRootPath;
      this.skillsRootPath = payload.skillsRootPath ?? this.skillsRootPath;
      this.sessionsRootPath = payload.sessionsRootPath ?? this.sessionsRootPath;
      this.runtimeStateFilePath = payload.runtimeStateFilePath ?? this.runtimeStateFilePath;
      this.requiresInitialSetup =
        typeof payload.requiresInitialSetup === "boolean"
          ? payload.requiresInitialSetup
          : !hasConfiguredModel(payload.models);
      this.isFirstLaunch = typeof payload.isFirstLaunch === "boolean" ? payload.isFirstLaunch : false;
      this.defaultModelProfileId = resolveDefaultModelProfileId(payload);
      this.builtinTools = payload.builtinTools ?? this.builtinTools;
      this.mcpTools = payload.mcpTools ?? this.mcpTools;
      this.mcpServers = payload.mcpServers;
      this.skills = payload.skills;
      this.skillDetails = {};
      this.employees = payload.employees ?? this.employees;
      this.workflows = payload.workflows ?? this.workflows;
      this.workflowSummaries = buildWorkflowSummaryMap(this.workflows);
      this.workflowRuns = buildWorkflowRunMap(payload.workflowRuns ?? Object.values(this.workflowRuns));
      this.cloudHubItems = payload.cloudHubItems ?? this.cloudHubItems;
      this.cloudHubDetail = payload.cloudHubDetail ?? this.cloudHubDetail;
      this.cloudHubManifest = payload.cloudHubManifest ?? this.cloudHubManifest;
      this.approvals = payload.approvals;
      this.approvalRequests = payload.approvalRequests ?? [];
      this.ready = true;
      this.error = null;
    },
    async loadBootstrap() {
      if (this.ready || this.loading) {
        return;
      }

      this.error = null;
      this.loading = true;
      try {
        const shell = useShellStore();
        const payload = await fetchBootstrap(shell.runtimeBaseUrl);

        this.hydrate({
          defaultModelProfileId: payload.defaultModelProfileId,
          sessions: payload.sessions,
          models: payload.models,
          myClawRootPath: payload.myClawRootPath,
          skillsRootPath: payload.skillsRootPath,
          sessionsRootPath: payload.sessionsRootPath,
          runtimeStateFilePath: payload.runtimeStateFilePath,
          requiresInitialSetup: payload.requiresInitialSetup,
          isFirstLaunch: payload.isFirstLaunch,
          builtinTools: payload.tools.builtin,
          mcpTools: payload.tools.mcp,
          mcpServers: payload.mcp.servers,
          skills: payload.skills.items,
          employees: payload.employees,
          workflows: payload.workflows,
          workflowRuns: payload.workflowRuns,
          approvals: payload.approvals,
          approvalRequests: payload.approvalRequests,
        });
      } catch (error) {
        this.error = error instanceof Error ? error.message : "加载工作区初始化数据失败";
      } finally {
        this.loading = false;
      }
    },
    addModelProfile(profile: ModelProfile) {
      this.models.push(profile);
      this.requiresInitialSetup = !hasConfiguredModel(this.models);
      if (!this.defaultModelProfileId) {
        this.defaultModelProfileId = profile.id;
      }
    },
    setDefaultModelProfileLocal(profileId: string) {
      this.defaultModelProfileId = profileId;
    },
    selectSession(sessionId: string) {
      if (this.sessions.some((item) => item.id === sessionId)) {
        this.activeSessionId = sessionId;
      }
    },
    async createSession() {
      const shell = useShellStore();
      const payload = await createSessionRequest(shell.runtimeBaseUrl);
      this.sessions.unshift(payload.session);
      this.activeSessionId = payload.session.id;
      return payload.session;
    },
    async deleteSession(sessionId: string) {
      const shell = useShellStore();
      const payload = await deleteSessionRequest(shell.runtimeBaseUrl, sessionId);
      this.sessions = payload.sessions;
      this.approvalRequests = payload.approvalRequests;

      if (this.activeSessionId === sessionId || !this.sessions.some((item) => item.id === this.activeSessionId)) {
        this.activeSessionId = this.sessions[0]?.id ?? null;
      }

      return payload;
    },
    async createModelProfile(input: Omit<ModelProfile, "id">) {
      const shell = useShellStore();
      const payload = await createModelProfileRequest(shell.runtimeBaseUrl, input);
      this.addModelProfile(payload.profile);
      return payload.profile;
    },
    async updateModelProfile(profileId: string, input: Omit<ModelProfile, "id">) {
      const shell = useShellStore();
      const payload = await updateModelProfileRequest(shell.runtimeBaseUrl, profileId, input);
      const index = this.models.findIndex((item) => item.id === profileId);
      if (index >= 0) {
        this.models[index] = payload.profile;
      }
      return payload.profile;
    },
    async deleteModelProfile(profileId: string) {
      const shell = useShellStore();
      const payload = await deleteModelProfileRequest(shell.runtimeBaseUrl, profileId);
      this.models = payload.models;
      this.defaultModelProfileId = payload.defaultModelProfileId;
      this.sessions = payload.sessions;
      if (this.activeSessionId && !this.sessions.some((item) => item.id === this.activeSessionId)) {
        this.activeSessionId = this.sessions[0]?.id ?? null;
      }
      this.requiresInitialSetup = !hasConfiguredModel(this.models);
      return payload;
    },
    async setDefaultModelProfile(profileId: string) {
      const shell = useShellStore();
      const payload = await setDefaultModelProfileRequest(shell.runtimeBaseUrl, profileId);
      this.defaultModelProfileId = payload.defaultModelProfileId;
    },
    async testModelProfileConnectivity(profileId: string) {
      const shell = useShellStore();
      return testModelProfileRequest(shell.runtimeBaseUrl, profileId);
    },
    async sendMessage(content: string) {
      const session = this.currentSession;
      if (!session || !content.trim()) {
        return;
      }

      const shell = useShellStore();
      const payload = await postSessionMessageStream(shell.runtimeBaseUrl, session.id, content.trim(), {
        onSnapshot: (snapshot) => {
          this.applySessionPayload(snapshot);
        },
      });
      this.applySessionPayload(payload);
    },
    async requestExecutionIntent(intent: ExecutionIntent) {
      const session = this.currentSession;
      if (!session) {
        return;
      }

      const shell = useShellStore();
      const payload = await requestExecutionIntentRequest(shell.runtimeBaseUrl, session.id, intent);
      const index = this.sessions.findIndex((item) => item.id === payload.session.id);
      if (index >= 0) {
        this.sessions[index] = payload.session;
      }
      this.approvals = payload.approvals;
      this.approvalRequests = payload.approvalRequests;
      return payload;
    },
    async resolveApproval(approvalId: string, decision: ApprovalDecision) {
      const shell = useShellStore();
      const payload = await resolveApprovalRequest(shell.runtimeBaseUrl, approvalId, decision);
      const index = this.sessions.findIndex((item) => item.id === payload.session.id);
      if (index >= 0) {
        this.sessions[index] = payload.session;
      }
      this.approvals = payload.approvals;
      this.approvalRequests = payload.approvalRequests;
      return payload;
    },
    /** 重新拉取内置工具目录，适合工具页初始化或显式刷新时使用。 */
    async loadBuiltinTools() {
      const shell = useShellStore();
      const payload = await fetchBuiltinTools(shell.runtimeBaseUrl);
      this.builtinTools = payload.items;
      return payload.items;
    },
    async loadMcpTools() {
      const shell = useShellStore();
      const payload = await fetchMcpTools(shell.runtimeBaseUrl);
      this.mcpTools = payload.items;
      return payload.items;
    },
    /** 更新单个内置工具的开关状态，并同步本地 store。 */
    async updateBuiltinToolPreference(
      toolId: string,
      input: {
        enabled: boolean;
        exposedToModel: boolean;
        approvalModeOverride: BuiltinToolApprovalMode | null;
      },
    ) {
      const shell = useShellStore();
      const payload = await updateBuiltinToolPreferenceRequest(shell.runtimeBaseUrl, toolId, input);
      const index = this.builtinTools.findIndex((item) => item.id === toolId);
      if (index >= 0) {
        this.builtinTools[index] = payload.tool;
      } else {
        this.builtinTools.push(payload.tool);
      }
      return payload.tool;
    },
    async updateMcpToolPreference(
      toolId: string,
      input: {
        enabled: boolean;
        exposedToModel: boolean;
        approvalModeOverride: BuiltinToolApprovalMode | null;
      },
    ) {
      const shell = useShellStore();
      const payload = await updateMcpToolPreferenceRequest(shell.runtimeBaseUrl, toolId, input);
      const index = this.mcpTools.findIndex((item) => item.id === toolId);
      if (index >= 0) {
        this.mcpTools[index] = payload.tool;
      } else {
        this.mcpTools.push(payload.tool);
      }
      return payload.tool;
    },
    async updateApprovalPolicy(input: {
      mode: ApprovalMode;
      autoApproveReadOnly: boolean;
      autoApproveSkills: boolean;
    }) {
      const shell = useShellStore();
      const payload = await updateApprovalPolicyRequest(shell.runtimeBaseUrl, input);
      this.approvals = payload.approvals;
      return payload.approvals;
    },
    async loadMcpServers() {
      const shell = useShellStore();
      const payload = await fetchMcpServers(shell.runtimeBaseUrl);
      this.mcpServers = payload.servers;
      return payload.servers;
    },
    async importMcpServers(source: "claude" | "codex" | "cursor") {
      const shell = useShellStore();
      const payload = await importMcpServersRequest(shell.runtimeBaseUrl, source);
      this.mcpServers = payload.servers;
      return payload.servers;
    },
    async createMcpServer(input: McpServerConfig) {
      const shell = useShellStore();
      const payload = await createMcpServerRequest(shell.runtimeBaseUrl, input);
      this.mcpServers = payload.servers;
      return payload.server;
    },
    async updateMcpServer(serverId: string, input: McpServerConfig) {
      const shell = useShellStore();
      const payload = await updateMcpServerRequest(shell.runtimeBaseUrl, serverId, input);
      this.mcpServers = payload.servers;
      return payload.server;
    },
    async deleteMcpServer(serverId: string) {
      const shell = useShellStore();
      const payload = await deleteMcpServerRequest(shell.runtimeBaseUrl, serverId);
      this.mcpServers = payload.servers;
      return payload;
    },
    async refreshMcpServer(serverId: string) {
      const shell = useShellStore();
      const payload = await refreshMcpServerRequest(shell.runtimeBaseUrl, serverId);
      this.mcpServers = payload.servers;
      return payload.server;
    },
    async loadEmployees() {
      const shell = useShellStore();
      const payload = await fetchEmployeesRequest(shell.runtimeBaseUrl);
      this.employees = payload.items;
      return payload.items;
    },
    async createEmployee(input: CreateEmployeeInput) {
      const shell = useShellStore();
      const payload = await createEmployeeRequest(shell.runtimeBaseUrl, input);
      this.employees = payload.items;
      return payload.employee;
    },
    async loadEmployeeById(employeeId: string) {
      const shell = useShellStore();
      const payload = await getEmployeeRequest(shell.runtimeBaseUrl, employeeId);
      const index = this.employees.findIndex((item) => item.id === employeeId);
      if (index >= 0) {
        this.employees[index] = payload.employee;
      } else {
        this.employees.unshift(payload.employee);
      }
      return payload.employee;
    },
    async updateEmployee(employeeId: string, input: UpdateEmployeeInput) {
      const shell = useShellStore();
      const payload = await updateEmployeeRequest(shell.runtimeBaseUrl, employeeId, input);
      const index = this.employees.findIndex((item) => item.id === employeeId);
      if (index >= 0) {
        this.employees[index] = payload.employee;
      } else {
        this.employees.unshift(payload.employee);
      }
      return payload.employee;
    },
    async loadWorkflows() {
      const shell = useShellStore();
      const payload = await fetchWorkflowsRequest(shell.runtimeBaseUrl);
      this.workflows = payload.items;
      this.workflowSummaries = buildWorkflowSummaryMap(this.workflows);
      return payload.items;
    },
    async createWorkflow(input: CreateWorkflowInput) {
      const shell = useShellStore();
      const payload = await createWorkflowRequest(shell.runtimeBaseUrl, input);
      const normalizedWorkflow = normalizeWorkflowDefinition(payload.workflow);
      this.workflowDefinitions[normalizedWorkflow.id] = normalizedWorkflow;
      this.workflows = upsertWorkflowSummaryList(
        payload.items.length > 0 ? payload.items : this.workflows,
        normalizedWorkflow,
      );
      this.workflowSummaries = buildWorkflowSummaryMap(this.workflows);
      return normalizedWorkflow;
    },
    async loadWorkflowById(workflowId: string) {
      const shell = useShellStore();
      const payload = await getWorkflowRequest(shell.runtimeBaseUrl, workflowId);
      const normalizedWorkflow = normalizeWorkflowDefinition(
        payload.workflow,
        this.workflowDefinitions[payload.workflow.id],
      );
      this.workflowDefinitions[normalizedWorkflow.id] = normalizedWorkflow;
      const workflowSummary = normalizeWorkflowSummary(normalizedWorkflow);
      this.workflowSummaries[workflowSummary.id] = workflowSummary;
      const index = this.workflows.findIndex((item) => item.id === workflowSummary.id);
      if (index >= 0) {
        this.workflows[index] = workflowSummary;
      } else {
        this.workflows.unshift(workflowSummary);
      }
      return normalizedWorkflow;
    },
    async updateWorkflow(workflowId: string, input: UpdateWorkflowInput) {
      const shell = useShellStore();
      const payload = await updateWorkflowRequest(shell.runtimeBaseUrl, workflowId, input);
      const normalizedWorkflow = normalizeWorkflowDefinition(
        payload.workflow,
        this.workflowDefinitions[payload.workflow.id],
      );
      this.workflowDefinitions[normalizedWorkflow.id] = normalizedWorkflow;
      const workflowSummary = normalizeWorkflowSummary(normalizedWorkflow);
      this.workflowSummaries[workflowSummary.id] = workflowSummary;
      const index = this.workflows.findIndex((item) => item.id === workflowSummary.id);
      if (index >= 0) {
        this.workflows[index] = workflowSummary;
      } else {
        this.workflows.unshift(workflowSummary);
      }
      return normalizedWorkflow;
    },
    /** 拉取运行摘要并归一化到 workflowRuns 索引。*/
    async loadWorkflowRuns() {
      const shell = useShellStore();
      const payload = await fetchWorkflowRunsRequest(shell.runtimeBaseUrl);
      this.workflowRuns = mergeWorkflowRunMap(this.workflowRuns, payload.items);
      return payload.items;
    },
    /** 启动工作流运行后更新本地运行摘要索引。*/
    async startWorkflowRun(workflowId: string) {
      const shell = useShellStore();
      const payload = await startWorkflowRunRequest(shell.runtimeBaseUrl, { workflowId });
      this.workflowRuns = mergeWorkflowRunMap(this.workflowRuns, payload.items);
      this.workflowRuns[payload.run.id] = payload.run;
      return payload.run;
    },
    /** 恢复暂停运行后更新本地运行摘要索引。*/
    async resumeWorkflowRun(runId: string) {
      const shell = useShellStore();
      const payload = await resumeWorkflowRunRequest(shell.runtimeBaseUrl, runId);
      this.workflowRuns = mergeWorkflowRunMap(this.workflowRuns, payload.items);
      this.workflowRuns[payload.run.id] = payload.run;
      return payload.run;
    },
    async loadCloudHubItems(type: "all" | CloudHubItemType = "all") {
      const shell = useShellStore();
      const items = await fetchCloudHubItems(shell.runtimeBaseUrl, type);
      this.cloudHubItems = items;
      if (type !== "all") {
        this.cloudHubDetail =
          this.cloudHubDetail && this.cloudHubDetail.type === type ? this.cloudHubDetail : null;
        this.cloudHubManifest =
          this.cloudHubManifest && this.cloudHubManifest.kind === type ? this.cloudHubManifest : null;
      }
      return items;
    },
    async loadCloudHubDetail(itemId: string) {
      const shell = useShellStore();
      const detail = await fetchCloudHubDetail(shell.runtimeBaseUrl, itemId);
      this.cloudHubDetail = detail;
      return detail;
    },
    async loadCloudHubManifest(releaseId: string) {
      const shell = useShellStore();
      const manifest = await fetchCloudHubManifest(shell.runtimeBaseUrl, releaseId);
      this.cloudHubManifest = manifest;
      return manifest;
    },
    async loadCloudHubDownloadToken(releaseId: string): Promise<CloudDownloadToken> {
      const shell = useShellStore();
      return fetchCloudHubDownloadToken(shell.runtimeBaseUrl, releaseId);
    },
    /** 加载本地 Skill 详情，供 Skills 页面查看完整 SKILL.md。 */
    async loadSkillDetail(skillId: string) {
      if (this.skillDetails[skillId]) {
        return this.skillDetails[skillId];
      }

      const shell = useShellStore();
      console.info("[workspace] 加载 Skill 详情", { skillId });
      const payload = await fetchSkillDetailRequest(shell.runtimeBaseUrl, skillId);
      this.skillDetails[payload.skill.id] = payload.skill;
      console.info("[workspace] Skill 详情加载完成", {
        skillId: payload.skill.id,
        entryPath: payload.skill.entryPath,
      });
      return payload.skill;
    },
    /** 从云端 Hub 拉取技能发布包并同步到本地技能目录。 */
    async importCloudSkill(input: { releaseId: string; skillName: string }) {
      const shell = useShellStore();
      console.info("[workspace] 开始导入云端 Skill", {
        releaseId: input.releaseId,
        skillName: input.skillName,
      });
      const token = await this.loadCloudHubDownloadToken(input.releaseId);
      const payload = await importCloudSkillReleaseRequest(shell.runtimeBaseUrl, {
        downloadUrl: token.downloadUrl,
        skillName: input.skillName,
      });
      this.skills = payload.skills.items;
      this.skillDetails = {};
      console.info("[workspace] 云端 Skill 导入完成", {
        releaseId: input.releaseId,
        skillName: input.skillName,
        totalSkills: this.skills.length,
      });
      return payload;
    },
    /** 从云端 Hub 安装员工包，并把结果写回本地员工列表。 */
    async importCloudEmployeePackage(input: {
      itemId: string;
      releaseId: string;
      name: string;
      summary?: string;
      manifest: CloudHubManifest;
    }) {
      if (input.manifest.kind !== "employee-package") {
        throw new Error("Cloud manifest is not an employee package.");
      }

      const shell = useShellStore();
      console.info("[workspace] 开始导入云端员工包", {
        itemId: input.itemId,
        releaseId: input.releaseId,
        name: input.name,
      });
      const token = await this.loadCloudHubDownloadToken(input.releaseId);
      const payload = await installEmployeePackageFromCloudRequest(shell.runtimeBaseUrl, {
        itemId: input.itemId,
        releaseId: input.releaseId,
        name: input.name,
        ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
        downloadUrl: token.downloadUrl,
        manifest: input.manifest,
      });
      this.employees = payload.items;
      console.info("[workspace] 云端员工包导入完成", {
        itemId: input.itemId,
        releaseId: input.releaseId,
        employeeId: payload.employee.id,
        totalEmployees: this.employees.length,
      });
      return payload;
    },
    /** 从云端 Hub 安装工作流包，并把结果写回本地工作流列表。 */
    async importCloudWorkflowPackage(input: {
      itemId: string;
      releaseId: string;
      name: string;
      summary?: string;
      manifest: CloudHubManifest;
    }) {
      if (input.manifest.kind !== "workflow-package") {
        throw new Error("Cloud manifest is not a workflow package.");
      }

      const shell = useShellStore();
      console.info("[workspace] 开始导入云端工作流包", {
        itemId: input.itemId,
        releaseId: input.releaseId,
        name: input.name,
      });
      const token = await this.loadCloudHubDownloadToken(input.releaseId);
      const payload = await installWorkflowPackageFromCloudRequest(shell.runtimeBaseUrl, {
        itemId: input.itemId,
        releaseId: input.releaseId,
        name: input.name,
        ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
        downloadUrl: token.downloadUrl,
        manifest: input.manifest,
      });
      this.workflows = upsertWorkflowSummaryList(payload.items, payload.workflow);
      this.workflowSummaries = buildWorkflowSummaryMap(this.workflows);
      console.info("[workspace] 云端工作流包导入完成", {
        itemId: input.itemId,
        releaseId: input.releaseId,
        workflowId: payload.workflow.id,
        totalWorkflows: this.workflows.length,
      });
      return payload;
    },
    /** 为本地员工或工作流生成可发布草稿，但不上传任何运行态数据。 */
    async createPublishDraft(input: {
      kind: "employee-package" | "workflow-package";
      sourceId: string;
      version: string;
    }) {
      const shell = useShellStore();
      console.info("[workspace] 开始生成发布草稿", input);
      const payload = await createPublishDraftRequest(shell.runtimeBaseUrl, input);
      console.info("[workspace] 发布草稿已生成", {
        draftId: payload.draft.id,
        kind: payload.draft.kind,
        sourceId: payload.draft.sourceId,
        filePath: payload.draft.filePath,
      });
      return payload;
    },
    async importCloudMcp(manifest: CloudHubManifest) {
      if (manifest.kind !== "mcp") {
        throw new Error("Cloud manifest is not an MCP connector.");
      }

      const baseConfig = {
        id: createCloudMcpServerId(manifest.name),
        name: manifest.name,
        source: "manual" as const,
        enabled: true,
      };

      let config: McpServerConfig;
      if (manifest.transport === "stdio") {
        if (!manifest.command?.trim()) {
          throw new Error("Cloud MCP stdio manifest is missing command.");
        }
        config = {
          ...baseConfig,
          transport: "stdio",
          command: manifest.command.trim(),
          ...(manifest.args?.length ? { args: [...manifest.args] } : {}),
        };
      } else {
        if (!manifest.endpoint?.trim()) {
          throw new Error("Cloud MCP http manifest is missing endpoint.");
        }
        config = {
          ...baseConfig,
          transport: "http",
          url: manifest.endpoint.trim(),
        };
      }

      return this.createMcpServer(config);
    },
    pushAssistantMessage(sessionId: string, content: string) {
      const index = this.sessions.findIndex((s) => s.id === sessionId);
      if (index >= 0) {
        const session = this.sessions[index];
        const newMessage = {
          id: `virtual-${Date.now()}`,
          role: "assistant" as const,
          content,
          createdAt: new Date().toISOString(),
        };
        
        // Re-assigning the whole session object ensures Vue detects the change
        this.sessions[index] = {
          ...session,
          messages: [...session.messages, newMessage],
        };
      }
    },
  },
});
