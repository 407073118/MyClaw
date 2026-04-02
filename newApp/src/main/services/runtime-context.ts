import type {
  ApprovalPolicy,
  ApprovalRequest,
  ChatSession,
  LocalEmployeeSummary,
  McpServer,
  ModelProfile,
  ResolvedBuiltinTool,
  ResolvedMcpTool,
  SkillDefinition,
  WorkflowDefinition,
  WorkflowSummary,
} from "@shared/contracts";

import type { MyClawPaths } from "./directory-service";
import type { McpServerManager } from "./mcp-server-manager";
import type { ResolvedModelCapability } from "./model-capability-resolver";

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
    getDefaultModelProfileId: () => string | null;
    setDefaultModelProfileId: (id: string | null) => void;
    getWorkflows: () => WorkflowSummary[];
    getApprovals: () => ApprovalPolicy;
    getApprovalRequests: () => ApprovalRequest[];
    setApprovalRequests: (requests: ApprovalRequest[]) => void;
  };
  services: {
    refreshSkills: () => Promise<SkillDefinition[]>;
    listMcpServers: () => McpServer[];
    mcpManager: McpServerManager | null;
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
