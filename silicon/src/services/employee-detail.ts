import { listApprovalRequests } from "../core/approval-store.js";
import type { SiliconLogger } from "../core/employee-scaffold.js";
import { readHeartbeatState } from "../core/heartbeat-state.js";
import { readMemoryJournal } from "../core/memory-store.js";
import { readEmployeeProfile } from "../core/profile-store.js";
import { listEmployeeSchedules } from "../core/schedule-store.js";
import { listEmployeeTasks } from "../core/task-store.js";
import type { ApprovalListItemView, EmployeeDetailView, TaskListItemView } from "../contracts/view-models.js";
import { inspectEmployeeRuntimeHealth, validateEmployeeFolder } from "../testing/employee-ci.js";
import { resolveRuntimeEmployeeDir } from "./runtime-paths.js";

export type GetEmployeeDetailViewInput = {
  runtimeRoot: string;
  employeeId: string;
  logger?: SiliconLogger;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 构建员工 Inspector 详情视图，避免 UI 直接读取员工文件结构。 */
export async function getEmployeeDetailView(input: GetEmployeeDetailViewInput): Promise<EmployeeDetailView> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始构建 UI 员工详情视图", {
    runtimeRoot: input.runtimeRoot,
    employeeId: input.employeeId,
  });
  const employeeDir = resolveRuntimeEmployeeDir(input.runtimeRoot, input.employeeId, logger);
  const [profile, heartbeat, tasks, approvals, schedules, memory, ci, health] = await Promise.all([
    readEmployeeProfile(employeeDir),
    readHeartbeatState(employeeDir, logger),
    listEmployeeTasks(employeeDir, logger),
    listApprovalRequests(employeeDir, logger),
    listEmployeeSchedules(employeeDir),
    readMemoryJournal(employeeDir),
    validateEmployeeFolder(employeeDir, { logger }),
    inspectEmployeeRuntimeHealth(employeeDir, { logger }),
  ]);

  const taskViews = tasks.map(toTaskListItemView);
  const approvalViews = approvals.map(toApprovalListItemView);
  const view: EmployeeDetailView = {
    profile,
    heartbeat,
    counts: {
      openTasks: taskViews.filter((task) => ["queued", "running", "waiting_approval"].includes(task.status)).length,
      waitingApprovals: approvalViews.filter((approval) => approval.status === "requested").length,
      blockedTasks: taskViews.filter((task) => task.status === "blocked").length,
      failedTasks: taskViews.filter((task) => task.status === "failed").length,
      schedules: schedules.length,
      memoryEvents: memory.length,
    },
    tasks: taskViews,
    approvals: approvalViews,
    doctor: {
      passed: ci.passed && health.staleLocks === 0 && health.malformedRecords === 0,
      staleLocks: health.staleLocks,
      malformedRecords: health.malformedRecords,
      errors: health.errors,
    },
  };
  logger.info("UI 员工详情视图已构建", {
    employeeId: input.employeeId,
    taskCount: view.tasks.length,
    approvalCount: view.approvals.length,
  });
  return view;
}

/** 将持久化 task 转成 UI 列表视图。 */
function toTaskListItemView(task: Awaited<ReturnType<typeof listEmployeeTasks>>[number]): TaskListItemView {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    attempt: task.attempt,
    requestedCapability: task.requestedCapability,
    approvalId: task.approvalId,
    runId: task.runId,
    artifactPath: task.artifactPath,
    reviewPath: task.reviewPath,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

/** 将持久化 approval 转成 UI 列表视图。 */
function toApprovalListItemView(approval: Awaited<ReturnType<typeof listApprovalRequests>>[number]): ApprovalListItemView {
  return {
    id: approval.id,
    taskId: approval.taskId,
    capability: approval.capability,
    reason: approval.reason,
    status: approval.status,
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt,
    resolvedAt: approval.resolvedAt,
  };
}
