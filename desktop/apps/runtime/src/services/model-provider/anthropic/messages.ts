import type { ChatMessage } from "@myclaw-desktop/shared";

import type { ModelConversationToolDefinition } from "../types";
import type { AnthropicMessage } from "./types";

/** 将会话消息转换为 Anthropic 请求消息与 system 文本。 */
export function createAnthropicInputMessages(messages: ChatMessage[]): {
  system: string;
  messages: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const anthropicMessages: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      if (message.content.trim()) {
        systemParts.push(message.content.trim());
      }
      continue;
    }

    if (message.role === "user" || message.role === "assistant") {
      anthropicMessages.push({
        role: message.role,
        content: [{ type: "text", text: message.content }],
      });
      continue;
    }

    anthropicMessages.push({
      role: "user",
      content: [{ type: "text", text: `Tool output:\n${message.content}` }],
    });
  }

  return {
    system: systemParts.join("\n\n"),
    messages: anthropicMessages,
  };
}

/** 将统一 tool 定义转换为 Anthropic tools 结构。 */
export function createAnthropicToolsPayload(tools: readonly ModelConversationToolDefinition[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}
