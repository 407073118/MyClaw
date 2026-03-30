import { describe, expect, it } from "vitest";

import { parseAnthropicStepFromSse } from "../../../../src/services/model-provider/anthropic/sse";

describe("anthropic sse compatibility", () => {
  it("parses streamed thinking blocks", async () => {
    const response = new Response(
      [
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"plan"}}',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}',
      ].join("\n"),
      {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      },
    );

    const step = await parseAnthropicStepFromSse(response);
    expect(step.assistantReasoning).toBe("plan");
    expect(step.finishReason).toBe("tool_use");
  });
});
