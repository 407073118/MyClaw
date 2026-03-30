import type { ChatMessage } from "@myclaw-desktop/shared";

import type { ModelConversationToolDefinition } from "../types";
import type { OpenAiRequestMessage, OpenAiStepResult } from "./types";

/** 将会话消息转换为 OpenAI-compatible 请求消息。 */
export function createOpenAiInputMessages(messages: ChatMessage[]): OpenAiRequestMessage[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "assistant",
        content: `Tool output:\n${message.content}`,
      };
    }

    return {
      role: message.role,
      content: message.content,
    };
  });
}

/** 将统一 tool 定义转换为 OpenAI-compatible 的 tools 字段。 */
export function createOpenAiToolsPayload(tools: readonly ModelConversationToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/** 组装工具轮次的 assistant 续写消息并保留私有字段。 */
export function buildOpenAiAssistantContinuationMessage(step: OpenAiStepResult): Record<string, unknown> {
  const continuationMessage: Record<string, unknown> = {
    ...step.assistantMessage,
    role: "assistant",
    content: typeof step.assistantMessage.content === "string" ? step.assistantMessage.content : "",
  };

  if (!Array.isArray(continuationMessage.tool_calls) || continuationMessage.tool_calls.length === 0) {
    continuationMessage.tool_calls = step.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        arguments: call.argumentsJson,
      },
    }));
  }

  return continuationMessage;
}
