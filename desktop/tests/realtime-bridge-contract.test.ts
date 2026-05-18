import { describe, expect, it } from "vitest";

import {
  BRIDGE_INBOUND_MESSAGE_TYPE,
  DESKTOP_ACK_MESSAGE_TYPE,
  DESKTOP_HELLO_MESSAGE_TYPE,
  type BridgeInboundMessage,
} from "../shared/contracts/realtime-bridge";

describe("realtime bridge desktop contract", () => {
  it("exports event constants and BridgeInboundMessage type", () => {
    const message: BridgeInboundMessage = {
      type: BRIDGE_INBOUND_MESSAGE_TYPE,
      messageId: "message-1",
      deliveryId: "delivery-1",
      provider: "dingtalk",
      externalMessageId: "external-1",
      senderStaffId: "staff-1",
      externalConversationId: "cid-1",
      conversationType: "direct",
      myclawUserId: "user-1",
      desktopDeviceId: "device-1",
      localSessionKey: "dingtalk:direct:cid-1:user:user-1",
      content: { type: "text", text: "你好" },
      traceId: "trace-1",
      createdAt: "2026-05-18T00:00:00.000Z",
    };

    expect(message.type).toBe("bridge.message.received");
    expect(DESKTOP_HELLO_MESSAGE_TYPE).toBe("desktop.hello");
    expect(DESKTOP_ACK_MESSAGE_TYPE).toBe("desktop.ack");
  });
});
