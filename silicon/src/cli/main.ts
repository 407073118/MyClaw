import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  approveApprovalRequest,
  denyApprovalRequest,
  listApprovalRequests,
  readApprovalRequest,
} from "../core/approval-store.js";
import { scaffoldEmployeeFolder, type SiliconLogger } from "../core/employee-scaffold.js";
import { readMemoryJournal } from "../core/memory-store.js";
import { resolveEmployeeChildPath } from "../core/path-boundary.js";
import { readEmployeeProfile } from "../core/profile-store.js";
import { initializeSiliconRuntimeRoot } from "../core/runtime-root.js";
import {
  cancelScheduledTask,
  createScheduledTask,
  listEmployeeSchedules,
  readScheduledTask,
} from "../core/schedule-store.js";
import { listEmployeeTemplates } from "../core/template-registry.js";
import {
  cancelEmployeeTask,
  createEmployeeTask,
  listEmployeeTasks,
  readEmployeeTask,
  retryEmployeeTask,
} from "../core/task-store.js";
import { listEmployeeTodos } from "../core/todo-store.js";
import type { CapabilityId } from "../policy/policy-engine.js";
import { isCapabilityId } from "../policy/policy-engine.js";
import { runSiliconDaemonLoop, runSiliconDaemonTick } from "../runtime/daemon.js";
import { runEmployeeHeartbeat } from "../runtime/heartbeat.js";
import {
  readSiliconDaemonSupervisorStatus,
  requestSiliconDaemonSupervisorStop,
  startSiliconDaemonSupervisor,
} from "../runtime/supervisor.js";
import { inspectEmployeeRuntimeHealth, validateEmployeeFolder } from "../testing/employee-ci.js";

export type SiliconCliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 运行 Silicon Runtime CLI 命令，并把异常转为稳定的 CLI 结果。 */
export async function runSiliconCli(
  argv: string[],
  options?: { logger?: SiliconLogger },
): Promise<SiliconCliResult> {
  const logger = options?.logger ?? noopLogger;
  logger.info("开始解析 Silicon Runtime CLI 命令", { argv });
  try {
    return await dispatchSiliconCli(argv, logger);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Silicon Runtime CLI 命令执行失败", { argv, errorMessage });
    return { exitCode: 1, stdout: "", stderr: errorMessage };
  }
}

/** 分发 CLI 子命令，保持命令面和核心能力一一对应。 */
async function dispatchSiliconCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    return { exitCode: 0, stdout: buildHelpText(), stderr: "" };
  }
  if (argv[0] === "version" || argv[0] === "--version") {
    return { exitCode: 0, stdout: "silicon 0.1.0", stderr: "" };
  }

  if (argv[0] === "runtime" && argv[1] === "init") {
    return initializeRuntimeFromCli(argv, logger);
  }
  if (argv[0] === "runtime" && argv[1] === "status") {
    return runtimeStatusFromCli(argv, logger);
  }
  if (argv[0] === "runtime" && argv[1] === "doctor") {
    return runtimeDoctorFromCli(argv, logger);
  }
  if (argv[0] === "employee" && argv[1] === "create") {
    return createEmployeeFromCli(argv, logger);
  }
  if (argv[0] === "employee" && argv[1] === "validate") {
    return validateEmployeeFromCli(argv, logger);
  }
  if (argv[0] === "employee" && argv[1] === "list") {
    return listEmployeesFromCli(argv, logger);
  }
  if (argv[0] === "template" && argv[1] === "list") {
    return listTemplatesFromCli(logger);
  }
  if (argv[0] === "task") {
    return taskCommandFromCli(argv, logger);
  }
  if (argv[0] === "approval") {
    return approvalCommandFromCli(argv, logger);
  }
  if (argv[0] === "schedule") {
    return scheduleCommandFromCli(argv, logger);
  }
  if (argv[0] === "todo" && argv[1] === "list") {
    return listTodosFromCli(argv, logger);
  }
  if (argv[0] === "memory" && argv[1] === "list") {
    return listMemoryFromCli(argv, logger);
  }
  if (argv[0] === "heartbeat" && argv[1] === "tick") {
    return tickHeartbeatFromCli(argv, logger);
  }
  if (argv[0] === "daemon") {
    return daemonCommandFromCli(argv, logger);
  }

  logger.warn("CLI 命令不受支持", { argv });
  return { exitCode: 1, stdout: "", stderr: "Unsupported command." };
}

