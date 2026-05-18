import { randomUUID } from "node:crypto";

import { WebSocket } from "ws";

type LoadTestArgs = {
  wsUrl: string;
  connectionToken: string;
  connections: number;
  durationSeconds: number;
  userPrefix: string;
};

/** 解析压测参数，默认模拟 500 条桌面端长连接。 */
function parseArgs(argv: string[]): LoadTestArgs {
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
    connections: Number(values.get("connections") ?? "500"),
    durationSeconds: Number(values.get("duration") ?? "60"),
    userPrefix: values.get("userPrefix") ?? "load-user",
  };
  console.info("[loadtest-ws] 压测参数解析完成", args);
  return args;
}

/** 构建压测连接地址，统一追加桌面端连接 Token。 */
function buildConnectionUrl(args: LoadTestArgs): string {
  if (!args.connectionToken) {
    console.warn("[loadtest-ws] 未配置连接 Token，将使用原始 WebSocket 地址");
    return args.wsUrl;
  }
  const url = new URL(args.wsUrl);
  url.searchParams.set("token", args.connectionToken);
  const connectionUrl = url.toString();
  console.info("[loadtest-ws] 已构建带 Token 的压测连接地址", { wsUrl: args.wsUrl });
  return connectionUrl;
}

/** 发送 JSON 消息，并统计发送次数。 */
function sendJson(socket: WebSocket, payload: Record<string, unknown>, stats: { sent: number }): void {
  if (socket.readyState !== WebSocket.OPEN) {
    console.warn("[loadtest-ws] WebSocket 尚未打开，跳过压测消息发送", { type: payload.type });
    return;
  }
  socket.send(JSON.stringify(payload));
  stats.sent += 1;
  console.info("[loadtest-ws] 压测消息发送成功", { type: payload.type, sent: stats.sent });
}

/** 创建单条压测连接，连接成功后持续发送心跳。 */
function createConnection(index: number, args: LoadTestArgs, stats: { opened: number; closed: number; errors: number; sent: number }): WebSocket {
  const socket = new WebSocket(buildConnectionUrl(args));
  const userId = `${args.userPrefix}-${index}`;
  const deviceId = `load-device-${index}`;
  socket.on("open", () => {
    stats.opened += 1;
    sendJson(socket, {
      type: "desktop.hello",
      userId,
      deviceId,
      connectionId: `load-${randomUUID()}`,
    }, stats);
    console.info("[loadtest-ws] 压测连接已打开", { index, opened: stats.opened });
  });
  socket.on("close", () => {
    stats.closed += 1;
  });
  socket.on("error", (error) => {
    stats.errors += 1;
    console.warn("[loadtest-ws] 压测连接出错", { index, error: error.message });
  });
  const heartbeatTimer = setInterval(() => {
    sendJson(socket, {
      type: "desktop.heartbeat",
      deviceId,
      sentAt: new Date().toISOString(),
    }, stats);
  }, 10_000);
  heartbeatTimer.unref();
  socket.on("close", () => clearInterval(heartbeatTimer));
  return socket;
}

/** 执行 WebSocket 长连接压测，并在到期后输出汇总。 */
async function runLoadTest(args: LoadTestArgs): Promise<void> {
  const stats = { opened: 0, closed: 0, errors: 0, sent: 0 };
  const sockets: WebSocket[] = [];
  console.info("[loadtest-ws] 开始创建 WebSocket 压测连接", {
    connections: args.connections,
    durationSeconds: args.durationSeconds,
  });
  for (let index = 0; index < args.connections; index += 1) {
    sockets.push(createConnection(index, args, stats));
  }

  await new Promise((resolve) => setTimeout(resolve, args.durationSeconds * 1000));
  for (const socket of sockets) {
    socket.close();
  }
  console.info("[loadtest-ws] WebSocket 压测完成", {
    requestedConnections: args.connections,
    opened: stats.opened,
    closed: stats.closed,
    errors: stats.errors,
    sent: stats.sent,
  });
}

runLoadTest(parseArgs(process.argv.slice(2))).catch((error) => {
  console.error("[loadtest-ws] WebSocket 压测执行失败", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
