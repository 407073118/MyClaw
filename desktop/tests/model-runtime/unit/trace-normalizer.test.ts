import { describe, expect, it } from "vitest";

import { normalizeManagedTraceEvent, normalizeVendorTraceEvent } from "../../../src/main/services/model-runtime/trace-normalizer";

describe("trace normalizer", () => {
  it("normalizes OpenAI native web search traces into capability events", () => {
    const event = normalizeVendorTraceEvent({
      source: "openai-responses",
      eventType: "web_search_call",
      vendor: "openai",
      item: {
        id: "ws_1",
        status: "completed",
        action: {
          type: "search",
          queries: ["OpenAI latest updates"],
        },
      },
    });

    expect(event).toEqual(
      expect.objectContaining({
        type: "web_search_call",
        capabilityId: "search",
        vendor: "openai",
        payload: expect.objectContaining({
          traceId: "ws_1",
          status: "completed",
          action: "search",
          queries: ["OpenAI latest updates"],
        }),
      }),
    );
  });

  it("normalizes background task creation into a research capability event", () => {
    const event = normalizeVendorTraceEvent({
      source: "openai-responses",
      eventType: "background_response_started",
      vendor: "openai",
      item: {
        responseId: "resp_bg_1",
        status: "queued",
        reason: "deep_research_model",
        pollAfterMs: 1500,
      },
    });

    expect(event).toEqual(
      expect.objectContaining({
        type: "background_response_started",
        capabilityId: "research-task",
        payload: expect.objectContaining({
          responseId: "resp_bg_1",
          status: "queued",
          reason: "deep_research_model",
          pollAfterMs: 1500,
        }),
      }),
    );
  });

  it("normalizes managed fallback execution traces", () => {
    const event = normalizeManagedTraceEvent({
      capabilityId: "search",
      type: "tool_fallback",
      toolCallId: "tool_1",
      payload: {
        routeType: "managed-local",
        toolName: "web_search",
      },
    });

    expect(event).toEqual(
      expect.objectContaining({
        type: "tool_fallback",
        capabilityId: "search",
        toolCallId: "tool_1",
        payload: expect.objectContaining({
          routeType: "managed-local",
          toolName: "web_search",
        }),
      }),
    );
  });
});
