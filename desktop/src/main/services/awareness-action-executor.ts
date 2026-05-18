import type {
  AwarenessAction,
  AwarenessRoutine,
  AwarenessSignal,
  AwarenessSignalStatus,
} from "@shared/contracts";
import type { AwarenessPolicyDecision } from "./awareness-policy-engine";

export type AwarenessActionExecutionContext = {
  routine: AwarenessRoutine;
  signals: AwarenessSignal[];
  policyDecision: AwarenessPolicyDecision;
  ledgerRecordId: string;
};

export type AwarenessActionExecutionResult = {
  status: "executed" | "blocked" | "pending";
  summary: string;
};

export type AwarenessActionExecutorDeps = {
  updateSignalStatus?: (
    id: string,
    status: AwarenessSignalStatus,
    extra?: { cooldownUntil?: string; resolvedAt?: string; dismissedAt?: string },
  ) => Promise<void>;
  notifyUser?: (payload: { routine: AwarenessRoutine; signals: AwarenessSignal[]; action: AwarenessAction }) => Promise<void>;
  createAgentTask?: (payload: Record<string, unknown>) => Promise<void>;
  triggerWorkflow?: (workflowId: string, payload?: Record<string, unknown>) => Promise<void>;
  executeScheduleJob?: (jobId: string) => Promise<void>;
  now?: () => Date;
};

export function createAwarenessActionExecutor(deps: AwarenessActionExecutorDeps = {}) {
  const now = deps.now ?? (() => new Date());

  /** 执行已经通过策略检查的值守动作，策略阻断时只返回状态不产生副作用。 */
  async function execute(
    action: AwarenessAction,
    context: AwarenessActionExecutionContext,
  ): Promise<AwarenessActionExecutionResult> {
    if (context.policyDecision.blocked) {
      const status = context.policyDecision.approvalStatus === "pending" ? "pending" : "blocked";
      console.info("[awareness-action] 策略阻断动作执行", {
        action: action.kind,
        status,
        reason: context.policyDecision.reason,
      });
      return { status, summary: context.policyDecision.reason };
    }

    switch (action.kind) {
      case "log_only":
        console.info("[awareness-action] 记录值守动作", { routineId: context.routine.id, description: action.description });
        return { status: "executed", summary: action.description };
      case "notify_user":
        return notifyUser(action, context);
      case "dismiss_signal":
        return dismissSignals(action, context);
      case "create_agent_task":
        return createAgentTask(action);
      case "trigger_workflow":
        return triggerWorkflow(action);
      case "execute_schedule_job":
        return executeScheduleJob(action);
      default:
        return { status: "blocked", summary: "未知动作类型" };
    }
  }

  /** 发送用户通知，未接入投递服务时写日志并视为已执行。 */
  async function notifyUser(
    action: AwarenessAction,
    context: AwarenessActionExecutionContext,
  ): Promise<AwarenessActionExecutionResult> {
    if (deps.notifyUser) {
      await deps.notifyUser({ routine: context.routine, signals: context.signals, action });
    }
    console.info("[awareness-action] 已处理用户通知动作", {
      routineId: context.routine.id,
      signalCount: context.signals.length,
    });
    return { status: "executed", summary: action.description };
  }

  /** 将动作关联的信号统一标记为 dismissed，并写入冷却时间。 */
  async function dismissSignals(
    action: AwarenessAction,
    context: AwarenessActionExecutionContext,
  ): Promise<AwarenessActionExecutionResult> {
    if (!deps.updateSignalStatus) return { status: "blocked", summary: "缺少执行器: updateSignalStatus" };
    const dismissedAt = now().toISOString();
    const cooldownUntil = new Date(now().getTime() + 2 * 60 * 60 * 1000).toISOString();
    for (const signal of context.signals) {
      await deps.updateSignalStatus(signal.id, "dismissed", { dismissedAt, cooldownUntil });
    }
    console.info("[awareness-action] 已忽略关联信号", {
      routineId: context.routine.id,
      signalCount: context.signals.length,
    });
    return { status: "executed", summary: action.description };
  }

  /** 创建 Agent 任务，缺少外部执行器时明确阻断。 */
  async function createAgentTask(action: AwarenessAction): Promise<AwarenessActionExecutionResult> {
    if (!deps.createAgentTask) return { status: "blocked", summary: "缺少执行器: createAgentTask" };
    await deps.createAgentTask(action.payload ?? {});
    return { status: "executed", summary: action.description };
  }

  /** 触发工作流，缺少 workflowId 或执行器时明确阻断。 */
  async function triggerWorkflow(action: AwarenessAction): Promise<AwarenessActionExecutionResult> {
    if (!deps.triggerWorkflow) return { status: "blocked", summary: "缺少执行器: triggerWorkflow" };
    const workflowId = typeof action.payload?.workflowId === "string" ? action.payload.workflowId : undefined;
    if (!workflowId) return { status: "blocked", summary: "缺少 workflowId" };
    await deps.triggerWorkflow(workflowId, action.payload);
    return { status: "executed", summary: action.description };
  }

  /** 执行定时任务，缺少 jobId 或执行器时明确阻断。 */
  async function executeScheduleJob(action: AwarenessAction): Promise<AwarenessActionExecutionResult> {
    if (!deps.executeScheduleJob) return { status: "blocked", summary: "缺少执行器: executeScheduleJob" };
    const jobId = typeof action.payload?.jobId === "string" ? action.payload.jobId : undefined;
    if (!jobId) return { status: "blocked", summary: "缺少 jobId" };
    await deps.executeScheduleJob(jobId);
    return { status: "executed", summary: action.description };
  }

  return { execute };
}

export type AwarenessActionExecutor = ReturnType<typeof createAwarenessActionExecutor>;
