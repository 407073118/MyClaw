import { WebSocket } from "ws";

import {
  BRIDGE_INBOUND_MESSAGE_TYPE,
  DESKTOP_ACK_MESSAGE_TYPE,
  DESKTOP_HEARTBEAT_MESSAGE_TYPE,
  DESKTOP_HELLO_MESSAGE_TYPE,
  DESKTOP_PROCESSING_FAILED_TYPE,
  DESKTOP_REPLY_CREATED_TYPE,
  type BridgeInboundMessage,
  type DesktopProcessingFailed,
  type DesktopReplyCreated,
  type RealtimeBridgeContent,
} from "../../../shared/contracts/realtime-bridge";

type WebSocketLike = {
  readyState: number;
  on(event: "open", listener: () => void): WebSocketLike;
  on(event: "message", listener: (data: Buffer | string) => void): WebSocketLike;
  on(event: "close", listener: () => void): WebSocketLike;
  on(event: "error", listener: (error: Error) => void): WebSocketLike;
  send(data: string): void;
  close(): void;
};

type WebSocketCtor = new (url: string) => WebSocketLike;

export interface RealtimeBridgeClientOptions {
  bridgeUrl: string;
  userId: string;
  deviceId: string;
  WebSocketCtor?: WebSocketCtor;
  onBridgeMessage?: (message: BridgeInboundMessage) => Promise<void> | void;
}

export interface RealtimeBridgeStatus {
  connected: boolean;
  bridgeUrl: string;
  userId: string;
  deviceId: string;
}

export class RealtimeBridgeClient {
  private readonly WebSocketCtor: WebSocketCtor;
  private socket: WebSocketLike | null = null;
  private connected = false;
  private readonly ackedDeliveryIds = new Set<string>();

  constructor(private readonly options: RealtimeBridgeClientOptions) {
    this.WebSocketCtor = options.WebSocketCtor ?? (WebSocket as unknown as WebSocketCtor);
  }

  /** 建立 realtime-bridge WebSocket 连接，并在打开后发送 hello。 */
  connect(): void {
    if (this.socket) {
      console.info("[realtime-bridge] 桥接客户端已存在连接，跳过重复连接");
      return;
    }

    console.info("[realtime-bridge] 开始连接实时桥接服务", { bridgeUrl: this.options.bridgeUrl });
    const socket = new this.WebSocketCtor(this.options.bridgeUrl);
    this.socket = socket;
    socket.on("open", () => {
      this.connected = true;
      this.sendHello();
      console.info("[realtime-bridge] 实时桥接服务连接成功");
    });
    socket.on("message", (data) => {
      void this.handleSocketMessage(data);
    });
    socket.on("close", () => {
      this.connected = false;
      this.socket = null;
      console.warn("[realtime-bridge] 实时桥接服务连接已关闭");
    });
    socket.on("error", (error) => {
      console.error("[realtime-bridge] 实时桥接服务连接错误", { error: error.message });
    });
  }

  /** 主动断开实时桥接连接。 */
  disconnect(): void {
    if (!this.socket) {
      console.warn("[realtime-bridge] 实时桥接连接不存在，跳过断开");
      return;
    }

    this.socket.close();
    this.connected = false;
    this.socket = null;
    console.info("[realtime-bridge] 实时桥接连接已主动断开");
  }

  /** 返回当前桥接客户端连接状态。 */
  getStatus(): RealtimeBridgeStatus {
    const status = {
      connected: this.connected,
      bridgeUrl: this.options.bridgeUrl,
      userId: this.options.userId,
      deviceId: this.options.deviceId,
    };
    console.info("[realtime-bridge] 查询桥接客户端状态", status);
    return status;
  }

  /** 发送桌面端心跳，维持服务端在线租约。 */
  sendHeartbeat(): void {
    this.sendJson({
      type: DESKTOP_HEARTBEAT_MESSAGE_TYPE,
      deviceId: this.options.deviceId,
      sentAt: new Date().toISOString(),
    });
    console.info("[realtime-bridge] 桌面端心跳发送成功", { deviceId: this.options.deviceId });
  }

