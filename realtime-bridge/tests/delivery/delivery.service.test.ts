import { describe, expect, it, vi } from "vitest";

import { DeliveryService } from "../../src/modules/delivery/delivery.service";
import { LocalSessionLockService } from "../../src/modules/delivery/local-session-lock.service";
import type { RouteResult } from "../../src/modules/routing/routing.service";

class FakePrisma {
  inboundMessages = new Map<string, any>();
  deliveryAttempts = new Map<string, any>();
  updateAttemptCount = 0;

  inboundMessage = {
    update: async ({ where, data }: any) => {
      const existing = this.inboundMessages.get(where.id) ?? { id: where.id };
      const updated = { ...existing, ...data };
      this.inboundMessages.set(where.id, updated);
      return updated;
    },
    findMany: async ({ where }: any) => Array.from(this.inboundMessages.values()).filter((row) => {
      const deviceMatches = row.desktopDeviceId === "device-1" || row.desktopDeviceId == null;
      return row.status === where.status && row.myclawUserId === where.myclawUserId && deviceMatches;
    }),
  };

  deliveryAttempt = {
    create: async ({ data }: any) => {
      this.deliveryAttempts.set(data.deliveryId, { ...data });
      return this.deliveryAttempts.get(data.deliveryId);
    },
    update: async ({ where, data }: any) => {
      this.updateAttemptCount += 1;
      const existing = this.deliveryAttempts.get(where.deliveryId);
      const updated = { ...existing, ...data };
      this.deliveryAttempts.set(where.deliveryId, updated);
      return updated;
    },
    findUnique: async ({ where }: any) => this.deliveryAttempts.get(where.deliveryId) ?? null,
  };
}

const createMessage = () => ({
  id: "message-1",
  provider: "dingtalk" as const,
  externalMessageId: "external-1",
  senderStaffId: "staff-1",
  externalConversationId: "cid-1",
  conversationType: "direct" as const,
  content: { type: "text", text: "你好" },
  traceId: "trace-1",
});

const seedInboundMessage = (prisma: FakePrisma, message = createMessage()) => {
  prisma.inboundMessages.set(message.id, {
    ...message,
    contentJson: message.content,
    status: "received",
  });
};

const createRoute = (): RouteResult => ({
  ok: true,
  myclawUserId: "user-1",
  desktopDeviceId: "device-1",
  localSessionKey: "dingtalk:direct:cid-1:user:user-1",
  routeSource: "sender-binding",
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 等待异步重试链路完成，避免事件循环调度导致断言抖动。
const waitUntil = async (assertion: () => void, timeoutMs = 100): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch {
      await wait(2);
    }
  }
  assertion();
};

