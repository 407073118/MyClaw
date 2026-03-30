import {
  CONTENT_FIELDS,
  REASONING_ROOT_FIELDS,
  REASONING_TEXT_FIELDS,
  joinTextParts,
  pickTextFromUnknown,
} from "../shared/text";
import { ensureRecord, parseJsonObject } from "../shared/json";
import type { OpenAiStepResult, OpenAiToolCall } from "./types";

/** 从 responses.output 数组中提取 content 或 reasoning 文本。 */
function pickTextFromOutput(output: unknown, mode: "content" | "reasoning"): string | null {
  if (!Array.isArray(output)) {
    return null;
  }

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const entry = item as { type?: unknown; content?: unknown };
    const type = typeof entry.type === "string" ? entry.type : "";
    if (mode === "content" && type === "reasoning") {
      continue;
    }
    if (mode === "reasoning" && type && type !== "reasoning") {
      continue;
    }

    const text = pickTextFromUnknown(
      mode === "reasoning" ? item : entry.content,
      mode === "reasoning" ? REASONING_TEXT_FIELDS : CONTENT_FIELDS,
    );
    if (text) {
      parts.push(text);
    }
  }

  return joinTextParts(parts);
}

/** 从 JSON payload 中提取助手正文文本。 */
export function readAssistantContentFromJsonPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const outputText = pickTextFromUnknown((payload as { output_text?: unknown }).output_text, CONTENT_FIELDS);
  if (outputText) {
    return outputText;
  }

  const outputTextFromList = pickTextFromOutput((payload as { output?: unknown }).output, "content");
  if (outputTextFromList) {
    return outputTextFromList;
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return null;
  }

  const message = (firstChoice as { message?: unknown }).message;
  const messageText = pickTextFromUnknown(message, CONTENT_FIELDS);
  if (messageText) {
    return messageText;
  }

  const deltaContent = (firstChoice as { delta?: { content?: unknown } }).delta?.content;
  const deltaText = pickTextFromUnknown(deltaContent, CONTENT_FIELDS);
  if (deltaText) {
    return deltaText;
  }

  const textContent = pickTextFromUnknown((firstChoice as { text?: unknown }).text, CONTENT_FIELDS);
  if (textContent) {
    return textContent;
  }

  return null;
}

/** 从 JSON payload 中提取 reasoning/thinking 文本。 */
export function readAssistantReasoningFromJsonPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const outputReasoning = pickTextFromOutput((payload as { output?: unknown }).output, "reasoning");
  if (outputReasoning) {
    return outputReasoning;
  }

  const choices = (payload as { choices?: unknown }).choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const firstChoice = choices[0];
    if (firstChoice && typeof firstChoice === "object") {
      const message = (firstChoice as { message?: unknown }).message;
      if (message && typeof message === "object") {
        const messageRecord = message as Record<string, unknown>;
        for (const field of REASONING_ROOT_FIELDS) {
          const messageReasoning = pickTextFromUnknown(messageRecord[field], REASONING_TEXT_FIELDS);
          if (messageReasoning) {
            return messageReasoning;
          }
        }
      }
    }
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const field of REASONING_ROOT_FIELDS) {
      const reasoning = pickTextFromUnknown(record[field], REASONING_TEXT_FIELDS);
      if (reasoning) {
        return reasoning;
      }
    }
  }

  return null;
}

/** 从 SSE 文本体回退提取助手内容。 */
function readAssistantContentFromSseBody(rawBody: string): string | null {
  const chunks: string[] = [];
  const plainDataLines: string[] = [];

  for (const rawLine of rawBody.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(":") || !line.startsWith("data:")) {
      continue;
    }

    const dataPayload = line.slice("data:".length).trim();
    if (!dataPayload || dataPayload === "[DONE]") {
      continue;
    }

    try {
      const parsed = JSON.parse(dataPayload) as unknown;
      const contentChunk = readAssistantContentFromJsonPayload(parsed);
      if (contentChunk) {
        chunks.push(contentChunk);
      }
    } catch {
      plainDataLines.push(dataPayload);
    }
  }

  const combined = chunks.join("").trim();
  if (combined) {
    return combined;
  }

  const plainCombined = plainDataLines.join("\n").trim();
  return plainCombined || null;
}

