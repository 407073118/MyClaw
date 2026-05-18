import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Prisma schema", () => {
  it("declares realtime bridge core models", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    for (const model of [
      "ChannelBot",
      "ChannelAccount",
      "ChannelConversation",
      "ChannelBinding",
      "DesktopDevice",
      "InboundMessage",
      "DeliveryAttempt",
      "OutboundMessage",
      "AuditLog",
    ]) {
      expect(schema).toContain(`model ${model}`);
    }
    expect(schema).toContain("@@unique([provider, externalMessageId])");
    expect(schema).toContain("@@index([status, createdAt])");
  });
});
