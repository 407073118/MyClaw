import { describe, expect, it } from "vitest";

import { createBrMiniMaxProfile } from "@shared/br-minimax";
import type {
  ChatMessage,
  ChatSession,
  ModelCapability,
  ModelProfile,
} from "@shared/contracts";
import { resolveModelCapability } from "../src/main/services/model-capability-resolver";
import { buildExecutionPlan } from "../src/main/services/reasoning-runtime";
import { assembleContext } from "../src/main/services/context-assembler";

/** 构造通用 provider profile，便于聚焦 Phase 2 降级链路。 */
function makeGenericProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "generic-profile",
    name: "Generic Provider",
    provider: "openai-compatible",
    providerFlavor: "generic-openai-compatible",
    baseUrl: "https://example.com/v1",
    apiKey: "test-key",
    model: "gpt-test",
    headers: {},
    requestBody: {},
    ...overrides,
  };
}

/** 构造具备稳定 budget 的 capability，避免测试被无关字段干扰。 */
function makeCapability(overrides: Partial<ModelCapability> = {}): ModelCapability {
  return {
    contextWindowTokens: 32768,
    maxInputTokens: 28672,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsStreaming: true,
    supportsReasoning: true,
    tokenCountingMode: "character-fallback",
    source: "registry",
    ...overrides,
  };
}

/** 构造带 reasoning 的最小会话，用于验证 replay 语义是否被保留。 */
function makeSession(messages: ChatMessage[]): ChatSession {
  return {
    id: "phase2-degradation-session",
    title: "Phase 2 Degradation Integration",
    modelProfileId: "profile-1",
    attachedDirectory: "/tmp/project",
    createdAt: "2026-04-06T00:00:00.000Z",
    messages,
  };
}

/** 构造基础对话轮，复用同一条 assistant reasoning 断言不同 provider 的 replay 结果。 */
function makeReasoningMessages(): ChatMessage[] {
  return [
    {
      id: "msg-user",
      role: "user",
      content: "Summarize the prior run",
      createdAt: "2026-04-06T00:00:00.000Z",
    },
    {
      id: "msg-assistant",
      role: "assistant",
      content: "Final answer",
      reasoning: "step one\nstep two",
      createdAt: "2026-04-06T00:00:01.000Z",
    },
  ];
}

/** 构造带 tool loop 的推理 transcript，用于验证降级后仅剥离 reasoning 而不破坏消息结构。 */
function makeToolLoopMessages(): ChatMessage[] {
  return [
    {
      id: "tool-loop-user",
      role: "user",
      content: "Should we call the weather tool?",
      createdAt: "2026-04-06T00:00:00.000Z",
    },
    {
      id: "tool-loop-assistant-call",
      role: "assistant",
      content: "",
      reasoning: "Need the tool result before answering.",
      tool_calls: [{
        id: "tool-1",
        type: "function",
        function: {
          name: "lookup_weather",
          arguments: "{\"city\":\"Shanghai\"}",
        },
      }],
      createdAt: "2026-04-06T00:00:01.000Z",
    },
    {
      id: "tool-loop-tool",
      role: "tool",
      tool_call_id: "tool-1",
      content: "{\"temperature\":22}",
      createdAt: "2026-04-06T00:00:02.000Z",
    },
    {
      id: "tool-loop-assistant-answer",
      role: "assistant",
      content: "It is 22C",
      reasoning: "Tool returned 22C.",
      createdAt: "2026-04-06T00:00:03.000Z",
    },
  ];
}

