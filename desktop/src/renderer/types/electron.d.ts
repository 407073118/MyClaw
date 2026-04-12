import type {
  ApprovalDecision,
  ApprovalMode,
  ApprovalPolicy,
  ApprovalRequest,
  BuiltinToolApprovalMode,
  ChatSession,
  McpServer,
  McpServerConfig,
  ModelCatalogItem,
  ModelProfile,
  ModelRouteProbeResult,
  PersonalPromptProfile,
  ResolvedBuiltinTool,
  ResolvedMcpTool,
  SkillDefinition,
  SiliconPerson,
  WorkflowDefinitionSummary,
} from "../../../shared/contracts";
import type { BrMiniMaxRuntimeDiagnostics } from "../../../shared/br-minimax";

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

type AppUpdateState = {
  enabled: boolean;
  stage: "disabled" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "no-update" | "error";
  currentVersion: string;
  latestVersion: string | null;
  progressPercent: number | null;
  message: string;
  feedLabel: string | null;
  downloadPageUrl: string | null;
};

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
  siliconPersons: SiliconPerson[];
  workflows: WorkflowDefinitionSummary[];
  workflowRuns: unknown[];
  cloudHubItems?: CloudHubItem[];
  cloudHubDetail?: CloudHubItemDetail | null;
  cloudHubManifest?: CloudHubManifest | null;
  approvals: ApprovalPolicy;
  approvalRequests: ApprovalRequest[];
  personalPrompt: PersonalPromptProfile;
  updates: AppUpdateState;
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

