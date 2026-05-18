import { describe, expect, it } from "vitest";

import type { ModelProfile } from "@shared/contracts";
import { getProviderAdapter } from "../src/main/services/provider-adapters";

function makeDeepSeekProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "profile-deepseek",
    name: "DeepSeek",
    provider: "openai-compatible",
    providerFlavor: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "test-key",
    model: "deepseek-chat",
    headers: {},
    requestBody: {},
    ...overrides,
  };
}

describe("deepseek adapter materializeReplayMessages", () => {
  it("deepseek-reasoner: strips reasoning from assistant replay messages and does NOT attach reasoning_content", () => {
    const adapter = getProviderAdapter("deepseek");
    const profile = makeDeepSeekProfile({ model: "deepseek-reasoner" });

    const replayMessages = adapter.materializeReplayMessages(
      { profile },
      {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "answer", reasoning: "internal chain of thought" },
        ],
      },
    );

    expect(replayMessages).toHaveLength(2);
    const assistant = replayMessages[1] as Record<string, unknown>;
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toBe("answer");
    expect("reasoning" in assistant).toBe(false);
    expect("reasoning_content" in assistant).toBe(false);
  });

  it("deepseek-reasoner with empty reasoning: still no reasoning_content", () => {
    const adapter = getProviderAdapter("deepseek");
    const profile = makeDeepSeekProfile({ model: "deepseek-reasoner" });

    const replayMessages = adapter.materializeReplayMessages(
      { profile },
      {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "answer", reasoning: "" },
        ],
      },
    );

    const assistant = replayMessages[1] as Record<string, unknown>;
    expect("reasoning" in assistant).toBe(false);
    expect("reasoning_content" in assistant).toBe(false);
  });

  it("deepseek-chat (non-reasoner): maps reasoning -> reasoning_content for thinking-mode tool-call replay", () => {
    const adapter = getProviderAdapter("deepseek");
    const profile = makeDeepSeekProfile({ model: "deepseek-chat" });

    const replayMessages = adapter.materializeReplayMessages(
      { profile },
      {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "answer", reasoning: "internal chain of thought" },
        ],
      },
    );

    const assistant = replayMessages[1] as Record<string, unknown>;
    expect(assistant.reasoning_content).toBe("internal chain of thought");
    expect("reasoning" in assistant).toBe(false);
  });

  it("deepseek-v3.2 family: keeps reasoning_content mapping (and case-insensitive check still rejects reasoner branch)", () => {
    const adapter = getProviderAdapter("deepseek");

    const lowercaseProfile = makeDeepSeekProfile({ model: "deepseek-v3.2-thinking" });
    const lowercaseReplay = adapter.materializeReplayMessages(
      { profile: lowercaseProfile },
      {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "answer", reasoning: "internal chain of thought" },
        ],
      },
    );
    const lowercaseAssistant = lowercaseReplay[1] as Record<string, unknown>;
    expect(lowercaseAssistant.reasoning_content).toBe("internal chain of thought");
    expect("reasoning" in lowercaseAssistant).toBe(false);

    const mixedCaseProfile = makeDeepSeekProfile({ model: "DeepSeek-V3.2" });
    const mixedCaseReplay = adapter.materializeReplayMessages(
      { profile: mixedCaseProfile },
      {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "answer", reasoning: "another trace" },
        ],
      },
    );
    const mixedCaseAssistant = mixedCaseReplay[1] as Record<string, unknown>;
    expect(mixedCaseAssistant.reasoning_content).toBe("another trace");
    expect("reasoning" in mixedCaseAssistant).toBe(false);
  });

  it("non-reasoner with empty reasoning: omits reasoning_content (delegated to base helper, regression guard for bf4d82a)", () => {
    const adapter = getProviderAdapter("deepseek");
    const profile = makeDeepSeekProfile({ model: "deepseek-chat" });

    const replayMessages = adapter.materializeReplayMessages(
      { profile },
      {
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "answer", reasoning: "" },
        ],
      },
    );

    const assistant = replayMessages[1] as Record<string, unknown>;
    expect("reasoning_content" in assistant).toBe(false);
    expect("reasoning" in assistant).toBe(false);
  });
});

describe("deepseek adapter V4 thinking request", () => {
  it("deepseek-v4-pro: enables thinking and maps xhigh effort to max", () => {
    const adapter = getProviderAdapter("deepseek");
    const profile = makeDeepSeekProfile({ model: "deepseek-v4-pro" });

    const variants = adapter.prepareRequest(
      { profile, reasoningEnabled: true, reasoningEffort: "xhigh" },
      { messages: [{ role: "user", content: "hi" }] },
    );

    expect(variants).toHaveLength(1);
    expect(variants[0]?.body).toMatchObject({
      model: "deepseek-v4-pro",
      thinking: { type: "enabled" },
      reasoning_effort: "max",
    });
  });

  it("adds usage streaming but never sends Anthropic cache_control on the compatible route", () => {
    const adapter = getProviderAdapter("deepseek");
    const profile = makeDeepSeekProfile({ model: "deepseek-chat" });

    const variants = adapter.prepareRequest(
      { profile, reasoningEnabled: true, reasoningEffort: "high" },
      { messages: [{ role: "user", content: "hi" }] },
    );

    expect(variants[0]?.body).toMatchObject({
      stream_options: {
        include_usage: true,
      },
    });
    expect(JSON.stringify(variants[0]?.body)).not.toContain("cache_control");
  });

  it("deepseek-v4-flash: disables thinking when the execution plan turns reasoning off", () => {
    const adapter = getProviderAdapter("deepseek");
    const profile = makeDeepSeekProfile({ model: "deepseek-v4-flash" });

    const variants = adapter.prepareRequest(
      { profile, reasoningEnabled: false, reasoningEffort: "high" },
      { messages: [{ role: "user", content: "hi" }] },
    );

    expect(variants[0]?.body).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
    });
    expect(variants[0]?.body).not.toHaveProperty("reasoning_effort");
  });

  it("deepseek-v4-pro: keeps explicit requestBody thinking overrides authoritative", () => {
    const adapter = getProviderAdapter("deepseek");
    const profile = makeDeepSeekProfile({
      model: "deepseek-v4-pro",
      requestBody: {
        thinking: { type: "disabled" },
      },
    });

    const variants = adapter.prepareRequest(
      { profile, reasoningEnabled: true, reasoningEffort: "xhigh" },
      { messages: [{ role: "user", content: "hi" }] },
    );

    expect(variants[0]?.body).toMatchObject({
      thinking: { type: "disabled" },
    });
    expect(variants[0]?.body).not.toHaveProperty("reasoning_effort");
  });
});
