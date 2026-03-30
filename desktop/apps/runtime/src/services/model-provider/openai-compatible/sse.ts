import { ensureRecord, parseJsonObject } from "../shared/json";
import { extractIncrementalText, joinTextParts, pickTextFromUnknown, CONTENT_FIELDS } from "../shared/text";
import type { ModelConversationDelta } from "../types";
import { parseOpenAiStep, readOpenAiReasoningDelta } from "./parser";
import type { OpenAiSseState, OpenAiStepResult, OpenAiToolCall, OpenAiToolCallAccumulator } from "./types";

/** 获取或创建某个 tool_call 的流式累积器。 */
function ensureOpenAiToolCallAccumulator(
  map: Map<number, OpenAiToolCallAccumulator>,
  index: number,
): OpenAiToolCallAccumulator {
  const existing = map.get(index);
  if (existing) {
    return existing;
  }

  const next: OpenAiToolCallAccumulator = {
    id: `toolcall-${crypto.randomUUID()}`,
    name: "",
    argumentsJson: "",
  };
  map.set(index, next);
  return next;
}

/** 将流式累积的 tool_call 结构转为标准调用格式。 */
function materializeOpenAiToolCalls(state: OpenAiSseState): OpenAiToolCall[] {
  return [...state.toolCallsByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, accumulator]) => accumulator)
    .filter((accumulator) => accumulator.name.trim().length > 0)
    .map((accumulator) => {
      const argumentsJson = accumulator.argumentsJson.trim() || "{}";
      return {
        id: accumulator.id,
        name: accumulator.name,
        argumentsJson,
        input: parseJsonObject(argumentsJson),
      };
    });
}

/** 应用单条 SSE payload 并回调增量。 */
async function applyOpenAiSsePayload(
  payload: unknown,
  state: OpenAiSseState,
  onAssistantDelta?: (delta: ModelConversationDelta) => Promise<void> | void,
): Promise<void> {
  const choices =
    payload && typeof payload === "object" && Array.isArray((payload as { choices?: unknown }).choices)
      ? ((payload as { choices: unknown[] }).choices as Array<Record<string, unknown>>)
      : [];
  const firstChoice = choices[0] ?? null;
  const delta = ensureRecord(firstChoice?.delta);

  const contentDelta = pickTextFromUnknown(delta.content, CONTENT_FIELDS);
  if (contentDelta) {
    const normalizedContentDelta = extractIncrementalText(contentDelta, state.latestContentSnapshot);
    state.latestContentSnapshot = normalizedContentDelta.snapshot;
    if (normalizedContentDelta.delta) {
      state.contentParts.push(normalizedContentDelta.delta);
      await onAssistantDelta?.({ content: normalizedContentDelta.delta });
    }
  }

  const reasoningDelta = readOpenAiReasoningDelta(delta);
  if (reasoningDelta) {
    const normalizedReasoningDelta = extractIncrementalText(reasoningDelta, state.latestReasoningSnapshot);
    state.latestReasoningSnapshot = normalizedReasoningDelta.snapshot;
    if (normalizedReasoningDelta.delta) {
      state.reasoningParts.push(normalizedReasoningDelta.delta);
      await onAssistantDelta?.({ reasoning: normalizedReasoningDelta.delta });
    }
  }

  const rawToolCalls = Array.isArray(delta.tool_calls) ? (delta.tool_calls as unknown[]) : [];
  for (const rawEntry of rawToolCalls) {
    const entry = ensureRecord(rawEntry);
    const rawIndex = entry.index;
    const index =
      typeof rawIndex === "number" && Number.isFinite(rawIndex)
        ? rawIndex
        : Number.parseInt(String(rawIndex ?? state.toolCallsByIndex.size), 10);
    const normalizedIndex = Number.isFinite(index) ? index : state.toolCallsByIndex.size;
    const accumulator = ensureOpenAiToolCallAccumulator(state.toolCallsByIndex, normalizedIndex);

    if (typeof entry.id === "string" && entry.id.trim()) {
      accumulator.id = entry.id.trim();
    }

    const fnRecord = ensureRecord(entry.function);
    if (typeof fnRecord.name === "string" && fnRecord.name.trim()) {
      accumulator.name = fnRecord.name.trim();
    }
    if (typeof fnRecord.arguments === "string") {
      accumulator.argumentsJson += fnRecord.arguments;
    }
  }

  const finishReason = firstChoice?.finish_reason;
  if (typeof finishReason === "string" && finishReason.trim()) {
    state.finishReason = finishReason.trim();
  }
}

/** 逐行消费 OpenAI-compatible SSE 响应并解析步进结果。 */
export async function parseOpenAiStepFromSse(
  response: Response,
  onAssistantDelta?: (delta: ModelConversationDelta) => Promise<void> | void,
): Promise<OpenAiStepResult> {
  if (!response.body) {
    const rawBody = await response.text();
    return parseOpenAiStep(rawBody, response.headers.get("content-type")?.toLowerCase() ?? "");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state: OpenAiSseState = {
    contentParts: [],
    reasoningParts: [],
    toolCallsByIndex: new Map<number, OpenAiToolCallAccumulator>(),
    finishReason: null,
    latestContentSnapshot: "",
    latestReasoningSnapshot: "",
  };

  const processDataLine = async (line: string) => {
    if (!line.startsWith("data:")) {
      return;
    }
    const dataPayload = line.slice("data:".length).trim();
    if (!dataPayload || dataPayload === "[DONE]") {
      return;
    }

    try {
      const parsed = JSON.parse(dataPayload) as unknown;
      await applyOpenAiSsePayload(parsed, state, onAssistantDelta);
    } catch {
      // 忽略坏包，继续流式消费。
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      await processDataLine(line);
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) {
      break;
    }
  }

  const trailingLine = buffer.trim();
  if (trailingLine) {
    await processDataLine(trailingLine);
  }

  const toolCalls = materializeOpenAiToolCalls(state);
  const assistantText = joinTextParts(state.contentParts);
  const assistantReasoning = joinTextParts(state.reasoningParts);

  return {
    assistantText,
    assistantReasoning,
    toolCalls,
    assistantMessage: {
      role: "assistant",
      content: assistantText ?? "",
      ...(assistantReasoning
        ? {
            reasoning_details: [
              {
                type: "text",
                text: assistantReasoning,
              },
            ],
          }
        : {}),
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: {
                name: call.name,
                arguments: call.argumentsJson,
              },
            })),
          }
        : {}),
    },
    finishReason: state.finishReason,
  };
}
