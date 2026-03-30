import { ensureRecord } from "../shared/json";
import { joinTextParts } from "../shared/text";
import type { AnthropicStepResult } from "./types";

/** 解析单次 Anthropic JSON 响应。 */
export function parseAnthropicStep(payload: unknown): AnthropicStepResult {
  const content = payload && typeof payload === "object" ? (payload as { content?: unknown }).content : null;
  const blocks = Array.isArray(content)
    ? content.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];

  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolCalls: AnthropicStepResult["toolCalls"] = [];

  for (const block of blocks) {
    const type = block.type;
    if (type === "text" && typeof block.text === "string" && block.text.trim()) {
      textParts.push(block.text);
      continue;
    }

    if (
      (type === "thinking" || type === "redacted_thinking") &&
      typeof block.thinking === "string" &&
      block.thinking.trim()
    ) {
      reasoningParts.push(block.thinking);
      continue;
    }

    if (type === "tool_use") {
      const name = typeof block.name === "string" ? block.name : "";
      if (!name) {
        continue;
      }

      toolCalls.push({
        id: typeof block.id === "string" && block.id ? block.id : `toolcall-${crypto.randomUUID()}`,
        name,
        input: ensureRecord(block.input),
      });
    }
  }

  const stopReason =
    typeof (payload as { stop_reason?: unknown }).stop_reason === "string"
      ? (payload as { stop_reason: string }).stop_reason
      : null;

  return {
    assistantText: joinTextParts(textParts),
    assistantReasoning: joinTextParts(reasoningParts),
    toolCalls,
    assistantBlocks: blocks,
    finishReason: stopReason,
  };
}
