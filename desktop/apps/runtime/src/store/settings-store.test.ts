import { describe, expect, it } from "vitest";

import { createDefaultModelProfileId, createDefaultProfiles } from "./settings-store";

describe("settings store", () => {
  it("creates the unified default Qwen profile for first launch", () => {
    const profiles = createDefaultProfiles();

    expect(profiles).toEqual([
      {
        id: "model-default",
        name: "默认 Qwen 3.5 Plus",
        provider: "openai-compatible",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        baseUrlMode: "manual",
        apiKey: "sk-sp-df8f797f71dc49e2a9de118ad90d62b9",
        model: "qwen3.5-plus",
      },
    ]);
    expect(createDefaultModelProfileId(profiles)).toBe("model-default");
  });
});
