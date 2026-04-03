import { describe, expect, it } from "vitest";

import { normalizeAnthropicCatalog } from "../src/main/services/provider-capability-probers/anthropic";
import { normalizeLocalGatewayCatalog } from "../src/main/services/provider-capability-probers/local-gateway";
import { normalizeOllamaCatalog } from "../src/main/services/provider-capability-probers/ollama";
import { normalizeOpenAiCompatibleCatalog } from "../src/main/services/provider-capability-probers/openai-compatible";
import { normalizeOpenRouterCatalog } from "../src/main/services/provider-capability-probers/openrouter";
import { normalizeVercelGatewayCatalog } from "../src/main/services/provider-capability-probers/vercel-ai-gateway";

describe("provider capability probers", () => {
  it("normalizes OpenRouter-like payloads", () => {
    const items = normalizeOpenRouterCatalog(
      {
        data: [
          {
            id: "openai/gpt-4.1",
            name: "GPT-4.1",
            context_length: 1047576,
            top_provider: { max_completion_tokens: 32768 },
            supported_parameters: ["tools", "stream"],
          },
        ],
      },
      "openai-compatible",
      "openrouter",
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("openai/gpt-4.1");
    expect(items[0]?.contextWindowTokens).toBe(1047576);
    expect(items[0]?.maxOutputTokens).toBe(32768);
    expect(items[0]?.source).toBe("provider-catalog");
  });

  it("normalizes Vercel gateway-like payloads", () => {
    const items = normalizeVercelGatewayCatalog(
      {
        data: [
          {
            id: "openai/gpt-4.1-mini",
            name: "GPT-4.1 mini",
            context_window: 1047576,
            max_tokens: 32768,
            supported_parameters: ["tools", "stream"],
          },
        ],
      },
      "openai-compatible",
      "vercel-ai-gateway",
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("openai/gpt-4.1-mini");
    expect(items[0]?.contextWindowTokens).toBe(1047576);
    expect(items[0]?.maxOutputTokens).toBe(32768);
    expect(items[0]?.source).toBe("provider-catalog");
  });

  it("normalizes Ollama-like payloads", () => {
    const items = normalizeOllamaCatalog(
      {
        models: [
          {
            name: "llama3.1:8b",
            details: { context_length: 8192 },
          },
        ],
      },
      "local-gateway",
      "ollama",
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("llama3.1:8b");
    expect(items[0]?.contextWindowTokens).toBe(8192);
    expect(items[0]?.source).toBe("provider-catalog");
  });

  it("normalizes generic openai-compatible payloads with ID-only data", () => {
    const items = normalizeOpenAiCompatibleCatalog(
      { data: [{ id: "gpt-4o-mini" }, { id: "qwen-plus" }] },
      "openai-compatible",
      "generic-openai-compatible",
    );

    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe("gpt-4o-mini");
    expect(items[1]?.id).toBe("qwen-plus");
    expect(items[0]?.source).toBe("provider-catalog");
  });

  it("normalizes anthropic payloads without rich capability fields", () => {
    const items = normalizeAnthropicCatalog(
      { data: [{ id: "claude-sonnet-4-20250514" }] },
      "anthropic",
      "anthropic",
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("claude-sonnet-4-20250514");
    expect(items[0]?.provider).toBe("anthropic");
    expect(items[0]?.source).toBe("provider-catalog");
  });

  it("normalizes local gateway payloads with generic IDs", () => {
    const items = normalizeLocalGatewayCatalog(
      { data: [{ id: "local-model-1" }] },
      "local-gateway",
      "generic-local-gateway",
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("local-model-1");
    expect(items[0]?.provider).toBe("local-gateway");
  });
});