/** 从 CLI 参数初始化 Silicon Runtime 根目录。 */
async function initializeRuntimeFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const runtimeRoot = values.get("runtime-root");
  if (!runtimeRoot) {
    logger.warn("CLI 缺少初始化 runtime 所需参数", { hasRuntimeRoot: Boolean(runtimeRoot) });
    return fail("Missing required options: --runtime-root");
  }
  const result = await initializeSiliconRuntimeRoot({ runtimeRoot, logger });
  return ok(`runtime 已初始化: ${result.runtimeRoot} templates=${result.templateCount}`);
}

/** 输出 runtime 根目录的整体状态。 */
async function runtimeStatusFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const runtimeRoot = values.get("runtime-root");
  if (!runtimeRoot) {
    return fail("Missing required options: --runtime-root");
  }
  const employees = await listEmployeeEntries(runtimeRoot, logger);
  const templates = await readdir(resolveEmployeeChildPath(runtimeRoot, ["templates"], logger)).catch(() => []);
  const daemon = await readSiliconDaemonSupervisorStatus(runtimeRoot, logger);
  logger.info("CLI 已输出 runtime 状态", {
    runtimeRoot,
    employeeCount: employees.length,
    templateCount: templates.length,
    daemonStatus: daemon.status,
  });
  return ok([
    `runtime=${runtimeRoot}`,
    `employees=${employees.length}`,
    `templates=${templates.filter((item) => item.endsWith(".json")).length}`,
    `daemon=${daemon.status}`,
    `pid=${daemon.pid}`,
    `ticks=${daemon.tickCount}`,
  ].join(" "));
}

/** 执行 runtime 级健康检查，验证平台目录和员工目录是否可读。 */
async function runtimeDoctorFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const runtimeRoot = values.get("runtime-root");
  if (!runtimeRoot) {
    return fail("Missing required options: --runtime-root");
  }
  const employees = await listEmployeeEntries(runtimeRoot, logger);
  const checks: string[] = [];
  checks.push(await pathExists(resolveEmployeeChildPath(runtimeRoot, ["platform"], logger)) ? "platform=ok" : "platform=missing");
  checks.push(await pathExists(resolveEmployeeChildPath(runtimeRoot, ["templates"], logger)) ? "templates=ok" : "templates=missing");
  checks.push(await pathExists(resolveEmployeeChildPath(runtimeRoot, ["employees"], logger)) ? "employees=ok" : "employees=missing");
  let passedEmployees = 0;
  let failedEmployees = 0;
  let staleLocks = 0;
  let malformedRecords = 0;
  for (const employeeId of employees) {
    const employeeDir = resolveEmployeeDir(runtimeRoot, employeeId);
    const result = await validateEmployeeFolder(employeeDir, { logger });
    const health = await inspectEmployeeRuntimeHealth(employeeDir, { logger });
    staleLocks += health.staleLocks;
    malformedRecords += health.malformedRecords;
    const passed = result.passed && health.staleLocks === 0 && health.malformedRecords === 0;
    if (passed) {
      passedEmployees += 1;
    } else {
      failedEmployees += 1;
    }
    checks.push(`${employeeId}=${passed ? "ok" : "failed"} staleLocks=${health.staleLocks} malformedRecords=${health.malformedRecords}`);
    for (const error of health.errors) {
      checks.push(`${employeeId}.error=${error}`);
    }
  }
  checks.push(`runtime doctor: employees=${employees.length} passed=${passedEmployees} failed=${failedEmployees} staleLocks=${staleLocks} malformedRecords=${malformedRecords}`);
  logger.info("CLI 已完成 runtime doctor", { runtimeRoot, checkCount: checks.length });
  const failed = checks.filter((line) => line.endsWith("missing") || line.includes("=failed"));
  return failed.length > 0 ? { exitCode: 1, stdout: checks.join("\n"), stderr: `doctor failed: ${failed.length}` } : ok(checks.join("\n"));
}

