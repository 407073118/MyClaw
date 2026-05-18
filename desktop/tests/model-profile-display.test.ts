import { describe, expect, it } from "vitest";

import { getModelVendorLabel } from "../src/renderer/utils/model-profile-display";

describe("model profile display helpers", () => {
  it("labels DeepSeek as DeepSeek even when the selected endpoint is the Anthropic-compatible route", () => {
    const label = getModelVendorLabel({
      provider: "openai-compatible",
      providerFlavor: "deepseek",
      providerFamily: "deepseek",
      vendorFamily: "deepseek",
      baseUrl: "https://api.deepseek.com/anthropic/v1",
      model: "deepseek-v4-pro",
    });

    expect(label).toBe("DeepSeek");
  });
});
