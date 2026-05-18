import { z } from "zod";

export const dingtalkRelayMessageSchema = z.object({
  provider: z.literal("dingtalk"),
  externalMessageId: z.string().min(1),
  senderStaffId: z.string().min(1),
  senderNick: z.string().min(1).optional(),
  externalConversationId: z.string().min(1),
  conversationType: z.union([z.literal("direct"), z.literal("group")]),
  conversationTitle: z.string().min(1).optional(),
  sessionWebhook: z.string().min(1).optional(),
  content: z.object({
    type: z.string().min(1),
  }).passthrough(),
  traceId: z.string().min(1),
  raw: z.unknown().optional(),
});

export type DingTalkRelayMessageDto = z.infer<typeof dingtalkRelayMessageSchema>;
