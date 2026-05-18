import { describe, expect, it, vi } from "vitest";

import { OutboundService } from "../../src/modules/outbound/outbound.service";

class FakePrisma {
  outboundMessages = new Map<string, any>();
  inboundMessages = new Map<string, any>([[
    "message-1",
    {
      id: "message-1",
      provider: "dingtalk",
      externalConversationId: "cid-1",
      rawPayloadJson: { sessionWebhook: "https://relay.example/session" },
    },
  ]]);
  nextOutboundId = "outbound-1";

  outboundMessage = {
    create: async ({ data }: any) => {
      const row = { id: this.nextOutboundId, ...data };
      this.outboundMessages.set(row.id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const existing = this.outboundMessages.get(where.id);
      const updated = { ...existing, ...data };
      this.outboundMessages.set(where.id, updated);
      return updated;
    },
  };

  inboundMessage = {
    findUnique: async ({ where }: any) => this.inboundMessages.get(where.id) ?? null,
    update: async ({ where, data }: any) => {
      const existing = this.inboundMessages.get(where.id) ?? { id: where.id };
      const updated = { ...existing, ...data };
      this.inboundMessages.set(where.id, updated);
      return updated;
    },
  };
}

const createReply = () => ({
  type: "desktop.reply_created" as const,
  messageId: "message-1",
  deliveryId: "delivery-1",
  content: { type: "text", text: "收到" },
  createdAt: new Date().toISOString(),
});

describe("OutboundService", () => {
  it("creates outbound message after desktop.reply_created", async () => {
    const prisma = new FakePrisma();
    const relayClient = { sendReply: vi.fn(async () => ({ ok: true, rawResponse: { ok: true } })) };
    const service = new OutboundService(prisma as any, relayClient as any, { retryDelaysMs: [] });

    await service.handleDesktopReplyCreated(createReply());

    expect(prisma.outboundMessages.get("outbound-1")).toMatchObject({
      inboundMessageId: "message-1",
      provider: "dingtalk",
      externalConversationId: "cid-1",
      status: "sent",
    });
  });

  it("sends reply with inbound conversation context", async () => {
    const prisma = new FakePrisma();
    const relayClient = { sendReply: vi.fn(async () => ({ ok: true, rawResponse: { ok: true } })) };
    const service = new OutboundService(prisma as any, relayClient as any, { retryDelaysMs: [] });

    await service.handleDesktopReplyCreated(createReply());

    expect(relayClient.sendReply).toHaveBeenCalledWith(expect.objectContaining({
      provider: "dingtalk",
      externalConversationId: "cid-1",
      sessionWebhook: "https://relay.example/session",
    }));
  });

  it("marks outbound sent and inbound completed after relay success", async () => {
    const prisma = new FakePrisma();
    const relayClient = { sendReply: vi.fn(async () => ({ ok: true, rawResponse: { message: "ok" } })) };
    const service = new OutboundService(prisma as any, relayClient as any, { retryDelaysMs: [] });

    await service.handleDesktopReplyCreated(createReply());

    expect(prisma.outboundMessages.get("outbound-1").status).toBe("sent");
    expect(prisma.inboundMessages.get("message-1").status).toBe("completed");
  });

  it("retries relay failure with configured delays", async () => {
    const prisma = new FakePrisma();
    const relayClient = {
      sendReply: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, error: "first" })
        .mockResolvedValueOnce({ ok: true, rawResponse: { ok: true } }),
    };
    const service = new OutboundService(prisma as any, relayClient as any, { retryDelaysMs: [1] });

    await service.handleDesktopReplyCreated(createReply());

    expect(relayClient.sendReply).toHaveBeenCalledTimes(2);
    expect(prisma.outboundMessages.get("outbound-1").retryCount).toBe(1);
    expect(prisma.outboundMessages.get("outbound-1").status).toBe("sent");
  });

  it("marks outbound and inbound failed after final relay failure", async () => {
    const prisma = new FakePrisma();
    const relayClient = { sendReply: vi.fn(async () => ({ ok: false, error: "relay down" })) };
    const service = new OutboundService(prisma as any, relayClient as any, { retryDelaysMs: [1, 1] });

    await service.handleDesktopReplyCreated(createReply());

    expect(relayClient.sendReply).toHaveBeenCalledTimes(3);
    expect(prisma.outboundMessages.get("outbound-1").status).toBe("failed");
    expect(prisma.inboundMessages.get("message-1").status).toBe("failed");
  });
});
