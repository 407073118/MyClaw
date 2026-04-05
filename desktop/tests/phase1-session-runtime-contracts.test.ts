import { describe, expect, it } from "vitest";

import type {
  ChatSession,
  ExecutionPlan,
  SessionRuntimeIntent,
} from "@shared/contracts";
import {
  SESSION_REPLAY_POLICY_VALUES,
  SESSION_RUNTIME_ADAPTER_VALUES,
  SESSION_RUNTIME_VERSION,
} from "@shared/contracts";

describe("Phase 1 session runtime contracts", () => {
  it("supports serializable runtime intent and execution plan shells", () => {
    const intent: SessionRuntimeIntent = {
      reasoningMode: "auto",
      reasoningEffort: "medium",
      adapterHint: "br-minimax",
      replayPolicy: "assistant-turn-with-reasoning",
    };

    const plan: ExecutionPlan = {
      runtimeVersion: SESSION_RUNTIME_VERSION,
      adapterId: "br-minimax",
      adapterSelectionSource: "profile",
      reasoningMode: "auto",
      replayPolicy: "assistant-turn-with-reasoning",
      fallbackAdapterIds: ["openai-compatible"],
    };

    const session: ChatSession = {
      id: "session-1",
      title: "Phase 1",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      runtimeVersion: SESSION_RUNTIME_VERSION,
      runtimeIntent: intent,
      messages: [],
    };

    const parsed = JSON.parse(JSON.stringify({ intent, plan, session })) as {
      intent: SessionRuntimeIntent;
      plan: ExecutionPlan;
      session: ChatSession;
    };

    expect(parsed.intent.adapterHint).toBe("br-minimax");
    expect(parsed.plan.fallbackAdapterIds).toEqual(["openai-compatible"]);
    expect(parsed.session.runtimeVersion).toBe(SESSION_RUNTIME_VERSION);
    expect(parsed.session.runtimeIntent?.replayPolicy).toBe("assistant-turn-with-reasoning");
  });

  it("exports replay and adapter runtime value lists", () => {
    expect(SESSION_REPLAY_POLICY_VALUES).toContain("content-only");
    expect(SESSION_REPLAY_POLICY_VALUES).toContain("assistant-turn-with-reasoning");
    expect(SESSION_RUNTIME_ADAPTER_VALUES).toEqual([
      "openai-compatible",
      "br-minimax",
    ]);
  });
});
