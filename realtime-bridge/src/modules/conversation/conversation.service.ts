import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";
import type { ChannelConversationType, ChannelProvider } from "../../contracts/channel-message";

export interface UpsertConversationInput {
  provider: ChannelProvider;
  externalConversationId: string;
  conversationType: ChannelConversationType;
  conversationTitle?: string;
  rawPayload?: unknown;
}

@Injectable()
export class ConversationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 创建或更新渠道会话信息，保证路由前有稳定会话记录。 */
  async upsertConversation(input: UpsertConversationInput): Promise<void> {
    console.info("[conversation] 开始创建或更新渠道会话", {
      provider: input.provider,
      externalConversationId: input.externalConversationId,
      conversationType: input.conversationType,
    });

    try {
      await (this.prisma as any).channelConversation.upsert({
        where: {
          provider_externalConversationId: {
            provider: input.provider,
            externalConversationId: input.externalConversationId,
          },
        },
        update: {
          conversationType: input.conversationType,
          title: input.conversationTitle,
          rawPayloadJson: input.rawPayload,
        },
        create: {
          provider: input.provider,
          externalConversationId: input.externalConversationId,
          conversationType: input.conversationType,
          title: input.conversationTitle,
          rawPayloadJson: input.rawPayload,
        },
      });
      console.info("[conversation] 渠道会话创建或更新成功", {
        externalConversationId: input.externalConversationId,
      });
    } catch (error) {
      console.error("[conversation] 渠道会话创建或更新失败", {
        externalConversationId: input.externalConversationId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
