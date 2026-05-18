import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";
import type { DingTalkRelayMessageDto } from "./dto/dingtalk-relay-message.dto";

@Injectable()
export class IngressService {
  constructor(private readonly prisma: PrismaService) {}

  /** 持久化钉钉中转消息，重复消息直接返回已有入站消息编号。 */
  async receiveDingTalkMessage(message: DingTalkRelayMessageDto): Promise<{ messageId: string }> {
    console.info("[ingress] 开始保存钉钉中转消息", {
      externalMessageId: message.externalMessageId,
      traceId: message.traceId,
    });

    try {
      const inboundMessage = await (this.prisma as any).inboundMessage.upsert({
        where: {
          provider_externalMessageId: {
            provider: message.provider,
            externalMessageId: message.externalMessageId,
          },
        },
        update: {
          rawPayloadJson: message.raw ?? message,
        },
        create: {
          provider: message.provider,
          externalMessageId: message.externalMessageId,
          senderStaffId: message.senderStaffId,
          senderNick: message.senderNick,
          externalConversationId: message.externalConversationId,
          conversationType: message.conversationType,
          contentJson: message.content,
          rawPayloadJson: message.raw ?? message,
          status: "received",
          traceId: message.traceId,
        },
        select: { id: true },
      });

      console.info("[ingress] 钉钉中转消息保存成功", {
        messageId: inboundMessage.id,
        externalMessageId: message.externalMessageId,
      });
      return { messageId: inboundMessage.id };
    } catch (error) {
      console.error("[ingress] 钉钉中转消息保存失败", {
        externalMessageId: message.externalMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
