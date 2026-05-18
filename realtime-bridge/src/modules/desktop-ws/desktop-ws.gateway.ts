import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional, type Type } from "@nestjs/common";
import { HttpAdapterHost, ModuleRef } from "@nestjs/core";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

import { AuditService } from "../audit/audit.service";
import type { ChannelMessageContent } from "../../contracts/channel-message";
import { DeliveryService } from "../delivery/delivery.service";
import { OutboundService } from "../outbound/outbound.service";
import { DesktopConnectionRegistry } from "./desktop-connection.registry";

type DesktopWsMessage =
  | { type: "desktop.hello"; userId: string; deviceId: string; connectionId?: string }
  | { type: "desktop.heartbeat"; deviceId: string }
  | { type: "desktop.ack"; deliveryId: string; messageId: string }
  | { type: "desktop.processing_started"; deliveryId: string; messageId: string }
  | { type: "desktop.reply_created"; deliveryId: string; messageId: string; content: ChannelMessageContent }
  | { type: "desktop.processing_failed"; deliveryId: string; messageId: string; reason: string };

@Injectable()
export class DesktopWsGateway implements OnModuleInit, OnModuleDestroy {
  private webSocketServer?: WebSocketServer;

  constructor(
    @Inject(HttpAdapterHost) private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(DesktopConnectionRegistry) private readonly registry: DesktopConnectionRegistry,
    @Optional() @Inject(ModuleRef) private readonly moduleRef?: ModuleRef,
  ) {}

