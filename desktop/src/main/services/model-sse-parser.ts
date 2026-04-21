/** SSE 解析阶段输出的 Token 用量。 */
export type ParsedTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** SSE 累积完成后得到的完整工具调用对象。 */
export type ParsedToolCall = {
  id: string;
  name: string;
  argumentsJson: string;
  input: Record<string, unknown>;
};

type ToolCallAccumulator = {
  id: string;
  name: string;
  argumentsJson: string;
};

type SseState = {
  contentParts: string[];
  reasoningParts: string[];
  toolCallsByIndex: Map<number, ToolCallAccumulator>;
  finishReason: string | null;
  usage: ParsedTokenUsage | null;
  /** 是否收到了 [DONE] 信号或有效的 finish_reason，标记流正常结束。 */
  streamCompleted: boolean;
};

/** 为指定 index 准备工具调用累积器，确保并行工具调用可以稳定拼装。 */
function ensureToolCallAccumulator(
  map: Map<number, ToolCallAccumulator>,
  index: number,
): ToolCallAccumulator {
  const existing = map.get(index);
  if (existing) return existing;
  const next: ToolCallAccumulator = {
    id: `toolcall-${Math.random().toString(36).slice(2)}`,
    name: "",
    argumentsJson: "",
  };
  map.set(index, next);
  return next;
}

/** 尝试从 provider 返回值中抽取文本，兼容字符串、数组和对象三种形态。 */
export function extractText(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (item && typeof item === "object") {
        const text = (item as { text?: unknown }).text;
        if (typeof text === "string" && text) parts.push(text);
      } else if (typeof item === "string" && item) {
        parts.push(item);
      }
    }
    return parts.join("") || null;
  }
  if (value && typeof value === "object") {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string" && text) return text;
  }
  return null;
}

/** 从 OpenAI 兼容 delta 中读取 reasoning / thinking 增量。 */
function readReasoningDelta(delta: Record<string, unknown>): string | null {
  return (
    extractText(delta["reasoning_content"]) ??
    extractText(delta["reasoning_details"]) ??
    extractText(delta["reasoning"]) ??
    extractText(delta["thinking"]) ??
    null
  );
}

/** 把单个 SSE payload 应用到累计状态，并把增量回传给上层。 */
function applySseChunk(
  payload: unknown,
  state: SseState,
  onDelta?: (delta: { content?: string; reasoning?: string }) => void,
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void,
): void {
  if (!payload || typeof payload !== "object") return;

  const choices = (payload as { choices?: unknown }).choices;
  const firstChoice =
    Array.isArray(choices) && choices.length > 0
      ? (choices[0] as Record<string, unknown>)
      : null;

  const delta =
    firstChoice && typeof firstChoice.delta === "object" && firstChoice.delta !== null
      ? (firstChoice.delta as Record<string, unknown>)
      : {};

  const contentVal = extractText(delta["content"]);
  if (contentVal) {
    state.contentParts.push(contentVal);
    onDelta?.({ content: contentVal });
  }

  const reasoningVal = readReasoningDelta(delta);
  if (reasoningVal) {
    state.reasoningParts.push(reasoningVal);
    onDelta?.({ reasoning: reasoningVal });
  }

  const rawToolCalls = Array.isArray(delta["tool_calls"])
    ? (delta["tool_calls"] as unknown[])
    : [];

  for (const rawEntry of rawToolCalls) {
    if (!rawEntry || typeof rawEntry !== "object") continue;
    const entry = rawEntry as Record<string, unknown>;

    const rawIndex = entry["index"];
    const parsedIndex =
      typeof rawIndex === "number" && Number.isFinite(rawIndex)
        ? rawIndex
        : Number.parseInt(String(rawIndex ?? state.toolCallsByIndex.size), 10);
    const index = Number.isFinite(parsedIndex)
      ? parsedIndex
      : state.toolCallsByIndex.size;

    const acc = ensureToolCallAccumulator(state.toolCallsByIndex, index);

    if (typeof entry["id"] === "string" && entry["id"].trim()) {
      acc.id = entry["id"].trim();
    }

    const fn =
      entry["function"] && typeof entry["function"] === "object"
        ? (entry["function"] as Record<string, unknown>)
        : {};
    if (typeof fn["name"] === "string" && fn["name"].trim()) {
      acc.name = fn["name"].trim();
    }
    if (typeof fn["arguments"] === "string") {
      acc.argumentsJson += fn["arguments"];
      onToolCallDelta?.({ toolCallId: acc.id, name: acc.name, argumentsDelta: fn["arguments"] });
    }
  }

  const rawLegacyFunctionCall =
    delta["function_call"] && typeof delta["function_call"] === "object"
      ? (delta["function_call"] as Record<string, unknown>)
      : null;
  if (rawLegacyFunctionCall) {
    const acc = ensureToolCallAccumulator(state.toolCallsByIndex, 0);
    if (typeof rawLegacyFunctionCall["name"] === "string" && rawLegacyFunctionCall["name"].trim()) {
      acc.name = rawLegacyFunctionCall["name"].trim();
    }
    if (typeof rawLegacyFunctionCall["arguments"] === "string") {
      acc.argumentsJson += rawLegacyFunctionCall["arguments"];
      onToolCallDelta?.({
        toolCallId: acc.id,
        name: acc.name,
        argumentsDelta: rawLegacyFunctionCall["arguments"],
      });
    }
  }

  if (firstChoice && typeof firstChoice["finish_reason"] === "string") {
    const finishReason = firstChoice["finish_reason"].trim();
    if (finishReason) state.finishReason = finishReason === "function_call" ? "tool_calls" : finishReason;
  }

  const rawUsage = (payload as Record<string, unknown>)["usage"];
  if (rawUsage && typeof rawUsage === "object") {
    const usage = rawUsage as Record<string, unknown>;
    state.usage = {
      promptTokens: Number(usage["prompt_tokens"] ?? usage["input_tokens"] ?? 0),
      completionTokens: Number(usage["completion_tokens"] ?? usage["output_tokens"] ?? 0),
      totalTokens: Number(usage["total_tokens"] ?? 0),
    };
    if (state.usage.totalTokens === 0) {
      state.usage.totalTokens = state.usage.promptTokens + state.usage.completionTokens;
    }
  }
}

