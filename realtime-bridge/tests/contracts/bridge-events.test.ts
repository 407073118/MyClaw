import { describe, expect, it } from "vitest";

import { DESKTOP_PROCESSING_STARTED_TYPE } from "../../src/contracts/bridge-events";
import { buildLocalSessionKey, INBOUND_MESSAGE_STATUS_VALUES } from "../../src/contracts/status";

describe("realtime bridge contracts", () => {
  it("keeps inbound message statuses stable", () => {
    expect(INBOUND_MESSAGE_STATUS_VALUES).toEqual([
      "received",
      "routed",
      "queued",
      "delivered",
      "processing",
      "completed",
      "failed",
      "expired",
    ]);
  });

  it("builds stable direct and group session keys", () => {
    expect(buildLocalSessionKey({
      provider: "dingtalk",
      conversationType: "direct",
      externalConversationId: "cid-1",
      myclawUserId: "user-1",
    })).toBe("dingtalk:direct:cid-1:user:user-1");

    expect(buildLocalSessionKey({
      provider: "dingtalk",
      conversationType: "group",
      externalConversationId: "gid-1",
      myclawUserId: "user-1",
    })).toBe("dingtalk:group:gid-1:user:user-1");
  });

  it("keeps desktop processing event type aligned", () => {
    expect(DESKTOP_PROCESSING_STARTED_TYPE).toBe("desktop.processing_started");
  });
});
