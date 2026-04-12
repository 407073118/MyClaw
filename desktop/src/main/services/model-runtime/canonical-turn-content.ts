import type {
  CanonicalMessage,
  CanonicalMessagePart,
  CanonicalTaskState,
  CanonicalToolCall,
  CanonicalToolResult,
  CanonicalTurnContent,
  ChatMessage,
  ChatMessageContent,
  PromptSection,
  SessionReplayPolicy,
  Task,
} from "@shared/contracts";
import type { ChatMessage as ModelChatMessage, ResolvedToolCall } from "../model-client";

type LegacyMessageLike = Pick<
  ModelChatMessage,
  "role" | "content" | "reasoning" | "tool_call_id" | "tool_calls"
>;

function contentToCanonicalContent(content: ChatMessageContent | string): string | CanonicalMessagePart[] {
  if (typeof content === "string") {
    return content;
  }
  return content.map<CanonicalMessagePart>((part) => part.type === "text"
    ? { type: "text", text: part.text }
    : {
        type: "image_url",
        imageUrl: part.image_url.url,
        detail: part.image_url.detail,
      });
}

function buildTaskState(tasks?: Task[]): CanonicalTaskState | null {
  if (!tasks || tasks.length === 0) {
    return null;
  }

  return {
    taskCount: tasks.length,
    inProgressTaskId: tasks.find((task) => task.status === "in_progress")?.id ?? null,
    completedTaskIds: tasks.filter((task) => task.status === "completed").map((task) => task.id),
    summary: tasks.map((task) => `${task.status}: ${task.subject}`).join("\n"),
  };
}

function buildCanonicalMessage(message: LegacyMessageLike): CanonicalMessage {
  return {
    role: message.role,
    content: contentToCanonicalContent(message.content),
    reasoning: message.reasoning ?? null,
    toolCallId: message.tool_call_id ?? null,
    toolCalls: message.tool_calls?.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      argumentsJson: toolCall.function.arguments,
      input: null,
    })) ?? null,
  };
}

/** 将会话消息映射为 canonical messages，保留 multimodal / reasoning / tool ledger。 */
export function buildCanonicalMessages(messages: Array<ChatMessage | LegacyMessageLike>): CanonicalMessage[] {
  return messages.map((message) => buildCanonicalMessage(message));
}

/** 将解析后的 tool calls 标准化为 canonical 调用。 */
export function buildCanonicalToolCalls(toolCalls: ResolvedToolCall[]): CanonicalToolCall[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    argumentsJson: toolCall.argumentsJson,
    input: toolCall.input,
  }));
}

/** 从 assistant 的 tool ledger 中恢复 tool_call_id 对应的工具名称。 */
function buildToolCallNameMap(messages: ChatMessage[]): Map<string, string> {
  const toolCallNameMap = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant" || !message.tool_calls) {
      continue;
    }
    for (const toolCall of message.tool_calls) {
      toolCallNameMap.set(toolCall.id, toolCall.function.name);
    }
  }
  return toolCallNameMap;
}

/** 将 tool 消息标准化为 canonical tool results。 */
export function buildCanonicalToolResults(messages: ChatMessage[]): CanonicalToolResult[] {
  const toolCallNameMap = buildToolCallNameMap(messages);

  return messages
    .filter((message) => message.role === "tool" && !!message.tool_call_id)
    .map((message) => ({
      toolCallId: message.tool_call_id!,
      name: toolCallNameMap.get(message.tool_call_id!) ?? message.tool_call_id!,
      output: typeof message.content === "string"
        ? message.content
        : message.content
          .filter((part): part is { type: "text"; text: string } => part.type === "text")
          .map((part) => "text" in part ? part.text : "")
          .join("\n"),
      success: true,
    }));
}

export type BuildCanonicalTurnContentInput = {
  systemSections: PromptSection[];
  userSections?: PromptSection[];
  sessionMessages?: ChatMessage[];
  legacyMessages?: ModelChatMessage[];
  toolCalls?: ResolvedToolCall[];
  tasks?: Task[];
  replayPolicy?: SessionReplayPolicy | null;
};

/** 统一构建 canonical turn content，兼容 session/workflow legacy message 主链。 */
export function buildCanonicalTurnContent(input: BuildCanonicalTurnContentInput): CanonicalTurnContent {
  const sourceMessages = input.sessionMessages ?? input.legacyMessages ?? [];
  const canonicalMessages = buildCanonicalMessages(sourceMessages);

  return {
    systemSections: input.systemSections,
    userSections: input.userSections ?? [],
    taskState: buildTaskState(input.tasks),
    messages: canonicalMessages,
    toolCalls: buildCanonicalToolCalls(input.toolCalls ?? []),
    toolResults: input.sessionMessages ? buildCanonicalToolResults(input.sessionMessages) : [],
    approvalEvents: [],
    replayHints: {
      preserveReasoning: input.replayPolicy === "assistant-turn-with-reasoning",
      preserveToolLedger: canonicalMessages.some((message) => !!message.toolCallId || (message.toolCalls?.length ?? 0) > 0),
      preserveCachePrefix: input.systemSections.length > 0,
    },
  };
}

function flattenCanonicalContent(content: string | CanonicalMessagePart[]): string | ChatMessageContent {
  if (typeof content === "string") {
    return content;
  }
  const visualParts = content.filter((part): part is Extract<CanonicalMessagePart, { type: "text" | "image_url" }> => part.type === "text" || part.type === "image_url");
  if (visualParts.every((part) => part.type === "text")) {
    return visualParts.map((part) => part.text).join("\n");
  }
  return visualParts.map((part) => part.type === "text"
    ? { type: "text", text: part.text }
    : {
        type: "image_url",
        image_url: {
          url: part.imageUrl,
          detail: part.detail,
        },
      });
}

function renderPromptSections(sections: PromptSection[]): string | null {
  if (sections.length === 0) {
    return null;
  }

  return sections
    .map((section) => section.title ? `# ${section.title}\n${section.content}` : section.content)
    .join("\n\n");
}

/** 将 canonical content 重新物化为 legacy model-client 消息，供 gateway shim 与兼容驱动使用。 */
export function canonicalTurnContentToLegacyMessages(content: CanonicalTurnContent): ModelChatMessage[] {
  const systemPrompt = renderPromptSections(content.systemSections);
  const userPrompt = renderPromptSections(content.userSections);
  const legacyMessages: ModelChatMessage[] = [];

  if (systemPrompt) {
    legacyMessages.push({
      role: "system",
      content: systemPrompt,
    });
  }
  if (userPrompt) {
    legacyMessages.push({
      role: "user",
      content: userPrompt,
    });
  }

  legacyMessages.push(...content.messages.map((message) => ({
    role: message.role,
    content: flattenCanonicalContent(message.content),
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls && message.toolCalls.length > 0 ? {
      tool_calls: message.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: "function" as const,
        function: { name: toolCall.name, arguments: toolCall.argumentsJson },
        })),
    } : {}),
  })));

  return legacyMessages;
}

export const toLegacyWireMessages = canonicalTurnContentToLegacyMessages;
export const materializeLegacyMessages = canonicalTurnContentToLegacyMessages;
