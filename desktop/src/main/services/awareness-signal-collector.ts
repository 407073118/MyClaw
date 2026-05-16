import type {
  AwarenessSignal,
  AwarenessSignalSeverity,
  AwarenessSignalSourceKind,
  AwarenessScope,
} from "@shared/contracts";
import { randomUUID } from "node:crypto";

export type SignalCollectorDeps = {
  getActiveSessionRuns: () => Map<string, { status: string; currentMessageId: string; phase: string; startedAt?: string }>;
  getAgentTasks: () => Array<{ id: string; status: string; assignees?: Array<{ siliconPersonId: string; status: string }> }>;
  getScheduleJobs: () => Array<{ id: string; status: string; lastRunAt?: string; nextRunAt?: string; executionRuns?: Array<{ status: string; finishedAt?: string }> }>;
  getWorkflowRuns: () => Array<{ id: string; status: string; workflowId: string; interruptRequested?: boolean }>;
  getBackgroundTasks: () => Array<{ sessionId: string; status?: string; backgroundTask?: { status?: string } }>;
  getApprovalRequests: () => Array<{ id: string; createdAt?: string; resolved?: boolean }>;
  getSiliconPersons: () => Array<{ id: string; status: string }>;
  getAvailabilityPolicy: () => unknown;
  now?: () => Date;
};

export type RawSignal = {
  sourceKind: AwarenessSignalSourceKind;
  sourceId: string;
  scope: AwarenessScope;
  severity: AwarenessSignalSeverity;
  summary: string;
  recommendedAction?: string;
  fingerprint: string;
};

const STUCK_THRESHOLD_MS = 30 * 60 * 1000;
const WAITING_USER_THRESHOLD_MS = 15 * 60 * 1000;
const STALE_JOB_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const PENDING_APPROVAL_THRESHOLD_MS = 10 * 60 * 1000;

