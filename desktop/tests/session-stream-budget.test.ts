import { describe, expect, it } from "vitest";

import {
  buildPayloadPreview,
  measurePayloadBytes,
  SESSION_STREAM_HARD_BUDGET_BYTES,
  SESSION_STREAM_PREVIEW_CHARS,
  SESSION_STREAM_SOFT_BUDGET_BYTES,
} from "../shared/contracts/session-stream";

describe("session stream payload budget", () => {
  it("creates a bounded preview for large tool input", () => {
    const largeInput = { content: "x".repeat(100_000), nested: { value: 1 } };
    const preview = buildPayloadPreview(largeInput, "input");

    expect(preview.inputPreview.length).toBeLessThanOrEqual(SESSION_STREAM_PREVIEW_CHARS);
    expect(preview.inputBytes).toBeGreaterThan(100_000);
    expect(preview.inputHash).toMatch(/^[a-f0-9]{16,64}$/);
    expect(preview.omittedKeys).toContain("input");
  });

  it("keeps preview payloads under realtime stream budgets", () => {
    const preview = buildPayloadPreview({ content: "x".repeat(100_000) }, "arguments");
    const bytes = measurePayloadBytes({ type: "tool.started", payload: preview });

    expect(bytes).toBeLessThan(SESSION_STREAM_SOFT_BUDGET_BYTES);
    expect(bytes).toBeLessThan(SESSION_STREAM_HARD_BUDGET_BYTES);
  });
});
