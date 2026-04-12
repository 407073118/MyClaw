import { describe, expect, it } from "vitest";

import { executeRequestVariants } from "../../../src/main/services/model-transport";

describe("fallback and retry", () => {
  it("falls back after 400 and retries 429/5xx", async () => {
    const responses = [
      new Response("bad request", { status: 400 }),
      new Response("rate limited", { status: 429 }),
      new Response("ok", { status: 200, headers: { "content-type": "application/json" } }),
    ];
    const result = await executeRequestVariants({
      url: "https://api.example.com",
      headers: {},
      requestVariants: [{ id: "primary", fallbackReason: "unsupported", body: {} }, { id: "fallback", body: {} }],
      fetchImpl: async () => responses.shift()!,
      sleep: async () => {},
      maxRetries: 2,
      retryDelaysMs: [0, 0],
    });

    expect(result.variant.id).toBe("fallback");
    expect(result.retryCount).toBe(1);
    expect(result.fallbackEvents).toEqual([{ fromVariant: "primary", toVariant: "fallback", reason: "unsupported" }]);
  });
});
