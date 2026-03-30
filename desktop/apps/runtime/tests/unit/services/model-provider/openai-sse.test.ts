import { describe, expect, it } from "vitest";

import { parseOpenAiStepFromSse } from "../../../../src/services/model-provider/openai-compatible/sse";

describe("openai sse compatibility", () => {
  it("parses streamed deltas", async () => {
    const response = new Response(
      [
        'data: {"choices":[{"delta":{"content":"h"}}]}',
        'data: {"choices":[{"delta":{"content":"hi"}}]}',
        "data: [DONE]",
      ].join("\n"),
      {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      },
    );

    const step = await parseOpenAiStepFromSse(response);
    expect(step.assistantText).toBe("hi");
  });
});
