import { describe, expect, it } from "vitest";

import { consumeSseStream } from "../src/main/services/model-sse-parser";

/** 构造标准 SSE 响应，便于验证 parser 是否能累计多帧内容。 */
function buildSseResponse(lines: string[]): Response {
  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

describe("phase1 model sse parser", () => {
  it("accumulates content and reasoning deltas from multiple frames", async () => {
    const result = await consumeSseStream(buildSseResponse([
      'data: {"choices":[{"delta":{"content":"hel","reasoning_content":"step "}}]}',
      'data: {"choices":[{"delta":{"content":"lo","reasoning_content":"one"}}]}',
      "data: [DONE]",
      "",
    ]));

    expect(result.content).toBe("hello");
    expect(result.reasoning).toBe("step one");
  });

  it("accumulates tool call arguments by index", async () => {
    const result = await consumeSseStream(buildSseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tool-1","function":{"name":"search","arguments":"{\\"q\\":\\"" }}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"weather\\"}"}}]},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
      "",
    ]));

    expect(result.toolCalls).toEqual([{
      id: "tool-1",
      name: "search",
      argumentsJson: "{\"q\":\"weather\"}",
      input: { q: "weather" },
    }]);
    expect(result.finishReason).toBe("tool_calls");
  });
});
