import { Inject, Injectable, Optional } from "@nestjs/common";

import { PrismaService } from "../../infra/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ConversationService } from "../conversation/conversation.service";
import { DeliveryService } from "../delivery/delivery.service";
import { RoutingService } from "../routing/routing.service";
import type { DingTalkRelayMessageDto } from "./dto/dingtalk-relay-message.dto";

@Injectable()
export class IngressService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(ConversationService) private readonly conversationService?: ConversationService,
    @Optional() @Inject(RoutingService) private readonly routingService?: RoutingService,
    @Optional() @Inject(DeliveryService) private readonly deliveryService?: DeliveryService,
    @Optional() @Inject(AuditService) private readonly auditService?: AuditService,
  ) {}

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
      await this.auditService?.recordIngressReceived(inboundMessage.id, {
        externalMessageId: message.externalMessageId,
        traceId: message.traceId,
      });
      void this.dispatchMessage(inboundMessage.id, message);
      return { messageId: inboundMessage.id };
    } catch (error) {
      console.error("[ingress] 钉钉中转消息保存失败", {
        externalMessageId: message.externalMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /** 异步执行会话更新、路由解析与投递，不阻塞入站 HTTP 响应。 */
  private async dispatchMessage(messageId: string, message: DingTalkRelayMessageDto): Promise<void> {
    if (!this.conversationService || !this.routingService || !this.deliveryService) {
      console.warn("[ingress] 路由或投递服务未注入，跳过异步投递", { messageId });
      return;
    }

    try {
      await this.conversationService.upsertConversation({
        provider: message.provider,
        externalConversationId: message.externalConversationId,
        conversationType: message.conversationType,
        conversationTitle: message.conversationTitle,
        rawPayload: message.raw ?? message,
      });
      const route = await this.routingService.route({
        provider: message.provider,
        senderStaffId: message.senderStaffId,
        externalConversationId: message.externalConversationId,
        conversationType: message.conversationType,
      });
      if (route.ok) {
        await this.auditService?.recordRouteResolved(messageId, {
          myclawUserId: route.myclawUserId,
          desktopDeviceId: route.desktopDeviceId,
          routeSource: route.routeSource,
        });
      } else {
        await this.auditService?.recordFailure(messageId, { reason: route.reason });
      }
      await this.deliveryService.deliverInboundMessage({
        id: messageId,
        provider: message.provider,
        externalMessageId: message.externalMessageId,
        senderStaffId: message.senderStaffId,
        externalConversationId: message.externalConversationId,
        conversationType: message.conversationType,
        content: message.content,
        traceId: message.traceId,
      }, route);
      console.info("[ingress] 入站消息异步路由投递完成", { messageId });
    } catch (error) {
      console.error("[ingress] 入站消息异步路由投递失败", {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
