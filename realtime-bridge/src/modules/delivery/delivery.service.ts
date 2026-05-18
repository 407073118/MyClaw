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

export type DeliveryEventContext =
  | { ok: true; messageId: string; desktopDeviceId: string; status: string }
  | { ok: false; reason: "delivery_not_found" };

type RoutedDeliveryContext = {
  message: DeliveryInboundMessage;
  route: Extract<RouteResult, { ok: true }>;
  deliveryId: string;
  attemptNumber: number;
};

type OfflineQueuedDeliveryContext = {
  message: DeliveryInboundMessage;
  myclawUserId: string;
  desktopDeviceId?: string;
  localSessionKey: string;
  routeSource: Extract<RouteResult, { ok: true }>["routeSource"];
};

type OfflineRouteContextFields = Omit<OfflineQueuedDeliveryContext, "message">;

@Injectable()
export class DeliveryService {
  private readonly ackTimeoutMs: number;
  private readonly retryDelaysMs: number[];
  private readonly ackTimers = new Map<string, NodeJS.Timeout>();
  private readonly deliveryContexts = new Map<string, RoutedDeliveryContext>();
  private readonly activeDeliveryByMessageId = new Map<string, string>();
  private readonly offlineQueuedByMessageId = new Map<string, OfflineQueuedDeliveryContext>();

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
      const offlineFields = route.reason === "device_offline" && this.hasOfflineRouteContext(route)
        ? {
            myclawUserId: route.myclawUserId,
            desktopDeviceId: route.desktopDeviceId ?? null,
            localSessionKey: route.localSessionKey,
          }
        : {};
      await this.updateInboundStatus(message.id, status, offlineFields);
      if (route.reason === "device_offline" && this.hasOfflineRouteContext(route)) {
        this.offlineQueuedByMessageId.set(message.id, {
          message,
          myclawUserId: route.myclawUserId,
          desktopDeviceId: route.desktopDeviceId,
          localSessionKey: route.localSessionKey,
          routeSource: route.routeSource,
        });
        console.warn("[delivery] 已记录离线队列上下文，等待桌面设备上线恢复投递", {
          messageId: message.id,
          myclawUserId: route.myclawUserId,
          desktopDeviceId: route.desktopDeviceId,
        });
      }
      console.warn("[delivery] 路由失败，入站消息未立即投递", { messageId: message.id, reason: route.reason, status });
      return status === "queued" ? { status, reason: route.reason } : { status, reason: route.reason };
    }

    await this.updateInboundStatus(message.id, "routed", {
      myclawUserId: route.myclawUserId,
      desktopDeviceId: route.desktopDeviceId,
      localSessionKey: route.localSessionKey,
    });

    const deliveryId = randomUUID();
    const deliveryContext: RoutedDeliveryContext = {
      message,
      route,
      deliveryId,
      attemptNumber: 1,
    };
    this.deliveryContexts.set(deliveryId, deliveryContext);
    this.activeDeliveryByMessageId.set(message.id, deliveryId);

    const lockResult = this.lockService.acquire(route.localSessionKey, deliveryId);
    if (!lockResult.acquired) {
      await this.updateInboundStatus(message.id, "queued");
      console.warn("[delivery] 本地会话忙碌，入站消息进入离线队列", {
        messageId: message.id,
        localSessionKey: route.localSessionKey,
      });
      return { status: "queued", reason: "local_session_busy" };
    }

    return this.sendDeliveryAttempt(deliveryContext);
  }

  /** 执行单次投递尝试，负责创建投递记录、发送 WebSocket 消息并安排 ACK 超时检查。 */
  private async sendDeliveryAttempt(context: RoutedDeliveryContext): Promise<DeliveryStartResult> {
    const { message, route, deliveryId, attemptNumber } = context;
    await (this.prisma as any).deliveryAttempt.create({
      data: {
        inboundMessageId: message.id,
        deliveryId,
        desktopDeviceId: route.desktopDeviceId,
        status: "sent",
        attemptNumber,
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
      await this.queueOfflineDelivery(context, "device_offline");
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
      attemptNumber,
      retryDelaysMs: this.retryDelaysMs,
    });
    return { status: "delivered", deliveryId };
  }

  /** 桌面设备重新上线后恢复投递该用户的离线队列消息。 */
  async recoverQueuedMessagesForDevice(myclawUserId: string, desktopDeviceId: string): Promise<number> {
    console.info("[delivery] 开始恢复桌面设备离线队列", { myclawUserId, desktopDeviceId });
    let recoveredCount = 0;
    const recoveredMessageIds = new Set<string>();
    for (const offlineContext of Array.from(this.offlineQueuedByMessageId.values())) {
      if (offlineContext.myclawUserId !== myclawUserId) {
        continue;
      }
      if (offlineContext.desktopDeviceId && offlineContext.desktopDeviceId !== desktopDeviceId) {
        continue;
      }

      this.offlineQueuedByMessageId.delete(offlineContext.message.id);
      recoveredMessageIds.add(offlineContext.message.id);
      if (await this.recoverQueuedContext(offlineContext, myclawUserId, desktopDeviceId)) {
        recoveredCount += 1;
      }
    }

    const persistedContexts = await this.loadPersistedQueuedContexts(myclawUserId, desktopDeviceId);
    for (const persistedContext of persistedContexts) {
      if (recoveredMessageIds.has(persistedContext.message.id)) {
        console.info("[delivery] 持久化离线队列消息已由内存队列恢复，跳过重复恢复", {
          messageId: persistedContext.message.id,
        });
        continue;
      }
      if (await this.recoverQueuedContext(persistedContext, myclawUserId, desktopDeviceId)) {
        recoveredCount += 1;
      }
    }
    console.info("[delivery] 桌面设备离线队列恢复完成", { myclawUserId, desktopDeviceId, recoveredCount });
    return recoveredCount;
  }

  /** 从数据库扫描 queued 消息，支持服务重启后继续恢复离线队列。 */
  private async loadPersistedQueuedContexts(myclawUserId: string, desktopDeviceId: string): Promise<OfflineQueuedDeliveryContext[]> {
    const rows = await (this.prisma as any).inboundMessage.findMany({
      where: {
        status: "queued",
        myclawUserId,
        OR: [
          { desktopDeviceId },
          { desktopDeviceId: null },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    const contexts = (rows as any[])
      .map((row) => this.toOfflineQueuedContext(row))
      .filter((context): context is OfflineQueuedDeliveryContext => Boolean(context));
    console.info("[delivery] 持久化离线队列扫描完成", {
      myclawUserId,
      desktopDeviceId,
      count: contexts.length,
    });
    return contexts;
  }

  /** 将数据库 queued 行转换为可重新投递的离线队列上下文。 */
  private toOfflineQueuedContext(row: any): OfflineQueuedDeliveryContext | undefined {
    if (
      row?.provider !== "dingtalk"
      || (row.conversationType !== "direct" && row.conversationType !== "group")
      || typeof row.id !== "string"
      || typeof row.externalMessageId !== "string"
      || typeof row.senderStaffId !== "string"
      || typeof row.externalConversationId !== "string"
      || typeof row.traceId !== "string"
      || typeof row.myclawUserId !== "string"
      || typeof row.localSessionKey !== "string"
    ) {
      console.warn("[delivery] 持久化离线队列消息缺少恢复字段，跳过", { messageId: row?.id });
      return undefined;
    }

    console.info("[delivery] 持久化离线队列消息转换成功", { messageId: row.id });
    return {
      message: {
        id: row.id,
        provider: row.provider,
        externalMessageId: row.externalMessageId,
        senderStaffId: row.senderStaffId,
        externalConversationId: row.externalConversationId,
        conversationType: row.conversationType,
        content: row.contentJson,
        traceId: row.traceId,
      },
      myclawUserId: row.myclawUserId,
      desktopDeviceId: typeof row.desktopDeviceId === "string" ? row.desktopDeviceId : undefined,
      localSessionKey: row.localSessionKey,
      routeSource: "sender-binding",
    };
  }

  /** 对单条离线队列上下文执行恢复投递，并处理本地会话仍忙碌的情况。 */
  private async recoverQueuedContext(
    offlineContext: OfflineQueuedDeliveryContext,
    myclawUserId: string,
    desktopDeviceId: string,
  ): Promise<boolean> {
    const deliveryId = randomUUID();
    const route: Extract<RouteResult, { ok: true }> = {
      ok: true,
      myclawUserId,
      desktopDeviceId,
      localSessionKey: offlineContext.localSessionKey,
      routeSource: offlineContext.routeSource,
    };
    const deliveryContext: RoutedDeliveryContext = {
      message: offlineContext.message,
      route,
      deliveryId,
      attemptNumber: 1,
    };
    this.deliveryContexts.set(deliveryId, deliveryContext);
    this.activeDeliveryByMessageId.set(offlineContext.message.id, deliveryId);

    const lockResult = this.lockService.acquire(route.localSessionKey, deliveryId);
    if (!lockResult.acquired) {
      await this.updateInboundStatus(offlineContext.message.id, "queued", {
        myclawUserId,
        desktopDeviceId,
        localSessionKey: route.localSessionKey,
      });
      console.warn("[delivery] 恢复投递时本地会话仍忙碌，消息保持排队", {
        messageId: offlineContext.message.id,
        localSessionKey: route.localSessionKey,
        position: lockResult.position,
      });
      return true;
    }

    const result = await this.sendDeliveryAttempt(deliveryContext);
    console.info("[delivery] 离线队列消息恢复投递完成", {
      messageId: offlineContext.message.id,
      status: result.status,
    });
    return result.status === "delivered" || result.status === "queued";
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

  /** 查询投递事件归属上下文，供 WebSocket 网关拒绝伪造或错设备事件。 */
  async getDeliveryEventContext(deliveryId: string): Promise<DeliveryEventContext> {
    const attempt = await (this.prisma as any).deliveryAttempt.findUnique({ where: { deliveryId } });
    if (!attempt) {
      console.warn("[delivery] 未找到投递事件归属上下文", { deliveryId });
      return { ok: false, reason: "delivery_not_found" };
    }

    console.info("[delivery] 投递事件归属上下文查询成功", {
      deliveryId,
      messageId: attempt.inboundMessageId,
      desktopDeviceId: attempt.desktopDeviceId,
      status: attempt.status,
    });
    return {
      ok: true,
      messageId: attempt.inboundMessageId,
      desktopDeviceId: attempt.desktopDeviceId,
      status: attempt.status,
    };
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
    await this.releaseDeliveryForMessage(messageId);
    console.info("[delivery] 入站消息完成状态标记成功", { messageId });
  }

  /** 标记入站消息失败，用于桌面端处理失败或最终出站失败。 */
  async markFailed(messageId: string, reason: string): Promise<void> {
    console.warn("[delivery] 开始标记入站消息失败", { messageId, reason });
    await this.updateInboundStatus(messageId, "failed");
    await this.releaseDeliveryForMessage(messageId);
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

  /** 判断离线路由结果是否携带足够恢复投递的上下文。 */
  private hasOfflineRouteContext(
    route: Extract<RouteResult, { ok: false; reason: "device_offline" }>,
  ): route is Extract<RouteResult, { ok: false; reason: "device_offline" }> & OfflineRouteContextFields {
    const hasContext = Boolean(
      typeof (route as { myclawUserId?: unknown }).myclawUserId === "string"
        && typeof (route as { localSessionKey?: unknown }).localSessionKey === "string"
        && ((route as { routeSource?: unknown }).routeSource === "sender-binding"
          || (route as { routeSource?: unknown }).routeSource === "conversation-binding"),
    );
    console.info("[delivery] 检查离线路由恢复上下文", { reason: route.reason, hasContext });
    return hasContext;
  }

  /** 将发送失败的投递放入离线恢复队列，并释放其占用的本地会话锁。 */
  private async queueOfflineDelivery(context: RoutedDeliveryContext, reason: string): Promise<void> {
    await this.updateInboundStatus(context.message.id, "queued");
    this.offlineQueuedByMessageId.set(context.message.id, {
      message: context.message,
      myclawUserId: context.route.myclawUserId,
      desktopDeviceId: context.route.desktopDeviceId,
      localSessionKey: context.route.localSessionKey,
      routeSource: context.route.routeSource,
    });
    this.activeDeliveryByMessageId.delete(context.message.id);
    if (this.lockService.isRunning(context.route.localSessionKey, context.deliveryId)) {
      this.lockService.release(context.route.localSessionKey, context.deliveryId);
    }
    console.warn("[delivery] 投递已进入离线恢复队列并释放会话锁", {
      messageId: context.message.id,
      deliveryId: context.deliveryId,
      reason,
    });
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
    this.scheduleRetryAfterAckTimeout(deliveryId);
  }

  /** ACK 超时后按配置延迟重试；到达最大次数后释放会话锁并标记入站失败。 */
  private scheduleRetryAfterAckTimeout(deliveryId: string): void {
    const context = this.deliveryContexts.get(deliveryId);
    if (!context) {
      console.warn("[delivery] ACK 超时后未找到投递上下文，无法重试", { deliveryId });
      return;
    }

    const retryDelayMs = this.retryDelaysMs[context.attemptNumber - 1];
    if (retryDelayMs === undefined) {
      console.warn("[delivery] ACK 重试次数已耗尽，入站消息标记失败并释放会话锁", {
        messageId: context.message.id,
        deliveryId,
      });
      void this.markFailed(context.message.id, "ack_timeout");
      return;
    }

    const nextDeliveryId = randomUUID();
    const nextContext: RoutedDeliveryContext = {
      ...context,
      deliveryId: nextDeliveryId,
      attemptNumber: context.attemptNumber + 1,
    };
    this.deliveryContexts.set(nextDeliveryId, nextContext);
    this.activeDeliveryByMessageId.set(context.message.id, nextDeliveryId);
    this.lockService.replaceRunning(context.route.localSessionKey, deliveryId, nextDeliveryId);

    const timer = setTimeout(() => {
      void this.sendDeliveryAttempt(nextContext).catch((error) => {
        console.error("[delivery] ACK 超时重试投递执行失败", {
          messageId: context.message.id,
          deliveryId: nextDeliveryId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, retryDelayMs);
    timer.unref?.();
    console.info("[delivery] ACK 超时后已安排投递重试", {
      messageId: context.message.id,
      previousDeliveryId: deliveryId,
      nextDeliveryId,
      retryDelayMs,
    });
  }

  /** 释放指定入站消息占用的本地会话锁，并继续投递同会话排队消息。 */
  private async releaseDeliveryForMessage(messageId: string): Promise<void> {
    const deliveryId = this.activeDeliveryByMessageId.get(messageId);
    if (!deliveryId) {
      console.warn("[delivery] 释放会话锁时未找到活跃投递", { messageId });
      return;
    }

    const context = this.deliveryContexts.get(deliveryId);
    if (!context) {
      console.warn("[delivery] 释放会话锁时未找到投递上下文", { messageId, deliveryId });
      return;
    }

    this.clearAckTimer(deliveryId);
    this.activeDeliveryByMessageId.delete(messageId);
    const releaseResult = this.lockService.release(context.route.localSessionKey, deliveryId);
    console.info("[delivery] 入站消息已释放本地会话投递锁", {
      messageId,
      deliveryId,
      nextDeliveryId: releaseResult.nextDeliveryId,
    });

    if (!releaseResult.nextDeliveryId) {
      return;
    }

    const nextContext = this.deliveryContexts.get(releaseResult.nextDeliveryId);
    if (!nextContext) {
      console.warn("[delivery] 排队投递已提升但缺少上下文，无法继续投递", {
        nextDeliveryId: releaseResult.nextDeliveryId,
      });
      return;
    }

    await this.sendDeliveryAttempt(nextContext);
  }
}