/** 从 CLI 输出内置员工模板列表。 */
function listTemplatesFromCli(logger: SiliconLogger): SiliconCliResult {
  const templates = listEmployeeTemplates(logger);
  logger.info("CLI 已输出硅基员工模板列表", { count: templates.length });
  return ok(templates.map((template) => `${template.definitionId}\t${template.displayName}\t${template.defaultSkillId}`).join("\n"));
}

/** 从 CLI 参数创建员工，并记录中文执行日志。 */
async function createEmployeeFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const runtimeRoot = values.get("runtime-root");
  const employeeId = values.get("id");
  const displayName = values.get("name");
  const definitionId = values.get("template");
  if (!runtimeRoot || !employeeId || !displayName || !definitionId) {
    logger.warn("CLI 缺少创建硅基员工所需参数", {
      hasRuntimeRoot: Boolean(runtimeRoot),
      hasEmployeeId: Boolean(employeeId),
      hasDisplayName: Boolean(displayName),
      hasDefinitionId: Boolean(definitionId),
    });
    return fail("Missing required options: --runtime-root, --id, --name, --template");
  }
  const result = await scaffoldEmployeeFolder({
    runtimeRoot,
    employeeId,
    displayName,
    definitionId,
    logger,
  });
  logger.info("CLI 已创建硅基员工", { employeeId, employeeDir: result.employeeDir });
  return ok(`硅基员工已创建: ${result.employeeDir}`);
}

/** 从 CLI 参数列出运行根目录下的所有员工。 */
async function listEmployeesFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const runtimeRoot = values.get("runtime-root");
  if (!runtimeRoot) {
    return fail("Missing required options: --runtime-root");
  }
  const employees = await listEmployeeEntries(runtimeRoot, logger);
  const lines: string[] = [];
  for (const employeeId of employees) {
    const employeeDir = resolveEmployeeDir(runtimeRoot, employeeId);
    const profile = await readEmployeeProfile(employeeDir).catch(() => null);
    lines.push(profile
      ? `${profile.employeeId}\t${profile.displayName}\t${profile.status}\t${profile.definitionId}`
      : `${employeeId}\t<unknown>\tfailed\t<unknown>`);
  }
  logger.info("CLI 已列出硅基员工实例", { runtimeRoot, count: lines.length });
  return ok(lines.join("\n"));
}

/** 从 CLI 参数执行员工文件夹 CI 校验。 */
async function validateEmployeeFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const runtimeRoot = values.get("runtime-root");
  const employeeId = values.get("employee");
  if (!runtimeRoot || !employeeId) {
    return fail("Missing required options: --runtime-root, --employee");
  }
  const result = await validateEmployeeFolder(resolveEmployeeDir(runtimeRoot, employeeId), { logger });
  logger.info("CLI 已完成硅基员工 CI 校验", {
    employeeId,
    passed: result.passed,
    checkCount: result.checks.length,
  });
  if (!result.passed) {
    const failedCount = result.checks.filter((check) => !check.passed).length;
    return fail(`employee CI 未通过: failed=${failedCount} checks=${result.checks.length}`);
  }
  return ok(`employee CI 通过: checks=${result.checks.length}`);
}

/** 分发 task 管理命令。 */
async function taskCommandFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  if (argv[1] === "create") {
    return createTaskFromCli(argv, logger);
  }
  if (argv[1] === "status") {
    return readTaskStatusFromCli(argv, logger);
  }
  if (argv[1] === "list") {
    return listTasksFromCli(argv, logger);
  }
  if (argv[1] === "cancel") {
    return cancelTaskFromCli(argv, logger);
  }
  if (argv[1] === "retry") {
    return retryTaskFromCli(argv, logger);
  }
  if (argv[1] === "artifact" || argv[1] === "review") {
    return readTaskOutputFromCli(argv, logger);
  }
  return fail("Unsupported task command.");
}

