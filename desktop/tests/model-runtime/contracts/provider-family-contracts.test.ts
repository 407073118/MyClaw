import { describe, expect, it } from "vitest";

import type { ChatSession, ExecutionPlan, ProviderFamily, ProtocolTarget, TurnExecutionPlan } from "@shared/contracts";
import { PROVIDER_FAMILY_VALUES, PROTOCOL_TARGET_VALUES, SESSION_RUNTIME_VERSION } from "@shared/contracts";

describe("provider family contracts", () => {
  it("round-trips provider families and protocol targets", () => {
    const payload = JSON.parse(JSON.stringify({
      families: PROVIDER_FAMILY_VALUES,
      protocols: PROTOCOL_TARGET_VALUES,
    })) as {
      families: ProviderFamily[];
      protocols: ProtocolTarget[];
    };

    expect(payload.families).toContain("openai-native");
    expect(payload.families).toContain("volcengine-ark");
    expect(payload.protocols).toEqual([
      "openai-responses",
      "anthropic-messages",
      "openai-chat-compatible",
    ]);
  });

  it("serializes turn execution plans without breaking legacy sessions", () => {
    const legacyExecutionPlan: ExecutionPlan = {
      runtimeVersion: SESSION_RUNTIME_VERSION,
      adapterId: "openai-compatible",
      adapterSelectionSource: "profile",
      reasoningMode: "auto",
      replayPolicy: "assistant-turn",
      fallbackAdapterIds: [],
    };
    const turnExecutionPlan: TurnExecutionPlan = {
      runtimeVersion: SESSION_RUNTIME_VERSION,
      legacyExecutionPlan,
      providerFamily: "generic-openai-compatible",
      protocolTarget: "openai-chat-compatible",
      selectedModelProfileId: "profile-1",
      experienceProfileId: "balanced",
      promptPolicyId: "generic.prompt.default",
      taskPolicyId: "generic.task.default",
      toolPolicyId: "generic.tools.default",
      contextPolicyId: "generic.context.default",
      reliabilityPolicyId: "generic.reliability.default",
      replayMode: "none",
      cacheMode: "none",
      multimodalMode: "canonical-parts",
      toolCompileTarget: "generic-openai-compatible",
      fallbackCandidates: [],
      telemetryTags: { providerFamily: "generic-openai-compatible" },
    };
    const session: ChatSession = {
      id: "session-1",
      title: "contract",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      createdAt: "2026-04-10T00:00:00.000Z",
      messages: [],
      executionPlan: legacyExecutionPlan as ChatSession["executionPlan"],
      turnExecutionPlan,
    };

    const parsed = JSON.parse(JSON.stringify(session)) as ChatSession;
    expect(parsed.executionPlan?.adapterId).toBe("openai-compatible");
    expect(parsed.turnExecutionPlan?.providerFamily).toBe("generic-openai-compatible");
    expect(parsed.turnExecutionPlan?.protocolTarget).toBe("openai-chat-compatible");
  });
});
