import "reflect-metadata";
import { INestApplication, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AdminController } from "../../src/modules/admin/admin.controller";
import { AdminService } from "../../src/modules/admin/admin.service";
import { AuditService } from "../../src/modules/audit/audit.service";

class FakePrisma {
  auditRows: any[] = [];

  auditLog = {
    create: async ({ data }: any) => {
      const row = { id: `audit-${this.auditRows.length + 1}`, createdAt: new Date(this.auditRows.length), ...data };
      this.auditRows.push(row);
      return row;
    },
    findMany: async ({ where }: any) => this.auditRows.filter((row) => row.inboundMessageId === where.inboundMessageId),
  };

  channelAccount = {
    findUnique: async () => null,
  };
}

const registry = {
  getActiveDeviceId: () => undefined,
};

describe("message timeline admin endpoint", () => {
  let app: INestApplication;
  let prisma: FakePrisma;

  @Module({
    controllers: [AdminController],
    providers: [
      AuditService,
      AdminService,
      { provide: "PrismaService", useValue: {} },
    ],
  })
  class EmptyModule {}

  beforeEach(async () => {
    process.env.MYCLAW_ADMIN_TOKEN = "admin-token";
    prisma = new FakePrisma();
    const auditService = new AuditService(prisma as any);
    await auditService.recordIngressReceived("message-1");
    await auditService.recordRouteResolved("message-1");
    await auditService.recordDelivered("message-1");
    await auditService.recordDeliveryAcked("message-1");
    await auditService.recordProcessingStarted("message-1");
    await auditService.recordReplyCreated("message-1");
    await auditService.recordOutboundSent("message-1");

    @Module({
      controllers: [AdminController],
      providers: [
        { provide: AuditService, useValue: auditService },
        { provide: AdminService, useValue: new AdminService(prisma as any, registry as any) },
      ],
    })
    class TestAdminModule {}

    app = await NestFactory.create(TestAdminModule, { logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    delete process.env.MYCLAW_ADMIN_TOKEN;
  });

  it("returns ordered audit timeline for a message", async () => {
    const response = await request(app.getHttpServer())
      .get("/admin/messages/message-1/timeline")
      .set("X-MyClaw-Admin-Token", "admin-token")
      .expect(200);

    expect(response.body.events.map((event: any) => event.eventType)).toEqual([
      "received",
      "routed",
      "delivered",
      "acked",
      "processing",
      "reply_created",
      "outbound_sent",
    ]);
  });

  it("serves the realtime bridge admin console page", async () => {
    const response = await request(app.getHttpServer())
      .get("/admin")
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("实时桥接控制台");
    expect(response.text).toContain("管理令牌");
    expect(response.text).toContain("消息时间线");
    expect(response.text).toContain("在线设备");
    expect(response.text).toContain("发送人绑定");
    expect(response.text).not.toContain("Realtime Bridge Console");
    expect(response.text).not.toContain("MYCLAW_ADMIN_TOKEN");
  });

  it("rejects admin requests when admin token is not configured", async () => {
    delete process.env.MYCLAW_ADMIN_TOKEN;

    await request(app.getHttpServer())
      .get("/admin/messages/message-1/timeline")
      .set("X-MyClaw-Admin-Token", "admin-token")
      .expect(401);
  });
});
