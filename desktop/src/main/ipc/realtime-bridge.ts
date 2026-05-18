import { ipcMain } from "electron";
import { SESSION_RUNTIME_VERSION, type ChatSession } from "@shared/contracts";

import type { RuntimeContext } from "../services/runtime-context";
import { RealtimeBridgeClient, type RealtimeBridgeClientOptions, type RealtimeBridgeStatus } from "../services/realtime-bridge-client";
import { RealtimeChannelSessionStore, resolveRealtimeChannelSessionStorePath } from "../services/realtime-channel-session-store";
import { saveSession } from "../services/state-persistence";
import type { BridgeInboundMessage } from "../../../shared/contracts/realtime-bridge";

let realtimeBridgeClient: RealtimeBridgeClient | null = null;

/** 构建实时桥接客户端配置，确保生产连接路径注入本地渠道会话映射存储。 */
export function buildRealtimeBridgeClientOptions(
  ctx: RuntimeContext,
  input?: { bridgeUrl?: string; userId?: string; deviceId?: string; connectionToken?: string },
): RealtimeBridgeClientOptions {
  const bridgeUrl = input?.bridgeUrl ?? process.env.REALTIME_BRIDGE_URL ?? "ws://localhost:4300/v1/desktop/ws";
  const userId = input?.userId ?? process.env.MYCLAW_USER_ID ?? "local-user";
  const deviceId = input?.deviceId ?? process.env.MYCLAW_DEVICE_ID ?? ctx.runtime.myClawRootPath;
  const connectionToken = input?.connectionToken ?? process.env.REALTIME_BRIDGE_CONNECTION_TOKEN;
  const storePath = resolveRealtimeChannelSessionStorePath(ctx.runtime.paths.myClawDir);
  console.info("[realtime-bridge-ipc] 已构建实时桥接客户端配置", {
    bridgeUrl,
    userId,
    deviceId,
    storePath,
  });
  return {
    bridgeUrl,
    userId,
    deviceId,
    connectionToken,
    sessionStore: new RealtimeChannelSessionStore(storePath),
    createLocalSessionId: (message) => createRealtimeLocalSession(ctx, message),
  };
}

/** 为新的实时渠道会话创建真实本地 ChatSession，避免只写映射导致 send-message 找不到会话。 */
async function createRealtimeLocalSession(ctx: RuntimeContext, message: BridgeInboundMessage): Promise<string> {
  const sessionId = buildRealtimeLocalSessionId(message.localSessionKey);
  const existing = ctx.state.sessions.find((session) => session.id === sessionId);
  if (existing) {
    console.info("[realtime-bridge-ipc] 复用已存在的实时渠道本地会话", {
      localSessionKey: message.localSessionKey,
      sessionId,
    });
    return sessionId;
  }

  const now = new Date().toISOString();
  const session: ChatSession = {
    id: sessionId,
    title: buildRealtimeLocalSessionTitle(message),
    modelProfileId: ctx.state.getDefaultModelProfileId() ?? "",
    attachedDirectory: null,
    createdAt: now,
    runtimeVersion: SESSION_RUNTIME_VERSION,
    messages: [],
  };
  ctx.state.sessions.push(session);
  await saveSession(ctx.runtime.paths, session);
  console.info("[realtime-bridge-ipc] 已创建实时渠道本地会话", {
    localSessionKey: message.localSessionKey,
    sessionId,
    title: session.title,
  });
  return sessionId;
}

/** 根据渠道会话键生成稳定本地 session id，确保重启后映射仍可读。 */
function buildRealtimeLocalSessionId(localSessionKey: string): string {
  const safeKey = localSessionKey.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  const sessionId = `realtime-${safeKey}`;
  console.info("[realtime-bridge-ipc] 已生成实时渠道本地会话 id", { localSessionKey, sessionId });
  return sessionId;
}

/** 生成实时渠道会话标题，优先使用外部群名，缺省时保留渠道来源信息。 */
function buildRealtimeLocalSessionTitle(message: BridgeInboundMessage): string {
  const title = message.conversationTitle?.trim()
    || `钉钉 ${message.conversationType} ${message.externalConversationId}`;
  console.info("[realtime-bridge-ipc] 已生成实时渠道本地会话标题", {
    localSessionKey: message.localSessionKey,
    title,
  });
  return title;
}

/** 注册实时桥接 IPC 控制通道。 */
export function registerRealtimeBridgeHandlers(ctx: RuntimeContext): void {
  ipcMain.handle("realtime-bridge:get-status", async (): Promise<RealtimeBridgeStatus | { connected: false }> => {
    console.info("[realtime-bridge-ipc] 查询实时桥接状态");
    return realtimeBridgeClient?.getStatus() ?? { connected: false };
  });

  ipcMain.handle("realtime-bridge:connect", async (_event, input?: { bridgeUrl?: string; userId?: string; deviceId?: string; connectionToken?: string }) => {
    console.info("[realtime-bridge-ipc] 开始连接实时桥接服务");
    const clientOptions = buildRealtimeBridgeClientOptions(ctx, input);
    realtimeBridgeClient = new RealtimeBridgeClient(clientOptions);
    realtimeBridgeClient.connect();
    console.info("[realtime-bridge-ipc] 实时桥接连接命令已执行", {
      bridgeUrl: clientOptions.bridgeUrl,
      userId: clientOptions.userId,
      deviceId: clientOptions.deviceId,
    });
    return realtimeBridgeClient.getStatus();
  });

  ipcMain.handle("realtime-bridge:disconnect", async () => {
    console.info("[realtime-bridge-ipc] 开始断开实时桥接服务");
    realtimeBridgeClient?.disconnect();
    realtimeBridgeClient = null;
    console.info("[realtime-bridge-ipc] 实时桥接断开命令已执行");
    return { connected: false };
  });
}
