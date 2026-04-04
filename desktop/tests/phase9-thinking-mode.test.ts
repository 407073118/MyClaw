import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ModelProfile } from "@shared/contracts";
import type { MyClawPaths } from "../src/main/services/directory-service";
import { resolveModelCapability } from "../src/main/services/model-capability-resolver";
import { buildReasoningExecutionPlan, resolveSessionThinkingState } from "../src/main/services/reasoning-runtime";
import { loadPersistedState, saveSession } from "../src/main/services/state-persistence";

function buildProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "phase9-profile",
    name: "Phase 9 Profile",
    provider: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "test-key",
    model: "gpt-test",
    ...overrides,
  };
}

describe("phase 9 thinking mode groundwork", () => {
  it("defaults reasoning-specific capability flags to disabled for unknown providers", () => {
    const profile = buildProfile({
      providerFlavor: "generic-openai-compatible",
      model: "custom-model",
    });

    const resolved = resolveModelCapability(profile, { registryCapability: null });

    expect(resolved.effective.supportsReasoning).toBe(false);
    expect(resolved.effective.supportsEffort).toBe(false);
    expect(resolved.effective.requiresReasoningReplay).toBe(false);
    expect(resolved.effective.preferredProtocol).toBe("openai-compatible");
  });

  it("infers anthropic protocol preference from provider metadata", () => {
    const profile = buildProfile({
      provider: "anthropic",
      providerFlavor: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-20250514",
    });

    const resolved = resolveModelCapability(profile);

    expect(resolved.effective.preferredProtocol).toBe("anthropic");
  });

  it("builds an openai-compatible reasoning patch when thinking is enabled", () => {
    const thinkingState = resolveSessionThinkingState({
      thinkingEnabled: true,
      thinkingSource: "user-toggle",
    });

    const plan = buildReasoningExecutionPlan({
      thinkingState,
      capability: {
        source: "manual-override",
        supportsReasoning: true,
        supportsEffort: true,
        preferredProtocol: "openai-compatible",
        requiresReasoningReplay: false,
      },
      profile: {
        provider: "openai-compatible",
        providerFlavor: "openai",
        model: "gpt-5.4",
      },
    });

    expect(plan.enabled).toBe(true);
    expect(plan.degradedReason).toBeNull();
    expect(plan.bodyPatch).toEqual({
      reasoning: {
        effort: "medium",
      },
    });
  });

  it("normalizes persisted sessions with default thinking state", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "myclaw-phase9-"));
    const paths: MyClawPaths = {
      rootDir,
      myClawDir: join(rootDir, "myClaw"),
      skillsDir: join(rootDir, "myClaw", "skills"),
      sessionsDir: join(rootDir, "myClaw", "sessions"),
      modelsDir: join(rootDir, "myClaw", "models"),
      settingsFile: join(rootDir, "myClaw", "settings.json"),
    };

    try {
      await saveSession(paths, {
        id: "session-1",
        title: "Phase 9 Session",
        modelProfileId: "profile-1",
        attachedDirectory: null,
        createdAt: "2026-04-04T00:00:00.000Z",
        messages: [],
      });

      const state = loadPersistedState(paths);

      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0]?.thinkingEnabled).toBe(false);
      expect(state.sessions[0]?.thinkingSource).toBe("default");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
