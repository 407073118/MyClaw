import type { ChannelConversationType, ChannelProvider } from "./channel-message";

export const INBOUND_MESSAGE_STATUS_VALUES = [
  "received",
  "routed",
  "queued",
  "delivered",
  "processing",
  "completed",
  "failed",
  "expired",
] as const;

export type InboundMessageStatus = (typeof INBOUND_MESSAGE_STATUS_VALUES)[number];

export const DELIVERY_ATTEMPT_STATUS_VALUES = [
  "pending",
  "sent",
  "acked",
  "failed",
  "expired",
] as const;

export type DeliveryAttemptStatus = (typeof DELIVERY_ATTEMPT_STATUS_VALUES)[number];

export const OUTBOUND_MESSAGE_STATUS_VALUES = [
  "pending",
  "sending",
  "sent",
  "failed",
] as const;

export type OutboundMessageStatus = (typeof OUTBOUND_MESSAGE_STATUS_VALUES)[number];

export interface BuildLocalSessionKeyInput {
  provider: ChannelProvider;
  conversationType: ChannelConversationType;
  externalConversationId: string;
  myclawUserId: string;
}

/** 构建本地会话键，确保同一外部会话稳定映射到同一桌面端会话。 */
export function buildLocalSessionKey(input: BuildLocalSessionKeyInput): string {
  if (input.provider !== "dingtalk") {
    console.warn("[contracts] 拒绝生成不支持渠道的本地会话键", {
      provider: input.provider,
    });
    throw new Error("unsupported provider");
  }

  if (input.conversationType !== "direct" && input.conversationType !== "group") {
    console.warn("[contracts] 拒绝生成不支持会话类型的本地会话键", {
      conversationType: input.conversationType,
    });
    throw new Error("unsupported conversation type");
  }

  const localSessionKey = `${input.provider}:${input.conversationType}:${input.externalConversationId}:user:${input.myclawUserId}`;
  console.info("[contracts] 生成本地会话键成功", {
    provider: input.provider,
    conversationType: input.conversationType,
    externalConversationId: input.externalConversationId,
    myclawUserId: input.myclawUserId,
  });
  return localSessionKey;
}
