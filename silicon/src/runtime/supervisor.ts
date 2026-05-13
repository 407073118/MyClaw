import { access, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";

import type { SiliconLogger } from "../core/employee-scaffold.js";
import { resolveEmployeeChildPath } from "../core/path-boundary.js";
import { writeUtf8FileAtomically } from "../core/safe-file.js";
import { runSiliconDaemonTick } from "./daemon.js";

export type SiliconDaemonSupervisorStatus = {
  schemaVersion: 1;
  runtimeRoot: string;
  pid: number;
  status: "running" | "stopping" | "stopped" | "failed";
  intervalMs: number;
  startedAt: string;
  updatedAt: string;
  tickCount: number;
  lastErrorMessage?: string;
};

export type StartSiliconDaemonSupervisorInput = {
  runtimeRoot: string;
  intervalMs: number;
  now?: () => Date;
  logger?: SiliconLogger;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 启动常驻 daemon supervisor，循环执行平台 tick 直到 stop 文件出现。 */
export async function startSiliconDaemonSupervisor(
  input: StartSiliconDaemonSupervisorInput,
): Promise<SiliconDaemonSupervisorStatus> {
  const logger = input.logger ?? noopLogger;
  const now = input.now ?? (() => new Date());
  logger.info("开始启动 Silicon Runtime daemon supervisor", {
    runtimeRoot: input.runtimeRoot,
    intervalMs: input.intervalMs,
  });
  const lockTtlMs = Math.max(input.intervalMs * 4, 300_000);
  const lockDir = await acquireDaemonSupervisorLock(input.runtimeRoot, logger, now, lockTtlMs);
  try {
  await removeStopRequest(input.runtimeRoot, logger);
  let status: SiliconDaemonSupervisorStatus = {
    schemaVersion: 1,
    runtimeRoot: input.runtimeRoot,
    pid: process.pid,
    status: "running",
    intervalMs: input.intervalMs,
    startedAt: now().toISOString(),
    updatedAt: now().toISOString(),
    tickCount: 0,
  };
  await writeDaemonStatus(input.runtimeRoot, status, logger);

  while (!(await hasStopRequest(input.runtimeRoot, logger))) {
    try {
      logger.info("daemon supervisor 开始执行 tick", {
        runtimeRoot: input.runtimeRoot,
        pid: process.pid,
        nextTick: status.tickCount + 1,
      });
      await runSiliconDaemonTick({ runtimeRoot: input.runtimeRoot, logger });
      status = {
        ...status,
        status: "running",
        tickCount: status.tickCount + 1,
        updatedAt: now().toISOString(),
        lastErrorMessage: undefined,
      };
      await writeDaemonStatus(input.runtimeRoot, status, logger);
      await refreshDaemonSupervisorLock(lockDir, input.runtimeRoot, logger, now, lockTtlMs);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn("daemon supervisor tick 失败，将继续下一轮", {
        runtimeRoot: input.runtimeRoot,
        errorMessage,
      });
      status = {
        ...status,
        status: "failed",
        updatedAt: now().toISOString(),
        lastErrorMessage: errorMessage,
      };
      await writeDaemonStatus(input.runtimeRoot, status, logger);
    }
    await delay(input.intervalMs);
  }

  status = {
    ...status,
    status: "stopped",
    updatedAt: now().toISOString(),
  };
  await writeDaemonStatus(input.runtimeRoot, status, logger);
  await removeStopRequest(input.runtimeRoot, logger);
  logger.info("Silicon Runtime daemon supervisor 已停止", {
    runtimeRoot: input.runtimeRoot,
    pid: process.pid,
    tickCount: status.tickCount,
  });
  return status;
  } finally {
    await releaseDaemonSupervisorLock(lockDir, logger);
  }
}

/** 读取 daemon supervisor 状态文件，缺失时返回 stopped 视图。 */
export async function readSiliconDaemonSupervisorStatus(
  runtimeRoot: string,
  logger: SiliconLogger = noopLogger,
): Promise<SiliconDaemonSupervisorStatus> {
  logger.info("开始读取 daemon supervisor 状态", { runtimeRoot });
  const raw = await readFile(resolveDaemonStatusPath(runtimeRoot, logger), "utf8").catch(() => "");
  if (!raw.trim()) {
    return {
      schemaVersion: 1,
      runtimeRoot,
      pid: 0,
      status: "stopped",
      intervalMs: 0,
      startedAt: "",
      updatedAt: "",
      tickCount: 0,
    };
  }
  const parsed = JSON.parse(raw) as SiliconDaemonSupervisorStatus;
  assertDaemonSupervisorStatus(parsed);
  return parsed;
}

/** 写入 stop 请求文件，让常驻 supervisor 在下一轮循环前优雅退出。 */
export async function requestSiliconDaemonSupervisorStop(
  runtimeRoot: string,
  logger: SiliconLogger = noopLogger,
): Promise<void> {
  logger.info("开始请求 daemon supervisor 停止", { runtimeRoot });
  const stopPath = resolveDaemonStopPath(runtimeRoot, logger);
  await writeFile(stopPath, `${JSON.stringify({
    schemaVersion: 1,
    requestedAt: new Date().toISOString(),
  })}\n`, "utf8");
  const previous = await readSiliconDaemonSupervisorStatus(runtimeRoot, logger);
  if (previous.status === "running" || previous.status === "failed") {
    await writeDaemonStatus(runtimeRoot, {
      ...previous,
      status: "stopping",
      updatedAt: new Date().toISOString(),
    }, logger);
  }
  logger.info("daemon supervisor 停止请求已写入", { runtimeRoot, stopPath });
}

/** 写入 daemon supervisor 状态文件，供 CLI status 和外部 UI 读取。 */
async function writeDaemonStatus(
  runtimeRoot: string,
  status: SiliconDaemonSupervisorStatus,
  logger: SiliconLogger,
): Promise<void> {
  logger.info("写入 daemon supervisor 状态", {
    runtimeRoot,
    pid: status.pid,
    status: status.status,
    tickCount: status.tickCount,
  });
  await writeUtf8FileAtomically(resolveDaemonStatusPath(runtimeRoot, logger), `${JSON.stringify(status, null, 2)}\n`, logger);
}

/** 计算 daemon supervisor 状态文件路径。 */
function resolveDaemonStatusPath(runtimeRoot: string, logger: SiliconLogger): string {
  return resolveEmployeeChildPath(runtimeRoot, ["platform", "daemon.json"], logger);
}

/** 计算 daemon supervisor stop 请求文件路径。 */
function resolveDaemonStopPath(runtimeRoot: string, logger: SiliconLogger): string {
  return resolveEmployeeChildPath(runtimeRoot, ["platform", "daemon.stop"], logger);
}

/** 判断 stop 请求文件是否存在。 */
async function hasStopRequest(runtimeRoot: string, logger: SiliconLogger): Promise<boolean> {
  const stopPath = resolveDaemonStopPath(runtimeRoot, logger);
  return access(stopPath).then(
    () => true,
    () => false,
  );
}

/** 删除遗留 stop 请求文件，避免新 supervisor 被旧停止信号影响。 */
async function removeStopRequest(runtimeRoot: string, logger: SiliconLogger): Promise<void> {
  await unlink(resolveDaemonStopPath(runtimeRoot, logger)).catch(() => undefined);
}

/** 获取 daemon supervisor 平台锁，避免多个常驻循环同时写入状态。 */
async function acquireDaemonSupervisorLock(
  runtimeRoot: string,
  logger: SiliconLogger,
  now: () => Date = () => new Date(),
  ttlMs = 300_000,
): Promise<string> {
  const lockDir = resolveEmployeeChildPath(runtimeRoot, ["platform", "daemon.lock"], logger);
  await mkdir(lockDir).catch(async (error: unknown) => {
    if (await removeStaleDaemonLock(lockDir, runtimeRoot, logger, now)) {
      await mkdir(lockDir);
      return;
    }
    logger.warn("daemon supervisor 平台锁获取失败", {
      runtimeRoot,
      lockDir,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw new Error("Daemon supervisor is already running.");
  });
  await refreshDaemonSupervisorLock(lockDir, runtimeRoot, logger, now, ttlMs);
  logger.info("daemon supervisor 平台锁已获取", { runtimeRoot, lockDir });
  return lockDir;
}

/** 刷新 daemon supervisor 平台锁元数据，避免崩溃遗留锁和运行中锁混淆。 */
async function refreshDaemonSupervisorLock(
  lockDir: string,
  runtimeRoot: string,
  logger: SiliconLogger,
  now: () => Date,
  ttlMs: number,
): Promise<void> {
  const acquiredAt = now();
  await writeFile(resolveEmployeeChildPath(lockDir, ["lock.json"], logger), `${JSON.stringify({
    schemaVersion: 1,
    runtimeRoot,
    ownerPid: process.pid,
    acquiredAt: acquiredAt.toISOString(),
    expiresAt: new Date(acquiredAt.getTime() + ttlMs).toISOString(),
  }, null, 2)}\n`, "utf8");
}

/** 清理过期 daemon 锁，让崩溃后的 supervisor 可以重新接管。 */
async function removeStaleDaemonLock(
  lockDir: string,
  runtimeRoot: string,
  logger: SiliconLogger,
  now: () => Date,
): Promise<boolean> {
  const raw = await readFile(resolveEmployeeChildPath(lockDir, ["lock.json"], logger), "utf8").catch(() => "");
  if (!raw.trim()) {
    await rm(lockDir, { recursive: true, force: true });
    return true;
  }
  const metadata = JSON.parse(raw) as { expiresAt?: unknown };
  const expiresAt = typeof metadata.expiresAt === "string" ? Date.parse(metadata.expiresAt) : Number.NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= now().getTime()) {
    logger.warn("发现过期 daemon supervisor 锁，已清理后重新获取", { runtimeRoot, lockDir, expiresAt: metadata.expiresAt });
    await rm(lockDir, { recursive: true, force: true });
    return true;
  }
  return false;
}

/** 校验 daemon supervisor 状态文件，避免 CLI 传播坏状态。 */
function assertDaemonSupervisorStatus(status: SiliconDaemonSupervisorStatus): void {
  if (
    status.schemaVersion !== 1
    || typeof status.runtimeRoot !== "string"
    || typeof status.pid !== "number"
    || !["running", "stopping", "stopped", "failed"].includes(status.status)
    || typeof status.intervalMs !== "number"
    || typeof status.startedAt !== "string"
    || typeof status.updatedAt !== "string"
    || typeof status.tickCount !== "number"
  ) {
    throw new Error("Invalid daemon supervisor status");
  }
}

/** 释放 daemon supervisor 平台锁，让后续启动可以接管运行。 */
async function releaseDaemonSupervisorLock(lockDir: string, logger: SiliconLogger): Promise<void> {
  logger.info("开始释放 daemon supervisor 平台锁", { lockDir });
  await rm(lockDir, { recursive: true, force: true });
  logger.info("daemon supervisor 平台锁已释放", { lockDir });
}

/** 等待指定毫秒数，用于 supervisor 常驻循环节拍。 */
async function delay(intervalMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, intervalMs));
  });
}
