import type {
  CapabilityEvent,
  CapabilityEventType,
  CapabilityKind,
  JsonValue,
  VendorFamily,
} from "@shared/contracts";

type VendorTraceNormalizationInput = {
  source: "openai-responses" | "anthropic-messages" | (string & {});
  eventType: CapabilityEventType;
  vendor?: VendorFamily;
  item: Record<string, unknown>;
  createdAt?: string;
  sessionId?: string | null;
  toolCallId?: string | null;
};

type ManagedTraceNormalizationInput = {
  capabilityId: CapabilityKind;
  type: CapabilityEventType;
  payload?: Record<string, JsonValue | null>;
  createdAt?: string;
  sessionId?: string | null;
  toolCallId?: string | null;
};

/** 将协议层原始 payload 转为统一 JSON 记录，避免观测层消费不可序列化对象。 */
function toJsonRecord(value: Record<string, unknown>): Record<string, JsonValue | null> {
  const record: Record<string, JsonValue | null> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (
      raw === null
      || typeof raw === "string"
      || typeof raw === "number"
      || typeof raw === "boolean"
    ) {
      record[key] = raw;
      continue;
    }

    if (Array.isArray(raw)) {
      record[key] = raw as JsonValue[];
      continue;
    }

    if (raw && typeof raw === "object") {
      record[key] = raw as Record<string, JsonValue>;
      continue;
    }

    record[key] = null;
  }
  return record;
}

/** 根据当前 trace 类型推断 capability，先覆盖已接入的搜索与研究链路。 */
function resolveCapabilityId(eventType: CapabilityEventType): CapabilityKind {
  if (eventType === "background_response_started") {
    return "research-task";
  }
  if (eventType === "computer_call") {
    return "computer";
  }
  if (eventType === "file_search_call") {
    return "knowledge-retrieval";
  }

  return "search";
}

/** 将 OpenAI Responses 的原始 trace 压平成统一字段，避免下游感知厂商细节。 */
function normalizeOpenAiResponsesPayload(
  eventType: CapabilityEventType,
  item: Record<string, unknown>,
): Record<string, JsonValue | null> {
  if (eventType === "web_search_call") {
    const action = item.action && typeof item.action === "object"
      ? item.action as Record<string, unknown>
      : {};

    return {
      traceId: typeof item.traceId === "string"
        ? item.traceId
        : typeof item.id === "string"
          ? item.id
          : null,
      status: typeof item.status === "string" ? item.status : null,
      action: typeof item.action === "string"
        ? item.action
        : typeof action.type === "string"
          ? action.type
          : null,
      queries: Array.isArray(item.queries)
        ? item.queries as JsonValue[]
        : Array.isArray(action.queries)
          ? action.queries as JsonValue[]
          : null,
      url: typeof item.url === "string"
        ? item.url
        : typeof action.url === "string"
          ? action.url
          : null,
      pattern: typeof item.pattern === "string"
        ? item.pattern
        : typeof action.pattern === "string"
          ? action.pattern
          : null,
    };
  }

  if (eventType === "file_search_call") {
    return {
      traceId: typeof item.traceId === "string"
        ? item.traceId
        : typeof item.id === "string"
          ? item.id
          : null,
      status: typeof item.status === "string" ? item.status : null,
      queries: Array.isArray(item.queries) ? item.queries as JsonValue[] : null,
      resultCount: Array.isArray(item.results) ? item.results.length : null,
    };
  }

  return toJsonRecord(item);
}

/** 归一化厂商原生 trace 事件。 */
export function normalizeVendorTraceEvent(input: VendorTraceNormalizationInput): CapabilityEvent {
  return {
    type: input.eventType,
    capabilityId: resolveCapabilityId(input.eventType),
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.vendor ? { vendor: input.vendor } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.toolCallId !== undefined ? { toolCallId: input.toolCallId } : {}),
    payload: input.source === "openai-responses"
      ? normalizeOpenAiResponsesPayload(input.eventType, input.item)
      : toJsonRecord(input.item),
  };
}

/** 归一化本地 managed runtime trace 事件。 */
export function normalizeManagedTraceEvent(input: ManagedTraceNormalizationInput): CapabilityEvent {
  return {
    type: input.type,
    capabilityId: input.capabilityId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.toolCallId !== undefined ? { toolCallId: input.toolCallId } : {}),
    payload: input.payload ?? {},
  };
}
