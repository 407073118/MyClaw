import { readdir, stat } from "node:fs/promises";

import type { SiliconLogger } from "../core/employee-scaffold.js";
import { resolveEmployeeChildPath } from "../core/path-boundary.js";

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 根据 runtime root 和员工 ID 计算员工目录。 */
export function resolveRuntimeEmployeeDir(
  runtimeRoot: string,
  employeeId: string,
  logger: SiliconLogger = noopLogger,
): string {
  return resolveEmployeeChildPath(runtimeRoot, ["employees", employeeId], logger);
}

/** 列出 runtime root 下所有员工 ID，供 UI 聚合服务复用。 */
export async function listRuntimeEmployeeIds(
  runtimeRoot: string,
  logger: SiliconLogger = noopLogger,
): Promise<string[]> {
  logger.info("开始列出 UI runtime 员工 ID", { runtimeRoot });
  const employeesRoot = resolveEmployeeChildPath(runtimeRoot, ["employees"], logger);
  const entries = await readdir(employeesRoot).catch(() => []);
  const employeeIds: string[] = [];
  for (const entry of entries.sort()) {
    const employeeDir = resolveEmployeeChildPath(runtimeRoot, ["employees", entry], logger);
    const info = await stat(employeeDir).catch(() => null);
    if (info?.isDirectory()) {
      employeeIds.push(entry);
    }
  }
  logger.info("UI runtime 员工 ID 已列出", { runtimeRoot, count: employeeIds.length });
  return employeeIds;
}
