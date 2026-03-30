import type {
  ApprovalPolicy,
  ApprovalRequest,
  ChatSession,
  LocalEmployeeSummary,
  McpServer,
  ModelProfile,
  ResolvedMcpTool,
  ResolvedBuiltinTool,
  SkillDefinition,
  WorkflowDefinitionSummary,
} from "@myclaw-desktop/shared";

type BootstrapData = {
  services: string[];
  defaultModelProfileId: string | null;
  sessions: ChatSession[];
  models: ModelProfile[];
  myClawRootPath: string;
  skillsRootPath: string;
  sessionsRootPath: string;
  runtimeStateFilePath: string;
  requiresInitialSetup: boolean;
  isFirstLaunch: boolean;
  mcp: {
    servers: McpServer[];
  };
  tools: {
    builtin: ResolvedBuiltinTool[];
    mcp: ResolvedMcpTool[];
  };
  skills: {
    items: SkillDefinition[];
  };
  employees: LocalEmployeeSummary[];
  workflows: WorkflowDefinitionSummary[];
  approvals: ApprovalPolicy;
  approvalRequests: ApprovalRequest[];
};

export function createBootstrapResponse(input: BootstrapData) {
  return {
    app: "myclaw-desktop",
    version: "0.1.0",
    services: input.services,
    defaultModelProfileId: input.defaultModelProfileId,
    sessions: input.sessions,
    models: input.models,
    myClawRootPath: input.myClawRootPath,
    skillsRootPath: input.skillsRootPath,
    sessionsRootPath: input.sessionsRootPath,
    runtimeStateFilePath: input.runtimeStateFilePath,
    requiresInitialSetup: input.requiresInitialSetup,
    isFirstLaunch: input.isFirstLaunch,
    mcp: input.mcp,
    tools: input.tools,
    skills: input.skills,
    employees: input.employees,
    workflows: input.workflows,
    approvals: input.approvals,
    approvalRequests: input.approvalRequests,
  };
}
