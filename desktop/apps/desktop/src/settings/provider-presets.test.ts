import { describe, expect, it } from "vitest";

import { providerPresets, resolveProviderPresetId } from "./provider-presets";

describe("provider presets", () => {
  it("configures MiniMax preset as anthropic-compatible using the official API root", () => {
    const preset = providerPresets.find((item) => item.id === "minimax");

    expect(preset).toEqual(expect.objectContaining({
      provider: "anthropic",
      baseUrl: "https://api.minimaxi.com",
      baseUrlMode: "provider-root",
    }));
  });

  it("maps MiniMax anthropic profiles back to the MiniMax preset", () => {
    expect(resolveProviderPresetId({
      provider: "anthropic",
      baseUrl: "https://api.minimaxi.com",
      model: "MiniMax-M2.7",
    })).toBe("minimax");
  });
});
