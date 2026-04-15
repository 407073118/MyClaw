import { describe, expect, it } from "vitest";

import { resolveBackgroundModePolicy } from "../../../src/main/services/model-runtime/background-mode-policy";
import { makeProfile } from "../contracts/test-helpers";

describe("background mode policy", () => {
  it("enables background mode for session-scoped deep research models by default", () => {
    const profile = makeProfile({
      providerFlavor: "openai",
      providerFamily: "openai-native",
      protocolTarget: "openai-responses",
      model: "o3-deep-research",
    });

    const policy = resolveBackgroundModePolicy({
      profile,
      protocolTarget: "openai-responses",
      capabilityRoutes: [
        {
          capabilityId: "research-task",
          routeType: "vendor-native",
          providerFamily: "openai-native",
          protocolTarget: "openai-responses",
          nativeToolName: "background_response",
          fallbackToolChain: [],
          reason: "native_background_available",
        },
      ],
      sessionId: "session-1",
      workflowRunId: null,
    });

    expect(policy).toEqual({
      enabled: true,
      reason: "deep_research_model",
      pollAfterMs: 2000,
    });
  });

  it("keeps workflow turns in the foreground even when the model supports native background execution", () => {
    const profile = makeProfile({
      providerFlavor: "openai",
      providerFamily: "openai-native",
      protocolTarget: "openai-responses",
      model: "o3-deep-research",
    });

    const policy = resolveBackgroundModePolicy({
      profile,
      protocolTarget: "openai-responses",
      capabilityRoutes: [
        {
          capabilityId: "research-task",
          routeType: "vendor-native",
          providerFamily: "openai-native",
          protocolTarget: "openai-responses",
          nativeToolName: "background_response",
          fallbackToolChain: [],
          reason: "native_background_available",
        },
      ],
      sessionId: null,
      workflowRunId: "wf-run-1",
    });

    expect(policy).toEqual({
      enabled: false,
      reason: "workflow_foreground_only",
      pollAfterMs: 2000,
    });
  });

  it("respects explicit profile overrides for always-on background mode", () => {
    const profile = makeProfile({
      providerFlavor: "openai",
      providerFamily: "openai-native",
      protocolTarget: "openai-responses",
      model: "gpt-5.4",
      responsesApiConfig: {
        backgroundMode: "always",
        backgroundPollIntervalMs: 4500,
      },
    });

    const policy = resolveBackgroundModePolicy({
      profile,
      protocolTarget: "openai-responses",
      capabilityRoutes: [
        {
          capabilityId: "research-task",
          routeType: "vendor-native",
          providerFamily: "openai-native",
          protocolTarget: "openai-responses",
          nativeToolName: "background_response",
          fallbackToolChain: [],
          reason: "native_background_available",
        },
      ],
      sessionId: "session-1",
      workflowRunId: null,
    });

    expect(policy).toEqual({
      enabled: true,
      reason: "profile_always",
      pollAfterMs: 4500,
    });
  });
});
