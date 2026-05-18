import { randomUUID } from "node:crypto";

import { WebSocket } from "ws";

type DesktopArgs = {
  wsUrl: string;
  connectionToken: string;
  userId: string;
  deviceId: string;
  replyText: string;
};

/** 解析命令行参数，允许覆盖用户、设备和回复文本。 */
function parseArgs(argv: string[]): DesktopArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith("--")) {
      values.set(item.slice(2), argv[index + 1] ?? "");
      index += 1;
    }
  }
  const args = {
    wsUrl: values.get("wsUrl") ?? process.env.REALTIME_BRIDGE_WS_URL ?? "ws://localhost:4300/v1/desktop/ws",
    connectionToken: values.get("connectionToken") ?? process.env.REALTIME_BRIDGE_DESKTOP_TOKEN ?? "",
    userId: values.get("userId") ?? "user-1",
    deviceId: values.get("deviceId") ?? "device-1",
    replyText: values.get("replyText") ?? "已收到测试消息",
  };
  console.info("[mock-desktop] 命令行参数解析完成", {
    wsUrl: args.wsUrl,
    userId: args.userId,
    deviceId: args.deviceId,
  });
  return args;
}

/** 构建携带连接 Token 的 WebSocket 地址，避免模拟客户端绕过服务端鉴权。 */
function buildConnectionUrl(args: DesktopArgs): string {
  if (!args.connectionToken) {
    console.warn("[mock-desktop] 未配置连接 Token，将使用原始 WebSocket 地址");
    return args.wsUrl;
  }
  const url = new URL(args.wsUrl);
  url.searchParams.set("token", args.connectionToken);
  const connectionUrl = url.toString();
  console.info("[mock-desktop] 已构建带 Token 的 WebSocket 地址", { wsUrl: args.wsUrl });
  return connectionUrl;
}

/** 安全发送 JSON 消息，并输出中文结构化日志。 */
function sendJson(socket: WebSocket, payload: Record<string, unknown>): void {
  socket.send(JSON.stringify(payload));
  console.info("[mock-desktop] WebSocket 消息已发送", { type: payload.type });
}

/** 处理桥接下发消息，按真实桌面端顺序回 ACK、processing 和 reply。 */
function handleBridgeMessage(socket: WebSocket, args: DesktopArgs, rawMessage: string): void {
  const message = JSON.parse(rawMessage) as {
    type?: string;
    messageId?: string;
    deliveryId?: string;
    content?: unknown;
  };
  console.info("[mock-desktop] 收到桥接服务消息", { type: message.type, messageId: message.messageId });
  if (message.type !== "bridge.message.received" || !message.messageId || !message.deliveryId) {
    return;
  }

  sendJson(socket, {
    type: "desktop.ack",
    messageId: message.messageId,
    deliveryId: message.deliveryId,
  });
  sendJson(socket, {
    type: "desktop.processing_started",
    messageId: message.messageId,
    deliveryId: message.deliveryId,
  });
  sendJson(socket, {
    type: "desktop.reply_created",
    messageId: message.messageId,
    deliveryId: message.deliveryId,
    content: { type: "text", text: args.replyText },
  });
}

/** 启动桌面端模拟客户端，持续保持 WebSocket 在线。 */
function startMockDesktop(args: DesktopArgs): void {
  const connectionUrl = buildConnectionUrl(args);
  console.info("[mock-desktop] 开始连接实时桥接 WebSocket", { wsUrl: args.wsUrl });
  const socket = new WebSocket(connectionUrl);
  socket.on("open", () => {
    sendJson(socket, {
      type: "desktop.hello",
      userId: args.userId,
      deviceId: args.deviceId,
      connectionId: `mock-${randomUUID()}`,
    });
    setInterval(() => {
      sendJson(socket, {
        type: "desktop.heartbeat",
        deviceId: args.deviceId,
        sentAt: new Date().toISOString(),
      });
    }, 30_000).unref();
    console.info("[mock-desktop] 实时桥接 WebSocket 已连接");
  });
  socket.on("message", (raw) => handleBridgeMessage(socket, args, raw.toString()));
  socket.on("close", () => {
    console.warn("[mock-desktop] 实时桥接 WebSocket 已关闭");
  });
  socket.on("error", (error) => {
    console.error("[mock-desktop] 实时桥接 WebSocket 出错", { error: error.message });
  });
}

startMockDesktop(parseArgs(process.argv.slice(2)));
