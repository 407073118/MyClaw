import type {
  ApprovalPolicy,
  ApprovalRequest,
  AsrConfig,
  ChatRunPhase,
  ChatSession,
  McpServer,
  ModelProfile,
  PersonalPromptProfile,
  ResolvedBuiltinTool,
  ResolvedMcpTool,
  SkillDefinition,
  SiliconPerson,
  WorkflowDefinition,
  WorkflowRunSummary,
  WorkflowSummary,
} from "@shared/contracts";

import type { MyClawPaths } from "./directory-service";
import type { ArtifactManager } from "./artifact-manager";
import type { ArtifactRegistry } from "./artifact-registry";
import type { McpServerManager } from "./mcp-server-manager";
import type { ResolvedModelCapability } from "./model-capability-resolver";
import type { AppUpdaterService } from "./app-updater";
import type { MeetingRecorder } from "./meeting-recorder";
import type { TimeApplicationService } from "./time-application-service";
import type { TimeJobExecutor } from "./time-job-executor";
import type { TimeNotificationService } from "./time-notification-service";
import type { TimeScheduler } from "./time-scheduler";
import type { TimeOrchestrationStore } from "./time-orchestration-store";

export type ActiveSessionRun = {
  runId: string;
  abortController: AbortController;
  status: "running" | "canceling";
  phase: ChatRunPhase;
  currentMessageId: string;
  pendingApprovalIds: string[];
  cancelRequested: boolean;
};

export type RuntimeContext = {
  runtime: {
    myClawRootPath: string;
    skillsRootPath: string;
    workspaceRootPath: string;
    artifactsRootPath: string;
    cacheRootPath: string;
    sessionsRootPath: string;
    paths: MyClawPaths;
  };
  state: {
    models: ModelProfile[];
    sessions: ChatSession[];
    siliconPersons: SiliconPerson[];
    skills: SkillDefinition[];
    workflowDefinitions: Record<string, WorkflowDefinition>;
    workflowRuns: WorkflowRunSummary[];
    /** 正在执行的 PregelRunner 实例，key 为 runId */
    activeWorkflowRuns: Map<string, any>;
    activeSessionRuns: Map<string, ActiveSessionRun>;
    getDefaultModelProfileId: () => string | null;
    setDefaultModelProfileId: (id: string | null) => void;
    getWorkflows: () => WorkflowSummary[];
    getApprovals: () => ApprovalPolicy;
    getApprovalRequests: () => ApprovalRequest[];
    setApprovalRequests: (requests: ApprovalRequest[]) => void;
    getPersonalPromptProfile: () => PersonalPromptProfile;
    setPersonalPromptProfile: (profile: PersonalPromptProfile) => void;
    getAsrConfig: () => AsrConfig;
    setAsrConfig: (config: AsrConfig) => void;
  };
  services: {
    artifactRegistry: ArtifactRegistry;
    artifactManager: ArtifactManager;
    refreshSkills: () => Promise<SkillDefinition[]>;
    listMcpServers: () => McpServer[];
    mcpManager: McpServerManager | null;
    /** connectAllEnabled() 返回的 Promise，bootstrap 等待它完成后再返回 MCP 工具列表。 */
    mcpReady?: Promise<void>;
    appUpdater: AppUpdaterService;
    resolveModelCapability?: (profile: ModelProfile) => ResolvedModelCapability;
    meetingRecorder?: MeetingRecorder;
    timeApplication?: TimeApplicationService;
    timeJobExecutor?: TimeJobExecutor;
    timeNotificationService?: TimeNotificationService;
    timeScheduler?: TimeScheduler;
    timeStore?: TimeOrchestrationStore;
  };
  tools: {
    resolveBuiltinTools: () => ResolvedBuiltinTool[];
    resolveMcpTools: () => ResolvedMcpTool[];
  };
};

/**
 * Creates the runtime context container holding all long-lived services and
 * state references shared across IPC handlers.
 */
export function createRuntimeContext(input: RuntimeContext): RuntimeContext {
  return input;
}
