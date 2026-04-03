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

import type {
  CloudDownloadToken,
  CloudHubItem,
  CloudHubItemDetail,
  CloudHubItemType,
  CloudHubManifest,
  CloudSkillCategory,
  CloudSkillDetail,
  CloudSkillSummary,
} from "../stores/workspace";

// ---------------------------------------------------------------------------
// Auth API (IPC wrappers for cloud auth endpoints)
// ---------------------------------------------------------------------------

type AuthLoginRequest = { account: string; password: string };
type AuthLoginResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    account: string;
    displayName: string;
    roles: string[];
    [key: string]: unknown;
  };
};
type AuthRefreshResponse = { accessToken: string; expiresIn: number };
type AuthIntrospectResponse = { active: boolean; user: AuthLoginResponse["user"] | null };

type BootstrapPayload = {
  defaultModelProfileId?: string | null;
  sessions: ChatSession[];
  models: ModelProfile[];
  myClawRootPath?: string;
  skillsRootPath?: string;
  sessionsRootPath?: string;
  requiresInitialSetup?: boolean;
  tools: { builtin: ResolvedBuiltinTool[]; mcp: ResolvedMcpTool[] };
  mcp: { servers: McpServer[] };
  skills: { items: SkillDefinition[] };
  employees: LocalEmployeeSummary[];
  workflows: WorkflowDefinitionSummary[];
  workflowRuns: unknown[];
  cloudHubItems?: CloudHubItem[];
  cloudHubDetail?: CloudHubItemDetail | null;
  cloudHubManifest?: CloudHubManifest | null;
  approvals: ApprovalPolicy;
  approvalRequests: ApprovalRequest[];
};

type SessionPayload = {
  session: ChatSession;
  approvals?: ApprovalPolicy;
  approvalRequests?: ApprovalRequest[];
};

type SessionsPayload = {
  sessions: ChatSession[];
  approvals?: ApprovalPolicy;
  approvalRequests?: ApprovalRequest[];
};

type ModelProfilePayload = { profile: ModelProfile };
type ModelProfilesPayload = {
  models: ModelProfile[];
  defaultModelProfileId: string | null;
  sessions: ChatSession[];
};
type DefaultModelPayload = { defaultModelProfileId: string | null };

type McpServersPayload = { servers: McpServer[] };
type McpServerPayload = { server: McpServer; servers: McpServer[] };

type BuiltinToolPayload = { tool: ResolvedBuiltinTool };
type McpToolPayload = { tool: ResolvedMcpTool };
type BuiltinToolsPayload = { items: ResolvedBuiltinTool[] };
type McpToolsPayload = { items: ResolvedMcpTool[] };
type ApprovalsPayload = { approvals: ApprovalPolicy };

type StreamOptions = {
  onSnapshot?: (snapshot: SessionPayload) => void;
};

