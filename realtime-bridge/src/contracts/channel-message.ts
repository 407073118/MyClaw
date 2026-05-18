export type ChannelProvider = "dingtalk";

export type ChannelConversationType = "direct" | "group";

export type ChannelMessageContent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "markdown";
      title?: string;
      text: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

export interface ChannelMessageIdentity {
  provider: ChannelProvider;
  externalMessageId: string;
  senderStaffId: string;
  senderNick?: string;
  externalConversationId: string;
  conversationType: ChannelConversationType;
  conversationTitle?: string;
  traceId: string;
}