/** 从 CLI 参数创建员工任务，并写入 inbox。 */
async function createTaskFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const required = readTaskIdentity(values);
  const title = values.get("title");
  const instruction = values.get("instruction");
  if (required instanceof Error || !title || !instruction) {
    return fail("Missing required options: --runtime-root, --employee, --id, --title, --instruction");
  }
  const requestedCapability = parseOptionalCapability(values.get("capability"), logger);
  if (requestedCapability instanceof Error) {
    return fail(requestedCapability.message);
  }
  const task = await createEmployeeTask({
    employeeDir: required.employeeDir,
    taskId: required.taskId,
    title,
    instruction,
    requestedCapability,
    logger,
  });
  return ok(`任务已创建: ${task.id} status=${task.status}`);
}

/** 从 CLI 参数读取任务状态。 */
async function readTaskStatusFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const required = readTaskIdentity(values);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const task = await readEmployeeTask(required.employeeDir, required.taskId);
  return ok(`任务状态: ${task.id} status=${task.status} run=${task.runId ?? "none"} artifact=${task.artifactPath ?? "none"}`);
}

/** 从 CLI 参数列出员工任务。 */
async function listTasksFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const required = parseEmployeeRequiredOptions(argv, logger);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const tasks = await listEmployeeTasks(required.employeeDir, logger);
  logger.info("CLI 已列出硅基员工任务", { employeeId: required.employeeId, count: tasks.length });
  return ok(tasks.map((task) => `${task.id}\t${task.status}\t${task.title}\t${task.runId ?? "none"}`).join("\n"));
}

/** 从 CLI 参数取消员工任务。 */
async function cancelTaskFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const required = readTaskIdentity(values);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const task = await cancelEmployeeTask({ employeeDir: required.employeeDir, taskId: required.taskId, logger });
  return ok(`任务已取消: ${task.id} status=${task.status}`);
}

/** 从 CLI 参数重试员工任务。 */
async function retryTaskFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const required = readTaskIdentity(values);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const task = await retryEmployeeTask({ employeeDir: required.employeeDir, taskId: required.taskId, logger });
  return ok(`任务已重试: ${task.id} status=${task.status}`);
}

/** 从 CLI 参数读取任务产物或复盘内容。 */
async function readTaskOutputFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const required = readTaskIdentity(values);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const task = await readEmployeeTask(required.employeeDir, required.taskId);
  const relativePath = argv[1] === "artifact" ? task.artifactPath : task.reviewPath;
  if (!relativePath) {
    return fail(`Task has no ${argv[1]}: ${task.id}`);
  }
  const outputPath = resolveEmployeeChildPath(required.employeeDir, relativePath.split("/"), logger);
  const content = await readFile(outputPath, "utf8");
  logger.info("CLI 已读取任务输出文件", { taskId: task.id, outputType: argv[1], outputPath });
  return ok(content);
}

/** 分发 approval 管理命令。 */
async function approvalCommandFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  if (argv[1] === "list") {
    return listApprovalsFromCli(argv, logger);
  }
  if (argv[1] === "status") {
    return readApprovalStatusFromCli(argv, logger);
  }
  if (argv[1] === "approve" || argv[1] === "deny") {
    return resolveApprovalFromCli(argv, logger);
  }
  return fail("Unsupported approval command.");
}

/** 从 CLI 参数列出审批请求。 */
async function listApprovalsFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const required = parseEmployeeRequiredOptions(argv, logger);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const approvals = await listApprovalRequests(required.employeeDir, logger);
  return ok(approvals.map((approval) => `${approval.id}\t${approval.status}\t${approval.taskId}\t${approval.capability}`).join("\n"));
}

