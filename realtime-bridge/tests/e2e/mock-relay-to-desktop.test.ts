import "reflect-metadata";
import { INestApplication, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { WebSocket } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signHmacPayload } from "../../src/common/crypto/hmac-signature";
import { PrismaService } from "../../src/infra/prisma/prisma.service";
import { RedisService } from "../../src/infra/redis/redis.service";
import { AdminController } from "../../src/modules/admin/admin.controller";
import { AdminService } from "../../src/modules/admin/admin.service";
import { AuditService } from "../../src/modules/audit/audit.service";
import { ConversationService } from "../../src/modules/conversation/conversation.service";
import { DeliveryService } from "../../src/modules/delivery/delivery.service";
import { LocalSessionLockService } from "../../src/modules/delivery/local-session-lock.service";
import { DesktopConnectionRegistry } from "../../src/modules/desktop-ws/desktop-connection.registry";
import { DesktopWsGateway } from "../../src/modules/desktop-ws/desktop-ws.gateway";
import { IngressController } from "../../src/modules/ingress/ingress.controller";
import { IngressService } from "../../src/modules/ingress/ingress.service";
import { DingTalkRelayClient } from "../../src/modules/outbound/dingtalk-relay.client";
import { OutboundService } from "../../src/modules/outbound/outbound.service";
import { RoutingService } from "../../src/modules/routing/routing.service";

class FakePrisma {
  inboundMessages = new Map<string, any>();
  deliveryAttempts = new Map<string, any>();
  outboundMessages = new Map<string, any>();
  auditRows: any[] = [];
  nextInboundId = 1;
  nextOutboundId = 1;

  inboundMessage = {
    upsert: async ({ where, update, create, select }: any) => {
      const externalMessageId = where.provider_externalMessageId.externalMessageId;
      const existing = [...this.inboundMessages.values()]
        .find((row) => row.externalMessageId === externalMessageId);
      const row = existing
        ? { ...existing, ...update }
        : { id: `message-${this.nextInboundId++}`, ...create };
      this.inboundMessages.set(row.id, row);
      return select?.id ? { id: row.id } : row;
    },
    update: async ({ where, data }: any) => {
      const existing = this.inboundMessages.get(where.id) ?? { id: where.id };
      const row = { ...existing, ...data };
      this.inboundMessages.set(where.id, row);
      return row;
    },
  };

  channelConversation = {
    upsert: async () => ({}),
  };

  channelBinding = {
    findUnique: async () => null,
  };

  channelAccount = {
    findUnique: async ({ where }: any) => {
      if (where.provider_senderStaffId.senderStaffId !== "staff-1") {
        return null;
      }
      return {
        provider: "dingtalk",
        senderStaffId: "staff-1",
        myclawUserId: "user-1",
        enabled: true,
      };
    },
  };

  deliveryAttempt = {
    create: async ({ data }: any) => {
      const row = { ...data };
      this.deliveryAttempts.set(row.deliveryId, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const existing = this.deliveryAttempts.get(where.deliveryId);
      const row = { ...existing, ...data };
      this.deliveryAttempts.set(where.deliveryId, row);
      return row;
    },
    findUnique: async ({ where }: any) => this.deliveryAttempts.get(where.deliveryId) ?? null,
  };

  outboundMessage = {
    create: async ({ data }: any) => {
      const row = { id: `outbound-${this.nextOutboundId++}`, ...data };
      this.outboundMessages.set(row.id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const existing = this.outboundMessages.get(where.id);
      const row = { ...existing, ...data };
      this.outboundMessages.set(where.id, row);
      return row;
    },
  };

  auditLog = {
    create: async ({ data }: any) => {
      const row = { id: `audit-${this.auditRows.length + 1}`, createdAt: new Date(this.auditRows.length), ...data };
      this.auditRows.push(row);
      return row;
    },
    findMany: async ({ where }: any) => this.auditRows.filter((row) => row.inboundMessageId === where.inboundMessageId),
  };
}

const createRelayPayload = () => ({
  provider: "dingtalk" as const,
  externalMessageId: "external-1",
  senderStaffId: "staff-1",
  externalConversationId: "cid-1",
  conversationType: "direct" as const,
  content: { type: "text", text: "测试消息" },
  traceId: "trace-1",
});

function signBody(body: string) {
  const timestamp = String(Date.now());
  const nonce = `nonce-${timestamp}`;
  return {
    timestamp,
    nonce,
    signature: signHmacPayload({
      body,
      timestamp,
      nonce,
      secret: "test-secret",
    }),
  };
}

async function waitForWsOpen(webSocket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    webSocket.once("open", resolve);
    webSocket.once("error", reject);
  });
}

async function waitForBridgeMessage(webSocket: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待桌面端桥接消息超时")), 1000);
    webSocket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === "bridge.message.received") {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
}

async function waitUntil(assertion: () => void | Promise<void>): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < 1000) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("等待断言成功超时");
}

