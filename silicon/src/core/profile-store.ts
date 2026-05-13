import { readFile } from "node:fs/promises";

import type { SiliconLogger } from "./employee-scaffold.js";
import { resolveEmployeeChildPath } from "./path-boundary.js";
import { writeUtf8FileAtomically } from "./safe-file.js";
import { assertEmployeeProfile, parseJsonRecord } from "./schema-guards.js";

export type EmployeeProfileStatus = "idle" | "running" | "waiting_approval" | "failed";

export type EmployeeProfile = {
  schemaVersion: 1;
  employeeId: string;
  displayName: string;
  definitionId: string;
  templateName?: string;
  status: EmployeeProfileStatus;
  createdAt: string;
  updatedAt: string;
  currentTaskId?: string;
  currentRunId?: string;
  lastErrorMessage?: string;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 计算员工 profile 的稳定 JSON 文件路径。 */
export function resolveEmployeeProfilePath(
  employeeDir: string,
  logger: SiliconLogger = noopLogger,
): string {
  return resolveEmployeeChildPath(employeeDir, ["profile.json"], logger);
}

/** 读取员工 profile，供 heartbeat、daemon 和 CLI 展示员工状态。 */
export async function readEmployeeProfile(employeeDir: string): Promise<EmployeeProfile> {
  const raw = await readFile(resolveEmployeeProfilePath(employeeDir), "utf8");
  const parsed = parseJsonRecord(raw, "EmployeeProfile");
  assertEmployeeProfile(parsed);
  return parsed;
}

/** 覆盖写入员工 profile，并记录中文状态日志。 */
export async function writeEmployeeProfile(
  employeeDir: string,
  profile: EmployeeProfile,
  logger: SiliconLogger = noopLogger,
): Promise<void> {
  logger.info("写入硅基员工 profile 状态", {
    employeeDir,
    employeeId: profile.employeeId,
    status: profile.status,
    currentTaskId: profile.currentTaskId,
    currentRunId: profile.currentRunId,
  });
  await writeUtf8FileAtomically(resolveEmployeeProfilePath(employeeDir, logger), `${JSON.stringify(profile, null, 2)}\n`, logger);
}

/** 更新员工 profile 状态，保持员工运行状态对外可观测。 */
export async function updateEmployeeProfileStatus(input: {
  employeeDir: string;
  status: EmployeeProfileStatus;
  updatedAt: string;
  currentTaskId?: string;
  currentRunId?: string;
  lastErrorMessage?: string;
  logger?: SiliconLogger;
}): Promise<EmployeeProfile> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始更新硅基员工 profile 状态", {
    employeeDir: input.employeeDir,
    status: input.status,
    currentTaskId: input.currentTaskId,
    currentRunId: input.currentRunId,
  });
  const previous = await readEmployeeProfile(input.employeeDir);
  const profile: EmployeeProfile = {
    ...previous,
    schemaVersion: 1,
    status: input.status,
    updatedAt: input.updatedAt,
    currentTaskId: input.currentTaskId,
    currentRunId: input.currentRunId,
    lastErrorMessage: input.lastErrorMessage,
  };
  await writeEmployeeProfile(input.employeeDir, profile, logger);
  logger.info("硅基员工 profile 状态已更新", {
    employeeDir: input.employeeDir,
    employeeId: profile.employeeId,
    status: profile.status,
  });
  return profile;
}
