import type {
  ChannelConversationType,
  ChannelMessageContent,
  ChannelMessageIdentity,
  ChannelProvider,
} from "./channel-message";

export const BRIDGE_INBOUND_MESSAGE_TYPE = "bridge.message.received" as const;
export const DESKTOP_ACK_MESSAGE_TYPE = "desktop.ack" as const;
export const DESKTOP_REPLY_CREATED_TYPE = "desktop.reply_created" as const;
export const DESKTOP_PROCESSING_FAILED_TYPE = "desktop.processing_failed" as const;

export interface BridgeInboundMessage extends ChannelMessageIdentity {
  type: typeof BRIDGE_INBOUND_MESSAGE_TYPE;
  messageId: string;
  deliveryId: string;
  myclawUserId: string;
  desktopDeviceId: string;
  localSessionKey: string;
  content: ChannelMessageContent;
  createdAt: string;
  rawPayload?: unknown;
}

export interface DesktopAckMessage {
  type: typeof DESKTOP_ACK_MESSAGE_TYPE;
  messageId: string;
  deliveryId: string;
  traceId?: string;
  receivedAt: string;
}

export interface DesktopReplyCreated {
  type: typeof DESKTOP_REPLY_CREATED_TYPE;
  messageId: string;
  deliveryId: string;
  traceId?: string;
  content: ChannelMessageContent;
  createdAt: string;
}

export interface DesktopProcessingFailed {
  type: typeof DESKTOP_PROCESSING_FAILED_TYPE;
  messageId: string;
  deliveryId: string;
  traceId?: string;
  reason: string;
  failedAt: string;
}

export type BridgeToDesktopEvent = BridgeInboundMessage;

export type DesktopToBridgeEvent =
  | DesktopAckMessage
  | DesktopReplyCreated
  | DesktopProcessingFailed;

export type {
  ChannelConversationType,
  ChannelMessageContent,
  ChannelMessageIdentity,
  ChannelProvider,
};
