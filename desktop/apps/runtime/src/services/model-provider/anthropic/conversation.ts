import { joinTextParts } from "../shared/text";
import { MYCLAW_MODEL_TOOLS } from "../tool-definitions";
import type { ChatCompletionOutput, ModelConversationInput } from "../types";
import { requestAnthropicStep } from "./client";
import { createAnthropicInputMessages } from "./messages";

/** 运行 Anthropic 多轮对话（含工具调用）。 */
export async function runAnthropicConversation(input: ModelConversationInput): Promise<ChatCompletionOutput> {
  const maxRounds = Math.max(1, Math.min(16, Math.floor(input.maxToolRounds ?? 6)));
  const state = createAnthropicInputMessages(input.messages);
  const tools = input.tools ?? MYCLAW_MODEL_TOOLS;
  let lastAssistantText: string | null = null;
  const reasoningParts: string[] = [];

  for (let index = 0; index < maxRounds; index += 1) {
    const step = await requestAnthropicStep({
      profile: input.profile,
      system: state.system,
      messages: state.messages,
      includeTools: Boolean(input.onToolCall) && tools.length > 0,
      tools,
      streamResponse: true,
      onAssistantDelta: input.onAssistantDelta,
    });

    if (step.assistantText) {
      lastAssistantText = step.assistantText;
    }
    if (step.assistantReasoning) {
      reasoningParts.push(step.assistantReasoning);
    }

    const finalContent = step.assistantText ?? lastAssistantText;
    const finalReasoning = joinTextParts(reasoningParts);

    if (!input.onToolCall || step.toolCalls.length === 0) {
      if (finalContent || finalReasoning) {
        return {
          content: (finalContent ?? (finalReasoning ? "(model returned reasoning only)" : "")).trim(),
          reasoning: finalReasoning,
        };
      }

      if (step.finishReason === "max_tokens") {
        throw new Error("Anthropic response hit max_tokens without valid assistant content.");
      }

      throw new Error(`Anthropic model response is empty (Model: ${input.profile.model}).`);
    }

    state.messages.push({
      role: "assistant",
      content: step.assistantBlocks.length > 0 ? step.assistantBlocks : [{ type: "text", text: step.assistantText ?? "" }],
    });

    let stoppedByTool = false;
    let stopMessage: string | null = null;
    const toolResults: Array<Record<string, unknown>> = [];

    for (const call of step.toolCalls) {
      const result = await input.onToolCall({
        id: call.id,
        name: call.name,
        input: call.input,
      });

      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: result.content,
      });

      if (result.stop) {
        stoppedByTool = true;
        stopMessage = result.content;
      }
    }

    state.messages.push({
      role: "user",
      content: toolResults,
    });

    if (stoppedByTool) {
      const pausedContent = (lastAssistantText ?? stopMessage ?? "Tool execution paused.").trim();
      return {
        content: pausedContent,
        reasoning: joinTextParts(reasoningParts),
      };
    }
  }

  if (lastAssistantText) {
    return {
      content: lastAssistantText.trim(),
      reasoning: joinTextParts(reasoningParts),
    };
  }

  throw new Error("Tool-calling loop reached the maximum number of rounds without final assistant content.");
}
