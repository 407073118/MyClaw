import type {
  ApprovalPolicy,
  ApprovalRequest,
  ChatRunPhase,
  ChatSession,
  LocalEmployeeSummary,
  McpServer,
  ModelProfile,
  PersonalPromptProfile,
  ResolvedBuiltinTool,
  ResolvedMcpTool,
  SkillDefinition,
  WorkflowDefinition,
  WorkflowRunSummary,
  WorkflowSummary,
} from "@shared/contracts";

import type { MyClawPaths } from "./directory-service";
import type { McpServerManager } from "./mcp-server-manager";
import type { ResolvedModelCapability } from "./model-capability-resolver";
import type { AppUpdaterService } from "./app-updater";

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
    sessionsRootPath: string;
    paths: MyClawPaths;
  };
  state: {
    models: ModelProfile[];
    sessions: ChatSession[];
    employees: LocalEmployeeSummary[];
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
  };
  services: {
    refreshSkills: () => Promise<SkillDefinition[]>;
    listMcpServers: () => McpServer[];
    mcpManager: McpServerManager | null;
    appUpdater: AppUpdaterService;
    resolveModelCapability?: (profile: ModelProfile) => ResolvedModelCapability;
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
