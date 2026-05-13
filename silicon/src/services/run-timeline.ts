import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { SiliconLogger } from "../core/employee-scaffold.js";
import { resolveEmployeeChildPath } from "../core/path-boundary.js";
import type { RunEvidenceView, RunStepView, RunTimelineEventView, RunTimelineView } from "../contracts/view-models.js";
import { resolveRuntimeEmployeeDir } from "./runtime-paths.js";

export type ReadRunTimelineViewInput = {
  runtimeRoot: string;
  employeeId: string;
  runId: string;
  logger?: SiliconLogger;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 读取 run inspector 时间线视图，聚合 state、events、steps 和证据文件。 */
export async function readRunTimelineView(input: ReadRunTimelineViewInput): Promise<RunTimelineView> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始读取 UI run timeline", {
    runtimeRoot: input.runtimeRoot,
    employeeId: input.employeeId,
    runId: input.runId,
  });
  const employeeDir = resolveRuntimeEmployeeDir(input.runtimeRoot, input.employeeId, logger);
  const runDir = resolveEmployeeChildPath(employeeDir, ["runs", input.runId], logger);
  const state = await readJsonObject(resolveEmployeeChildPath(runDir, ["state.json"], logger), logger);
  const events = await readJsonl(resolveEmployeeChildPath(runDir, ["events.jsonl"], logger), logger);
  const steps = await readJsonl(resolveEmployeeChildPath(runDir, ["steps.jsonl"], logger), logger);
  const evidence = await Promise.all(["state.json", "context.json", "plan.json", "events.jsonl", "steps.jsonl"].map((file) => {
    return readEvidence(runDir, file, logger);
  }));

  const verifier = typeof state.verifier === "object" && state.verifier !== null
    ? state.verifier as Record<string, unknown>
    : {};
  const view: RunTimelineView = {
    runId: readString(state.runId, input.runId),
    taskId: readString(state.taskId, ""),
    status: readString(state.status, "unknown"),
    startedAt: readOptionalString(state.startedAt),
    finishedAt: readOptionalString(state.finishedAt),
    executorMode: readOptionalString(verifier.executorMode),
    blockedReason: readOptionalString(verifier.blockedReason ?? state.errorMessage),
    events: events.map(toRunEventView),
    steps: steps.map((step) => step as RunStepView),
    evidence,
  };
  logger.info("UI run timeline 已读取", {
    employeeId: input.employeeId,
    runId: input.runId,
    status: view.status,
    eventCount: view.events.length,
    stepCount: view.steps.length,
  });
  return view;
}

/** 读取 JSON 对象文件，失败时抛出带路径的错误。 */
async function readJsonObject(path: string, logger: SiliconLogger): Promise<Record<string, unknown>> {
  const raw = await readFile(path, "utf8");
  logger.info("UI run timeline 已读取 JSON 文件", { path, byteLength: raw.length });
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid JSON object: ${path}`);
  }
  return parsed as Record<string, unknown>;
}

/** 读取 JSONL 文件，跳过空行并返回原始对象数组。 */
async function readJsonl(path: string, logger: SiliconLogger): Promise<Record<string, unknown>[]> {
  const raw = await readFile(path, "utf8").catch(() => "");
  logger.info("UI run timeline 已读取 JSONL 文件", { path, byteLength: raw.length });
  const rows: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      rows.push(parsed as Record<string, unknown>);
    }
  }
  return rows;
}

/** 读取证据文件摘要，避免 UI 一次性拉取过大的 run 文件。 */
async function readEvidence(runDir: string, fileName: string, logger: SiliconLogger): Promise<RunEvidenceView> {
  const path = join(runDir, fileName);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) {
    return { path: fileName, readable: false, byteLength: 0 };
  }
  const raw = await readFile(path, "utf8").catch(() => "");
  logger.info("UI run evidence 已读取", { path, byteLength: raw.length });
  return {
    path: fileName,
    readable: raw.length > 0,
    byteLength: raw.length,
    summary: raw.slice(0, 240),
  };
}

/** 将 run event 原始对象转成稳定 UI 事件视图。 */
function toRunEventView(event: Record<string, unknown>): RunTimelineEventView {
  return {
    eventId: readString(event.eventId, ""),
    type: readString(event.type, "unknown"),
    taskId: readOptionalString(event.taskId),
    runId: readOptionalString(event.runId),
    createdAt: readOptionalString(event.createdAt),
    message: readOptionalString(event.message),
  };
}

/** 从未知值读取字符串，否则返回默认值。 */
function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** 从未知值读取可选字符串。 */
function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
