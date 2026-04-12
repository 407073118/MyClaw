import type {
  CanonicalMessage,
  CanonicalMessagePart,
  CanonicalTurnContent,
  ModelProfile,
  ProtocolTarget,
  TurnExecutionPlan,
  TurnFallbackEvent,
  TurnOutcome,
} from "@shared/contracts";
import type { ModelCallResult, ResolvedToolCall } from "../../model-client";
import type { CompiledToolBundle } from "../tool-middleware";

export type ProtocolExecutionInput = {
  profile: ModelProfile;
  plan: TurnExecutionPlan;
  content: CanonicalTurnContent;
  toolBundle: CompiledToolBundle;
  previousResponseId?: string | null;
  signal?: AbortSignal;
  onDelta?: (delta: { content?: string; reasoning?: string }) => void;
  onToolCallDelta?: (delta: { toolCallId: string; name: string; argumentsDelta: string }) => void;
  rolloutGate: {
    enabled: boolean;
    rolloutOrder: number;
    reason: string;
  };
};

export type ProtocolExecutionOutput = {
  content: string;
  reasoning?: string;
  toolCalls: ResolvedToolCall[];
  finishReason: string | null;
  usage?: TurnOutcome["usage"];
  responseId?: string | null;
  requestVariantId?: string | null;
  fallbackReason?: string | null;
  retryCount: number;
  fallbackEvents: TurnFallbackEvent[];
};

export type ProtocolDriver = {
  protocolTarget: ProtocolTarget;
  buildRequestBody?: (input: ProtocolExecutionInput) => Record<string, unknown>;
  execute(input: ProtocolExecutionInput): Promise<ProtocolExecutionOutput>;
};

/** 将 prompt sections 渲染为协议无关的系统提示。 */
export function renderPromptSectionText(sections: CanonicalTurnContent["systemSections"]): string {
  return sections
    .map((section) => (section.title ? `# ${section.title}\n${section.content}` : section.content))
    .join("\n\n")
    .trim();
}

/** 将 canonical message part 压平成纯文本。 */
export function flattenMessageParts(parts: CanonicalMessagePart[]): string {
  return parts
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "reasoning") return `<reasoning>${part.text}</reasoning>`;
      if (part.type === "image_url") return `[image:${part.imageUrl}]`;
      if (part.type === "tool_call_ref") return `[tool-call:${part.toolCallId}]`;
      if (part.type === "tool_result_ref") return `[tool-result:${part.toolCallId}]`;
      return JSON.stringify(part.value);
    })
    .join("\n");
}

/** 将 canonical message 转成协议通用对象。 */
export function materializeCanonicalMessage(message: CanonicalMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: typeof message.content === "string" ? message.content : flattenMessageParts(message.content),
    ...(message.reasoning ? { reasoning: message.reasoning } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls && message.toolCalls.length > 0
      ? {
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.name,
              arguments: toolCall.argumentsJson,
            },
          })),
        }
      : {}),
  };
}

/** 将 canonical content 转成协议共享消息数组。 */
export function buildCanonicalRequestMessages(content: CanonicalTurnContent): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  const systemPrompt = renderPromptSectionText(content.systemSections);
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  if (content.userSections.length > 0) {
    messages.push({
      role: "user",
      content: content.userSections.map((section) => section.content).join("\n\n"),
    });
  }
  for (const message of content.messages) {
    messages.push(materializeCanonicalMessage(message));
  }
  return messages;
}

/** 为尚未接入 native transport 的协议驱动补齐真实 transport 标签，避免把 legacy shim 伪装成 native 执行。 */
export function buildLegacyShimTransportMetadata(
  protocolTarget: ProtocolTarget,
  transport: ModelCallResult["transport"] | undefined,
): Pick<ProtocolExecutionOutput, "requestVariantId" | "fallbackReason" | "retryCount" | "fallbackEvents"> {
  const requestVariantId = transport?.requestVariantId ?? "primary";
  const fallbackEvents: TurnFallbackEvent[] = requestVariantId === protocolTarget
    ? []
    : [{ fromVariant: protocolTarget, toVariant: requestVariantId, reason: "legacy_call_model_shim" }];

  return {
    requestVariantId,
    fallbackReason: transport?.fallbackReason ?? (fallbackEvents.length > 0 ? "legacy_call_model_shim" : null),
    retryCount: transport?.retryCount ?? 0,
    fallbackEvents: [...fallbackEvents, ...(transport?.fallbackEvents ?? [])],
  };
}
