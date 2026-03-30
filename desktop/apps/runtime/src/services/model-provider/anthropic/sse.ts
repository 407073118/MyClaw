import { ensureRecord, parseJsonObject } from "../shared/json";
import { CONTENT_FIELDS, REASONING_TEXT_FIELDS, joinTextParts, pickTextFromUnknown } from "../shared/text";
import type { ModelConversationDelta } from "../types";
import { parseAnthropicStep } from "./parser";
import type { AnthropicSseState, AnthropicSseToolAccumulator, AnthropicStepResult } from "./types";

/** 获取或创建某个 Anthropic tool_use 的累积器。 */
function ensureAnthropicToolAccumulator(
  map: Map<number, AnthropicSseToolAccumulator>,
  index: number,
): AnthropicSseToolAccumulator {
  const existing = map.get(index);
  if (existing) {
    return existing;
  }

  const next: AnthropicSseToolAccumulator = {
    id: `toolcall-${crypto.randomUUID()}`,
    name: "",
    input: {},
    inputJson: "",
  };
  map.set(index, next);
  return next;
}

/** 应用单条 Anthropic SSE payload 并回调增量。 */
async function applyAnthropicSsePayload(
  payload: unknown,
  state: AnthropicSseState,
  onAssistantDelta?: (delta: ModelConversationDelta) => Promise<void> | void,
): Promise<void> {
  const record = ensureRecord(payload);
  const type = typeof record.type === "string" ? record.type : "";

  if (type === "content_block_start") {
    const rawIndex = record.index;
    const index =
      typeof rawIndex === "number" && Number.isFinite(rawIndex)
        ? rawIndex
        : Number.parseInt(String(rawIndex ?? state.assistantBlocksByIndex.size), 10);
    const normalizedIndex = Number.isFinite(index) ? index : state.assistantBlocksByIndex.size;
    const block = ensureRecord(record.content_block);
    const blockType = typeof block.type === "string" ? block.type : "";
    state.assistantBlocksByIndex.set(normalizedIndex, { ...block });

    if (blockType === "text") {
      const text = pickTextFromUnknown(block.text, CONTENT_FIELDS);
      if (text) {
        state.textParts.push(text);
        await onAssistantDelta?.({ content: text });
      }
      return;
    }

    if (blockType === "thinking" || blockType === "redacted_thinking") {
      const reasoning = pickTextFromUnknown(block.thinking, REASONING_TEXT_FIELDS);
      if (reasoning) {
        state.reasoningParts.push(reasoning);
        await onAssistantDelta?.({ reasoning });
      }
      return;
    }

    if (blockType === "tool_use") {
      const accumulator = ensureAnthropicToolAccumulator(state.toolCallsByIndex, normalizedIndex);
      if (typeof block.id === "string" && block.id.trim()) {
        accumulator.id = block.id.trim();
      }
      if (typeof block.name === "string" && block.name.trim()) {
        accumulator.name = block.name.trim();
      }
      accumulator.input = ensureRecord(block.input);
    }

    return;
  }

  if (type === "content_block_delta") {
    const rawIndex = record.index;
    const index =
      typeof rawIndex === "number" && Number.isFinite(rawIndex)
        ? rawIndex
        : Number.parseInt(String(rawIndex ?? 0), 10);
    const normalizedIndex = Number.isFinite(index) ? index : 0;
    const delta = ensureRecord(record.delta);
    const deltaType = typeof delta.type === "string" ? delta.type : "";

    if (deltaType === "text_delta") {
      const text = pickTextFromUnknown(delta.text, CONTENT_FIELDS);
      if (text) {
        state.textParts.push(text);
        await onAssistantDelta?.({ content: text });
      }
      return;
    }

    if (deltaType === "thinking_delta") {
      const reasoning = pickTextFromUnknown(delta.thinking, REASONING_TEXT_FIELDS);
      if (reasoning) {
        state.reasoningParts.push(reasoning);
        await onAssistantDelta?.({ reasoning });
      }
      return;
    }

    if (deltaType === "input_json_delta") {
      const accumulator = ensureAnthropicToolAccumulator(state.toolCallsByIndex, normalizedIndex);
      if (typeof delta.partial_json === "string") {
        accumulator.inputJson += delta.partial_json;
      }
      return;
    }
  }

  if (type === "message_delta") {
    const delta = ensureRecord(record.delta);
    if (typeof delta.stop_reason === "string" && delta.stop_reason.trim()) {
      state.finishReason = delta.stop_reason.trim();
    }
  }
}

/** 逐行消费 Anthropic SSE 并解析步进结果。 */
export async function parseAnthropicStepFromSse(
  response: Response,
  onAssistantDelta?: (delta: ModelConversationDelta) => Promise<void> | void,
): Promise<AnthropicStepResult> {
  if (!response.body) {
    const payload = (await response.json()) as unknown;
    return parseAnthropicStep(payload);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state: AnthropicSseState = {
    textParts: [],
    reasoningParts: [],
    toolCallsByIndex: new Map<number, AnthropicSseToolAccumulator>(),
    assistantBlocksByIndex: new Map<number, Record<string, unknown>>(),
    finishReason: null,
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
      await applyAnthropicSsePayload(parsed, state, onAssistantDelta);
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

  const toolCalls = [...state.toolCallsByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, accumulator]) => {
      const parsedInput = accumulator.inputJson.trim() ? parseJsonObject(accumulator.inputJson) : {};
      const input = Object.keys(parsedInput).length > 0 ? parsedInput : accumulator.input;
      return {
        id: accumulator.id,
        name: accumulator.name,
        input,
      };
    })
    .filter((toolCall) => toolCall.name.trim().length > 0);

  const assistantBlocks = [...state.assistantBlocksByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, block]) => block);

  return {
    assistantText: joinTextParts(state.textParts),
    assistantReasoning: joinTextParts(state.reasoningParts),
    toolCalls,
    assistantBlocks,
    finishReason: state.finishReason,
  };
}
