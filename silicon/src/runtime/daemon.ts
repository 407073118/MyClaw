import { readdir, stat } from "node:fs/promises";

import type { SiliconLogger } from "../core/employee-scaffold.js";
import { resolveEmployeeChildPath } from "../core/path-boundary.js";
import { dispatchDueScheduledTasks } from "../core/schedule-store.js";
import { runEmployeeHeartbeat } from "./heartbeat.js";

export type RunSiliconDaemonTickInput = {
  runtimeRoot: string;
  logger?: SiliconLogger;
};

export type RunSiliconDaemonLoopInput = {
  runtimeRoot: string;
  intervalMs: number;
  maxTicks: number;
  logger?: SiliconLogger;
};

export type RunSiliconDaemonTickResult = {
  scannedEmployees: number;
  dispatchedSchedules: number;
  processedTasks: number;
  approvalTasks: number;
  deniedTasks: number;
  blockedTasks: number;
  failedEmployees: number;
  processedTaskIds: string[];
  dispatchedScheduleIds: string[];
  approvalTaskIds: string[];
  deniedTaskIds: string[];
  blockedTaskIds: string[];
  failedEmployeeDirs: string[];
};

export type RunSiliconDaemonLoopResult = {
  tickCount: number;
  scannedEmployees: number;
  dispatchedSchedules: number;
  processedTasks: number;
  approvalTasks: number;
  deniedTasks: number;
  blockedTasks: number;
  failedEmployees: number;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 执行一次平台级 daemon tick，扫描所有员工并推进各自 heartbeat。 */
export async function runSiliconDaemonTick(
  input: RunSiliconDaemonTickInput,
): Promise<RunSiliconDaemonTickResult> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始执行 Silicon Runtime 平台级 daemon tick", { runtimeRoot: input.runtimeRoot });

  const employeeDirs = await listEmployeeDirectories(input.runtimeRoot, logger);
  const processedTaskIds: string[] = [];
  const dispatchedScheduleIds: string[] = [];
  const approvalTaskIds: string[] = [];
  const deniedTaskIds: string[] = [];
  const blockedTaskIds: string[] = [];
  const failedEmployeeDirs: string[] = [];

  for (const employeeDir of employeeDirs) {
    try {
      const dispatchedSchedules = await dispatchDueScheduledTasks({ employeeDir, logger });
      dispatchedScheduleIds.push(...dispatchedSchedules.map((schedule) => schedule.id));
      logger.info("daemon tick 开始推进员工 heartbeat", { employeeDir });
      const result = await runEmployeeHeartbeat({ employeeDir, logger });
      processedTaskIds.push(...result.processedTaskIds);
      approvalTaskIds.push(...result.approvalTaskIds);
      deniedTaskIds.push(...result.deniedTaskIds);
      blockedTaskIds.push(...result.blockedTaskIds);
    } catch (error) {
      logger.warn("daemon tick 推进员工失败，继续扫描其他员工", {
        employeeDir,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      failedEmployeeDirs.push(employeeDir);
    }
  }

  logger.info("Silicon Runtime 平台级 daemon tick 完成", {
    runtimeRoot: input.runtimeRoot,
    scannedEmployees: employeeDirs.length,
    dispatchedSchedules: dispatchedScheduleIds.length,
    processedTasks: processedTaskIds.length,
    approvalTasks: approvalTaskIds.length,
    deniedTasks: deniedTaskIds.length,
    blockedTasks: blockedTaskIds.length,
    failedEmployees: failedEmployeeDirs.length,
  });

  return {
    scannedEmployees: employeeDirs.length,
    dispatchedSchedules: dispatchedScheduleIds.length,
    processedTasks: processedTaskIds.length,
    approvalTasks: approvalTaskIds.length,
    deniedTasks: deniedTaskIds.length,
    blockedTasks: blockedTaskIds.length,
    failedEmployees: failedEmployeeDirs.length,
    processedTaskIds,
    dispatchedScheduleIds,
    approvalTaskIds,
    deniedTaskIds,
    blockedTaskIds,
    failedEmployeeDirs,
  };
}

/** 按固定间隔执行 daemon loop，形成本地 7x24 自治运行的最小模式。 */
export async function runSiliconDaemonLoop(
  input: RunSiliconDaemonLoopInput,
): Promise<RunSiliconDaemonLoopResult> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始执行 Silicon Runtime daemon loop", {
    runtimeRoot: input.runtimeRoot,
    intervalMs: input.intervalMs,
    maxTicks: input.maxTicks,
  });
  const summary: RunSiliconDaemonLoopResult = {
    tickCount: 0,
    scannedEmployees: 0,
    dispatchedSchedules: 0,
    processedTasks: 0,
    approvalTasks: 0,
    deniedTasks: 0,
    blockedTasks: 0,
    failedEmployees: 0,
  };

  for (let tickIndex = 0; tickIndex < input.maxTicks; tickIndex += 1) {
    logger.info("daemon loop 开始执行 tick", {
      runtimeRoot: input.runtimeRoot,
      tickIndex: tickIndex + 1,
      maxTicks: input.maxTicks,
    });
    const result = await runSiliconDaemonTick({ runtimeRoot: input.runtimeRoot, logger });
    summary.tickCount += 1;
    summary.scannedEmployees += result.scannedEmployees;
    summary.dispatchedSchedules += result.dispatchedSchedules;
    summary.processedTasks += result.processedTasks;
    summary.approvalTasks += result.approvalTasks;
    summary.deniedTasks += result.deniedTasks;
    summary.blockedTasks += result.blockedTasks;
    summary.failedEmployees += result.failedEmployees;
    if (tickIndex < input.maxTicks - 1) {
      await delay(input.intervalMs);
    }
  }

  logger.info("Silicon Runtime daemon loop 执行完成", {
    runtimeRoot: input.runtimeRoot,
    tickCount: summary.tickCount,
    dispatchedSchedules: summary.dispatchedSchedules,
    processedTasks: summary.processedTasks,
    approvalTasks: summary.approvalTasks,
    deniedTasks: summary.deniedTasks,
    blockedTasks: summary.blockedTasks,
    failedEmployees: summary.failedEmployees,
  });
  return summary;
}

/** 列出运行根目录下的所有员工目录。 */
async function listEmployeeDirectories(runtimeRoot: string, logger: SiliconLogger): Promise<string[]> {
  const employeesRoot = resolveEmployeeChildPath(runtimeRoot, ["employees"], logger);
  const entries = await readdir(employeesRoot).catch(() => []);
  const dirs: string[] = [];
  for (const entry of entries.sort()) {
    const employeeDir = resolveEmployeeChildPath(runtimeRoot, ["employees", entry], logger);
    const info = await stat(employeeDir).catch(() => null);
    if (info?.isDirectory()) {
      dirs.push(employeeDir);
    }
  }
  return dirs;
}

/** 等待指定毫秒数，用于 daemon loop 的 tick 间隔。 */
async function delay(intervalMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, intervalMs));
  });
}
