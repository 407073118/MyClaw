import type { ExecutionPlan, ModelProfile } from "@shared/contracts";

export function makeLegacyExecutionPlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    runtimeVersion: 1,
    adapterId: "openai-compatible",
    adapterSelectionSource: "profile",
    reasoningMode: "auto",
    replayPolicy: "content-only",
    fallbackAdapterIds: [],
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "profile-1",
    name: "Test Profile",
    provider: "openai-compatible",
    providerFlavor: "generic-openai-compatible",
    baseUrl: "https://api.example.com/v1",
    apiKey: "test-key",
    model: "gpt-4.1-mini",
    headers: {},
    requestBody: {},
    ...overrides,
  };
}
