import { describe, expect, it } from "vitest";

import type { ModelProfile } from "@shared/contracts";
import { getProviderAdapter } from "../../../src/main/services/provider-adapters";

function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "profile-1",
    name: "Profile",
    provider: "openai-compatible",
    providerFlavor: "generic-openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "test-key",
    model: "gpt-test",
    headers: {},
    requestBody: {},
    ...overrides,
  };
}

describe("vendor adapter behavior", () => {
  it("adds OpenAI-native compatible request patches and a fallback variant", () => {
    const adapter = getProviderAdapter("openai-native");
    const profile = makeProfile({
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1",
    });

    const variants = adapter.prepareRequest(
      { profile, reasoningEffort: "high" },
      {
        messages: adapter.materializeReplayMessages(
          { profile, reasoningEffort: "high" },
          { messages: [{ role: "user", content: "hello" }] },
        ),
      },
    );

    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatchObject({
      id: "primary",
      body: {
        model: "gpt-4.1",
        parallel_tool_calls: false,
        stream_options: {
          include_usage: true,
        },
        reasoning: {
          effort: "high",
        },
      },
    });
    expect(variants[1]).toMatchObject({
      id: "compatibility-fallback",
      fallbackReason: "openai_native_vendor_patch_unsupported",
    });
    expect(variants[1]?.body).not.toHaveProperty("stream_options");
    expect(variants[1]?.body).not.toHaveProperty("parallel_tool_calls");
  });

  it("builds anthropic-native message bodies with system separation and input_schema tools", () => {
    const adapter = getProviderAdapter("anthropic-native");
    const profile = makeProfile({
      provider: "anthropic",
      providerFlavor: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-3-7-sonnet",
    });

    const variants = adapter.prepareRequest(
      { profile, reasoningEffort: "high" },
      {
        messages: adapter.materializeReplayMessages(
          { profile, reasoningEffort: "high" },
          {
            messages: [
              { role: "system", content: "You are helpful" },
              { role: "user", content: "hello" },
            ],
            tools: [{
              type: "function",
              function: {
                name: "fs_read",
                description: "Read file contents",
                parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
              },
            }],
          },
        ),
        tools: [{
          type: "function",
          function: {
            name: "fs_read",
            description: "Read file contents",
            parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
          },
        }],
      },
    );

    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      id: "primary",
      body: {
        model: "claude-3-7-sonnet",
        system: "You are helpful",
        messages: [{ role: "user", content: "hello" }],
        thinking: {
          type: "enabled",
          budget_tokens: 32768,
        },
        tools: [{
          name: "fs_read",
          description: "Read file contents",
          input_schema: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
          },
        }],
      },
    });
  });

  it("uses Qwen-native thinking fields, tool constraints, and clean fallback sanitization", () => {
    const adapter = getProviderAdapter("qwen");
    const profile = makeProfile({
      providerFlavor: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-max",
      requestBody: {
        enable_search: true,
        search_options: {
          forced: true,
        },
        enable_code_interpreter: true,
      },
    });

    const variants = adapter.prepareRequest(
      { profile, reasoningEffort: "high" },
      {
        messages: adapter.materializeReplayMessages(
          { profile, reasoningEffort: "high" },
          {
            messages: [{ role: "user", content: "hello" }],
            tools: [{
              type: "function",
              function: {
                name: "lookup_weather",
                description: "Lookup weather",
                parameters: { type: "object", properties: {} },
              },
            }],
          },
        ),
        tools: [{
          type: "function",
          function: {
            name: "lookup_weather",
            description: "Lookup weather",
            parameters: { type: "object", properties: {} },
          },
        }],
      },
    );

    expect(variants).toHaveLength(2);
    expect(variants[0]?.body).toMatchObject({
      enable_thinking: true,
      thinking_budget: 8192,
      enable_search: true,
      search_options: {
        forced: true,
      },
      enable_code_interpreter: true,
    });
    expect(variants[0]?.body).not.toHaveProperty("reasoning");
    expect(variants[0]?.body).not.toHaveProperty("tool_choice");
    expect(variants[1]).toMatchObject({
      id: "compatibility-fallback",
      fallbackReason: "qwen_vendor_patch_unsupported",
    });
    expect(variants[1]?.body).toMatchObject({
      tool_choice: "auto",
    });
    expect(variants[1]?.body).not.toHaveProperty("enable_thinking");
    expect(variants[1]?.body).not.toHaveProperty("thinking_budget");
    expect(variants[1]?.body).not.toHaveProperty("enable_search");
    expect(variants[1]?.body).not.toHaveProperty("search_options");
    expect(variants[1]?.body).not.toHaveProperty("enable_code_interpreter");
  });

  it("disables Qwen thinking controls for unsupported coder models", () => {
    const adapter = getProviderAdapter("qwen");
    const profile = makeProfile({
      providerFlavor: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen3-coder-plus",
    });

    const variants = adapter.prepareRequest(
      { profile, reasoningEffort: "xhigh" },
      {
        messages: adapter.materializeReplayMessages(
          { profile, reasoningEffort: "xhigh" },
          { messages: [{ role: "user", content: "hello" }] },
        ),
      },
    );

    expect(variants[0]?.body).not.toHaveProperty("enable_thinking");
    expect(variants[0]?.body).not.toHaveProperty("thinking_budget");
  });

  it("keeps preserve_thinking only for the Qwen chat models that officially support it", () => {
    const supportedProfile = makeProfile({
      providerFlavor: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen3.6-plus",
      requestBody: {
        preserve_thinking: true,
      },
    });

    const supportedVariants = getProviderAdapter("qwen").prepareRequest(
      { profile: supportedProfile, reasoningEffort: "medium" },
      {
        messages: [{ role: "user", content: "hello" }],
      },
    );

    expect(supportedVariants[0]?.body).toMatchObject({
      preserve_thinking: true,
    });
    expect(supportedVariants[1]?.body).not.toHaveProperty("preserve_thinking");

    const unsupportedProfile = makeProfile({
      providerFlavor: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-max",
      requestBody: {
        preserve_thinking: true,
      },
    });
    const unsupportedVariants = getProviderAdapter("qwen").prepareRequest(
      { profile: unsupportedProfile, reasoningEffort: "medium" },
      {
        messages: [{ role: "user", content: "hello" }],
      },
    );

    expect(unsupportedVariants[0]?.body).not.toHaveProperty("preserve_thinking");
    expect(unsupportedVariants[1]?.body).not.toHaveProperty("preserve_thinking");
  });

  it("lets kimi carry compatible reasoning breadcrumbs but downgrade request patches cleanly", () => {
    const adapter = getProviderAdapter("kimi");
    const profile = makeProfile({
      providerFlavor: "moonshot",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2-0905-preview",
    });

    const replayMessages = adapter.materializeReplayMessages(
      { profile, reasoningEffort: "high" },
      {
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "answer", reasoning: "step one\nstep two" },
        ],
      },
    );
    const variants = adapter.prepareRequest(
      { profile, reasoningEffort: "high" },
      { messages: replayMessages },
    );

    expect(replayMessages[1]).toMatchObject({
      role: "assistant",
      content: "answer",
      reasoning_content: "step one\nstep two",
    });
    expect(variants).toHaveLength(2);
    expect(variants[0]?.body).toMatchObject({
      thinking: {
        type: "enabled",
      },
    });
    expect(variants[1]).toMatchObject({
      id: "compatibility-fallback",
      fallbackReason: "kimi_vendor_patch_unsupported",
    });
    expect(variants[1]?.body).not.toHaveProperty("thinking");
  });

  it("adds ark-specific compatible request patches with a dedicated fallback reason", () => {
    const adapter = getProviderAdapter("volcengine-ark");
    const profile = makeProfile({
      providerFlavor: "volcengine-ark",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-seed-code",
    });

    const variants = adapter.prepareRequest(
      { profile, reasoningEffort: "high" },
      {
        messages: adapter.materializeReplayMessages(
          { profile, reasoningEffort: "high" },
          { messages: [{ role: "user", content: "hello" }] },
        ),
      },
    );

    expect(variants).toHaveLength(2);
    expect(variants[0]?.body).toMatchObject({
      reasoning: {
        effort: "high",
      },
      stream_options: {
        include_usage: true,
      },
    });
    expect(variants[1]).toMatchObject({
      fallbackReason: "ark_vendor_patch_unsupported",
    });
    expect(variants[1]?.body).not.toHaveProperty("stream_options");
  });

  it("sanitizes public minimax compatible requests instead of behaving like a pure generic alias", () => {
    const adapter = getProviderAdapter("minimax");
    const profile = makeProfile({
      providerFlavor: "minimax-anthropic",
      baseUrl: "https://api.minimax.chat/v1",
      model: "minimax-text-01",
      requestBody: {
        temperature: 0.8,
        presence_penalty: 1,
        frequency_penalty: 1,
        function_call: "auto",
      },
    });

    const variants = adapter.prepareRequest(
      { profile, reasoningEffort: "high" },
      {
        messages: adapter.materializeReplayMessages(
          { profile, reasoningEffort: "high" },
          { messages: [{ role: "user", content: "hello" }] },
        ),
      },
    );

    expect(variants).toHaveLength(2);
    expect(variants[0]?.body).toMatchObject({
      model: "minimax-text-01",
      temperature: 0.8,
    });
    expect(variants[0]?.body).not.toHaveProperty("presence_penalty");
    expect(variants[0]?.body).not.toHaveProperty("frequency_penalty");
    expect(variants[0]?.body).not.toHaveProperty("function_call");
    expect(variants[1]).toMatchObject({
      fallbackReason: "minimax_vendor_patch_unsupported",
    });
    expect(variants[1]?.body).not.toHaveProperty("reasoning");
  });
});
