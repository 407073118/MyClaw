import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

import { DesktopConnectionRegistry } from "./desktop-connection.registry";

type DesktopWsMessage =
  | { type: "desktop.hello"; userId: string; deviceId: string; connectionId?: string }
  | { type: "desktop.heartbeat"; deviceId: string }
  | { type: "desktop.ack"; deliveryId: string; messageId: string }
  | { type: "desktop.reply_created"; deliveryId: string; messageId: string; content: unknown }
  | { type: "desktop.processing_failed"; deliveryId: string; messageId: string; reason: string };

@Injectable()
export class DesktopWsGateway implements OnModuleInit, OnModuleDestroy {
  private webSocketServer?: WebSocketServer;

  constructor(
    @Inject(HttpAdapterHost) private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(DesktopConnectionRegistry) private readonly registry: DesktopConnectionRegistry,
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
    webSocket.on("message", async (rawMessage) => {
      const message = this.parseMessage(rawMessage.toString());
      if (!message) {
        return;
      }

      if (message.type === "desktop.hello") {
        connectionId = message.connectionId ?? randomUUID();
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

      console.info("[desktop-ws] 收到桌面端业务事件", { type: message.type });
    });

    webSocket.on("close", () => {
      if (connectionId) {
        void this.registry.disconnect(connectionId);
      }
      console.warn("[desktop-ws] 桌面端 WebSocket 已关闭", { connectionId });
    });
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
}