export function createAwarenessSignalCollector(deps: SignalCollectorDeps) {
  const now = deps.now ?? (() => new Date());

  function collect(): RawSignal[] {
    const signals: RawSignal[] = [];
    const currentTime = now();

    collectFromAgentTasks(signals, currentTime);
    collectFromScheduleJobs(signals, currentTime);
    collectFromWorkflowRuns(signals);
    collectFromBackgroundTasks(signals);
    collectFromStuckSessions(signals, currentTime);
    collectFromPendingApprovals(signals, currentTime);
    collectFromSystemHealth(signals);

    return signals;
  }

  function collectFromAgentTasks(signals: RawSignal[], _now: Date): void {
    const tasks = deps.getAgentTasks();
    for (const task of tasks) {
      if (task.status === "failed") {
        signals.push({
          sourceKind: "agent_task",
          sourceId: task.id,
          scope: { kind: "personal" },
          severity: "warning",
          summary: `员工任务失败: ${task.id}`,
          recommendedAction: "重试或检查任务配置",
          fingerprint: `task:failed:${task.id}`,
        });
      }
      if (task.status === "waiting_user") {
        signals.push({
          sourceKind: "agent_task",
          sourceId: task.id,
          scope: { kind: "personal" },
          severity: "info",
          summary: `员工任务等待用户: ${task.id}`,
          recommendedAction: "前往查看并处理",
          fingerprint: `task:waiting:${task.id}`,
        });
      }
    }
  }

  function collectFromScheduleJobs(signals: RawSignal[], currentTime: Date): void {
    const jobs = deps.getScheduleJobs();
    for (const job of jobs) {
      if (job.status === "failed") {
        signals.push({
          sourceKind: "schedule_job",
          sourceId: job.id,
          scope: { kind: "personal" },
          severity: "warning",
          summary: `定时任务失败: ${job.id}`,
          recommendedAction: "检查任务配置或手动重试",
          fingerprint: `job:failed:${job.id}`,
        });
      }
      if (job.nextRunAt) {
        const expected = new Date(job.nextRunAt).getTime();
        const delay = currentTime.getTime() - expected;
        if (delay > STALE_JOB_THRESHOLD_MS && job.status !== "completed") {
          signals.push({
            sourceKind: "schedule_job",
            sourceId: job.id,
            scope: { kind: "personal" },
            severity: "critical",
            summary: `定时任务严重滞后: ${job.id}，预期 ${job.nextRunAt}`,
            recommendedAction: "检查调度器是否正常",
            fingerprint: `job:stale:${job.id}`,
          });
        }
      }
    }
  }

  function collectFromWorkflowRuns(signals: RawSignal[]): void {
    const runs = deps.getWorkflowRuns();
    for (const run of runs) {
      if (run.status === "failed") {
        signals.push({
          sourceKind: "workflow_run",
          sourceId: run.id,
          scope: { kind: "personal" },
          severity: "warning",
          summary: `工作流执行失败: ${run.id}`,
          recommendedAction: "检查工作流配置或重试",
          fingerprint: `workflow:failed:${run.id}`,
        });
      }
      if (run.interruptRequested) {
        signals.push({
          sourceKind: "workflow_run",
          sourceId: run.id,
          scope: { kind: "personal" },
          severity: "info",
          summary: `工作流等待人工输入: ${run.id}`,
          recommendedAction: "前往处理",
          fingerprint: `workflow:waiting:${run.id}`,
        });
      }
    }
  }

  function collectFromBackgroundTasks(signals: RawSignal[]): void {
    const sessions = deps.getBackgroundTasks();
    for (const session of sessions) {
      if (session.backgroundTask?.status === "failed") {
        signals.push({
          sourceKind: "background_task",
          sourceId: session.sessionId,
          scope: { kind: "personal" },
          severity: "warning",
          summary: `后台研究任务失败: ${session.sessionId}`,
          recommendedAction: "检查网络或重试",
          fingerprint: `bg:failed:${session.sessionId}`,
        });
      }
    }
  }

  function collectFromStuckSessions(signals: RawSignal[], currentTime: Date): void {
    const runs = deps.getActiveSessionRuns();
    for (const [sessionId, run] of runs) {
      if (run.status === "running" && run.phase === "model") {
        if (!run.startedAt) continue;
        const elapsed = currentTime.getTime() - new Date(run.startedAt).getTime();
        if (elapsed < STUCK_THRESHOLD_MS) continue;
        signals.push({
          sourceKind: "session_stuck",
          sourceId: sessionId,
          scope: { kind: "personal" },
          severity: "warning",
          summary: `会话运行超过阈值: ${sessionId}`,
          recommendedAction: "检查是否需要取消",
          fingerprint: `stuck:${sessionId}`,
        });
      }
    }
  }

  function collectFromPendingApprovals(signals: RawSignal[], currentTime: Date): void {
    const requests = deps.getApprovalRequests();
    for (const req of requests) {
      if (req.resolved) continue;
      const createdAt = req.createdAt ? new Date(req.createdAt).getTime() : 0;
      const age = currentTime.getTime() - createdAt;
      if (age > PENDING_APPROVAL_THRESHOLD_MS) {
        signals.push({
          sourceKind: "approval_pending",
          sourceId: req.id,
          scope: { kind: "personal" },
          severity: "info",
          summary: `审批请求等待处理: ${req.id}`,
          recommendedAction: "前往审批或拒绝",
          fingerprint: `approval:${req.id}`,
        });
      }
    }
  }

  function collectFromSystemHealth(signals: RawSignal[]): void {
    const persons = deps.getSiliconPersons();
    for (const person of persons) {
      if (person.status === "error") {
        signals.push({
          sourceKind: "system_health",
          sourceId: person.id,
          scope: { kind: "silicon_person", ownerId: person.id },
          severity: "warning",
          summary: `硅基员工异常: ${person.id}`,
          recommendedAction: "检查员工状态",
          fingerprint: `health:person_error:${person.id}`,
        });
      }
    }
  }

  return { collect };
}

export function createSignalFromRaw(raw: RawSignal): AwarenessSignal {  const now = new Date().toISOString();
  const cooldownMs = 2 * 60 * 60 * 1000;
  return {
    id: randomUUID(),
    fingerprint: raw.fingerprint,
    sourceKind: raw.sourceKind,
    sourceId: raw.sourceId,
    scope: raw.scope,
    severity: raw.severity,
    summary: raw.summary,
    recommendedAction: raw.recommendedAction,
    status: "active",
    cooldownUntil: new Date(Date.now() + cooldownMs).toISOString(),
    createdAt: now,
    updatedAt: now,
  };
}
