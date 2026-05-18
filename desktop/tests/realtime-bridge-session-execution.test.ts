import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { BRIDGE_INBOUND_MESSAGE_TYPE } from "../shared/contracts/realtime-bridge";
import { RealtimeBridgeClient } from "../src/main/services/realtime-bridge-client";
import { RealtimeChannelSessionStore } from "../src/main/services/realtime-channel-session-store";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1 as const;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  listeners = new Map<string, Array<(data?: any) => void>>();

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  /** 测试替身注册 WebSocket 事件监听器。 */
  on(event: string, listener: (data?: any) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  /** 测试替身记录 WebSocket 发送内容。 */
  send(data: string): void {
    this.sent.push(data);
  }

  /** 测试替身触发 WebSocket 关闭。 */
  close(): void {
    this.readyState = 3 as const;
  }

  /** 测试替身主动触发事件。 */
  emit(event: string, data?: any): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(data);
    }
  }
}

const createBridgeMessage = (overrides: Partial<ReturnType<typeof baseBridgeMessage>> = {}) => ({
  ...baseBridgeMessage(),
  ...overrides,
});

function baseBridgeMessage() {
  return {
    type: BRIDGE_INBOUND_MESSAGE_TYPE,
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
    content: { type: "text" as const, text: "你好" },
    traceId: "trace-1",
    createdAt: "2026-05-18T00:00:00.000Z",
  };
}

function createStore() {
  const dir = mkdtempSync(join(tmpdir(), "myclaw-realtime-session-"));
  return {
    dir,
    store: new RealtimeChannelSessionStore(join(dir, "realtime-channel-sessions.json")),
  };
}

function createClient(input: {
  store: RealtimeChannelSessionStore;
  sendMessage: (sessionId: string, payload: { content: string }) => Promise<unknown>;
  createLocalSessionId?: () => string;
}) {
  MockWebSocket.instances = [];
  const client = new RealtimeBridgeClient({
    bridgeUrl: "ws://localhost:4300/v1/desktop/ws",
    userId: "user-1",
    deviceId: "device-1",
    WebSocketCtor: MockWebSocket as any,
    sessionStore: input.store,
    sendMessage: input.sendMessage,
    createLocalSessionId: input.createLocalSessionId,
  });
  client.connect();
  MockWebSocket.instances[0].emit("open");
  return { client, socket: MockWebSocket.instances[0] };
}

function sentMessages(socket: MockWebSocket) {
  return socket.sent.map((item) => JSON.parse(item));
}

describe("RealtimeBridgeClient session execution", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates a channel session mapping when no mapping exists", async () => {
    const { dir, store } = createStore();
    tempDirs.push(dir);
    const sendMessage = vi.fn(async () => ({ finalText: "本地回复" }));
    const { client } = createClient({
      store,
      sendMessage,
      createLocalSessionId: () => "local-session-new",
    });

    await client.handleBridgeMessage(createBridgeMessage());

    await expect(store.get("dingtalk:direct:cid-1:user:user-1")).resolves.toMatchObject({
      localSessionKey: "dingtalk:direct:cid-1:user:user-1",
      localSessionId: "local-session-new",
      provider: "dingtalk",
      externalConversationId: "cid-1",
      conversationType: "direct",
    });
    expect(sendMessage).toHaveBeenCalledWith("local-session-new", { content: "你好" });
  });

  it("reuses an existing channel session mapping", async () => {
    const { dir, store } = createStore();
    tempDirs.push(dir);
    await store.upsert({
      localSessionKey: "dingtalk:direct:cid-1:user:user-1",
      localSessionId: "local-session-existing",
      provider: "dingtalk",
      externalConversationId: "cid-1",
      conversationType: "direct",
      updatedAt: "2026-05-18T00:00:00.000Z",
    });
    const sendMessage = vi.fn(async () => ({ finalText: "继续回复" }));
    const { client } = createClient({ store, sendMessage });

    await client.handleBridgeMessage(createBridgeMessage());

    expect(sendMessage).toHaveBeenCalledWith("local-session-existing", { content: "你好" });
  });

  it("sends desktop.reply_created when assistant returns final text", async () => {
    const { dir, store } = createStore();
    tempDirs.push(dir);
    const sendMessage = vi.fn(async () => ({ assistantMessage: { content: "企业消息已处理" } }));
    const { client, socket } = createClient({
      store,
      sendMessage,
      createLocalSessionId: () => "local-session-reply",
    });

    await client.handleBridgeMessage(createBridgeMessage());

    expect(sentMessages(socket).at(-1)).toMatchObject({
      type: "desktop.reply_created",
      messageId: "message-1",
      deliveryId: "delivery-1",
      content: { type: "text", text: "企业消息已处理" },
    });
  });

  it("sends desktop.processing_failed when local execution throws", async () => {
    const { dir, store } = createStore();
    tempDirs.push(dir);
    const sendMessage = vi.fn(async () => {
      throw new Error("本地执行失败");
    });
    const { client, socket } = createClient({
      store,
      sendMessage,
      createLocalSessionId: () => "local-session-error",
    });

    await client.handleBridgeMessage(createBridgeMessage());

    expect(sentMessages(socket).at(-1)).toMatchObject({
      type: "desktop.processing_failed",
      messageId: "message-1",
      deliveryId: "delivery-1",
      reason: "本地执行失败",
    });
  });
});