type CancelSessionRunInput = {
  runId?: string;
  messageId?: string;
  reason?: string;
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
      getAppUpdateState: () => Promise<AppUpdateState>;
      checkForAppUpdates: () => Promise<AppUpdateState>;
      downloadAppUpdate: () => Promise<AppUpdateState>;
      quitAndInstallAppUpdate: () => Promise<{ accepted: boolean }>;
      openAppUpdateDownloadPage: () => Promise<{ opened: boolean }>;
      onAppUpdateStateChanged: (callback: (payload: AppUpdateState) => void) => () => void;

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
      cancelSessionRun: (
        sessionId: string,
        input?: CancelSessionRunInput,
      ) => Promise<SessionPayload>;
      requestExecutionIntent: (
        sessionId: string,
        intent: unknown,
      ) => Promise<unknown>;
      updateSessionRuntimeIntent: (
        sessionId: string,
        intent: Record<string, unknown>,
      ) => Promise<{ session: import("@shared/contracts").ChatSession }>;
      /** 批准当前计划，并把会话推进到执行阶段。 */
      approvePlan: (
        sessionId: string,
      ) => Promise<{ session: import("@shared/contracts").ChatSession }>;
      /** 请求继续完善当前计划，保持会话停留在计划阶段。 */
      revisePlan: (
        sessionId: string,
        feedback: string,
      ) => Promise<{ session: import("@shared/contracts").ChatSession }>;
      /** 取消计划模式，让会话回到普通对话入口。 */
      cancelPlanMode: (
        sessionId: string,
      ) => Promise<{ session: import("@shared/contracts").ChatSession }>;
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
      testModelProfile: (profileId: string) => Promise<{
        success: boolean;
        ok?: boolean;
        latencyMs?: number;
        error?: string;
        diagnostics?: BrMiniMaxRuntimeDiagnostics;
        profile?: ModelProfile;
      }>;
      testModelByConfig: (
        input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">,
      ) => Promise<{ success: boolean; ok: boolean; latencyMs?: number; error?: string }>;
      probeModelRoutesByConfig: (
        input: Pick<ModelProfile, "provider" | "providerFlavor" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody">,
      ) => Promise<ModelRouteProbeResult>;
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

      // --- 个人长期 Prompt ---
      getPersonalPrompt: () => Promise<PersonalPromptProfile>;
      updatePersonalPrompt: (input: { prompt: string }) => Promise<PersonalPromptProfile>;

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
      importSiliconPersonPackage: (input: {
        itemId: string;
        releaseId: string;
        name: string;
        summary?: string;
        downloadUrl: string;
        manifest: CloudHubManifest;
      }) => Promise<{ items: SiliconPerson[]; siliconPerson: SiliconPerson }>;
      installWorkflowPackageFromCloud: (input: {
        itemId: string;
        releaseId: string;
        name: string;
        summary?: string;
        downloadUrl: string;
        manifest: CloudHubManifest;
      }) => Promise<{ items: WorkflowDefinitionSummary[]; workflow: WorkflowDefinitionSummary }>;

      // --- Employees ---
      listSiliconPersons: () => Promise<{ items: SiliconPerson[] }>;
      getSiliconPerson: (siliconPersonId: string) => Promise<{ siliconPerson: SiliconPerson }>;
      createSiliconPerson: (input: {
        name: string;
        title?: string;
        description: string;
      }) => Promise<{ items: SiliconPerson[]; siliconPerson: SiliconPerson }>;
      updateSiliconPerson: (
        siliconPersonId: string,
        input: Partial<SiliconPerson>,
      ) => Promise<{ siliconPerson: SiliconPerson }>;

      createSiliconPersonSession: (
        siliconPersonId: string,
        input?: { title?: string },
      ) => Promise<{ siliconPerson: SiliconPerson; session: ChatSession }>;
      switchSiliconPersonSession: (
        siliconPersonId: string,
        sessionId: string,
      ) => Promise<{ siliconPerson: SiliconPerson; session: ChatSession }>;
      sendSiliconPersonMessage: (
        siliconPersonId: string,
        content: string,
      ) => Promise<{ siliconPerson: SiliconPerson; session: ChatSession }>;
      /** 将指定硅基员工会话标记为已读，仅同步未读状态，不切换 currentSession。 */
      markSiliconPersonSessionRead: (
        siliconPersonId: string,
        sessionId: string,
      ) => Promise<{ siliconPerson: SiliconPerson; session: ChatSession }>;
      startSiliconPersonWorkflowRun: (
        siliconPersonId: string,
        workflowId: string,
      ) => Promise<{ siliconPerson: SiliconPerson; session: ChatSession; runId: string | null }>;

      /** 获取硅基员工工作空间路径信息。 */
      getSiliconPersonPaths: (
        siliconPersonId: string,
      ) => Promise<{ personDir: string; skillsDir: string; sessionsDir: string }>;
      /** 获取硅基员工独立工作空间的技能列表。 */
      listSiliconPersonSkills: (
        siliconPersonId: string,
      ) => Promise<{ items: SkillDefinition[] }>;
      /** 刷新硅基员工独立工作空间的技能列表。 */
      refreshSiliconPersonSkills: (
        siliconPersonId: string,
      ) => Promise<{ items: SkillDefinition[] }>;
      /** 获取硅基员工独立工作空间的 MCP 服务列表。 */
      listSiliconPersonMcpServers: (
        siliconPersonId: string,
      ) => Promise<{ servers: McpServer[] }>;

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
      startWorkflowRun: (input: { workflowId: string; initialState?: Record<string, unknown> }) => Promise<{ runId: string | null }>;
      resumeWorkflowRun: (runId: string, resumeValue?: unknown) => Promise<{ success: boolean }>;
      deleteWorkflow: (workflowId: string) => Promise<{ success: boolean }>;
      cancelWorkflowRun: (runId: string) => Promise<{ success: boolean }>;
      getWorkflowRunDetail: (runId: string) => Promise<unknown>;
      /** 订阅工作流引擎流式事件 */
      onWorkflowStream: (callback: (event: unknown) => void) => () => void;

      // --- Skills ---
      fetchSkillDetail: (skillId: string) => Promise<{ skill: unknown }>;
      /** 重新扫描磁盘上的 Skills 目录，返回最新列表。 */
      refreshSkills: () => Promise<{ items: SkillDefinition[] }>;
      /** 在系统文件管理器中打开 Skills 根目录。 */
      openSkillsFolder: () => Promise<void>;

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