describe("mock relay to desktop e2e", () => {
  let app: INestApplication;
  let prisma: FakePrisma;
  let desktopSocket: WebSocket | undefined;
  const relayClient = { sendReply: vi.fn(async () => ({ ok: true, rawResponse: { ok: true } })) };

  beforeEach(async () => {
    process.env.DINGTALK_RELAY_HMAC_SECRET = "test-secret";
    process.env.MYCLAW_ADMIN_TOKEN = "admin-token";
    relayClient.sendReply.mockClear();
    prisma = new FakePrisma();
    const redis = {
      setDeviceOnline: vi.fn(async () => undefined),
      refreshDeviceOnline: vi.fn(async () => undefined),
      removeDevice: vi.fn(async () => undefined),
    };
    const registry = new DesktopConnectionRegistry(redis as any);

    @Module({
      controllers: [IngressController, AdminController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: DingTalkRelayClient, useValue: relayClient },
        { provide: DesktopConnectionRegistry, useValue: registry },
        ConversationService,
        RoutingService,
        LocalSessionLockService,
        AuditService,
        AdminService,
        DesktopWsGateway,
        {
          provide: DeliveryService,
          useFactory: (prismaService: PrismaService, connectionRegistry: DesktopConnectionRegistry, lockService: LocalSessionLockService) =>
            new DeliveryService(prismaService, connectionRegistry, lockService, { ackTimeoutMs: 1000 }),
          inject: [PrismaService, DesktopConnectionRegistry, LocalSessionLockService],
        },
        {
          provide: OutboundService,
          useFactory: (prismaService: PrismaService, relay: DingTalkRelayClient) =>
            new OutboundService(prismaService, relay, { retryDelaysMs: [] }),
          inject: [PrismaService, DingTalkRelayClient],
        },
        IngressService,
      ],
    })
    class TestBridgeModule {}

    app = await NestFactory.create(TestBridgeModule, { logger: false });
    await app.listen(0);
    const appUrl = new URL(await app.getUrl());
    desktopSocket = new WebSocket(`ws://127.0.0.1:${appUrl.port}/v1/desktop/ws`);
    await waitForWsOpen(desktopSocket);
    desktopSocket.send(JSON.stringify({
      type: "desktop.hello",
      userId: "user-1",
      deviceId: "device-1",
      connectionId: "connection-1",
    }));
    await waitUntil(() => {
      expect(registry.getConnection("device-1")).toBeDefined();
    });
  });

  afterEach(async () => {
    desktopSocket?.close();
    await app.close();
    delete process.env.DINGTALK_RELAY_HMAC_SECRET;
    delete process.env.MYCLAW_ADMIN_TOKEN;
  });

  it("delivers a DingTalk relay message to Desktop reply and exposes completed admin timeline", async () => {
    if (!desktopSocket) {
      throw new Error("desktop socket not initialized");
    }
    const payload = createRelayPayload();
    const body = JSON.stringify(payload);
    const signature = signBody(body);

    const response = await request(app.getHttpServer())
      .post("/v1/ingress/dingtalk/message")
      .set("X-MyClaw-Timestamp", signature.timestamp)
      .set("X-MyClaw-Nonce", signature.nonce)
      .set("X-MyClaw-Signature", signature.signature)
      .send(payload)
      .expect(201);

    const bridgeMessage = await waitForBridgeMessage(desktopSocket);
    expect(bridgeMessage).toMatchObject({
      type: "bridge.message.received",
      messageId: response.body.messageId,
      provider: "dingtalk",
      content: { type: "text", text: "测试消息" },
    });

    desktopSocket.send(JSON.stringify({
      type: "desktop.ack",
      messageId: bridgeMessage.messageId,
      deliveryId: bridgeMessage.deliveryId,
    }));
    desktopSocket.send(JSON.stringify({
      type: "desktop.processing_started",
      messageId: bridgeMessage.messageId,
      deliveryId: bridgeMessage.deliveryId,
    }));
    desktopSocket.send(JSON.stringify({
      type: "desktop.reply_created",
      messageId: bridgeMessage.messageId,
      deliveryId: bridgeMessage.deliveryId,
      content: { type: "text", text: "已收到测试消息" },
    }));

    await waitUntil(() => {
      expect(relayClient.sendReply).toHaveBeenCalledWith(expect.objectContaining({
        messageId: response.body.messageId,
        deliveryId: bridgeMessage.deliveryId,
        content: { type: "text", text: "已收到测试消息" },
      }));
      expect(prisma.inboundMessages.get(response.body.messageId).status).toBe("completed");
    });

    const timeline = await request(app.getHttpServer())
      .get(`/admin/messages/${response.body.messageId}/timeline`)
      .set("X-MyClaw-Admin-Token", "admin-token")
      .expect(200);

    expect(timeline.body.events.map((event: any) => event.eventType)).toEqual([
      "received",
      "routed",
      "acked",
      "processing",
      "reply_created",
      "outbound_sent",
    ]);
  });
});
