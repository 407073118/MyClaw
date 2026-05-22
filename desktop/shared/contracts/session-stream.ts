import type { ChatSession, ChatMessage } from "./session";
import type { Task } from "./task";

export const SESSION_STREAM_PREVIEW_CHARS = 2048;
export const SESSION_STREAM_SOFT_BUDGET_BYTES = 16 * 1024;
export const SESSION_STREAM_HARD_BUDGET_BYTES = 64 * 1024;

export type SessionStreamScope = {
  kind: "session" | "artifact" | "workflow" | "global";
  id?: string;
};

/** 实时会话事件的统一信封，用于给渲染进程做订阅过滤、顺序校验和载荷预算。 */
export interface SessionStreamEnvelopeV2<TPayload> {
  version: 2;
  id: string;
  seq: number;
  createdAt: string;
  type: string;
  scope?: SessionStreamScope;
  payload: TPayload;
  budget?: {
    bytes: number;
    truncated?: boolean;
    omittedKeys?: string[];
  };
}

/** 会话领域补丁，避免高频路径反复广播完整 ChatSession。 */
export type SessionPatchPayload =
  | { sessionId: string; revision: number; kind: "session.fields"; fields: Partial<ChatSession> }
  | { sessionId: string; revision: number; kind: "messages.append"; messages: ChatMessage[] }
  | { sessionId: string; revision: number; kind: "messages.update"; messageId: string; fields: Partial<ChatMessage> }
  | { sessionId: string; revision: number; kind: "tasks.replace"; tasks: Task[] }
  | { sessionId: string; revision: number; kind: "runState.set"; chatRunState: ChatSession["chatRunState"] };

/** 渲染进程订阅条件，main 侧据此过滤无关实时事件。 */
export type SessionStreamSubscription = {
  sessionIds?: string[];
  eventTypes?: string[];
  scopeKinds?: SessionStreamScope["kind"][];
  includeLegacyFullSession?: boolean;
  maxPayloadBytes?: number;
};

/** 大对象实时广播时只传摘要，完整内容留在主进程按需读取。 */
export type PayloadPreview = {
  inputPreview: string;
  inputBytes: number;
  inputHash: string;
  omittedKeys: string[];
};

/** 统计 IPC payload 的 UTF-8 字节数，用于实时事件预算控制。 */
export function measurePayloadBytes(payload: unknown): number {
  return new TextEncoder().encode(stableStringify(payload)).length;
}

/** 构建大输入的预览对象，避免 tool/approval 实时事件携带完整参数。 */
export function buildPayloadPreview(
  value: unknown,
  omittedKey: string,
  previewChars = SESSION_STREAM_PREVIEW_CHARS,
): PayloadPreview {
  const serialized = stableStringify(value);
  const inputBytes = new TextEncoder().encode(serialized).length;
  const inputPreview = serialized.slice(0, previewChars);
  return {
    inputPreview,
    inputBytes,
    inputHash: hashStableString(serialized),
    omittedKeys: [omittedKey],
  };
}

/** 稳定序列化对象，确保同一参数对象在 main/renderer 侧可得到一致摘要。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/** 使用轻量 FNV-1a 摘要标识大输入；这里用于性能预算和比对，不作为安全哈希。 */
export function hashStableString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(16, "0");
}
