import "reflect-metadata";
import { INestApplication, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { signHmacPayload } from "../../src/common/crypto/hmac-signature";
import { IngressController } from "../../src/modules/ingress/ingress.controller";
import { IngressService } from "../../src/modules/ingress/ingress.service";

const relaySecret = "relay-secret";

const validPayload = {
  provider: "dingtalk",
  externalMessageId: "msg-1",
  senderStaffId: "staff-1",
  senderNick: "测试用户",
  externalConversationId: "cid-1",
  conversationType: "direct",
  content: { type: "text", text: "你好" },
  traceId: "trace-1",
};

describe("IngressController", () => {
  let app: INestApplication;
  const ingressService = {
    receiveDingTalkMessage: vi.fn(async () => ({ messageId: "inbound-1" })),
  };

  @Module({
    controllers: [IngressController],
    providers: [{ provide: IngressService, useValue: ingressService }],
  })
  class TestIngressModule {}

  beforeEach(async () => {
    process.env.DINGTALK_RELAY_HMAC_SECRET = relaySecret;
    ingressService.receiveDingTalkMessage.mockClear();
    app = await NestFactory.create(TestIngressModule, { logger: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.DINGTALK_RELAY_HMAC_SECRET;
  });

  it("accepts a valid relay payload", async () => {
    const body = JSON.stringify(validPayload);
    const timestamp = String(Date.now());
    const nonce = "nonce-valid";
    const signature = signHmacPayload({ body, timestamp, nonce, secret: relaySecret });

    const response = await request(app.getHttpServer())
      .post("/v1/ingress/dingtalk/message")
      .set("Content-Type", "application/json")
      .set("X-MyClaw-Signature", signature)
      .set("X-MyClaw-Timestamp", timestamp)
      .set("X-MyClaw-Nonce", nonce)
      .send(body)
      .expect(201);

    expect(response.body).toEqual({ ok: true, messageId: "inbound-1" });
    expect(ingressService.receiveDingTalkMessage).toHaveBeenCalledWith(validPayload);
  });

  it("rejects missing signatures", async () => {
    await request(app.getHttpServer())
      .post("/v1/ingress/dingtalk/message")
      .send(validPayload)
      .expect(401);
  });

  it("rejects invalid relay payloads", async () => {
    const invalidPayload = { ...validPayload, traceId: undefined };
    const body = JSON.stringify(invalidPayload);
    const timestamp = String(Date.now());
    const nonce = "nonce-invalid-body";
    const signature = signHmacPayload({ body, timestamp, nonce, secret: relaySecret });

    await request(app.getHttpServer())
      .post("/v1/ingress/dingtalk/message")
      .set("Content-Type", "application/json")
      .set("X-MyClaw-Signature", signature)
      .set("X-MyClaw-Timestamp", timestamp)
      .set("X-MyClaw-Nonce", nonce)
      .send(body)
      .expect(400);
  });
});
