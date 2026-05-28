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
    expect(JSON.stringify(variants[0]?.body.tools)).toContain("cache_control");
  });

  it("does not send Anthropic cache_control to Moonshot-compatible legacy routes by default", () => {
    const adapter = getProviderAdapter("anthropic-native");
    const profile = makeProfile({
      provider: "openai-compatible",
      providerFlavor: "moonshot",
      baseUrl: "https://api.moonshot.cn/v1",
      model: "kimi-k2-0905-preview",
    });

    const variants = adapter.prepareRequest(
      { profile },
      {
        messages: [{ role: "user", content: "hello" }],
        tools: [{
          type: "function",
          function: {
            name: "search",
            description: "Search docs",
            parameters: { type: "object", properties: {}, required: [] },
          },
        }],
      },
    );

    expect(JSON.stringify(variants[0]?.body)).not.toContain("cache_control");
  });

  it("uses adaptive thinking for Claude Opus 4.7 in legacy anthropic adapter path", () => {
    const adapter = getProviderAdapter("anthropic-native");
    const profile = makeProfile({
      provider: "anthropic",
      providerFlavor: "anthropic",
      baseUrl: "http://13.250.152.8:3000",
      model: "global.anthropic.claude-opus-4-7",
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

    expect(variants[0]?.body).toMatchObject({
      thinking: {
        type: "adaptive",
        display: "summarized",
      },
      output_config: {
        effort: "high",
      },
    });
    expect(JSON.stringify(variants[0]?.body)).not.toContain("budget_tokens");
  });

  it("keeps precompiled anthropic input_schema tools in legacy anthropic adapter path", () => {
    const adapter = getProviderAdapter("anthropic-native");
    const profile = makeProfile({
      provider: "anthropic",
      providerFlavor: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-3-7-sonnet",
    });

    const variants = adapter.prepareRequest(
      { profile },
      {
        messages: [{ role: "user", content: "read package.json" }],
        tools: [{
          name: "fs_read",
          description: "Read file contents",
          input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        } as never],
      },
    );

    expect(variants[0]?.body.tools).toEqual([{
      name: "fs_read",
      description: "Read file contents",
      input_schema: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
      cache_control: { type: "ephemeral" },
    }]);
  });

  it("materializes legacy anthropic replay with tool_use and tool_result blocks", () => {
    const adapter = getProviderAdapter("anthropic-native");
    const profile = makeProfile({
      provider: "anthropic",
      providerFlavor: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-3-7-sonnet",
      requestBody: {
        temperature: 0.1,
      },
    });

    const variants = adapter.prepareRequest(
      { profile, reasoningEffort: "high" },
      {
        messages: adapter.materializeReplayMessages(
          { profile, reasoningEffort: "high" },
          {
            messages: [
              { role: "user", content: "Read package metadata" },
              {
                role: "assistant",
                content: "I will inspect it.",
                tool_calls: [{
                  id: "toolu_legacy",
                  type: "function",
                  function: {
                    name: "fs_read",
                    arguments: "{\"path\":\"package.json\"}",
                  },
                }],
              },
              {
                role: "tool",
                content: "{\"name\":\"myclaw\"}",
                tool_call_id: "toolu_legacy",
              },
            ],
          },
        ),
      },
    );

    const body = variants[0]?.body as Record<string, unknown>;
    const messages = body.messages as unknown[];
    expect(JSON.stringify(messages)).not.toContain("\"role\":\"tool\"");
    expect(JSON.stringify(messages)).not.toContain("\"tool_calls\"");
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "I will inspect it." },
        {
          type: "tool_use",
          id: "toolu_legacy",
          name: "fs_read",
          input: { path: "package.json" },
        },
      ],
    });
    expect(messages[2]).toEqual({
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_legacy",
        content: "{\"name\":\"myclaw\"}",
      }],
    });
    expect(body.max_tokens).toBeGreaterThan(32768);
    expect(body.temperature).toBe(0.1);
  });

  it("keeps legacy anthropic runtime system reminders in message order", () => {
    const adapter = getProviderAdapter("anthropic-native");
    const profile = makeProfile({
      provider: "anthropic",
      providerFlavor: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-3-7-sonnet",
    });

    const variants = adapter.prepareRequest(
      { profile, reasoningEffort: "medium" },
      {
        messages: [
          { role: "system", content: "You are helpful" },
          { role: "user", content: "开始执行任务" },
          { role: "assistant", content: "我已经输出阶段性结果。" },
          { role: "system", content: "[任务未完成] 请继续按计划推进任务。" },
        ],
      },
    );

    const body = variants[0]?.body as Record<string, unknown>;
    const messages = body.messages as Array<{ role: string; content: unknown }>;

    expect(body.system).toBe("You are helpful");
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: "[任务未完成] 请继续按计划推进任务。",
    });
  });

  it("normalizes legacy Anthropic JSON usage with cache-aware token totals", () => {
    const adapter = getProviderAdapter("anthropic-native");

    const result = adapter.normalizeResponse({
      content: [{ type: "text", text: "cached response" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 50,
        cache_read_input_tokens: 100000,
        cache_creation_input_tokens: 200,
        output_tokens: 20,
      },
    });

    expect(result.usage).toMatchObject({
      promptTokens: 100250,
      completionTokens: 20,
      totalTokens: 100270,
      cacheReadInputTokens: 100000,
      cacheWriteInputTokens: 200,
      cacheHitInputTokens: 100000,
      cacheMissInputTokens: 250,
    });
    expect(result.usage?.cacheEfficiency).toBeCloseTo(100000 / 100250);
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
    expect(variants[1]?.body).toMatchObject({
      stream_options: {
        include_usage: true,
      },
    });
  });

  it("keeps Ark runtime function tools when custom requestBody contains native tools", () => {
    const adapter = getProviderAdapter("volcengine-ark");
    const runtimeTools = [{
      type: "function" as const,
      function: {
        name: "fs_read",
        description: "Read file contents",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          required: ["path"],
        },
      },
    }];
    const profile = makeProfile({
      providerFlavor: "volcengine-ark",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-seed-code",
      requestBody: {
        temperature: 0.2,
        tools: [{ type: "web_search" }],
      },
    });

    const variants = adapter.prepareRequest(
      { profile, reasoningEffort: "medium" },
      {
        messages: [{ role: "user", content: "read package.json" }],
        tools: runtimeTools,
      },
    );

    expect(variants[0]?.body).toMatchObject({
      temperature: 0.2,
      tools: runtimeTools,
      tool_choice: "auto",
    });
    expect(variants[1]?.body).toMatchObject({
      tools: runtimeTools,
      tool_choice: "auto",
    });
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