/** 从 CLI 参数读取审批状态。 */
async function readApprovalStatusFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const required = readApprovalIdentity(values);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const approval = await readApprovalRequest(required.employeeDir, required.approvalId);
  logger.info("CLI 已读取硅基员工审批状态", {
    employeeId: required.employeeId,
    approvalId: approval.id,
    status: approval.status,
  });
  return ok(`审批状态: ${approval.id} status=${approval.status} task=${approval.taskId} capability=${approval.capability}`);
}

/** 从 CLI 参数处理审批通过或拒绝命令。 */
async function resolveApprovalFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const required = readApprovalIdentity(values);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const approval = argv[1] === "approve"
    ? await approveApprovalRequest({ employeeDir: required.employeeDir, approvalId: required.approvalId, logger })
    : await denyApprovalRequest({ employeeDir: required.employeeDir, approvalId: required.approvalId, logger });
  logger.info("CLI 已处理硅基员工审批请求", {
    employeeId: required.employeeId,
    approvalId: approval.id,
    status: approval.status,
  });
  const label = approval.status === "approved" ? "审批已通过" : "审批已拒绝";
  return ok(`${label}: ${approval.id} status=${approval.status}`);
}

/** 分发 schedule 管理命令。 */
async function scheduleCommandFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  if (argv[1] === "create") {
    return createScheduleFromCli(argv, logger);
  }
  if (argv[1] === "list") {
    return listSchedulesFromCli(argv, logger);
  }
  if (argv[1] === "status") {
    return readScheduleStatusFromCli(argv, logger);
  }
  if (argv[1] === "cancel") {
    return cancelScheduleFromCli(argv, logger);
  }
  return fail("Unsupported schedule command.");
}

/** 从 CLI 参数创建员工定时任务。 */
async function createScheduleFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const runtimeRoot = values.get("runtime-root");
  const employeeId = values.get("employee");
  const scheduleId = values.get("id");
  const title = values.get("title");
  const instruction = values.get("instruction");
  const dueAt = values.get("due-at");
  if (!runtimeRoot || !employeeId || !scheduleId || !title || !instruction || !dueAt) {
    return fail("Missing required options: --runtime-root, --employee, --id, --title, --instruction, --due-at");
  }
  const requestedCapability = parseOptionalCapability(values.get("capability"), logger);
  if (requestedCapability instanceof Error) {
    return fail(requestedCapability.message);
  }
  const schedule = await createScheduledTask({
    employeeDir: resolveEmployeeDir(runtimeRoot, employeeId),
    scheduleId,
    title,
    instruction,
    dueAt,
    requestedCapability,
    logger,
  });
  return ok(`定时任务已创建: ${schedule.id} status=${schedule.status} dueAt=${schedule.dueAt}`);
}

/** 从 CLI 参数列出员工定时任务。 */
async function listSchedulesFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const required = parseEmployeeRequiredOptions(argv, logger);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const schedules = await listEmployeeSchedules(required.employeeDir);
  logger.info("CLI 已列出硅基员工定时任务", { employeeId: required.employeeId, count: schedules.length });
  return ok(schedules.map((schedule) => `${schedule.id}\t${schedule.status}\t${schedule.dueAt}\t${schedule.dispatchedTaskId ?? "none"}`).join("\n"));
}

/** 从 CLI 参数读取定时任务状态。 */
async function readScheduleStatusFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const required = readScheduleIdentity(values);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const schedule = await readScheduledTask(required.employeeDir, required.scheduleId);
  return ok(`定时任务状态: ${schedule.id} status=${schedule.status} dueAt=${schedule.dueAt} task=${schedule.dispatchedTaskId ?? "none"}`);
}

/** 从 CLI 参数取消定时任务。 */
async function cancelScheduleFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const required = readScheduleIdentity(values);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const schedule = await cancelScheduledTask({ employeeDir: required.employeeDir, scheduleId: required.scheduleId, logger });
  return ok(`定时任务已取消: ${schedule.id} status=${schedule.status}`);
}

