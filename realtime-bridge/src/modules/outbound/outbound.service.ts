import { Inject, Injectable, Optional } from "@nestjs/common";

import type { DesktopReplyCreated } from "../../contracts/bridge-events";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { DingTalkRelayClient } from "./dingtalk-relay.client";

export interface OutboundServiceOptions {
  retryDelaysMs?: number[];
}

@Injectable()
export class OutboundService {
  private readonly retryDelaysMs: number[];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DingTalkRelayClient) private readonly relayClient: DingTalkRelayClient,
    @Optional() @Inject("OUTBOUND_SERVICE_OPTIONS") options: OutboundServiceOptions = {},
  ) {
    this.retryDelaysMs = options.retryDelaysMs ?? [1000, 5000, 30000];
  }

  /** 处理桌面端回复事件，创建出站消息并回发到钉钉中转服务。 */
  async handleDesktopReplyCreated(event: Pick<DesktopReplyCreated, "messageId" | "deliveryId" | "content">): Promise<void> {
    console.info("[outbound] 开始处理桌面端回复事件", {
      messageId: event.messageId,
      deliveryId: event.deliveryId,
    });
    const outboundMessage = await (this.prisma as any).outboundMessage.create({
      data: {
        inboundMessageId: event.messageId,
        provider: "dingtalk",
        externalConversationId: "",
        contentJson: event.content,
        status: "pending",
        retryCount: 0,
      },
    });

    await this.sendWithRetry(outboundMessage.id, event);
    console.info("[outbound] 桌面端回复事件处理完成", { messageId: event.messageId });
  }

  /** 按 1s、5s、30s 默认节奏重试回发，最终失败时同步标记入站失败。 */
  private async sendWithRetry(
    outboundMessageId: string,
    event: Pick<DesktopReplyCreated, "messageId" | "deliveryId" | "content">,
  ): Promise<void> {
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt += 1) {
      console.info("[outbound] 开始尝试回发钉钉中转服务", {
        outboundMessageId,
        attempt: attempt + 1,
      });
      await (this.prisma as any).outboundMessage.update({
        where: { id: outboundMessageId },
        data: { status: "sending", retryCount: attempt },
      });

      const result = await this.relayClient.sendReply({
        messageId: event.messageId,
        deliveryId: event.deliveryId,
        content: event.content,
      });
      if (result.ok) {
        await (this.prisma as any).outboundMessage.update({
          where: { id: outboundMessageId },
          data: {
            status: "sent",
            rawResponseJson: result.rawResponse,
            sentAt: new Date(),
            retryCount: attempt,
          },
        });
        await this.markInboundStatus(event.messageId, "completed");
        console.info("[outbound] 出站消息回发成功", { outboundMessageId, attempt: attempt + 1 });
        return;
      }

      if (attempt < this.retryDelaysMs.length) {
        await (this.prisma as any).outboundMessage.update({
          where: { id: outboundMessageId },
          data: { retryCount: attempt + 1 },
        });
        console.warn("[outbound] 出站消息回发失败，准备重试", {
          outboundMessageId,
          attempt: attempt + 1,
          error: result.error,
        });
        await this.sleep(this.retryDelaysMs[attempt]);
        continue;
      }

      await (this.prisma as any).outboundMessage.update({
        where: { id: outboundMessageId },
        data: { status: "failed", retryCount: attempt },
      });
      await this.markInboundStatus(event.messageId, "failed");
      console.error("[outbound] 出站消息最终回发失败", {
        outboundMessageId,
        error: result.error,
      });
    }
  }

  /** 更新入站消息状态，避免将内部异常堆栈暴露给钉钉侧。 */
  private async markInboundStatus(messageId: string, status: "completed" | "failed"): Promise<void> {
    await (this.prisma as any).inboundMessage.update({
      where: { id: messageId },
      data: { status },
    });
    console.info("[outbound] 入站消息状态更新成功", { messageId, status });
  }

  /** 等待下一次重试窗口，测试可通过短延迟覆盖。 */
  private async sleep(delayMs: number): Promise<void> {
    console.info("[outbound] 等待出站消息重试窗口", { delayMs });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    console.info("[outbound] 出站消息重试等待结束", { delayMs });
  }
}