  /** 挂载原生 WebSocket Server 到 Nest HTTP Server，接收桌面端长连接。 */
  onModuleInit(): void {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
    this.webSocketServer = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (request: IncomingMessage, socket: any, head: Buffer) => {
      if (!this.isDesktopPath(request.url)) {
        console.warn("[desktop-ws] 拒绝非桌面端 WebSocket 路径", { url: request.url });
        return;
      }

      this.webSocketServer?.handleUpgrade(request, socket, head, (webSocket) => {
        this.webSocketServer?.emit("connection", webSocket, request);
      });
    });
    this.webSocketServer.on("connection", (webSocket) => this.bindSocket(webSocket));
    console.info("[desktop-ws] 桌面端 WebSocket 网关已挂载");
  }

  /** 关闭 WebSocket Server，避免测试和服务退出时遗留监听器。 */
  onModuleDestroy(): void {
    console.info("[desktop-ws] 开始关闭桌面端 WebSocket 网关");
    this.webSocketServer?.close();
    console.info("[desktop-ws] 桌面端 WebSocket 网关已关闭");
  }

  /** 校验升级请求路径，只允许桌面端桥接入口。 */
  private isDesktopPath(url?: string): boolean {
    const pathname = new URL(url ?? "/", "http://localhost").pathname;
    const accepted = pathname === "/v1/desktop/ws";
    console.info("[desktop-ws] 校验桌面端 WebSocket 路径", { pathname, accepted });
    return accepted;
  }

  /** 绑定单条桌面端连接的消息和关闭事件。 */
  private bindSocket(webSocket: WebSocket): void {
    let connectionId: string | undefined;
    let messageQueue = Promise.resolve();
    webSocket.on("message", (rawMessage) => {
      messageQueue = messageQueue
        .catch(() => undefined)
        .then(() => this.handleSocketMessage(rawMessage.toString(), webSocket, (nextConnectionId) => {
          connectionId = nextConnectionId;
        }))
        .catch((error) => {
          console.error("[desktop-ws] 串行处理桌面端消息失败", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });

    webSocket.on("close", () => {
      if (connectionId) {
        void this.registry.disconnect(connectionId);
      }
      console.warn("[desktop-ws] 桌面端 WebSocket 已关闭", { connectionId });
    });
  }

  /** 串行处理单条桌面端连接上的消息，避免审计和状态更新乱序。 */
  private async handleSocketMessage(
    rawMessage: string,
    webSocket: WebSocket,
    setConnectionId: (connectionId: string) => void,
  ): Promise<void> {
    const message = this.parseMessage(rawMessage.toString());
    if (!message) {
      return;
    }

    if (message.type === "desktop.hello") {
      const connectionId = message.connectionId ?? randomUUID();
      setConnectionId(connectionId);
      await this.registry.register({
        connectionId,
        userId: message.userId,
        deviceId: message.deviceId,
        socket: webSocket,
      });
      console.info("[desktop-ws] 桌面端 hello 处理成功", { connectionId });
      return;
    }

    if (message.type === "desktop.heartbeat") {
      await this.registry.refreshHeartbeat(message.deviceId);
      console.info("[desktop-ws] 桌面端 heartbeat 处理成功", { deviceId: message.deviceId });
      return;
    }

    await this.handleDesktopBusinessEvent(message);
  }

  /** 解析桌面端消息，非法 JSON 会被安全拒绝。 */
  private parseMessage(rawMessage: string): DesktopWsMessage | undefined {
    try {
      const message = JSON.parse(rawMessage) as DesktopWsMessage;
      console.info("[desktop-ws] 桌面端消息解析成功", { type: message.type });
      return message;
    } catch (error) {
      console.warn("[desktop-ws] 拒绝非法桌面端消息", {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /** 分发桌面端业务事件，接入投递、出站和审计链路。 */
  private async handleDesktopBusinessEvent(message: DesktopWsMessage): Promise<void> {
    console.info("[desktop-ws] 开始处理桌面端业务事件", { type: message.type });
    if (message.type === "desktop.ack") {
      await this.handleAckEvent(message);
      return;
    }

    if (message.type === "desktop.processing_started") {
      await this.handleProcessingStartedEvent(message);
      return;
    }

    if (message.type === "desktop.reply_created") {
      await this.handleReplyCreatedEvent(message);
      return;
    }

    if (message.type === "desktop.processing_failed") {
      await this.handleProcessingFailedEvent(message);
      return;
    }

    console.warn("[desktop-ws] 未支持的桌面端业务事件类型", { type: message.type });
  }

  /** 处理桌面端 ACK，清理投递超时并写入审计时间线。 */
  private async handleAckEvent(message: Extract<DesktopWsMessage, { type: "desktop.ack" }>): Promise<void> {
    const deliveryService = this.resolveOptionalService(DeliveryService);
    const auditService = this.resolveOptionalService(AuditService);
    await deliveryService?.handleAck(message.deliveryId);
    await auditService?.recordDeliveryAcked(message.messageId, { deliveryId: message.deliveryId });
    console.info("[desktop-ws] 桌面端 ACK 业务事件处理完成", {
      messageId: message.messageId,
      deliveryId: message.deliveryId,
    });
  }

  /** 处理桌面端开始执行事件，推动入站消息进入 processing 状态。 */
  private async handleProcessingStartedEvent(message: Extract<DesktopWsMessage, { type: "desktop.processing_started" }>): Promise<void> {
    const deliveryService = this.resolveOptionalService(DeliveryService);
    const auditService = this.resolveOptionalService(AuditService);
    await deliveryService?.markProcessingStarted(message.messageId);
    await auditService?.recordProcessingStarted(message.messageId, { deliveryId: message.deliveryId });
    console.info("[desktop-ws] 桌面端开始处理业务事件处理完成", {
      messageId: message.messageId,
      deliveryId: message.deliveryId,
    });
  }

  /** 处理桌面端回复事件，创建出站消息并记录完整审计链路。 */
  private async handleReplyCreatedEvent(message: Extract<DesktopWsMessage, { type: "desktop.reply_created" }>): Promise<void> {
    const outboundService = this.resolveOptionalService(OutboundService);
    const auditService = this.resolveOptionalService(AuditService);
    await auditService?.recordReplyCreated(message.messageId, {
      deliveryId: message.deliveryId,
      content: message.content,
    });
    await outboundService?.handleDesktopReplyCreated(message);
    await auditService?.recordOutboundSent(message.messageId, { deliveryId: message.deliveryId });
    console.info("[desktop-ws] 桌面端回复业务事件处理完成", {
      messageId: message.messageId,
      deliveryId: message.deliveryId,
    });
  }

  /** 处理桌面端执行失败事件，收口入站状态并写入失败审计。 */
  private async handleProcessingFailedEvent(message: Extract<DesktopWsMessage, { type: "desktop.processing_failed" }>): Promise<void> {
    const deliveryService = this.resolveOptionalService(DeliveryService);
    const auditService = this.resolveOptionalService(AuditService);
    await deliveryService?.markFailed(message.messageId, message.reason);
    await auditService?.recordFailure(message.messageId, {
      deliveryId: message.deliveryId,
      reason: message.reason,
    });
    console.warn("[desktop-ws] 桌面端处理失败业务事件已收口", {
      messageId: message.messageId,
      deliveryId: message.deliveryId,
      reason: message.reason,
    });
  }

  /** 从 Nest 容器懒加载跨模块服务，避免 WebSocket 模块形成静态循环依赖。 */
  private resolveOptionalService<T>(token: Type<T>): T | undefined {
    try {
      const service = this.moduleRef?.get(token, { strict: false });
      console.info("[desktop-ws] 跨模块服务解析完成", {
        token: token.name,
        found: Boolean(service),
      });
      return service;
    } catch (error) {
      console.warn("[desktop-ws] 跨模块服务未注册，跳过对应业务处理", {
        token: token.name,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