/** 从 CLI 参数列出员工 todo 投影。 */
async function listTodosFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const required = parseEmployeeRequiredOptions(argv, logger);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const todos = await listEmployeeTodos(required.employeeDir);
  logger.info("CLI 已列出硅基员工 todo 投影", { employeeId: required.employeeId, count: todos.length });
  return ok(todos.map((todo) => `${todo.taskId}\t${todo.status}\t${todo.title}\t${todo.runId ?? "none"}`).join("\n"));
}

/** 从 CLI 参数列出员工 memory journal。 */
async function listMemoryFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const required = parseEmployeeRequiredOptions(argv, logger);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const entries = await readMemoryJournal(required.employeeDir);
  logger.info("CLI 已列出硅基员工 memory journal", { employeeId: required.employeeId, count: entries.length });
  return ok(entries.map((entry) => `${entry.eventId}\t${entry.type}\t${entry.subjectId}\t${entry.summary}`).join("\n"));
}

/** 从 CLI 参数触发一次员工 heartbeat。 */
async function tickHeartbeatFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const required = parseEmployeeRequiredOptions(argv, logger);
  if (required instanceof Error) {
    return fail(required.message);
  }
  const result = await runEmployeeHeartbeat({ employeeDir: required.employeeDir, logger });
  return ok([
    "heartbeat tick 完成:",
    `processed=${result.processedTaskIds.length}`,
    `approvals=${result.approvalTaskIds.length}`,
    `denied=${result.deniedTaskIds.length}`,
    `blocked=${result.blockedTaskIds.length}`,
    `events=${result.eventCount}`,
  ].join(" "));
}

/** 分发 daemon 管理命令。 */
async function daemonCommandFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  if (argv[1] === "tick") {
    return tickDaemonFromCli(argv, logger);
  }
  if (argv[1] === "run") {
    return runDaemonLoopFromCli(argv, logger);
  }
  if (argv[1] === "start") {
    return startDaemonSupervisorFromCli(argv, logger);
  }
  if (argv[1] === "status") {
    return daemonStatusFromCli(argv, logger);
  }
  if (argv[1] === "stop") {
    return stopDaemonSupervisorFromCli(argv, logger);
  }
  return fail("Unsupported daemon command.");
}

/** 从 CLI 参数触发一次平台级 daemon tick。 */
async function tickDaemonFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const runtimeRoot = values.get("runtime-root");
  if (!runtimeRoot) {
    return fail("Missing required options: --runtime-root");
  }
  const result = await runSiliconDaemonTick({ runtimeRoot, logger });
  return ok([
    "daemon tick 完成:",
    `employees=${result.scannedEmployees}`,
    `schedules=${result.dispatchedSchedules}`,
    `processed=${result.processedTasks}`,
    `approvals=${result.approvalTasks}`,
    `denied=${result.deniedTasks}`,
    `blocked=${result.blockedTasks}`,
    `failedEmployees=${result.failedEmployees}`,
  ].join(" "));
}

/** 从 CLI 参数启动有限 tick 的 daemon loop。 */
async function runDaemonLoopFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const runtimeRoot = values.get("runtime-root");
  if (!runtimeRoot) {
    return fail("Missing required options: --runtime-root");
  }
  const maxTicks = parsePositiveInteger(values.get("ticks") ?? "1", "ticks", logger);
  const intervalMs = parsePositiveInteger(values.get("interval-ms") ?? "1000", "interval-ms", logger);
  if (maxTicks instanceof Error) {
    return fail(maxTicks.message);
  }
  if (intervalMs instanceof Error) {
    return fail(intervalMs.message);
  }
  const result = await runSiliconDaemonLoop({ runtimeRoot, maxTicks, intervalMs, logger });
  return ok([
    "daemon run 完成:",
    `ticks=${result.tickCount}`,
    `scanned=${result.scannedEmployees}`,
    `schedules=${result.dispatchedSchedules}`,
    `processed=${result.processedTasks}`,
    `approvals=${result.approvalTasks}`,
    `denied=${result.deniedTasks}`,
    `blocked=${result.blockedTasks}`,
    `failedEmployees=${result.failedEmployees}`,
  ].join(" "));
}

