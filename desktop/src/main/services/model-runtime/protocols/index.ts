import type { ProtocolTarget } from "@shared/contracts";

import { anthropicMessagesDriver } from "./anthropic-messages-driver";
import { openAiChatCompatibleDriver } from "./openai-chat-compatible-driver";
import { openAiResponsesDriver } from "./openai-responses-driver";
import type { ProtocolDriver, ProtocolExecutionInput, ProtocolExecutionOutput } from "./shared";

const PROTOCOL_DRIVERS: Record<ProtocolTarget, ProtocolDriver> = {
  "openai-chat-compatible": openAiChatCompatibleDriver,
  "anthropic-messages": anthropicMessagesDriver,
  "openai-responses": openAiResponsesDriver,
};

/** 根据协议目标选择驱动；所有模型执行都必须先经过此层。 */
export function resolveProtocolDriver(target: ProtocolTarget): ProtocolDriver {
  return PROTOCOL_DRIVERS[target];
}

export { anthropicMessagesDriver, openAiChatCompatibleDriver, openAiResponsesDriver };
export type { ProtocolDriver, ProtocolExecutionInput, ProtocolExecutionOutput } from "./shared";
