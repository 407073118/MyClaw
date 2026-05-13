import type { SiliconLogger } from "../core/employee-scaffold.js";
import type { EmployeeTask } from "../core/task-store.js";

export type HarnessExecutorMode = "local_minimal" | "missing_adapter" | "forbidden";

export type HarnessExecutorDecision = {
  capability: string;
  mode: HarnessExecutorMode;
  canExecute: boolean;
  reason: string;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 裁决 harness 当前应使用的执行器边界，并写入中文控制日志。 */
export function resolveHarnessExecutorDecision(
  task: EmployeeTask,
  logger: SiliconLogger = noopLogger,
): HarnessExecutorDecision {
  const capability = task.requestedCapability ?? "artifact.write";
  logger.info("开始裁决硅基员工 harness 执行器边界", {
    taskId: task.id,
    capability,
  });

  if (capability === "employee.cross_access") {
    const decision: HarnessExecutorDecision = {
      capability,
      mode: "forbidden",
      canExecute: false,
      reason: "跨员工目录访问破坏员工身体和记忆边界，执行器层始终禁止。",
    };
    logger.warn("硅基员工 harness 执行器已禁止跨员工访问", {
      taskId: task.id,
      capability,
      mode: decision.mode,
    });
    return decision;
  }

  if (capability === "shell.execute" || capability === "network.external") {
    const decision: HarnessExecutorDecision = {
      capability,
      mode: "missing_adapter",
      canExecute: false,
      reason: `能力 ${capability} 已通过 policy/approval 进入 run，但当前尚未接入真实执行器适配器。`,
    };
    logger.warn("硅基员工 harness 缺少高风险能力执行器适配器", {
      taskId: task.id,
      capability,
      mode: decision.mode,
    });
    return decision;
  }

  const decision: HarnessExecutorDecision = {
    capability,
    mode: "local_minimal",
    canExecute: true,
    reason: `能力 ${capability} 可由本地最小 harness 执行器处理。`,
  };
  logger.info("硅基员工 harness 执行器边界裁决完成", {
    taskId: task.id,
    capability,
    mode: decision.mode,
  });
  return decision;
}