/** 解析 JSON payload 内的 OpenAI-compatible tool_calls。 */
export function parseOpenAiToolCalls(payload: unknown): OpenAiToolCall[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const calls: OpenAiToolCall[] = [];
  const choices = (payload as { choices?: unknown }).choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const firstChoice = choices[0];
    const message =
      firstChoice && typeof firstChoice === "object" ? (firstChoice as { message?: unknown }).message : null;
    const toolCalls = message && typeof message === "object" ? (message as { tool_calls?: unknown }).tool_calls : null;
    if (Array.isArray(toolCalls)) {
      for (const entry of toolCalls) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const id = String((entry as { id?: unknown }).id ?? `toolcall-${crypto.randomUUID()}`);
        const fn = (entry as { function?: unknown }).function;
        const fnRecord = ensureRecord(fn);
        const name = typeof fnRecord.name === "string" ? fnRecord.name : "";
        if (!name) {
          continue;
        }
        const argumentsJson = typeof fnRecord.arguments === "string" ? fnRecord.arguments : "{}";
        calls.push({
          id,
          name,
          argumentsJson,
          input: parseJsonObject(argumentsJson),
        });
      }
    }
  }

  const output = (payload as { output?: unknown }).output;
  if (Array.isArray(output)) {
    for (const entry of output) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const type = (entry as { type?: unknown }).type;
      if (type !== "function_call") {
        continue;
      }
      const name = typeof (entry as { name?: unknown }).name === "string" ? String((entry as { name?: unknown }).name) : "";
      if (!name) {
        continue;
      }
      const id =
        (typeof (entry as { call_id?: unknown }).call_id === "string" &&
          String((entry as { call_id?: unknown }).call_id)) ||
        (typeof (entry as { id?: unknown }).id === "string" && String((entry as { id?: unknown }).id)) ||
        `toolcall-${crypto.randomUUID()}`;
      const argumentsJson =
        typeof (entry as { arguments?: unknown }).arguments === "string"
          ? String((entry as { arguments?: unknown }).arguments)
          : "{}";
      calls.push({
        id,
        name,
        argumentsJson,
        input: parseJsonObject(argumentsJson),
      });
    }
  }

  const uniqueById = new Map<string, OpenAiToolCall>();
  calls.forEach((call) => {
    if (!uniqueById.has(call.id)) {
      uniqueById.set(call.id, call);
    }
  });
  return [...uniqueById.values()];
}

/** 解析助手消息对象，失败时回退到基础文本消息。 */
export function parseOpenAiAssistantMessage(payload: unknown, fallbackText: string | null): Record<string, unknown> {
  if (payload && typeof payload === "object") {
    const choices = (payload as { choices?: unknown }).choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const firstChoice = choices[0];
      if (firstChoice && typeof firstChoice === "object") {
        const message = (firstChoice as { message?: unknown }).message;
        if (message && typeof message === "object") {
          return message as Record<string, unknown>;
        }
      }
    }
  }

  return {
    role: "assistant",
    content: fallbackText ?? "",
  };
}

/** 从 OpenAI delta 中提取 reasoning 增量字段。 */
export function readOpenAiReasoningDelta(delta: Record<string, unknown>): string | null {
  return (
    pickTextFromUnknown(delta.reasoning_content, REASONING_TEXT_FIELDS) ||
    pickTextFromUnknown(delta.reasoning_details, REASONING_TEXT_FIELDS) ||
    pickTextFromUnknown(delta.reasoning, REASONING_TEXT_FIELDS) ||
    pickTextFromUnknown(delta.thinking, REASONING_TEXT_FIELDS) ||
    pickTextFromUnknown(delta.summary, REASONING_TEXT_FIELDS)
  );
}

/** 解析单次 OpenAI-compatible 步进响应（JSON 或 SSE 文本）。 */
export function parseOpenAiStep(rawBody: string, contentType: string): OpenAiStepResult {
  let payload: unknown = null;
  let assistantText: string | null = null;
  let assistantReasoning: string | null = null;
  let toolCalls: OpenAiToolCall[] = [];

  try {
    payload = JSON.parse(rawBody) as unknown;
    assistantText = readAssistantContentFromJsonPayload(payload);
    assistantReasoning = readAssistantReasoningFromJsonPayload(payload);
    toolCalls = parseOpenAiToolCalls(payload);
  } catch {
    // 忽略 JSON 解析异常，回退 SSE 兼容路径。
  }

  if (
    !assistantText &&
    (contentType.includes("text/event-stream") || rawBody.includes("\ndata:") || rawBody.startsWith("data:"))
  ) {
    assistantText = readAssistantContentFromSseBody(rawBody);
  }

  const choices =
    payload && typeof payload === "object" && Array.isArray((payload as { choices?: unknown }).choices)
      ? ((payload as { choices: unknown[] }).choices as Array<Record<string, unknown>>)
      : [];
  const finishReason = typeof choices[0]?.finish_reason === "string" ? String(choices[0].finish_reason) : null;

  return {
    assistantText,
    assistantReasoning,
    toolCalls,
    assistantMessage: parseOpenAiAssistantMessage(payload, assistantText),
    finishReason,
  };
}
