import { joinTextParts } from "../shared/text";
import { MYCLAW_MODEL_TOOLS } from "../tool-definitions";
import type { ChatCompletionInput, ChatCompletionOutput, ModelConversationInput, ProfileConnectivityInput, ProfileConnectivityOutput } from "../types";
import { performOpenAiConnectivityTest, requestOpenAiStep } from "./client";
import { buildOpenAiAssistantContinuationMessage, createOpenAiInputMessages } from "./messages";

/** 运行 OpenAI-compatible 多轮对话（含工具调用）。 */
export async function runOpenAiCompatibleConversation(
  input: ModelConversationInput,
): Promise<ChatCompletionOutput> {
  const maxRounds = Math.max(1, Math.min(16, Math.floor(input.maxToolRounds ?? 6)));
  const requestMessages = createOpenAiInputMessages(input.messages);
  const tools = input.tools ?? MYCLAW_MODEL_TOOLS;
  let lastAssistantText: string | null = null;
  const reasoningParts: string[] = [];

  for (let index = 0; index < maxRounds; index += 1) {
    const step = await requestOpenAiStep({
      profile: input.profile,
      messages: requestMessages,
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

      if (step.finishReason === "length") {
        throw new Error("Model response hit max_tokens without valid assistant content.");
      }

      throw new Error(
        `Model response did not include assistant content (Provider: ${input.profile.provider}, Model: ${input.profile.model}).`,
      );
    }

    requestMessages.push(buildOpenAiAssistantContinuationMessage(step));

    let stoppedByTool = false;
    let stopMessage: string | null = null;

    for (const call of step.toolCalls) {
      const result = await input.onToolCall({
        id: call.id,
        name: call.name,
        input: call.input,
      });

      requestMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result.content,
      });

      if (result.stop) {
        stoppedByTool = true;
        stopMessage = result.content;
      }
    }

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

/** 运行单轮 OpenAI-compatible 回复（无工具）。 */
export async function createOpenAiCompatibleReply(
  input: ChatCompletionInput,
): Promise<ChatCompletionOutput> {
  const step = await requestOpenAiStep({
    profile: input.profile,
    messages: createOpenAiInputMessages(input.messages),
    includeTools: false,
    tools: [],
  });

  if (step.assistantText || step.assistantReasoning) {
    return {
      content: (step.assistantText ?? (step.assistantReasoning ? "(model returned reasoning only)" : "")).trim(),
      reasoning: step.assistantReasoning,
    };
  }

  throw new Error(`Model response is empty (Model: ${input.profile.model}).`);
}

/** 保留兼容别名，供旧调用方继续使用。 */
export async function testOpenAiCompatibleProfile(
  input: ProfileConnectivityInput,
): Promise<ProfileConnectivityOutput> {
  return performOpenAiConnectivityTest(input);
}
