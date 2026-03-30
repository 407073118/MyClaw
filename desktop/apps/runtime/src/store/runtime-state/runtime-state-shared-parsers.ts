import type {
  BuiltinToolApprovalMode,
  ChatMessage,
  JsonValue,
  McpServerConfig,
} from "@myclaw-desktop/shared";

import { isA2UiPayload } from "../../services/a2ui";
import type { PendingWorkItem } from "../pending-work-store";
import type { WorkflowLibraryRootRecord } from "../workflow-library-root-store";
import type { SqlDatabase, SqlRow } from "./runtime-state-types";

const SQLITE_HEADER = "SQLite format 3\0";

/** 将 SQLite 查询结果转换为对象数组，避免上层重复处理列索引。 */
export function selectRows(db: SqlDatabase, sql: string): SqlRow[] {
  const results = db.exec(sql);
  if (results.length === 0) {
    return [];
  }

  const [firstResult] = results;
  return firstResult.values.map((values) => {
    const row: SqlRow = {};
    firstResult.columns.forEach((column, index) => {
      row[column] = values[index] ?? null;
    });
    return row;
  });
}

/** 将数据库字段安全解析为有限数字，避免 NaN 进入运行时状态。 */
export function toFiniteNumber(
  value: number | string | Uint8Array | null | undefined,
  fallback: number,
): number {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return normalized;
}

export function parseStringArray(value: number | string | Uint8Array | null | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function parseStringMap(
  value: number | string | Uint8Array | null | undefined,
): Record<string, string> | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const entries = Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    return Object.fromEntries(entries);
  } catch {
    return undefined;
  }
}

export function parseJsonRecord(
  value: number | string | Uint8Array | null | undefined,
): Record<string, JsonValue> | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    return parsed as Record<string, JsonValue>;
  } catch {
    return undefined;
  }
}

export function parseMessageUi(value: number | string | Uint8Array | null | undefined): ChatMessage["ui"] {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isA2UiPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 解析待办恢复策略，异常输入一律回退到手动恢复。 */
export function parsePendingWorkResumePolicy(
  value: number | string | Uint8Array | null | undefined,
): PendingWorkItem["resumePolicy"] {
  if (typeof value !== "string") {
    return { kind: "manual" };
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind: "manual" };
    }

    const candidate = parsed as { kind?: unknown; value?: unknown };
    if (
      candidate.kind === "manual" ||
      candidate.kind === "time" ||
      candidate.kind === "event" ||
      candidate.kind === "heartbeat"
    ) {
      return {
        kind: candidate.kind,
        ...(typeof candidate.value === "string" ? { value: candidate.value } : {}),
      };
    }
  } catch {
    // Ignore malformed JSON and fall back to a safe manual policy.
  }

  return { kind: "manual" };
}

/** 解析工作流根目录类型，遇到未知值时立即报错避免静默降级。 */
export function parseWorkflowLibraryRootKind(
  value: number | string | Uint8Array | null | undefined,
  rootId: string,
): WorkflowLibraryRootRecord["kind"] {
  if (value === "personal" || value === "mounted") {
    return value;
  }

  throw new Error(`Invalid workflow library root kind '${String(value ?? "")}' for root '${rootId || "<unknown>"}'.`);
}

export function parseBuiltinToolApprovalMode(
  value: number | string | Uint8Array | null | undefined,
): BuiltinToolApprovalMode | null {
  if (typeof value !== "string") {
    return null;
  }

  return isBuiltinToolApprovalMode(value) ? value : null;
}

export function isBuiltinToolApprovalMode(value: unknown): value is BuiltinToolApprovalMode {
  return value === "inherit" || value === "always-ask" || value === "always-allow";
}

export function isMcpSource(value: unknown): value is McpServerConfig["source"] {
  return value === "manual" || value === "claude" || value === "codex" || value === "cursor";
}

export function isSqliteFile(raw: Uint8Array): boolean {
  if (raw.length < SQLITE_HEADER.length) {
    return false;
  }

  return Buffer.from(raw.subarray(0, SQLITE_HEADER.length)).toString("utf8") === SQLITE_HEADER;
}
