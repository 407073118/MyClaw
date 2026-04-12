import { describe, expect, it } from "vitest";

import { resolveExperienceProfileId } from "../../../src/main/services/model-runtime/experience-profile-resolver";

describe("experience profile resolver", () => {
  it("maps provider families to default experience profiles", () => {
    expect(resolveExperienceProfileId({ providerFamily: "openai-native" })).toBe("gpt-best");
    expect(resolveExperienceProfileId({ providerFamily: "anthropic-native" })).toBe("claude-best");
    expect(resolveExperienceProfileId({ providerFamily: "qwen-dashscope" })).toBe("qwen-best");
  });

  it("prefers requested profiles over inferred defaults", () => {
    expect(resolveExperienceProfileId({ providerFamily: "openai-native", requestedProfileId: "fast" })).toBe("fast");
  });
});