describe("Phase 2 degradation integration", () => {
  it("falls back safely when capability is unknown", () => {
    const profile = makeGenericProfile({
      model: "completely-unknown-model-xyz",
    });
    const resolvedCapability = resolveModelCapability(profile, {
      registryCapability: null,
      discoveredCapability: null,
    });
    const executionPlan = buildExecutionPlan({
      profile,
      capability: resolvedCapability.effective,
    });
    const assembled = assembleContext({
      session: makeSession(makeReasoningMessages()),
      capability: resolvedCapability.effective,
      workingDir: "/tmp/project",
      executionPlan,
    });

    expect(resolvedCapability.effective.source).toBe("default");
    expect(resolvedCapability.effective.contextWindowTokens).toBeGreaterThan(0);
    expect(resolvedCapability.effective.maxOutputTokens).toBeGreaterThan(0);
    expect(executionPlan).toMatchObject({
      adapterId: "openai-compatible",
      replayPolicy: "content-only",
      degradationReason: null,
    });
    expect(assembled.messages).toEqual([
      expect.objectContaining({ role: "system" }),
      { role: "user", content: "Summarize the prior run" },
      { role: "assistant", content: "Final answer" },
    ]);
  });

  it("records degradation reason when MiniMax cannot preserve reasoning", () => {
    const profile = createBrMiniMaxProfile({
      id: "br-degraded",
      apiKey: "br-test-key",
    });
    const executionPlan = buildExecutionPlan({
      profile,
      capability: makeCapability({ supportsReasoning: false }),
    });
    const assembled = assembleContext({
      session: makeSession(makeReasoningMessages()),
      capability: makeCapability({ supportsReasoning: false }),
      workingDir: "/tmp/project",
      executionPlan,
    });

    expect(executionPlan).toMatchObject({
      adapterId: "br-minimax",
      reasoningEnabled: false,
      replayPolicy: "assistant-turn",
      degradationReason: "capability-missing",
      planSource: "capability",
    });
    expect(assembled.messages[2]).toEqual({
      role: "assistant",
      content: "Final answer",
    });
  });

  it("keeps assistant and tool replay structure when MiniMax degrades to assistant-turn", () => {
    const profile = createBrMiniMaxProfile({
      id: "br-tool-loop-degraded",
      apiKey: "br-test-key",
    });
    const executionPlan = buildExecutionPlan({
      profile,
      capability: makeCapability({ supportsReasoning: false }),
    });
    const assembled = assembleContext({
      session: makeSession(makeToolLoopMessages()),
      capability: makeCapability({ supportsReasoning: false }),
      workingDir: "/tmp/project",
      executionPlan,
    });

    expect(executionPlan).toMatchObject({
      adapterId: "br-minimax",
      replayPolicy: "assistant-turn",
      degradationReason: "capability-missing",
    });
    expect(assembled.messages).toEqual([
      expect.objectContaining({ role: "system" }),
      { role: "user", content: "Should we call the weather tool?" },
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: "tool-1",
          type: "function",
          function: {
            name: "lookup_weather",
            arguments: "{\"city\":\"Shanghai\"}",
          },
        }],
      },
      {
        role: "tool",
        content: "{\"temperature\":22}",
        tool_call_id: "tool-1",
      },
      {
        role: "assistant",
        content: "It is 22C",
      },
    ]);
  });

  it("keeps replay-aware behavior for MiniMax when reasoning is supported", () => {
    const profile = createBrMiniMaxProfile({
      id: "br-replay-aware",
      apiKey: "br-test-key",
    });
    const executionPlan = buildExecutionPlan({
      profile,
      capability: makeCapability({ supportsReasoning: true }),
    });
    const assembled = assembleContext({
      session: makeSession(makeReasoningMessages()),
      capability: makeCapability({ supportsReasoning: true }),
      workingDir: "/tmp/project",
      executionPlan,
    });

    expect(executionPlan).toMatchObject({
      adapterId: "br-minimax",
      replayPolicy: "assistant-turn-with-reasoning",
      degradationReason: null,
    });
    expect(assembled.messages[2]).toEqual({
      role: "assistant",
      content: "Final answer",
      reasoning: "step one\nstep two",
    });
  });

  it("keeps generic providers on simpler replay semantics", () => {
    const profile = makeGenericProfile({
      model: "gpt-4.1",
    });
    const executionPlan = buildExecutionPlan({
      profile,
      capability: makeCapability({ supportsReasoning: true }),
    });
    const assembled = assembleContext({
      session: makeSession(makeReasoningMessages()),
      capability: makeCapability({ supportsReasoning: true }),
      workingDir: "/tmp/project",
      executionPlan,
    });

    expect(executionPlan).toMatchObject({
      adapterId: "openai-compatible",
      replayPolicy: "content-only",
      degradationReason: null,
    });
    expect(assembled.messages[2]).toEqual({
      role: "assistant",
      content: "Final answer",
    });
  });
});
