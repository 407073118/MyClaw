import { readFile, writeFile } from "node:fs/promises";

import type { SiliconLogger } from "./employee-scaffold.js";
import { resolveEmployeeChildPath } from "./path-boundary.js";
import { assertMemoryJournalEntry, parseJsonRecord } from "./schema-guards.js";

export type MemoryEventType =
  | "approval_requested"
  | "approval_denied"
  | "policy_denied"
  | "task_succeeded"
  | "task_blocked"
  | "task_failed";

export type MemoryJournalEntry = {
  schemaVersion: 1;
  eventId: string;
  type: MemoryEventType;
  subjectId: string;
  summary: string;
  confidence: number;
  createdAt: string;
  sourcePath?: string;
};

export type AppendMemoryEventInput = {
  employeeDir: string;
  eventId: string;
  type: MemoryEventType;
  subjectId: string;
  summary: string;
  confidence: number;
  sourcePath?: string;
  now?: () => Date;
  logger?: SiliconLogger;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 计算员工记忆 journal 的稳定 JSONL 文件路径。 */
export function resolveMemoryJournalPath(
  employeeDir: string,
  logger: SiliconLogger = noopLogger,
): string {
  return resolveEmployeeChildPath(employeeDir, ["memory", "journal.jsonl"], logger);
}

/** 追加一条员工记忆事件，保持经验沉淀可回放。 */
export async function appendMemoryEvent(input: AppendMemoryEventInput): Promise<MemoryJournalEntry> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始追加硅基员工记忆事件", {
    employeeDir: input.employeeDir,
    eventId: input.eventId,
    type: input.type,
    subjectId: input.subjectId,
  });
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    logger.warn("硅基员工记忆置信度越界，拒绝写入", {
      employeeDir: input.employeeDir,
      eventId: input.eventId,
      confidence: input.confidence,
    });
    throw new Error(`Invalid memory confidence: ${input.confidence}`);
  }
  if (input.sourcePath) {
    resolveEmployeeChildPath(input.employeeDir, input.sourcePath.split("/"), logger);
  }
  const entry: MemoryJournalEntry = {
    schemaVersion: 1,
    eventId: input.eventId,
    type: input.type,
    subjectId: input.subjectId,
    summary: input.summary,
    confidence: input.confidence,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    sourcePath: input.sourcePath,
  };
  assertMemoryJournalEntry(entry);
  await writeFile(resolveMemoryJournalPath(input.employeeDir, logger), `${JSON.stringify(entry)}\n`, {
    encoding: "utf8",
    flag: "a",
  });
  logger.info("硅基员工记忆事件已追加", {
    employeeDir: input.employeeDir,
    eventId: entry.eventId,
    type: entry.type,
    confidence: entry.confidence,
  });
  return entry;
}

/** 读取员工完整 memory journal，供测试、复盘和后续检索使用。 */
export async function readMemoryJournal(employeeDir: string): Promise<MemoryJournalEntry[]> {
  const raw = await readFile(resolveMemoryJournalPath(employeeDir), "utf8").catch(() => "");
  if (!raw.trim()) {
    return [];
  }
  const entries: MemoryJournalEntry[] = [];
  for (const line of raw.trim().split("\n")) {
    const parsed = parseJsonRecord(line, "MemoryJournalEntry");
    assertMemoryJournalEntry(parsed);
    entries.push(parsed);
  }
  return entries;
}