/** 从 CLI 参数启动常驻 daemon supervisor。 */
async function startDaemonSupervisorFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const runtimeRoot = values.get("runtime-root");
  if (!runtimeRoot) {
    return fail("Missing required options: --runtime-root");
  }
  const intervalMs = parsePositiveInteger(values.get("interval-ms") ?? "1000", "interval-ms", logger);
  if (intervalMs instanceof Error) {
    return fail(intervalMs.message);
  }
  const status = await startSiliconDaemonSupervisor({ runtimeRoot, intervalMs, logger });
  return ok(`daemon supervisor 已停止: status=${status.status} ticks=${status.tickCount}`);
}

/** 从 CLI 参数读取 daemon supervisor 状态。 */
async function daemonStatusFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const runtimeRoot = values.get("runtime-root");
  if (!runtimeRoot) {
    return fail("Missing required options: --runtime-root");
  }
  const status = await readSiliconDaemonSupervisorStatus(runtimeRoot, logger);
  return ok(`daemon status: ${status.status} pid=${status.pid} ticks=${status.tickCount} updatedAt=${status.updatedAt || "none"}`);
}

/** 从 CLI 参数请求 daemon supervisor 停止。 */
async function stopDaemonSupervisorFromCli(argv: string[], logger: SiliconLogger): Promise<SiliconCliResult> {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return fail(values.message);
  }
  const runtimeRoot = values.get("runtime-root");
  if (!runtimeRoot) {
    return fail("Missing required options: --runtime-root");
  }
  await requestSiliconDaemonSupervisorStop(runtimeRoot, logger);
  return ok("daemon stop 请求已写入");
}

/** 解析 CLI 的 --key value 参数，避免各命令重复处理。 */
function parseCliOptions(argv: string[], startIndex: number, logger: SiliconLogger): Map<string, string> | Error {
  const values = new Map<string, string>();
  for (let index = startIndex; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      logger.warn("CLI 参数格式错误", { index, key, value });
      return new Error(`Invalid argument near ${key ?? "<empty>"}`);
    }
    values.set(key.slice(2), value);
  }
  return values;
}

/** 解析员工级命令的 runtime-root 和 employee 参数。 */
function parseEmployeeRequiredOptions(
  argv: string[],
  logger: SiliconLogger,
): { runtimeRoot: string; employeeId: string; employeeDir: string } | Error {
  const values = parseCliOptions(argv, 2, logger);
  if (values instanceof Error) {
    return values;
  }
  const runtimeRoot = values.get("runtime-root");
  const employeeId = values.get("employee");
  if (!runtimeRoot || !employeeId) {
    return new Error("Missing required options: --runtime-root, --employee");
  }
  return { runtimeRoot, employeeId, employeeDir: resolveEmployeeDir(runtimeRoot, employeeId) };
}

/** 解析任务级命令的员工目录和任务 ID。 */
function readTaskIdentity(values: Map<string, string>): { employeeDir: string; employeeId: string; taskId: string } | Error {
  const runtimeRoot = values.get("runtime-root");
  const employeeId = values.get("employee");
  const taskId = values.get("id");
  if (!runtimeRoot || !employeeId || !taskId) {
    return new Error("Missing required options: --runtime-root, --employee, --id");
  }
  return { employeeId, taskId, employeeDir: resolveEmployeeDir(runtimeRoot, employeeId) };
}

/** 解析审批级命令的员工目录和审批 ID。 */
function readApprovalIdentity(values: Map<string, string>): { employeeDir: string; employeeId: string; approvalId: string } | Error {
  const runtimeRoot = values.get("runtime-root");
  const employeeId = values.get("employee");
  const approvalId = values.get("id");
  if (!runtimeRoot || !employeeId || !approvalId) {
    return new Error("Missing required options: --runtime-root, --employee, --id");
  }
  return { employeeId, approvalId, employeeDir: resolveEmployeeDir(runtimeRoot, employeeId) };
}

