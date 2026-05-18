import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import { BRIDGE_INBOUND_MESSAGE_TYPE } from "../../contracts/bridge-events";
import type { ChannelConversationType, ChannelMessageContent, ChannelProvider } from "../../contracts/channel-message";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { DesktopConnectionRegistry } from "../desktop-ws/desktop-connection.registry";
import type { RouteResult } from "../routing/routing.service";
import { LocalSessionLockService } from "./local-session-lock.service";

export interface DeliveryInboundMessage {
  id: string;
  provider: ChannelProvider;
  externalMessageId: string;
  senderStaffId: string;
  externalConversationId: string;
  conversationType: ChannelConversationType;
  content: ChannelMessageContent;
  traceId: string;
}

export interface DeliveryServiceOptions {
  ackTimeoutMs?: number;
  retryDelaysMs?: number[];
}

export type DeliveryStartResult =
  | { status: "delivered"; deliveryId: string }
  | { status: "queued"; reason: string }
  | { status: "failed"; reason: string };

@Injectable()
export class DeliveryService {
  private readonly ackTimeoutMs: number;
  private readonly retryDelaysMs: number[];
  private readonly ackTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DesktopConnectionRegistry) private readonly registry: DesktopConnectionRegistry,
    @Inject(LocalSessionLockService) private readonly lockService: LocalSessionLockService,
    options: DeliveryServiceOptions = {},
  ) {
    this.ackTimeoutMs = options.ackTimeoutMs ?? 8000;
    this.retryDelaysMs = options.retryDelaysMs ?? [2000, 5000, 15000];
  }

  /** 根据路由结果启动入站消息投递，并维护 routed、queued、delivered 状态。 */
  async deliverInboundMessage(message: DeliveryInboundMessage, route: RouteResult): Promise<DeliveryStartResult> {
    console.info("[delivery] 开始投递入站消息", { messageId: message.id });
    if (!route.ok) {
      const status = route.reason === "device_offline" ? "queued" : "failed";
      await this.updateInboundStatus(message.id, status);
      console.warn("[delivery] 路由失败，入站消息未立即投递", { messageId: message.id, reason: route.reason, status });
      return status === "queued" ? { status, reason: route.reason } : { status, reason: route.reason };
    }

    await this.updateInboundStatus(message.id, "routed", {
      myclawUserId: route.myclawUserId,
      desktopDeviceId: route.desktopDeviceId,
      localSessionKey: route.localSessionKey,
    });

    const deliveryId = randomUUID();
    const lockResult = this.lockService.acquire(route.localSessionKey, deliveryId);
    if (!lockResult.acquired) {
      await this.updateInboundStatus(message.id, "queued");
      console.warn("[delivery] 本地会话忙碌，入站消息进入离线队列", {
        messageId: message.id,
        localSessionKey: route.localSessionKey,
      });
      return { status: "queued", reason: "local_session_busy" };
    }

    await (this.prisma as any).deliveryAttempt.create({
      data: {
        inboundMessageId: message.id,
        deliveryId,
        desktopDeviceId: route.desktopDeviceId,
        status: "sent",
        attemptNumber: 1,
        sentAt: new Date(),
      },
    });

    const sent = this.registry.sendToDevice(route.desktopDeviceId, {
      type: BRIDGE_INBOUND_MESSAGE_TYPE,
      messageId: message.id,
      deliveryId,
      provider: message.provider,
      externalMessageId: message.externalMessageId,
      senderStaffId: message.senderStaffId,
      externalConversationId: message.externalConversationId,
      conversationType: message.conversationType,
      content: message.content,
      traceId: message.traceId,
      myclawUserId: route.myclawUserId,
      desktopDeviceId: route.desktopDeviceId,
      localSessionKey: route.localSessionKey,
      createdAt: new Date().toISOString(),
    });

    if (!sent) {
      await this.updateInboundStatus(message.id, "queued");
      console.warn("[delivery] 发送时桌面设备离线，入站消息进入队列", {
        messageId: message.id,
        desktopDeviceId: route.desktopDeviceId,
      });
      return { status: "queued", reason: "device_offline" };
    }

    await this.updateInboundStatus(message.id, "delivered");
    this.scheduleAckTimeout(deliveryId);
    console.info("[delivery] 入站消息投递成功，等待桌面端 ACK", {
      messageId: message.id,
      deliveryId,
      retryDelaysMs: this.retryDelaysMs,
    });
    return { status: "delivered", deliveryId };
  }

  /** 处理桌面端 ACK，重复 ACK 直接忽略以保证幂等。 */
  async handleAck(deliveryId: string): Promise<void> {
    console.info("[delivery] 开始处理桌面端 ACK", { deliveryId });
    const attempt = await (this.prisma as any).deliveryAttempt.findUnique({ where: { deliveryId } });
    if (!attempt) {
      console.warn("[delivery] 未找到 ACK 对应投递记录，安全忽略", { deliveryId });
      return;
    }

    if (attempt.status === "acked") {
      console.info("[delivery] 重复 ACK 已幂等忽略", { deliveryId });
      return;
    }

    this.clearAckTimer(deliveryId);
    await (this.prisma as any).deliveryAttempt.update({
      where: { deliveryId },
      data: { status: "acked", ackedAt: new Date() },
    });
    console.info("[delivery] 桌面端 ACK 处理成功", { deliveryId });
  }

  /** 标记桌面端已开始处理消息。 */
  async markProcessingStarted(messageId: string): Promise<void> {
    console.info("[delivery] 开始标记入站消息处理中", { messageId });
    await this.updateInboundStatus(messageId, "processing");
    console.info("[delivery] 入站消息处理中状态标记成功", { messageId });
  }

  /** 标记入站消息完成，用于出站回复成功后的状态收口。 */
  async markCompleted(messageId: string): Promise<void> {
    console.info("[delivery] 开始标记入站消息完成", { messageId });
    await this.updateInboundStatus(messageId, "completed");
    console.info("[delivery] 入站消息完成状态标记成功", { messageId });
  }

  /** 标记入站消息失败，用于桌面端处理失败或最终出站失败。 */
  async markFailed(messageId: string, reason: string): Promise<void> {
    console.warn("[delivery] 开始标记入站消息失败", { messageId, reason });
    await this.updateInboundStatus(messageId, "failed");
    console.warn("[delivery] 入站消息失败状态标记成功", { messageId, reason });
  }

  /** 更新入站消息状态，并写入可选路由字段。 */
  private async updateInboundStatus(messageId: string, status: string, extra: Record<string, unknown> = {}): Promise<void> {
    await (this.prisma as any).inboundMessage.update({
      where: { id: messageId },
      data: { status, ...extra },
    });
    console.info("[delivery] 入站消息状态更新成功", { messageId, status });
  }

  /** 安排 ACK 超时检查，超时后记录失败投递尝试。 */
  private scheduleAckTimeout(deliveryId: string): void {
    const timer = setTimeout(() => {
      void this.failAttemptOnAckTimeout(deliveryId);
    }, this.ackTimeoutMs);
    timer.unref?.();
    this.ackTimers.set(deliveryId, timer);
    console.info("[delivery] ACK 超时检查已安排", { deliveryId, ackTimeoutMs: this.ackTimeoutMs });
  }

  /** 清理 ACK 超时检查，避免已确认投递被误标失败。 */
  private clearAckTimer(deliveryId: string): void {
    const timer = this.ackTimers.get(deliveryId);
    if (timer) {
      clearTimeout(timer);
      this.ackTimers.delete(deliveryId);
      console.info("[delivery] ACK 超时检查已清理", { deliveryId });
    }
  }

  /** ACK 超时后将投递尝试标记为失败。 */
  private async failAttemptOnAckTimeout(deliveryId: string): Promise<void> {
    const attempt = await (this.prisma as any).deliveryAttempt.findUnique({ where: { deliveryId } });
    if (!attempt || attempt.status === "acked") {
      console.info("[delivery] ACK 超时检查发现投递已确认或不存在，跳过失败标记", { deliveryId });
      return;
    }

    await (this.prisma as any).deliveryAttempt.update({
      where: { deliveryId },
      data: {
        status: "failed",
        errorCode: "ack_timeout",
        errorMessage: "桌面端 ACK 超时",
      },
    });
    this.ackTimers.delete(deliveryId);
    console.warn("[delivery] ACK 超时，投递尝试已标记失败", { deliveryId });
  }
}
