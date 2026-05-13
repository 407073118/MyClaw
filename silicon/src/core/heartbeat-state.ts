import { readFile } from "node:fs/promises";

import type { SiliconLogger } from "./employee-scaffold.js";
import { resolveEmployeeChildPath } from "./path-boundary.js";
import { assertHeartbeatState, parseJsonRecord } from "./schema-guards.js";
import { writeUtf8FileAtomically } from "./safe-file.js";

export type HeartbeatState = {
  schemaVersion: 1;
  status: "alive" | "running" | "waiting_approval" | "failed";
  tickCount: number;
  lastBeatAt: string | null;
  nextBeatAt: string | null;
  lastResult?: {
    processed: number;
    approvals: number;
    denied: number;
    events: number;
  };
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 计算员工 heartbeat state 的稳定 JSON 文件路径。 */
export function resolveHeartbeatStatePath(
  employeeDir: string,
  logger: SiliconLogger = noopLogger,
): string {
  return resolveEmployeeChildPath(employeeDir, ["heartbeat", "state.json"], logger);
}

/** 读取员工 heartbeat state，读取失败时返回保守初始状态。 */
export async function readHeartbeatState(
  employeeDir: string,
  logger: SiliconLogger = noopLogger,
): Promise<HeartbeatState> {
  const raw = await readFile(resolveHeartbeatStatePath(employeeDir), "utf8").catch((error: unknown) => {
    logger.warn("读取 heartbeat state 失败，使用初始状态", {
      employeeDir,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return "";
  });
  if (!raw.trim()) {
    return { schemaVersion: 1, status: "alive", tickCount: 0, lastBeatAt: null, nextBeatAt: null };
  }
  const parsed = parseJsonRecord(raw, "HeartbeatState");
  assertHeartbeatState(parsed);
  return parsed;
}

/** 写入员工 heartbeat state，保持生命体心跳状态可观测。 */
export async function writeHeartbeatState(
  employeeDir: string,
  state: HeartbeatState,
  logger: SiliconLogger = noopLogger,
): Promise<void> {
  logger.info("写入硅基员工 heartbeat state", {
    employeeDir,
    status: state.status,
    tickCount: state.tickCount,
    lastBeatAt: state.lastBeatAt,
  });
  await writeUtf8FileAtomically(resolveHeartbeatStatePath(employeeDir, logger), `${JSON.stringify(state, null, 2)}\n`, logger);
}

/** 记录一次 heartbeat tick 结果，并推进 tick 计数。 */
export async function recordHeartbeatTick(input: {
  employeeDir: string;
  status: HeartbeatState["status"];
  beatAt: string;
  nextBeatAt?: string | null;
  processed: number;
  approvals: number;
  denied: number;
  events: number;
  logger?: SiliconLogger;
}): Promise<HeartbeatState> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始记录硅基员工 heartbeat tick 结果", {
    employeeDir: input.employeeDir,
    status: input.status,
    processed: input.processed,
    approvals: input.approvals,
    denied: input.denied,
    events: input.events,
  });
  const previous = await readHeartbeatState(input.employeeDir, logger);
  const state: HeartbeatState = {
    schemaVersion: 1,
    status: input.status,
    tickCount: previous.tickCount + 1,
    lastBeatAt: input.beatAt,
    nextBeatAt: input.nextBeatAt ?? null,
    lastResult: {
      processed: input.processed,
      approvals: input.approvals,
      denied: input.denied,
      events: input.events,
    },
  };
  await writeHeartbeatState(input.employeeDir, state, logger);
  logger.info("硅基员工 heartbeat tick 结果已记录", {
    employeeDir: input.employeeDir,
    tickCount: state.tickCount,
    status: state.status,
  });
  return state;
}
