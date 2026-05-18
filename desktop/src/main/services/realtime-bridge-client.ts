import { WebSocket } from "ws";

import {
  BRIDGE_INBOUND_MESSAGE_TYPE,
  DESKTOP_ACK_MESSAGE_TYPE,
  DESKTOP_HEARTBEAT_MESSAGE_TYPE,
  DESKTOP_HELLO_MESSAGE_TYPE,
  DESKTOP_PROCESSING_FAILED_TYPE,
  DESKTOP_PROCESSING_STARTED_TYPE,
  DESKTOP_REPLY_CREATED_TYPE,
  type BridgeInboundMessage,
  type DesktopProcessingFailed,
  type DesktopProcessingStarted,
  type DesktopReplyCreated,
  type RealtimeBridgeContent,
} from "../../../shared/contracts/realtime-bridge";
import type { RealtimeChannelSessionStore } from "./realtime-channel-session-store";

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
type SessionSendMessageInput = { content: string };
type SessionSendMessage = (sessionId: string, input: SessionSendMessageInput) => Promise<unknown>;

export interface RealtimeBridgeClientOptions {
  bridgeUrl: string;
  userId: string;
  deviceId: string;
  connectionToken?: string;
  WebSocketCtor?: WebSocketCtor;
  onBridgeMessage?: (message: BridgeInboundMessage) => Promise<void> | void;
  sessionStore?: RealtimeChannelSessionStore;
  sendMessage?: SessionSendMessage;
  createLocalSessionId?: (message: BridgeInboundMessage) => string | Promise<string>;
  maxConcurrentSessions?: number;
}

export interface RealtimeBridgeStatus {
  connected: boolean;
  bridgeUrl: string;
  userId: string;
  deviceId: string;
}

export class RealtimeBridgeClient {
  private readonly WebSocketCtor: WebSocketCtor;
  private readonly sendMessageBridge: SessionSendMessage;
  private readonly maxConcurrentSessions: number;
  private socket: WebSocketLike | null = null;
  private connected = false;
  private readonly ackedDeliveryIds = new Set<string>();
  private readonly sessionQueues = new Map<string, Promise<void>>();
  private readonly globalExecutionQueue: Array<() => void> = [];
  private activeExecutionCount = 0;

  constructor(private readonly options: RealtimeBridgeClientOptions) {
    this.WebSocketCtor = options.WebSocketCtor ?? (WebSocket as unknown as WebSocketCtor);
    this.sendMessageBridge = options.sendMessage ?? defaultSessionSendMessage;
    this.maxConcurrentSessions = options.maxConcurrentSessions ?? 2;
  }

