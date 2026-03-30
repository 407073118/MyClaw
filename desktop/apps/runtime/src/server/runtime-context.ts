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
  WorkflowSummary,
} from "@myclaw-desktop/shared";
import type { RuntimeLayout } from "../services/runtime-layout";

export type RuntimeContext = {
  runtime: {
    runtimeStateFilePath: string;
    runtimeLayout: RuntimeLayout;
    isFirstLaunch: boolean;
  };
  state: {
    models: ModelProfile[];
    sessions: { sessions: ChatSession[] };
    getDefaultModelProfileId: () => string | null;
    getEmployees: () => LocalEmployeeSummary[];
    getWorkflows: () => WorkflowSummary[];
    getApprovals: () => ApprovalPolicy;
    getApprovalRequests: () => ApprovalRequest[];
    setApprovalRequests: (requests: ApprovalRequest[]) => void;
  };
  services: {
    refreshSkills: () => Promise<SkillDefinition[]>;
    listMcpServers: () => McpServer[];
  };
  tools: {
    resolveBuiltinTools: () => ResolvedBuiltinTool[];
    resolveMcpTools: () => ResolvedMcpTool[];
  };
  guards: {
    shouldRequireInitialSetup: () => boolean;
  };
};

/**
 * 创建 runtime 共享上下文容器。
 * 仅承载跨路由共享的长期状态和服务，不放 request 级临时变量。
 */
export function createRuntimeContext(input: RuntimeContext): RuntimeContext {
  return input;
}
