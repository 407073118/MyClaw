import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import type { SiliconLogger } from "./employee-scaffold.js";
import { resolveEmployeeChildPath } from "./path-boundary.js";

export type EmployeeLock = {
  lockName: string;
  lockDir: string;
};

export type EmployeeLockMetadata = {
  schemaVersion: 1;
  lockName: string;
  ownerPid: number;
  acquiredAt: string;
  expiresAt: string;
};

export type AcquireEmployeeLockOptions = {
  logger?: SiliconLogger;
  now?: () => Date;
  ttlMs?: number;
  ownerPid?: number;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 获取员工文件夹内的跨进程目录锁，防止并发 heartbeat 覆盖状态。 */
export async function acquireEmployeeLock(
  employeeDir: string,
  lockName: string,
  optionsOrLogger: SiliconLogger | AcquireEmployeeLockOptions = noopLogger,
): Promise<EmployeeLock> {
  const options = normalizeLockOptions(optionsOrLogger);
  const logger = options.logger;
  logger.info("开始获取硅基员工目录锁", { employeeDir, lockName });
  const locksDir = resolveEmployeeChildPath(employeeDir, ["locks"], logger);
  await mkdir(locksDir, { recursive: true });
  const lockDir = resolveEmployeeChildPath(employeeDir, ["locks", `${lockName}.lock`], logger);
  const now = options.now();
  await mkdir(lockDir).catch(async (error: unknown) => {
    if (await removeStaleLockIfExpired(lockDir, lockName, now, logger)) {
      await mkdir(lockDir);
      return;
    }
    logger.warn("硅基员工目录锁获取失败", {
      employeeDir,
      lockName,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw new Error(`Employee lock is already held: ${lockName}`);
  });
  const metadata: EmployeeLockMetadata = {
    schemaVersion: 1,
    lockName,
    ownerPid: options.ownerPid,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + options.ttlMs).toISOString(),
  };
  await writeFile(resolveEmployeeChildPath(lockDir, ["lock.json"], logger), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  logger.info("硅基员工目录锁已获取", { employeeDir, lockName, lockDir });
  return { lockName, lockDir };
}

/** 释放员工文件夹内的目录锁。 */
export async function releaseEmployeeLock(
  lock: EmployeeLock,
  logger: SiliconLogger = noopLogger,
): Promise<void> {
  logger.info("开始释放硅基员工目录锁", { lockName: lock.lockName, lockDir: lock.lockDir });
  await rm(lock.lockDir, { recursive: true, force: true });
  logger.info("硅基员工目录锁已释放", { lockName: lock.lockName, lockDir: lock.lockDir });
}

/** 刷新员工目录锁元数据，长任务执行期间持续续租，避免被误判为过期锁。 */
export async function refreshEmployeeLock(
  lock: EmployeeLock,
  optionsOrLogger: SiliconLogger | AcquireEmployeeLockOptions = noopLogger,
): Promise<EmployeeLockMetadata> {
  const options = normalizeLockOptions(optionsOrLogger);
  const logger = options.logger;
  const now = options.now();
  const metadata: EmployeeLockMetadata = {
    schemaVersion: 1,
    lockName: lock.lockName,
    ownerPid: options.ownerPid,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + options.ttlMs).toISOString(),
  };
  await writeFile(resolveEmployeeChildPath(lock.lockDir, ["lock.json"], logger), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  logger.info("硅基员工目录锁已续租", { lockName: lock.lockName, lockDir: lock.lockDir, expiresAt: metadata.expiresAt });
  return metadata;
}

/** 读取锁元数据，供 doctor 和 stale lock 恢复使用。 */
export async function readEmployeeLockMetadata(lockDir: string): Promise<EmployeeLockMetadata> {
  const raw = await readFile(resolveEmployeeChildPath(lockDir, ["lock.json"]), "utf8");
  const parsed = JSON.parse(raw) as Partial<EmployeeLockMetadata>;
  if (
    parsed.schemaVersion !== 1
    || typeof parsed.lockName !== "string"
    || typeof parsed.ownerPid !== "number"
    || typeof parsed.acquiredAt !== "string"
    || typeof parsed.expiresAt !== "string"
  ) {
    throw new Error("Invalid employee lock metadata");
  }
  return parsed as EmployeeLockMetadata;
}

function normalizeLockOptions(optionsOrLogger: SiliconLogger | AcquireEmployeeLockOptions): Required<AcquireEmployeeLockOptions> {
  if (isLogger(optionsOrLogger)) {
    return {
      logger: optionsOrLogger,
      now: () => new Date(),
      ttlMs: 300_000,
      ownerPid: process.pid,
    };
  }
  return {
    logger: optionsOrLogger.logger ?? noopLogger,
    now: optionsOrLogger.now ?? (() => new Date()),
    ttlMs: optionsOrLogger.ttlMs ?? 300_000,
    ownerPid: optionsOrLogger.ownerPid ?? process.pid,
  };
}

function isLogger(value: SiliconLogger | AcquireEmployeeLockOptions): value is SiliconLogger {
  return typeof (value as SiliconLogger).info === "function" && typeof (value as SiliconLogger).warn === "function";
}

async function removeStaleLockIfExpired(
  lockDir: string,
  lockName: string,
  now: Date,
  logger: SiliconLogger,
): Promise<boolean> {
  const metadata = await readEmployeeLockMetadata(lockDir).catch((error: unknown) => {
    logger.warn("硅基员工目录锁元数据不可读，按过期锁清理", {
      lockDir,
      lockName,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  if (!metadata) {
    await rm(lockDir, { recursive: true, force: true });
    return true;
  }
  const expiresAt = Date.parse(metadata.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
    logger.warn("发现过期硅基员工目录锁，已清理后重试获取", {
      lockDir,
      lockName,
      ownerPid: metadata.ownerPid,
      expiresAt: metadata.expiresAt,
    });
    await rm(lockDir, { recursive: true, force: true });
    return true;
  }
  return false;
}