// ---------------------------------------------------------------------------
// window.myClawAPI declaration
//
// This MUST match the API surface exposed in src/preload/index.ts.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    myClawAPI: {
      /** The host platform string, e.g. "darwin", "win32", "linux" */
      platform: string;

      /** 窗口控制 API — 自定义标题栏使用 */
      windowControls: {
        /** 最小化窗口 */
        minimize: () => void;
        /** 最大化或还原窗口 */
        maximize: () => void;
        /** 关闭窗口 */
        close: () => void;
        /** 查询当前是否为最大化状态 */
        isMaximized: () => Promise<boolean>;
        /** 监听最大化状态变化 */
        onMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void;
      };

      // --- Auth ---
      auth: {
        login: (payload: AuthLoginRequest) => Promise<AuthLoginResponse>;
        logout: (refreshToken: string) => Promise<{ success: boolean }>;
        refresh: (refreshToken: string) => Promise<AuthRefreshResponse>;
        introspect: (accessToken: string) => Promise<AuthIntrospectResponse>;
      };

      // --- Bootstrap ---
      bootstrap: () => Promise<BootstrapPayload>;

      // --- Sessions ---
      createSession: (data?: {
        title?: string;
        modelProfileId?: string;
        attachedDirectory?: string | null;
      }) => Promise<SessionPayload>;
      deleteSession: (sessionId: string) => Promise<SessionsPayload>;
      sendMessage: (
        sessionId: string,
        content: string,
        options?: StreamOptions,
      ) => Promise<SessionPayload>;
      requestExecutionIntent: (
        sessionId: string,
        intent: unknown,
      ) => Promise<unknown>;
      /** Subscribe to real-time session streaming events (deltas, completion, etc.) */
      onSessionStream: (callback: (event: Record<string, unknown>) => void) => () => void;

      // --- Model profiles ---
      createModelProfile: (input: Omit<ModelProfile, "id">) => Promise<ModelProfilePayload>;
      updateModelProfile: (
        profileId: string,
        input: Partial<Omit<ModelProfile, "id">>,
      ) => Promise<ModelProfilePayload>;
      deleteModelProfile: (profileId: string) => Promise<ModelProfilesPayload>;
      setDefaultModelProfile: (profileId: string) => Promise<DefaultModelPayload>;
      testModelProfile: (profileId: string) => Promise<{ success: boolean; error?: string }>;
      fetchModelCatalog: (
        input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">,
      ) => Promise<{ modelIds: ModelCatalogItem[] }>;
      fetchAvailableModelIds: (
        input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">,
      ) => Promise<{ modelIds: string[] }>;

      // --- MCP servers ---
      fetchMcpServers: () => Promise<McpServersPayload>;
      createMcpServer: (input: Omit<McpServerConfig, "id">) => Promise<McpServerPayload>;
      updateMcpServer: (serverId: string, input: Partial<Omit<McpServerConfig, "id">>) => Promise<McpServerPayload>;
      deleteMcpServer: (serverId: string) => Promise<McpServersPayload>;
      refreshMcpServer: (serverId: string) => Promise<McpServerPayload>;
      discoverExternalMcpServers: () => Promise<Array<{
        source: string;
        name: string;
        command: string;
        args: string[];
        env?: Record<string, string>;
        alreadyImported: boolean;
      }>>;
      importMcpServers: (servers: unknown[]) => Promise<McpServer[]>;

      // --- Builtin tools ---
      fetchBuiltinTools: () => Promise<BuiltinToolsPayload>;
      updateBuiltinToolPreference: (
        toolId: string,
        input: { enabled: boolean; exposedToModel: boolean; approvalModeOverride: BuiltinToolApprovalMode | null },
      ) => Promise<BuiltinToolPayload>;

      // --- MCP tools ---
      fetchMcpTools: () => Promise<McpToolsPayload>;
      updateMcpToolPreference: (
        toolId: string,
        input: { enabled: boolean; exposedToModel: boolean; approvalModeOverride: BuiltinToolApprovalMode | null },
      ) => Promise<McpToolPayload>;

      // --- Approvals ---
      resolveApproval: (
        approvalId: string,
        decision: ApprovalDecision,
      ) => Promise<SessionPayload & { approvals: ApprovalPolicy; approvalRequests: ApprovalRequest[] }>;
      updateApprovalPolicy: (input: {
        mode: ApprovalMode;
        autoApproveReadOnly: boolean;
        autoApproveSkills: boolean;
      }) => Promise<ApprovalsPayload>;

      // --- Cloud Hub ---
      fetchCloudHubItems: (type?: "all" | CloudHubItemType) => Promise<CloudHubItem[]>;
      fetchCloudHubDetail: (itemId: string) => Promise<CloudHubItemDetail>;
      fetchCloudHubManifest: (releaseId: string) => Promise<CloudHubManifest>;
      fetchCloudHubDownloadToken: (releaseId: string) => Promise<CloudDownloadToken>;

      // --- Cloud Skills ---
      fetchCloudSkills: (query?: {
        category?: CloudSkillCategory;
        keyword?: string;
        sort?: "latest" | "downloads" | "name";
        tag?: string;
      }) => Promise<CloudSkillSummary[]>;
      fetchCloudSkillDetail: (skillId: string) => Promise<CloudSkillDetail>;

      // --- Cloud imports ---
      importCloudSkill: (input: {
        releaseId: string;
        skillName: string;
      }) => Promise<{ skills: { items: SkillDefinition[] } }>;
      importCloudMcp: (input: {
        releaseId: string;
        servers: McpServerConfig[];
      }) => Promise<McpServersPayload>;
      installEmployeePackageFromCloud: (input: {
        itemId: string;
        releaseId: string;
        name: string;
        summary?: string;
        downloadUrl: string;
        manifest: CloudHubManifest;
      }) => Promise<{ items: LocalEmployeeSummary[]; employee: LocalEmployeeSummary }>;
      installWorkflowPackageFromCloud: (input: {
        itemId: string;
        releaseId: string;
        name: string;
        summary?: string;
        downloadUrl: string;
        manifest: CloudHubManifest;
      }) => Promise<{ items: WorkflowDefinitionSummary[]; workflow: WorkflowDefinitionSummary }>;

      // --- Employees ---
      fetchEmployees: () => Promise<{ items: LocalEmployeeSummary[] }>;
      getEmployee: (employeeId: string) => Promise<{ employee: LocalEmployeeSummary }>;
      createEmployee: (input: {
        name: string;
        summary?: string;
        model?: string;
        skills?: string[];
      }) => Promise<{ items: LocalEmployeeSummary[]; employee: LocalEmployeeSummary }>;
      updateEmployee: (
        employeeId: string,
        input: Partial<{ name: string; summary: string; model: string; skills: string[] }>,
      ) => Promise<{ employee: LocalEmployeeSummary }>;

      // --- Workflows ---
      fetchWorkflows: () => Promise<{ items: WorkflowDefinitionSummary[] }>;
      getWorkflow: (workflowId: string) => Promise<{ workflow: unknown }>;
      createWorkflow: (input: { name: string; description?: string }) => Promise<{
        workflow: unknown;
        items: WorkflowDefinitionSummary[];
      }>;
      updateWorkflow: (
        workflowId: string,
        input: unknown,
      ) => Promise<{ workflow: unknown; items: WorkflowDefinitionSummary[] }>;
      fetchWorkflowRuns: () => Promise<{ items: unknown[] }>;
      startWorkflowRun: (input: { workflowId: string }) => Promise<{ run: unknown; items: unknown[] }>;
      resumeWorkflowRun: (runId: string) => Promise<{ run: unknown; items: unknown[] }>;

      // --- Skills ---
      fetchSkillDetail: (skillId: string) => Promise<{ skill: unknown }>;

      // --- Web Panels ---
      webPanelResolveView: (skillId: string) => Promise<string | null>;
      onWebPanelOpen: (callback: (payload: { viewPath: string; title: string; data: unknown }) => void) => () => void;

      // --- Skill Files ---
      skillReadTree: (skillId: string) => Promise<import("@shared/contracts").FileTreeNode[]>;
      skillReadFile: (skillId: string, relativePath: string) => Promise<string>;

      // --- Publish drafts ---
      createPublishDraft: (input: {
        kind: "employee-package" | "workflow-package";
        sourceId: string;
        version: string;
      }) => Promise<unknown>;
    };
  }
}