/** 解析定时任务级命令的员工目录和 schedule ID。 */
function readScheduleIdentity(values: Map<string, string>): { employeeDir: string; employeeId: string; scheduleId: string } | Error {
  const runtimeRoot = values.get("runtime-root");
  const employeeId = values.get("employee");
  const scheduleId = values.get("id");
  if (!runtimeRoot || !employeeId || !scheduleId) {
    return new Error("Missing required options: --runtime-root, --employee, --id");
  }
  return { employeeId, scheduleId, employeeDir: resolveEmployeeDir(runtimeRoot, employeeId) };
}

/** 解析正整数 CLI 参数，并记录中文校验日志。 */
function parsePositiveInteger(value: string, name: string, logger: SiliconLogger): number | Error {
  if (!/^[1-9][0-9]*$/.test(value)) {
    logger.warn("CLI 正整数参数校验失败", { name, value });
    return new Error(`Invalid numeric option: --${name}`);
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed)) {
    logger.info("CLI 已解析正整数参数", { name, value: parsed });
    return parsed;
  }
  logger.warn("CLI 正整数参数校验失败", { name, value });
  return new Error(`Invalid numeric option: --${name}`);
}

/** 校验 CLI 输入的能力 ID，并返回类型化能力值。 */
function parseOptionalCapability(value: string | undefined, logger: SiliconLogger): CapabilityId | undefined | Error {
  if (!value) {
    return undefined;
  }
  if (isCapabilityId(value)) {
    logger.info("CLI 已识别硅基员工任务能力", { capability: value });
    return value;
  }
  logger.warn("CLI 任务能力参数不受支持", { capability: value });
  return new Error(`Unsupported capability: ${value}`);
}

/** 根据运行根目录和员工 ID 计算员工目录。 */
function resolveEmployeeDir(runtimeRoot: string, employeeId: string): string {
  return resolveEmployeeChildPath(runtimeRoot, ["employees", employeeId]);
}

/** 列出 runtime 根目录下的员工 ID。 */
async function listEmployeeEntries(runtimeRoot: string, logger: SiliconLogger): Promise<string[]> {
  const employeesRoot = resolveEmployeeChildPath(runtimeRoot, ["employees"], logger);
  const entries = await readdir(employeesRoot).catch(() => []);
  const employeeIds: string[] = [];
  for (const entry of entries.sort()) {
    const employeeDir = join(employeesRoot, entry);
    const info = await stat(employeeDir).catch(() => null);
    if (info?.isDirectory()) {
      employeeIds.push(entry);
    }
  }
  return employeeIds;
}

/** 判断路径是否存在，用于 doctor 健康检查。 */
async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** 构建 CLI 帮助文本。 */
function buildHelpText(): string {
  return [
    "Silicon Runtime CLI",
    "",
    "runtime init|status|doctor --runtime-root <dir>",
    "employee create --runtime-root <dir> --id <id> --name <name> --template <template>",
    "employee list|validate --runtime-root <dir> [--employee <id>]",
    "template list",
    "task create|list|status|cancel|retry|artifact|review --runtime-root <dir> --employee <id> [--id <task>]",
    "approval list|status|approve|deny --runtime-root <dir> --employee <id> [--id <approval>]",
    "schedule create|list|status|cancel --runtime-root <dir> --employee <id>",
    "todo list --runtime-root <dir> --employee <id>",
    "memory list --runtime-root <dir> --employee <id>",
    "heartbeat tick --runtime-root <dir> --employee <id>",
    "daemon tick|run|start|status|stop --runtime-root <dir>",
  ].join("\n");
}

/** 构建成功 CLI 结果。 */
function ok(stdout: string): SiliconCliResult {
  return { exitCode: 0, stdout, stderr: "" };
}

/** 构建失败 CLI 结果。 */
function fail(stderr: string): SiliconCliResult {
  return { exitCode: 1, stdout: "", stderr };
}
