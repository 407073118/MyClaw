import { describe, expect, it, vi } from "vitest";

import type { ModelProfile } from "@shared/contracts";
import { normalizeCatalogPayload, resolveProviderFlavor } from "../src/main/ipc/models";
import {
  resolveMiniMaxModeHint,
  resolveProviderBaseUrlHint,
  resolveProviderPresetId,
} from "../src/renderer/pages/ModelDetailPage";

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

function buildProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "profile-1",
    name: "MiniMax",
    provider: "openai-compatible",
    providerFlavor: "minimax-anthropic",
    baseUrl: "https://api.minimaxi.com",
    baseUrlMode: "provider-root",
    apiKey: "test-key",
    model: "MiniMax-M2.5",
    headers: {},
    requestBody: {},
    ...overrides,
  };
}

describe("phase 10 model settings", () => {
  it("maps MiniMax profiles back to the minimax preset", () => {
    expect(resolveProviderPresetId(buildProfile())).toBe("minimax");
    expect(resolveProviderPresetId(buildProfile({
      providerFlavor: undefined,
      baseUrl: "https://gateway.example.com/v1",
      model: "minimax-m2.5",
    }))).toBe("minimax");
  });

  it("infers minimax flavor from baseUrl or model id", () => {
    expect(resolveProviderFlavor(buildProfile({
      providerFlavor: undefined,
    }))).toBe("minimax-anthropic");

    expect(resolveProviderFlavor(buildProfile({
      providerFlavor: undefined,
      baseUrl: "https://gateway.example.com/v1",
      model: "minimax-m2.5",
    }))).toBe("minimax-anthropic");
  });

  it("normalizes MiniMax model catalogs through the OpenAI-compatible path", () => {
    const items = normalizeCatalogPayload(
      {
        data: [{
          id: "MiniMax-M2.5",
          name: "MiniMax M2.5",
          context_length: 204800,
          max_tokens: 8192,
          supported_parameters: ["tools", "stream"],
        }],
      },
      "openai-compatible",
      "minimax-anthropic",
    );

    expect(items).toEqual([{
      id: "MiniMax-M2.5",
      name: "MiniMax M2.5",
      provider: "openai-compatible",
      providerFlavor: "minimax-anthropic",
      contextWindowTokens: 204800,
      maxInputTokens: undefined,
      maxOutputTokens: 8192,
      supportsTools: true,
      supportsStreaming: true,
      source: "provider-catalog",
    }]);
  });

  it("explains MiniMax provider-root and manual modes without leaking protocol details", () => {
    expect(resolveProviderBaseUrlHint(buildProfile())).toContain("更完整的推理与回放");
    expect(resolveMiniMaxModeHint(buildProfile())).toContain("增强推理");

    const manualProfile = buildProfile({
      baseUrl: "https://gateway.example.com/v1",
      baseUrlMode: "manual",
      providerFlavor: undefined,
      model: "minimax-m2.5",
    });

    expect(resolveProviderBaseUrlHint(manualProfile)).toContain("兼容模式");
    expect(resolveMiniMaxModeHint(manualProfile)).toContain("兼容模式");
    expect(resolveMiniMaxModeHint(manualProfile)).not.toContain("anthropic");
  });
});