  /** 建立 realtime-bridge WebSocket 连接，并在打开后发送 hello。 */
  connect(): void {
    if (this.socket) {
      console.info("[realtime-bridge] 桥接客户端已存在连接，跳过重复连接");
      return;
    }

    const bridgeUrl = this.buildConnectionUrl();
    console.info("[realtime-bridge] 开始连接实时桥接服务", { bridgeUrl });
    const socket = new this.WebSocketCtor(bridgeUrl);
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
    this.sendProcessingStarted(message);
    if (this.options.sessionStore) {
      await this.enqueueSessionExecution(message);
    } else {
      await this.options.onBridgeMessage?.(message);
    }
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

  /** 发送桌面端开始处理事件，驱动服务端投递状态进入 processing。 */
  sendProcessingStarted(message: Pick<BridgeInboundMessage, "messageId" | "deliveryId" | "traceId">): void {
    const event: DesktopProcessingStarted = {
      type: DESKTOP_PROCESSING_STARTED_TYPE,
      messageId: message.messageId,
      deliveryId: message.deliveryId,
      traceId: message.traceId,
      startedAt: new Date().toISOString(),
    };
    this.sendJson(event);
    console.info("[realtime-bridge] 桌面端开始处理事件已发送", {
      messageId: message.messageId,
      deliveryId: message.deliveryId,
    });
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

  /** 构建带连接 Token 的 WebSocket URL，避免在 hello 前暴露未授权连接。 */
  private buildConnectionUrl(): string {
    if (!this.options.connectionToken) {
      console.warn("[realtime-bridge] 未配置实时桥接连接 Token，将使用原始连接地址");
      return this.options.bridgeUrl;
    }
    const url = new URL(this.options.bridgeUrl);
    url.searchParams.set("token", this.options.connectionToken);
    const connectionUrl = url.toString();
    console.info("[realtime-bridge] 已构建带 Token 的实时桥接连接地址", { bridgeUrl: this.options.bridgeUrl });
    return connectionUrl;
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

  /** 按 localSessionKey 将实时消息排队，确保同一会话严格串行执行。 */
  private async enqueueSessionExecution(message: BridgeInboundMessage): Promise<void> {
    const previous = this.sessionQueues.get(message.localSessionKey) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await this.acquireGlobalExecutionSlot(message.localSessionKey);
        try {
          await this.executeBridgeMessage(message);
        } finally {
          this.releaseGlobalExecutionSlot(message.localSessionKey);
        }
      });
    this.sessionQueues.set(
      message.localSessionKey,
      next.finally(() => {
        if (this.sessionQueues.get(message.localSessionKey) === next) {
          this.sessionQueues.delete(message.localSessionKey);
        }
      }),
    );
    await next;
  }

  /** 获取全局执行槽位，限制不同实时会话同时运行数量。 */
  private async acquireGlobalExecutionSlot(localSessionKey: string): Promise<void> {
    if (this.activeExecutionCount < this.maxConcurrentSessions) {
      this.activeExecutionCount += 1;
      console.info("[realtime-bridge] 已获取实时会话执行槽位", {
        localSessionKey,
        activeExecutionCount: this.activeExecutionCount,
      });
      return;
    }

    console.info("[realtime-bridge] 实时会话执行达到并发上限，进入等待队列", {
      localSessionKey,
      maxConcurrentSessions: this.maxConcurrentSessions,
    });
    await new Promise<void>((resolve) => {
      this.globalExecutionQueue.push(resolve);
    });
    this.activeExecutionCount += 1;
    console.info("[realtime-bridge] 等待中的实时会话已获取执行槽位", {
      localSessionKey,
      activeExecutionCount: this.activeExecutionCount,
    });
  }

  /** 释放全局执行槽位，并唤醒下一个等待的实时会话。 */
  private releaseGlobalExecutionSlot(localSessionKey: string): void {
    this.activeExecutionCount = Math.max(0, this.activeExecutionCount - 1);
    const next = this.globalExecutionQueue.shift();
    next?.();
    console.info("[realtime-bridge] 已释放实时会话执行槽位", {
      localSessionKey,
      activeExecutionCount: this.activeExecutionCount,
      waitingCount: this.globalExecutionQueue.length,
    });
  }

  /** 将桥接消息送入本地 session 执行链路，并按结果回发状态事件。 */
  private async executeBridgeMessage(message: BridgeInboundMessage): Promise<void> {
    try {
      const mapping = await this.resolveSessionMapping(message);
      const result = await this.sendMessageBridge(mapping.localSessionId, {
        content: this.extractUserContent(message.content),
      });
      const replyText = this.extractAssistantReplyText(result);
      if (replyText) {
        this.sendReplyCreated({
          messageId: message.messageId,
          deliveryId: message.deliveryId,
          traceId: message.traceId,
          content: { type: "text", text: replyText },
        });
      }
      await this.options.onBridgeMessage?.(message);
      console.info("[realtime-bridge] 桥接消息已完成本地 session 执行", {
        messageId: message.messageId,
        localSessionId: mapping.localSessionId,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.sendProcessingFailed({
        messageId: message.messageId,
        deliveryId: message.deliveryId,
        traceId: message.traceId,
        reason,
      });
      console.error("[realtime-bridge] 桥接消息执行失败", {
        messageId: message.messageId,
        deliveryId: message.deliveryId,
        reason,
      });
    }
  }

  /** 查询或创建渠道会话映射，避免同一外部会话重复创建本地 session。 */
  private async resolveSessionMapping(message: BridgeInboundMessage) {
    const sessionStore = this.options.sessionStore;
    if (!sessionStore) {
      throw new Error("realtime channel session store is not configured");
    }

    const existing = await sessionStore.get(message.localSessionKey);
    if (existing) {
      console.info("[realtime-bridge] 复用已有实时渠道会话映射", {
        localSessionKey: message.localSessionKey,
        localSessionId: existing.localSessionId,
      });
      return existing;
    }

    const created = await sessionStore.upsert({
      localSessionKey: message.localSessionKey,
      localSessionId: await this.createLocalSessionId(message),
      provider: message.provider,
      externalConversationId: message.externalConversationId,
      conversationType: message.conversationType,
      updatedAt: new Date().toISOString(),
    });
    console.info("[realtime-bridge] 已创建实时渠道会话映射", {
      localSessionKey: message.localSessionKey,
      localSessionId: created.localSessionId,
    });
    return created;
  }

  /** 为没有映射的实时渠道会话生成稳定可读的本地 session id。 */
  private async createLocalSessionId(message: BridgeInboundMessage): Promise<string> {
    if (this.options.createLocalSessionId) {
      const sessionId = await this.options.createLocalSessionId(message);
      console.info("[realtime-bridge] 使用外部策略创建实时会话 session id", {
        localSessionKey: message.localSessionKey,
        sessionId,
      });
      return sessionId;
    }

    const safeKey = message.localSessionKey.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    const sessionId = `realtime-${safeKey}-${Date.now().toString(36)}`;
    console.info("[realtime-bridge] 使用默认策略创建实时会话 session id", {
      localSessionKey: message.localSessionKey,
      sessionId,
    });
    return sessionId;
  }

  /** 提取企业消息中的用户文本，非文本载荷按 JSON 形式进入本地 session。 */
  private extractUserContent(content: RealtimeBridgeContent): string {
    if (typeof content.text === "string") {
      console.info("[realtime-bridge] 已提取实时消息文本内容", { type: content.type });
      return content.text;
    }
    const serialized = JSON.stringify(content);
    console.info("[realtime-bridge] 实时消息非文本内容已序列化", { type: content.type });
    return serialized;
  }

  /** 从本地 session 执行结果中提取助手最终文本，用于回发钉钉中转服务。 */
  private extractAssistantReplyText(result: unknown): string | null {
    const candidates = [
      result,
      (result as { finalText?: unknown } | null)?.finalText,
      (result as { text?: unknown } | null)?.text,
      (result as { content?: unknown } | null)?.content,
      (result as { assistantMessage?: { content?: unknown } } | null)?.assistantMessage?.content,
      (result as { message?: { content?: unknown } } | null)?.message?.content,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        console.info("[realtime-bridge] 已提取本地 session 助手回复文本");
        return candidate;
      }
    }
    console.warn("[realtime-bridge] 本地 session 未返回可回发文本，跳过回复事件");
    return null;
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

/** 默认复用 session:send-message IPC 主链路，避免创建第二套模型执行运行时。 */
async function defaultSessionSendMessage(sessionId: string, input: SessionSendMessageInput): Promise<unknown> {
  const { invokeRegisteredSessionSendMessage } = await import("../ipc/sessions");
  console.info("[realtime-bridge] 调用已注册 session:send-message 主链路", { sessionId });
  return invokeRegisteredSessionSendMessage(sessionId, input);
}