/** 安全解析 JSON，任何异常都按空值处理，避免打断流式消费。 */
export function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** 将工具调用增量整理为最终可用的调用结果。 */
function materializeToolCalls(state: SseState): ParsedToolCall[] {
  return [...state.toolCallsByIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, acc]) => acc)
    .filter((acc) => acc.name.trim().length > 0)
    .map((acc) => {
      const argumentsJson = acc.argumentsJson.trim() || "{}";
      let input: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(argumentsJson);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          input = parsed as Record<string, unknown>;
        }
      } catch (error) {
        // 流式累积出的 arguments 不是合法 JSON（Qwen/Kimi/Ark 等模型在 thinking +
        // tool call 多轮里偶发截断或未转义）。打 warn 便于排查，同时保持原流程。
        // 下游 buildToolLabel 的诊断字段（如 exec.command 的 receivedArgKeys）
        // 会把"参数丢失"翻译成模型可读的自纠错误。
        console.warn("[model-sse-parser] 工具调用 arguments JSON 解析失败，已降级为空对象", {
          toolName: acc.name,
          error: error instanceof Error ? error.message : String(error),
          argumentsSnippet: argumentsJson.slice(0, 300),
          argumentsLength: argumentsJson.length,
        });
        input = {};
      }
      return { id: acc.id, name: acc.name, argumentsJson, input };
    });
}

/** 输出标准化的流式解析结果。 */
function finaliseSseState(state: SseState): {
  content: string;
  reasoning: string;
  toolCalls: ParsedToolCall[];
  finishReason: string | null;
  usage: ParsedTokenUsage | null;
  /** 流是否正常结束（收到 [DONE] 或有效 finish_reason）。false 表示连接异常截断。 */
  streamCompleted: boolean;
} {
  return {
    content: state.contentParts.join(""),
    reasoning: state.reasoningParts.join(""),
    toolCalls: materializeToolCalls(state),
    finishReason: state.finishReason,
    usage: state.usage,
    streamCompleted: state.streamCompleted,
  };
}

/** 消费 SSE 响应体，并累计 content、reasoning、tool calls 与 usage。 */
export async function consumeSseStream(
  response: Response,
  onDelta?: (delta: { content?: string; reasoning?: string }) => void,
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void,
): Promise<{
  content: string;
  reasoning: string;
  toolCalls: ParsedToolCall[];
  finishReason: string | null;
  usage: ParsedTokenUsage | null;
  /** 流是否正常结束（收到 [DONE] 或有效 finish_reason）。false 表示连接异常截断。 */
  streamCompleted: boolean;
}> {
  const state: SseState = {
    contentParts: [],
    reasoningParts: [],
    toolCallsByIndex: new Map(),
    finishReason: null,
    usage: null,
    streamCompleted: false,
  };

  if (!response.body) {
    const rawText = await response.text();
    for (const rawLine of rawText.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trim();
      if (!payload) continue;
      if (payload === "[DONE]") { state.streamCompleted = true; continue; }
      const parsed = tryParseJson(payload);
      if (parsed !== null) applySseChunk(parsed, state, onDelta, onToolCallDelta);
    }
    // finish_reason 存在也视为正常完成（部分 provider 不发 [DONE]）
    if (state.finishReason) state.streamCompleted = true;
    return finaliseSseState(state);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice("data:".length).trim();
    if (!payload) return;
    if (payload === "[DONE]") { state.streamCompleted = true; return; }
    const parsed = tryParseJson(payload);
    if (parsed !== null) applySseChunk(parsed, state, onDelta, onToolCallDelta);
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      processLine(line);
      newlineIndex = buffer.indexOf("\n");
    }

    if (done) break;
  }

  if (buffer.trim()) {
    processLine(buffer);
  }

  // finish_reason 存在也视为正常完成（部分 provider 不发 [DONE]）
  if (state.finishReason) state.streamCompleted = true;

  return finaliseSseState(state);
}
