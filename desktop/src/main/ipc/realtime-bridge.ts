import { ipcMain } from "electron";

import type { RuntimeContext } from "../services/runtime-context";
import { RealtimeBridgeClient, type RealtimeBridgeStatus } from "../services/realtime-bridge-client";

let realtimeBridgeClient: RealtimeBridgeClient | null = null;

/** 注册实时桥接 IPC 控制通道。 */
export function registerRealtimeBridgeHandlers(ctx: RuntimeContext): void {
  ipcMain.handle("realtime-bridge:get-status", async (): Promise<RealtimeBridgeStatus | { connected: false }> => {
    console.info("[realtime-bridge-ipc] 查询实时桥接状态");
    return realtimeBridgeClient?.getStatus() ?? { connected: false };
  });

  ipcMain.handle("realtime-bridge:connect", async (_event, input?: { bridgeUrl?: string; userId?: string; deviceId?: string }) => {
    console.info("[realtime-bridge-ipc] 开始连接实时桥接服务");
    const bridgeUrl = input?.bridgeUrl ?? process.env.REALTIME_BRIDGE_URL ?? "ws://localhost:4300/v1/desktop/ws";
    const userId = input?.userId ?? process.env.MYCLAW_USER_ID ?? "local-user";
    const deviceId = input?.deviceId ?? process.env.MYCLAW_DEVICE_ID ?? ctx.runtime.myClawRootPath;
    realtimeBridgeClient = new RealtimeBridgeClient({ bridgeUrl, userId, deviceId });
    realtimeBridgeClient.connect();
    console.info("[realtime-bridge-ipc] 实时桥接连接命令已执行", { bridgeUrl, userId, deviceId });
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
