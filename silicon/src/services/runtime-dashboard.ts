import type { SiliconLogger } from "../core/employee-scaffold.js";
import { readSiliconDaemonSupervisorStatus } from "../runtime/supervisor.js";
import type {
  ActionRequiredItemView,
  EmployeeListItemView,
  QueueStreamItemView,
  RuntimeDashboardView,
  RuntimeSummaryView,
  UiErrorView,
} from "../contracts/view-models.js";
import { getEmployeeDetailView } from "./employee-detail.js";
import { listRuntimeEmployeeIds } from "./runtime-paths.js";

export type GetRuntimeDashboardViewInput = {
  runtimeRoot: string;
  logger?: SiliconLogger;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 构建 Workbench 首页 dashboard 视图，聚合员工、任务、审批和 daemon 状态。 */
export async function getRuntimeDashboardView(input: GetRuntimeDashboardViewInput): Promise<RuntimeDashboardView> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始构建 UI runtime dashboard", { runtimeRoot: input.runtimeRoot });
  const [daemon, employeeIds] = await Promise.all([
    readSiliconDaemonSupervisorStatus(input.runtimeRoot, logger),
    listRuntimeEmployeeIds(input.runtimeRoot, logger),
  ]);
  const employees: EmployeeListItemView[] = [];
  const queueStream: QueueStreamItemView[] = [];
  const actionRequired: ActionRequiredItemView[] = [];
  const errors: UiErrorView[] = [];

  for (const employeeId of employeeIds) {
    try {
      const detail = await getEmployeeDetailView({ runtimeRoot: input.runtimeRoot, employeeId, logger });
      employees.push({
        employeeId,
        displayName: detail.profile.displayName,
        definitionId: detail.profile.definitionId,
        templateName: detail.profile.templateName,
        status: detail.profile.status,
        currentTaskId: detail.profile.currentTaskId,
        currentRunId: detail.profile.currentRunId,
        lastBeatAt: detail.heartbeat.lastBeatAt,
        tickCount: detail.heartbeat.tickCount,
        lastErrorMessage: detail.profile.lastErrorMessage,
        openTasks: detail.counts.openTasks,
        waitingApprovals: detail.counts.waitingApprovals,
        blockedTasks: detail.counts.blockedTasks,
        failedTasks: detail.counts.failedTasks,
        doctorStatus: detail.doctor.passed ? "passed" : "failed",
      });
      for (const task of detail.tasks) {
        queueStream.push({
          id: `${employeeId}:${task.id}`,
          kind: "task",
          employeeId,
          title: task.title,
          status: task.status,
          blocker: task.errorMessage,
          updatedAt: task.updatedAt,
        });
        if (task.status === "blocked") {
          actionRequired.push({
            id: `${employeeId}:${task.id}:blocked`,
            kind: "blocked_task",
            employeeId,
            taskId: task.id,
            title: task.title,
            message: task.errorMessage ?? "任务已阻塞，需要查看 run inspector。",
            severity: "warning",
            updatedAt: task.updatedAt,
          });
        }
      }
      for (const approval of detail.approvals) {
        queueStream.push({
          id: `${employeeId}:${approval.id}`,
          kind: "approval",
          employeeId,
          title: approval.reason,
          status: approval.status,
          updatedAt: approval.updatedAt,
        });
        if (approval.status === "requested") {
          actionRequired.push({
            id: `${employeeId}:${approval.id}:approval`,
            kind: "approval",
            employeeId,
            taskId: approval.taskId,
            approvalId: approval.id,
            title: `审批 ${approval.capability}`,
            message: approval.reason,
            severity: "warning",
            updatedAt: approval.updatedAt,
          });
        }
      }
      if (!detail.doctor.passed) {
        actionRequired.push(...buildDoctorActionItems(employeeId, detail.doctor.staleLocks, detail.doctor.malformedRecords));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("构建 UI 员工摘要失败，已返回不可读员工行", { employeeId, errorMessage: message });
      employees.push({
        employeeId,
        displayName: "<unreadable>",
        definitionId: "<unknown>",
        status: "unreadable",
        lastBeatAt: null,
        tickCount: 0,
        openTasks: 0,
        waitingApprovals: 0,
        blockedTasks: 0,
        failedTasks: 0,
        doctorStatus: "failed",
      });
      errors.push({
        code: "employee_unreadable",
        message,
        target: { kind: "employee", id: employeeId },
        recoverable: true,
        suggestedAction: "打开 Doctor 查看员工目录和 JSON 记录。",
      });
    }
  }

  queueStream.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const summary = buildRuntimeSummary(employees, queueStream);
  const view: RuntimeDashboardView = {
    runtimeRoot: input.runtimeRoot,
    daemon: {
      status: daemon.status,
      pid: daemon.pid,
      tickCount: daemon.tickCount,
      updatedAt: daemon.updatedAt,
      lastErrorMessage: daemon.lastErrorMessage,
    },
    summary,
    employees,
    queueStream,
    actionRequired,
    errors,
  };
  logger.info("UI runtime dashboard 已构建", {
    runtimeRoot: input.runtimeRoot,
    employees: view.summary.employees,
    blocked: view.summary.blocked,
    waitingApproval: view.summary.waitingApproval,
  });
  return view;
}

/** 生成 doctor 相关的待处理动作。 */
function buildDoctorActionItems(employeeId: string, staleLocks: number, malformedRecords: number): ActionRequiredItemView[] {
  const items: ActionRequiredItemView[] = [];
  if (staleLocks > 0) {
    items.push({
      id: `${employeeId}:stale-locks`,
      kind: "stale_lock",
      employeeId,
      title: "过期锁",
      message: `发现 ${staleLocks} 个过期锁，需要通过 doctor 确认恢复路径。`,
      severity: "warning",
    });
  }
  if (malformedRecords > 0) {
    items.push({
      id: `${employeeId}:malformed-records`,
      kind: "malformed_record",
      employeeId,
      title: "坏记录",
      message: `发现 ${malformedRecords} 条坏记录，需要人工修复。`,
      severity: "error",
    });
  }
  return items;
}

/** 汇总 dashboard 顶部数字指标。 */
function buildRuntimeSummary(employees: EmployeeListItemView[], queueStream: QueueStreamItemView[]): RuntimeSummaryView {
  return {
    employees: employees.length,
    running: queueStream.filter((item) => item.status === "running").length,
    waitingApproval: queueStream.filter((item) => item.status === "waiting_approval" || item.status === "requested").length,
    blocked: queueStream.filter((item) => item.status === "blocked").length,
    failed: queueStream.filter((item) => item.status === "failed").length,
    queued: queueStream.filter((item) => item.status === "queued").length,
    succeeded: queueStream.filter((item) => item.status === "succeeded").length,
  };
}
