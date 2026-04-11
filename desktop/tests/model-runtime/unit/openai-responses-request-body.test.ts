import { describe, expect, it } from "vitest";

import { buildOpenAiResponsesRequestBody } from "../../../src/main/services/model-runtime/protocols/openai-responses-driver";

describe("openai responses request body", () => {
  it("maps xhigh reasoning effort into a native reasoning object", () => {
    const body = buildOpenAiResponsesRequestBody(
      "gpt-5.4",
      [{ role: "user", content: "hello" }],
      [],
      "xhigh",
    );

    expect(body).toMatchObject({
      model: "gpt-5.4",
      reasoning: {
        effort: "xhigh",
      },
    });
  });
});