describe("DeliveryService", () => {
  it("moves received messages to routed and delivered after WebSocket send", async () => {
    const prisma = new FakePrisma();
    const registry = { sendToDevice: vi.fn(() => true) };
    const service = new DeliveryService(prisma as any, registry as any, new LocalSessionLockService(), {
      ackTimeoutMs: 100,
    });

    const result = await service.deliverInboundMessage(createMessage(), createRoute());

    expect(result.status).toBe("delivered");
    expect(prisma.inboundMessages.get("message-1").status).toBe("delivered");
    expect(registry.sendToDevice).toHaveBeenCalledWith("device-1", expect.objectContaining({
      type: "bridge.message.received",
      messageId: "message-1",
    }));
  });

  it("moves delivered message to processing after desktop.processing_started", async () => {
    const prisma = new FakePrisma();
    const service = new DeliveryService(prisma as any, { sendToDevice: vi.fn() } as any, new LocalSessionLockService());

    await service.markProcessingStarted("message-1");

    expect(prisma.inboundMessages.get("message-1").status).toBe("processing");
  });

  it("moves processing message to completed after outbound success", async () => {
    const prisma = new FakePrisma();
    const service = new DeliveryService(prisma as any, { sendToDevice: vi.fn() } as any, new LocalSessionLockService());

    await service.markCompleted("message-1");

    expect(prisma.inboundMessages.get("message-1").status).toBe("completed");
  });

  it("queues message when route is offline", async () => {
    const prisma = new FakePrisma();
    const service = new DeliveryService(prisma as any, { sendToDevice: vi.fn() } as any, new LocalSessionLockService());

    const result = await service.deliverInboundMessage(createMessage(), {
      ok: false,
      reason: "device_offline",
    });

    expect(result.status).toBe("queued");
    expect(prisma.inboundMessages.get("message-1").status).toBe("queued");
  });

  it("recovers route-offline queued message when desktop device reconnects", async () => {
    const prisma = new FakePrisma();
    const registry = { sendToDevice: vi.fn(() => true) };
    const service = new DeliveryService(prisma as any, registry as any, new LocalSessionLockService());

    const result = await service.deliverInboundMessage(createMessage(), {
      ok: false,
      reason: "device_offline",
      myclawUserId: "user-1",
      localSessionKey: "dingtalk:direct:cid-1:user:user-1",
      routeSource: "sender-binding",
    } as any);
    const recoveredCount = await service.recoverQueuedMessagesForDevice("user-1", "device-1");

    expect(result).toEqual({ status: "queued", reason: "device_offline" });
    expect(recoveredCount).toBe(1);
    expect(registry.sendToDevice).toHaveBeenCalledWith("device-1", expect.objectContaining({
      type: "bridge.message.received",
      messageId: "message-1",
    }));
    expect(prisma.inboundMessages.get("message-1").status).toBe("delivered");
  });

  it("recovers persisted queued message after service restart", async () => {
    const prisma = new FakePrisma();
    seedInboundMessage(prisma);
    const firstRegistry = { sendToDevice: vi.fn(() => false) };
    const firstService = new DeliveryService(prisma as any, firstRegistry as any, new LocalSessionLockService());

    await firstService.deliverInboundMessage(createMessage(), {
      ok: false,
      reason: "device_offline",
      myclawUserId: "user-1",
      localSessionKey: "dingtalk:direct:cid-1:user:user-1",
      routeSource: "sender-binding",
    } as any);

    const secondRegistry = { sendToDevice: vi.fn(() => true) };
    const restartedService = new DeliveryService(prisma as any, secondRegistry as any, new LocalSessionLockService());
    const recoveredCount = await restartedService.recoverQueuedMessagesForDevice("user-1", "device-1");

    expect(recoveredCount).toBe(1);
    expect(secondRegistry.sendToDevice).toHaveBeenCalledWith("device-1", expect.objectContaining({
      type: "bridge.message.received",
      messageId: "message-1",
    }));
    expect(prisma.inboundMessages.get("message-1")).toMatchObject({
      status: "delivered",
      myclawUserId: "user-1",
      localSessionKey: "dingtalk:direct:cid-1:user:user-1",
    });
  });

  it("releases local session lock when send detects offline device", async () => {
    const prisma = new FakePrisma();
    const registry = { sendToDevice: vi.fn(() => false) };
    const service = new DeliveryService(prisma as any, registry as any, new LocalSessionLockService());

    const first = await service.deliverInboundMessage(createMessage(), createRoute());
    registry.sendToDevice.mockReturnValue(true);
    const recoveredCount = await service.recoverQueuedMessagesForDevice("user-1", "device-1");

    expect(first).toEqual({ status: "queued", reason: "device_offline" });
    expect(recoveredCount).toBe(1);
    expect(registry.sendToDevice).toHaveBeenCalledTimes(2);
    expect(prisma.inboundMessages.get("message-1").status).toBe("delivered");
  });

  it("records failed delivery attempt after ACK timeout", async () => {
    const prisma = new FakePrisma();
    const registry = { sendToDevice: vi.fn(() => true) };
    const service = new DeliveryService(prisma as any, registry as any, new LocalSessionLockService(), {
      ackTimeoutMs: 1,
    });

    const result = await service.deliverInboundMessage(createMessage(), createRoute());
    expect(result.status).toBe("delivered");
    await wait(5);

    if (result.status !== "delivered") {
      throw new Error("expected delivered result");
    }
    expect(prisma.deliveryAttempts.get(result.deliveryId).status).toBe("failed");
  });

  it("retries delivery after ACK timeout", async () => {
    const prisma = new FakePrisma();
    const registry = { sendToDevice: vi.fn(() => true) };
    const service = new DeliveryService(prisma as any, registry as any, new LocalSessionLockService(), {
      ackTimeoutMs: 1,
      retryDelaysMs: [1],
    });

    const result = await service.deliverInboundMessage(createMessage(), createRoute());
    expect(result.status).toBe("delivered");
    await waitUntil(() => expect(registry.sendToDevice).toHaveBeenCalledTimes(2));
    expect(Array.from(prisma.deliveryAttempts.values()).map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
  });

  it("delivers queued local session message after running message completes", async () => {
    const prisma = new FakePrisma();
    const registry = { sendToDevice: vi.fn(() => true) };
    const service = new DeliveryService(prisma as any, registry as any, new LocalSessionLockService(), {
      ackTimeoutMs: 100,
    });

    const first = await service.deliverInboundMessage(createMessage(), createRoute());
    const second = await service.deliverInboundMessage({
      ...createMessage(),
      id: "message-2",
      externalMessageId: "external-2",
    }, createRoute());

    expect(first.status).toBe("delivered");
    expect(second).toEqual({ status: "queued", reason: "local_session_busy" });

    await service.markCompleted("message-1");

    expect(registry.sendToDevice).toHaveBeenCalledTimes(2);
    expect(prisma.inboundMessages.get("message-2").status).toBe("delivered");
    const sendCalls = registry.sendToDevice.mock.calls as unknown[][];
    const secondSentPayload = sendCalls[1]?.[1];
    expect(JSON.parse(secondSentPayload ? JSON.stringify(secondSentPayload) : "{}")).toMatchObject({
      messageId: "message-2",
      type: "bridge.message.received",
    });
  });

  it("handles duplicate delivery ACK idempotently", async () => {
    const prisma = new FakePrisma();
    const registry = { sendToDevice: vi.fn(() => true) };
    const service = new DeliveryService(prisma as any, registry as any, new LocalSessionLockService(), {
      ackTimeoutMs: 100,
    });

    const result = await service.deliverInboundMessage(createMessage(), createRoute());
    expect(result.status).toBe("delivered");
    if (result.status !== "delivered") {
      throw new Error("expected delivered result");
    }
    await service.handleAck(result.deliveryId);
    await service.handleAck(result.deliveryId);

    expect(prisma.deliveryAttempts.get(result.deliveryId).status).toBe("acked");
    expect(prisma.updateAttemptCount).toBe(1);
  });
});
