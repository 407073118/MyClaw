import { ipcMain } from "electron";

import type {
  ApprovalPolicy,
  ApprovalRequest,
  AvailabilityPolicy,
  CalendarEvent,
  ChatSession,
  ExecutionRun,
  McpServer,
  ModelProfile,
  PersonalPromptProfile,
  Reminder,
  ResolvedBuiltinTool,
  ResolvedMcpTool,
  ScheduleJob,
  SkillDefinition,
  SiliconPerson,
  TaskCommitment,
  TodayBrief,
  WorkflowRunSummary,
  WorkflowSummary,
} from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import type { AppUpdateSnapshot } from "../services/app-updater";

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
  workflowRuns: WorkflowRunSummary[];
  approvals: ApprovalPolicy;
  approvalRequests: ApprovalRequest[];
  personalPrompt: PersonalPromptProfile;
  mcp: { servers: McpServer[] };
  siliconPersons: SiliconPerson[];
  myClawRootPath: string;
  skillsRootPath: string;
  sessionsRootPath: string;
  workspaceRootPath: string;
  artifactsRootPath: string;
  cacheRootPath: string;
  requiresInitialSetup: boolean;
  updates: AppUpdateSnapshot;
  time: {
    calendarEvents: CalendarEvent[];
    taskCommitments: TaskCommitment[];
    reminders: Reminder[];
    scheduleJobs: ScheduleJob[];
    executionRuns: ExecutionRun[];
    availabilityPolicy: AvailabilityPolicy | null;
    todayBrief: TodayBrief | null;
  };
};

export function registerBootstrapHandlers(ctx: RuntimeContext): void {
  ipcMain.handle("app:bootstrap", async (): Promise<BootstrapPayload> => {
    const emptyTimeSnapshot: BootstrapPayload["time"] = {
      calendarEvents: [],
      taskCommitments: [],
      reminders: [],
      scheduleJobs: [],
      executionRuns: [],
      availabilityPolicy: null,
      todayBrief: null,
    };

    const [skills, , timeSnapshot] = await Promise.all([
      ctx.services.refreshSkills(),
      // 等待 MCP 服务连接完成，确保 bootstrap 能返回已加载的工具列表
      ctx.services.mcpReady,
      ctx.services.timeApplication?.getSnapshot() ?? Promise.resolve(emptyTimeSnapshot),
    ]);

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
      personalPrompt: ctx.state.getPersonalPromptProfile(),
      mcp: { servers: ctx.services.listMcpServers() },
      siliconPersons: ctx.state.siliconPersons,
      workflowRuns: ctx.state.workflowRuns,
      myClawRootPath: ctx.runtime.myClawRootPath,
      skillsRootPath: ctx.runtime.skillsRootPath,
      sessionsRootPath: ctx.runtime.sessionsRootPath,
      workspaceRootPath: ctx.runtime.workspaceRootPath,
      artifactsRootPath: ctx.runtime.artifactsRootPath,
      cacheRootPath: ctx.runtime.cacheRootPath,
      requiresInitialSetup: !hasConfiguredModel(ctx.state.models),
      updates: ctx.services.appUpdater.getSnapshot(),
      time: timeSnapshot,
    };
  });
}
