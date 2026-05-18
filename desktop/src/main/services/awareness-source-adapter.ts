import type {
  ApprovalRequest,
  ChatSession,
  ExecutionRun,
  ScheduleJob,
  SiliconPerson,
  WorkflowRunSummary,
} from "@shared/contracts";
import type { ActiveSessionRun } from "./runtime-context";
import type { TimeOrchestrationStore } from "./time-orchestration-store";

export type AwarenessSourceSnapshot = {
  scheduleJobs: ScheduleJob[];
  executionRuns: ExecutionRun[];
  latestExecutionRunsByScheduleJobId: Map<string, ExecutionRun>;
  sessions: ChatSession[];
  workflowRuns: WorkflowRunSummary[];
  approvalRequests: ApprovalRequest[];
  siliconPersons: SiliconPerson[];
  activeSessionRuns: Map<string, ActiveSessionRun>;
};

export type AwarenessSourceAdapterDeps = {
  timeStore: Pick<TimeOrchestrationStore, "listScheduleJobs" | "listExecutionRuns">;
  getSessions: () => ChatSession[];
  getWorkflowRuns: () => WorkflowRunSummary[];
  getApprovalRequests: () => ApprovalRequest[];
  getSiliconPersons: () => SiliconPerson[];
  getActiveSessionRuns: () => Map<string, ActiveSessionRun>;
};

/** 创建值守数据源适配器，统一从 main runtime 拉取一次性快照。 */
export function createAwarenessSourceAdapter(deps: AwarenessSourceAdapterDeps) {
  /** 读取值守所需的真实运行时数据，避免 collector 直接依赖 IPC 模块或空数组占位。 */
  async function snapshot(): Promise<AwarenessSourceSnapshot> {
    console.info("[awareness-source] 构建值守数据源快照");
    const [scheduleJobs, executionRuns] = await Promise.all([
      deps.timeStore.listScheduleJobs(),
      deps.timeStore.listExecutionRuns(200),
    ]);

    return {
      scheduleJobs,
      executionRuns,
      latestExecutionRunsByScheduleJobId: buildLatestExecutionRunsByScheduleJobId(executionRuns),
      sessions: deps.getSessions(),
      workflowRuns: deps.getWorkflowRuns(),
      approvalRequests: deps.getApprovalRequests(),
      siliconPersons: deps.getSiliconPersons(),
      activeSessionRuns: deps.getActiveSessionRuns(),
    };
  }

  return { snapshot };
}

/** 按计划任务归组最近一次执行结果，供 signal collector 判断失败恢复和最新状态。 */
function buildLatestExecutionRunsByScheduleJobId(executionRuns: ExecutionRun[]): Map<string, ExecutionRun> {
  const latest = new Map<string, ExecutionRun>();
  for (const run of executionRuns) {
    const existing = latest.get(run.jobId);
    if (!existing || Date.parse(run.startedAt) > Date.parse(existing.startedAt)) {
      latest.set(run.jobId, run);
    }
  }
  return latest;
}
