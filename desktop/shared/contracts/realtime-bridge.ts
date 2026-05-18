export const BRIDGE_INBOUND_MESSAGE_TYPE = "bridge.message.received" as const;
export const DESKTOP_HELLO_MESSAGE_TYPE = "desktop.hello" as const;
export const DESKTOP_HEARTBEAT_MESSAGE_TYPE = "desktop.heartbeat" as const;
export const DESKTOP_ACK_MESSAGE_TYPE = "desktop.ack" as const;
export const DESKTOP_REPLY_CREATED_TYPE = "desktop.reply_created" as const;
export const DESKTOP_PROCESSING_FAILED_TYPE = "desktop.processing_failed" as const;

export type RealtimeBridgeProvider = "dingtalk";
export type RealtimeBridgeConversationType = "direct" | "group";

export type RealtimeBridgeContent =
  | { type: "text"; text: string }
  | { type: "markdown"; title?: string; text: string }
  | { type: string; [key: string]: unknown };

export interface BridgeInboundMessage {
  type: typeof BRIDGE_INBOUND_MESSAGE_TYPE;
  messageId: string;
  deliveryId: string;
  provider: RealtimeBridgeProvider;
  externalMessageId: string;
  senderStaffId: string;
  senderNick?: string;
  externalConversationId: string;
  conversationType: RealtimeBridgeConversationType;
  conversationTitle?: string;
  myclawUserId: string;
  desktopDeviceId: string;
  localSessionKey: string;
  content: RealtimeBridgeContent;
  traceId: string;
  createdAt: string;
  rawPayload?: unknown;
}

export interface DesktopHelloMessage {
  type: typeof DESKTOP_HELLO_MESSAGE_TYPE;
  userId: string;
  deviceId: string;
  connectionId?: string;
}

export interface DesktopHeartbeatMessage {
  type: typeof DESKTOP_HEARTBEAT_MESSAGE_TYPE;
  deviceId: string;
  sentAt: string;
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
  content: RealtimeBridgeContent;
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

export type DesktopToBridgeMessage =
  | DesktopHelloMessage
  | DesktopHeartbeatMessage
  | DesktopAckMessage
  | DesktopReplyCreated
  | DesktopProcessingFailed;
