import { ipcMain } from "electron";

import type {
  ApprovalPolicy,
  ApprovalRequest,
  ChatSession,
  McpServer,
  ModelProfile,
  ResolvedBuiltinTool,
  ResolvedMcpTool,
  SkillDefinition,
  WorkflowSummary,
} from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";

function hasConfiguredModel(models: ModelProfile[]): boolean {
  return models.some((m) => {
    const apiKey = (m.apiKey ?? "").trim();
    return m.baseUrl?.trim() && m.model?.trim() && apiKey && apiKey !== "replace-me";
  });
}

export type BootstrapPayload = {
  sessions: ChatSession[];
  models: ModelProfile[];
  defaultModelProfileId: string | null;
  tools: {
    builtin: ResolvedBuiltinTool[];
    mcp: ResolvedMcpTool[];
  };
  skills: { items: SkillDefinition[] };
  workflows: WorkflowSummary[];
  approvals: ApprovalPolicy;
  approvalRequests: ApprovalRequest[];
  mcp: { servers: McpServer[] };
  employees: [];
  workflowRuns: [];
  myClawRootPath: string;
  skillsRootPath: string;
  sessionsRootPath: string;
  requiresInitialSetup: boolean;
};

export function registerBootstrapHandlers(ctx: RuntimeContext): void {
  ipcMain.handle("app:bootstrap", async (): Promise<BootstrapPayload> => {
    const [skills] = await Promise.all([ctx.services.refreshSkills()]);

    return {
      sessions: ctx.state.sessions,
      models: ctx.state.models,
      defaultModelProfileId: ctx.state.getDefaultModelProfileId(),
      tools: {
        builtin: ctx.tools.resolveBuiltinTools(),
        mcp: ctx.tools.resolveMcpTools(),
      },
      skills: { items: skills },
      workflows: ctx.state.getWorkflows(),
      approvals: ctx.state.getApprovals(),
      approvalRequests: ctx.state.getApprovalRequests(),
      mcp: { servers: ctx.services.listMcpServers() },
      employees: [],
      workflowRuns: [],
      myClawRootPath: ctx.runtime.myClawRootPath,
      skillsRootPath: ctx.runtime.skillsRootPath,
      sessionsRootPath: ctx.runtime.sessionsRootPath,
      requiresInitialSetup: !hasConfiguredModel(ctx.state.models),
    };
  });
}
