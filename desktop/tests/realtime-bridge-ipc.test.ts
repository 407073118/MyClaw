import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveRealtimeChannelSessionStorePath } from "../src/main/services/realtime-channel-session-store";

const mocks = vi.hoisted(() => ({
  saveSession: vi.fn(async () => undefined),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock("../src/main/services/state-persistence", () => ({
  saveSession: mocks.saveSession,
}));

import { buildRealtimeBridgeClientOptions } from "../src/main/ipc/realtime-bridge";

const createBridgeMessage = () => ({
  type: "bridge.message.received" as const,
  messageId: "message-1",
  deliveryId: "delivery-1",
  provider: "dingtalk" as const,
  externalMessageId: "external-1",
  senderStaffId: "staff-1",
  externalConversationId: "cid-1",
  conversationType: "direct" as const,
  myclawUserId: "user-1",
  desktopDeviceId: "device-1",
  localSessionKey: "dingtalk:direct:cid-1:user:user-1",
  content: { type: "text", text: "你好" },
  traceId: "trace-1",
  createdAt: "2026-05-18T00:00:00.000Z",
});

describe("realtime bridge IPC", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    mocks.saveSession.mockClear();
    delete process.env.REALTIME_BRIDGE_CONNECTION_TOKEN;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates the bridge client with a persistent channel session store", async () => {
    const myClawDir = mkdtempSync(join(tmpdir(), "myclaw-realtime-ipc-"));
    tempDirs.push(myClawDir);
    const ctx = {
      runtime: {
        myClawRootPath: "device-from-root",
        paths: { myClawDir },
      },
    };

    const options = buildRealtimeBridgeClientOptions(ctx as any, {
      bridgeUrl: "ws://bridge.example/v1/desktop/ws",
      userId: "user-1",
      deviceId: "device-1",
    });

    await options.sessionStore?.upsert({
      localSessionKey: "dingtalk:direct:cid-1:user:user-1",
      localSessionId: "local-session-1",
      provider: "dingtalk",
      externalConversationId: "cid-1",
      conversationType: "direct",
      updatedAt: "2026-05-18T00:00:00.000Z",
    });

    expect(options).toMatchObject({
      bridgeUrl: "ws://bridge.example/v1/desktop/ws",
      userId: "user-1",
      deviceId: "device-1",
    });
    expect(options.sessionStore).toBeDefined();
    expect(existsSync(resolveRealtimeChannelSessionStorePath(myClawDir))).toBe(true);
  });

  it("creates a real local chat session for a new realtime channel mapping", async () => {
    const myClawDir = mkdtempSync(join(tmpdir(), "myclaw-realtime-ipc-"));
    tempDirs.push(myClawDir);
    const ctx = {
      runtime: {
        myClawRootPath: "device-from-root",
        paths: { myClawDir },
      },
      state: {
        sessions: [],
        getDefaultModelProfileId: () => "model-1",
      },
    };
    const options = buildRealtimeBridgeClientOptions(ctx as any, {
      bridgeUrl: "ws://bridge.example/v1/desktop/ws",
      userId: "user-1",
      deviceId: "device-1",
    });

    const localSessionId = await options.createLocalSessionId?.(createBridgeMessage());

    expect(localSessionId).toBe("realtime-dingtalk-direct-cid-1-user-user-1");
    expect(ctx.state.sessions).toHaveLength(1);
    expect(ctx.state.sessions[0]).toMatchObject({
      id: "realtime-dingtalk-direct-cid-1-user-user-1",
      title: "钉钉 direct cid-1",
      modelProfileId: "model-1",
      attachedDirectory: null,
      messages: [],
    });
    expect(mocks.saveSession).toHaveBeenCalledWith(ctx.runtime.paths, ctx.state.sessions[0]);
  });

  it("passes configured bridge connection token into the client options", () => {
    process.env.REALTIME_BRIDGE_CONNECTION_TOKEN = "desktop-token";
    const ctx = {
      runtime: {
        myClawRootPath: "device-from-root",
        paths: { myClawDir: "C:/tmp/myclaw" },
      },
      state: {
        sessions: [],
        getDefaultModelProfileId: () => "model-1",
      },
    };

    const options = buildRealtimeBridgeClientOptions(ctx as any);

    expect(options.connectionToken).toBe("desktop-token");
  });
});
