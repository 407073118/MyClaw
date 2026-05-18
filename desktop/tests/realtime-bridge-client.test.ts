import { describe, expect, it, vi } from "vitest";

import { BRIDGE_INBOUND_MESSAGE_TYPE } from "../shared/contracts/realtime-bridge";
import { RealtimeBridgeClient } from "../src/main/services/realtime-bridge-client";

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

const createBridgeMessage = () => ({
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
  content: { type: "text", text: "你好" },
  traceId: "trace-1",
  createdAt: "2026-05-18T00:00:00.000Z",
});

describe("RealtimeBridgeClient", () => {
  it("sends desktop.hello after open", () => {
    MockWebSocket.instances = [];
    const client = new RealtimeBridgeClient({
      bridgeUrl: "ws://localhost:4300/v1/desktop/ws",
      userId: "user-1",
      deviceId: "device-1",
      WebSocketCtor: MockWebSocket as any,
    });

    client.connect();
    MockWebSocket.instances[0].emit("open");

    expect(JSON.parse(MockWebSocket.instances[0].sent[0])).toMatchObject({
      type: "desktop.hello",
      userId: "user-1",
      deviceId: "device-1",
    });
  });

  it("sends desktop.heartbeat", () => {
    MockWebSocket.instances = [];
    const client = new RealtimeBridgeClient({
      bridgeUrl: "ws://localhost:4300/v1/desktop/ws",
      userId: "user-1",
      deviceId: "device-1",
      WebSocketCtor: MockWebSocket as any,
    });

    client.connect();
    MockWebSocket.instances[0].emit("open");
    client.sendHeartbeat();

    expect(JSON.parse(MockWebSocket.instances[0].sent.at(-1) ?? "{}")).toMatchObject({
      type: "desktop.heartbeat",
      deviceId: "device-1",
    });
  });

  it("ACKs bridge.message.received once and ignores duplicate deliveryId", async () => {
    MockWebSocket.instances = [];
    const onBridgeMessage = vi.fn(async () => undefined);
    const client = new RealtimeBridgeClient({
      bridgeUrl: "ws://localhost:4300/v1/desktop/ws",
      userId: "user-1",
      deviceId: "device-1",
      WebSocketCtor: MockWebSocket as any,
      onBridgeMessage,
    });
    client.connect();
    MockWebSocket.instances[0].emit("open");

    await client.handleBridgeMessage(createBridgeMessage());
    await client.handleBridgeMessage(createBridgeMessage());

    const ackMessages = MockWebSocket.instances[0].sent
      .map((item) => JSON.parse(item))
      .filter((item) => item.type === "desktop.ack");
    expect(ackMessages).toHaveLength(1);
    expect(ackMessages[0]).toMatchObject({ deliveryId: "delivery-1", messageId: "message-1" });
    expect(onBridgeMessage).toHaveBeenCalledTimes(1);
  });
});