  /** 处理桥接服务下发消息，先 ACK 再交给本地执行链路。 */
  async handleBridgeMessage(message: BridgeInboundMessage): Promise<void> {
    if (message.type !== BRIDGE_INBOUND_MESSAGE_TYPE) {
      console.warn("[realtime-bridge] 拒绝未知桥接消息", { type: (message as { type?: string }).type });
      return;
    }

    if (this.ackedDeliveryIds.has(message.deliveryId)) {
      console.warn("[realtime-bridge] 重复 deliveryId 已忽略", { deliveryId: message.deliveryId });
      return;
    }

    this.ackedDeliveryIds.add(message.deliveryId);
    this.sendAck(message);
    await this.options.onBridgeMessage?.(message);
    console.info("[realtime-bridge] 桥接消息处理入口完成", {
      messageId: message.messageId,
      deliveryId: message.deliveryId,
    });
  }

  /** 发送桌面端 ACK，确认已经收到桥接消息。 */
  sendAck(message: Pick<BridgeInboundMessage, "messageId" | "deliveryId" | "traceId">): void {
    this.sendJson({
      type: DESKTOP_ACK_MESSAGE_TYPE,
      messageId: message.messageId,
      deliveryId: message.deliveryId,
      traceId: message.traceId,
      receivedAt: new Date().toISOString(),
    });
    console.info("[realtime-bridge] 桌面端 ACK 已发送", { deliveryId: message.deliveryId });
  }

  /** 发送桌面端回复创建事件。 */
  sendReplyCreated(input: { messageId: string; deliveryId: string; traceId?: string; content: RealtimeBridgeContent }): void {
    const event: DesktopReplyCreated = {
      type: DESKTOP_REPLY_CREATED_TYPE,
      messageId: input.messageId,
      deliveryId: input.deliveryId,
      traceId: input.traceId,
      content: input.content,
      createdAt: new Date().toISOString(),
    };
    this.sendJson(event);
    console.info("[realtime-bridge] 桌面端回复创建事件已发送", { messageId: input.messageId });
  }

  /** 发送桌面端处理失败事件。 */
  sendProcessingFailed(input: { messageId: string; deliveryId: string; traceId?: string; reason: string }): void {
    const event: DesktopProcessingFailed = {
      type: DESKTOP_PROCESSING_FAILED_TYPE,
      messageId: input.messageId,
      deliveryId: input.deliveryId,
      traceId: input.traceId,
      reason: input.reason,
      failedAt: new Date().toISOString(),
    };
    this.sendJson(event);
    console.warn("[realtime-bridge] 桌面端处理失败事件已发送", { messageId: input.messageId, reason: input.reason });
  }

  /** 发送 hello 消息，向桥接服务声明当前用户和设备。 */
  private sendHello(): void {
    this.sendJson({
      type: DESKTOP_HELLO_MESSAGE_TYPE,
      userId: this.options.userId,
      deviceId: this.options.deviceId,
    });
    console.info("[realtime-bridge] 桌面端 hello 已发送", {
      userId: this.options.userId,
      deviceId: this.options.deviceId,
    });
  }

  /** 解析 WebSocket 下行消息，并交给桥接消息处理入口。 */
  private async handleSocketMessage(data: Buffer | string): Promise<void> {
    try {
      const raw = Buffer.isBuffer(data) ? data.toString("utf8") : data;
      const message = JSON.parse(raw) as BridgeInboundMessage;
      await this.handleBridgeMessage(message);
      console.info("[realtime-bridge] WebSocket 下行消息解析成功", { type: message.type });
    } catch (error) {
      console.warn("[realtime-bridge] WebSocket 下行消息解析失败", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** 序列化并发送 WebSocket 消息，未连接时安全拒绝。 */
  private sendJson(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn("[realtime-bridge] WebSocket 未连接，拒绝发送消息");
      return;
    }

    this.socket.send(JSON.stringify(payload));
    console.info("[realtime-bridge] WebSocket 消息发送成功", {
      type: (payload as { type?: string }).type,
    });
  }
}
