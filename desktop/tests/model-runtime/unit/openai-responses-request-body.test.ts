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

  it("can disable response storage for privacy-sensitive profiles", () => {
    const body = buildOpenAiResponsesRequestBody(
      "gpt-5.4",
      [{ role: "user", content: "hello" }],
      [],
      "medium",
      { disableResponseStorage: true },
    );

    expect(body).toMatchObject({
      model: "gpt-5.4",
      store: false,
    });
  });

  it("can continue a server-side response chain with previous_response_id", () => {
    const body = buildOpenAiResponsesRequestBody(
      "gpt-5.4",
      [{ role: "user", content: "hello" }],
      [],
      "medium",
      { previousResponseId: "resp_prev_123" },
    );

    expect(body).toMatchObject({
      model: "gpt-5.4",
      previous_response_id: "resp_prev_123",
    });
  });
});
