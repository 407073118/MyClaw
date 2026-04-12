import { describe, expect, it } from "vitest";

import { routeModelForRole } from "../../../src/main/services/model-runtime/role-model-router";
import { makeProfile } from "../contracts/test-helpers";

describe("role model router", () => {
  it("prefers Anthropic/OpenAI families for planning and review", () => {
    const profiles = [
      makeProfile({ id: "generic", providerFlavor: "generic-openai-compatible" }),
      makeProfile({ id: "claude", provider: "anthropic", providerFlavor: "anthropic", model: "claude-3-7-sonnet" }),
    ];

    expect(routeModelForRole("plan", profiles).modelProfileId).toBe("claude");
  });
});
