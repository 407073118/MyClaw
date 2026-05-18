import { afterEach, describe, expect, it, vi } from "vitest";

import { AuditService } from "../../src/modules/audit/audit.service";
import { DeliveryService } from "../../src/modules/delivery/delivery.service";
import { DesktopWsGateway } from "../../src/modules/desktop-ws/desktop-ws.gateway";
import { OutboundService } from "../../src/modules/outbound/outbound.service";

function createGateway(services: Map<unknown, unknown>, registry: unknown = {}): DesktopWsGateway {
  const moduleRef = {
    get: (token: unknown) => services.get(token),
  };
  return new DesktopWsGateway({} as any, registry as any, moduleRef as any);
}

describe("DesktopWsGateway reply handling", () => {
  afterEach(() => {
    delete process.env.REALTIME_BRIDGE_DESKTOP_TOKEN;
  });

  it("rejects desktop websocket upgrades when token is missing or mismatched", () => {
    process.env.REALTIME_BRIDGE_DESKTOP_TOKEN = "desktop-token";
    const gateway = createGateway(new Map<unknown, unknown>());

    expect((gateway as any).isDesktopPath("/v1/desktop/ws")).toBe(false);
    expect((gateway as any).isDesktopPath("/v1/desktop/ws?token=bad-token")).toBe(false);
  });

  it("accepts desktop websocket upgrades when token matches", () => {
    process.env.REALTIME_BRIDGE_DESKTOP_TOKEN = "desktop-token";
    const gateway = createGateway(new Map<unknown, unknown>());

    expect((gateway as any).isDesktopPath("/v1/desktop/ws?token=desktop-token")).toBe(true);
  });

  it("recovers queued deliveries after desktop hello registers a device", async () => {
    const registry = {
      register: vi.fn(async () => undefined),
    };
    const deliveryService = {
      recoverQueuedMessagesForDevice: vi.fn(async () => 1),
    };
    const gateway = createGateway(new Map<unknown, unknown>([
      [DeliveryService, deliveryService],
    ]), registry);

    await (gateway as any).handleSocketMessage(JSON.stringify({
      type: "desktop.hello",
      userId: "user-1",
      deviceId: "device-1",
      connectionId: "connection-1",
    }), { send: vi.fn() }, vi.fn());

    expect(registry.register).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: "connection-1",
      userId: "user-1",
      deviceId: "device-1",
    }));
    expect(deliveryService.recoverQueuedMessagesForDevice).toHaveBeenCalledWith("user-1", "device-1");
  });

  it("rejects business events when delivery does not belong to the active connection", async () => {
    const registry = {
      getConnectionById: vi.fn(() => ({
        connectionId: "connection-1",
        userId: "user-2",
        deviceId: "device-2",
      })),
    };
    const deliveryService = {
      getDeliveryEventContext: vi.fn(async () => ({
        ok: true,
        messageId: "message-1",
        desktopDeviceId: "device-1",
      })),
      handleAck: vi.fn(async () => undefined),
    };
    const auditService = {
      recordDeliveryAcked: vi.fn(async () => undefined),
    };
    const gateway = createGateway(new Map<unknown, unknown>([
      [DeliveryService, deliveryService],
      [AuditService, auditService],
    ]), registry);

    await (gateway as any).handleSocketMessage(JSON.stringify({
      type: "desktop.ack",
      messageId: "message-1",
      deliveryId: "delivery-1",
    }), { send: vi.fn() }, vi.fn(), () => "connection-1");

    expect(deliveryService.getDeliveryEventContext).toHaveBeenCalledWith("delivery-1");
    expect(deliveryService.handleAck).not.toHaveBeenCalled();
    expect(auditService.recordDeliveryAcked).not.toHaveBeenCalled();
  });

  it("records outbound_sent only after outbound relay success", async () => {
    const outboundService = {
      handleDesktopReplyCreated: vi.fn(async () => ({ ok: true, outboundMessageId: "outbound-1" })),
    };
    const auditService = {
      recordReplyCreated: vi.fn(async () => undefined),
      recordOutboundSent: vi.fn(async () => undefined),
      recordFailure: vi.fn(async () => undefined),
    };
    const deliveryService = {
      markCompleted: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };
    const gateway = createGateway(new Map<unknown, unknown>([
      [OutboundService, outboundService],
      [AuditService, auditService],
      [DeliveryService, deliveryService],
    ]));

    await (gateway as any).handleReplyCreatedEvent({
      type: "desktop.reply_created",
      messageId: "message-1",
      deliveryId: "delivery-1",
      content: { type: "text", text: "收到" },
    });

    expect(auditService.recordOutboundSent).toHaveBeenCalledWith("message-1", { deliveryId: "delivery-1" });
    expect(deliveryService.markCompleted).toHaveBeenCalledWith("message-1");
    expect(deliveryService.markFailed).not.toHaveBeenCalled();
  });

  it("records failure instead of outbound_sent after outbound relay failure", async () => {
    const outboundService = {
      handleDesktopReplyCreated: vi.fn(async () => ({
        ok: false,
        outboundMessageId: "outbound-1",
        error: "relay down",
      })),
    };
    const auditService = {
      recordReplyCreated: vi.fn(async () => undefined),
      recordOutboundSent: vi.fn(async () => undefined),
      recordFailure: vi.fn(async () => undefined),
    };
    const deliveryService = {
      markCompleted: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };
    const gateway = createGateway(new Map<unknown, unknown>([
      [OutboundService, outboundService],
      [AuditService, auditService],
      [DeliveryService, deliveryService],
    ]));

    await (gateway as any).handleReplyCreatedEvent({
      type: "desktop.reply_created",
      messageId: "message-1",
      deliveryId: "delivery-1",
      content: { type: "text", text: "收到" },
    });

    expect(auditService.recordOutboundSent).not.toHaveBeenCalled();
    expect(auditService.recordFailure).toHaveBeenCalledWith("message-1", {
      deliveryId: "delivery-1",
      reason: "relay down",
    });
    expect(deliveryService.markFailed).toHaveBeenCalledWith("message-1", "relay down");
    expect(deliveryService.markCompleted).not.toHaveBeenCalled();
  });
});
