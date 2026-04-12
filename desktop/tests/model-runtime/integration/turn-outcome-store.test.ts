import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createTurnOutcomeId, listTurnOutcomes, readTurnOutcome, saveTurnOutcome, updateTurnOutcome } from "../../../src/main/services/model-runtime/turn-outcome-store";

describe("turn outcome store", () => {
  it("persists and reads outcomes", async () => {
    const myClawDir = mkdtempSync(join(tmpdir(), "myclaw-outcomes-"));
    const outcome = {
      id: createTurnOutcomeId(),
      sessionId: "session-1",
      providerFamily: "generic-openai-compatible" as const,
      vendorFamily: "generic-openai-compatible" as const,
      protocolTarget: "openai-chat-compatible" as const,
      modelProfileId: "profile-1",
      experienceProfileId: "balanced" as const,
      promptPolicyId: "prompt",
      taskPolicyId: "task",
      toolPolicyId: "tool",
      contextPolicyId: "context",
      reliabilityPolicyId: "reliability",
      retryCount: 0,
      toolCompileMode: "relaxed",
      replayMode: "none",
      startedAt: "2026-04-10T00:00:00.000Z",
      finishedAt: "2026-04-10T00:00:01.000Z",
      success: true,
      latencyMs: 1000,
      responseId: "resp_123",
    };

    await saveTurnOutcome({ myClawDir } as any, outcome as any);
    expect(await readTurnOutcome({ myClawDir } as any, outcome.id)).toMatchObject({
      sessionId: "session-1",
      responseId: "resp_123",
    });
    expect(await listTurnOutcomes({ myClawDir } as any, { sessionId: "session-1" })).toHaveLength(1);
  });

  it("updates outcomes without duplicating telemetry entries", async () => {
    const myClawDir = mkdtempSync(join(tmpdir(), "myclaw-outcomes-"));
    const outcome = {
      id: createTurnOutcomeId(),
      sessionId: "session-1",
      providerFamily: "generic-openai-compatible" as const,
      vendorFamily: "generic-openai-compatible" as const,
      protocolTarget: "openai-chat-compatible" as const,
      modelProfileId: "profile-1",
      experienceProfileId: "balanced" as const,
      promptPolicyId: "prompt",
      taskPolicyId: "task",
      toolPolicyId: "tool",
      contextPolicyId: "context",
      reliabilityPolicyId: "reliability",
      retryCount: 0,
      toolCompileMode: "relaxed",
      replayMode: "none",
      startedAt: "2026-04-10T00:00:00.000Z",
      finishedAt: "2026-04-10T00:00:01.000Z",
      success: true,
      latencyMs: 1000,
      responseId: "resp_123",
      telemetry: {
        experienceProfileId: "balanced" as const,
        promptPolicyId: "prompt",
        taskPolicyId: "task",
        toolPolicyId: "tool",
        contextPolicyId: "context",
        reliabilityPolicyId: "reliability",
        providerFamily: "generic-openai-compatible" as const,
        vendorFamily: "generic-openai-compatible" as const,
        protocolTarget: "openai-chat-compatible" as const,
        requestVariantId: "primary",
        retryCount: 0,
        success: true,
        latencyMs: 1000,
        toolCompileMode: "relaxed",
        replayMode: "none",
        fallbackEvents: [],
        createdAt: "2026-04-10T00:00:01.000Z",
      },
    };

    await saveTurnOutcome({ myClawDir } as any, outcome as any);
    await updateTurnOutcome({ myClawDir } as any, {
      ...outcome,
      toolCallCount: 2,
      toolSuccessCount: 1,
      contextStability: false,
    } as any);

    expect(await readTurnOutcome({ myClawDir } as any, outcome.id)).toMatchObject({
      toolCallCount: 2,
      toolSuccessCount: 1,
      contextStability: false,
    });

    const telemetryLines = readFileSync(join(myClawDir, "turn-telemetry.jsonl"), "utf-8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    expect(telemetryLines).toHaveLength(1);
  });
});
