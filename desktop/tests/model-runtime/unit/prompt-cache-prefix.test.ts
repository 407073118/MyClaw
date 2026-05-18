import { describe, expect, it, vi } from "vitest";

import type { ChatSession } from "@shared/contracts";
import {
  composePromptSections,
  renderPromptSectionsByCacheTier,
} from "../../../src/main/services/model-runtime/prompt-composer";

const session: ChatSession = {
  id: "session-cache-prefix",
  title: "Prompt cache",
  modelProfileId: "profile-1",
  attachedDirectory: "/repo",
  createdAt: "2026-05-16T00:00:00.000Z",
  messages: [],
};

describe("prompt cache prefix", () => {
  it("keeps stable prefix identical when only clock seconds change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T10:00:00Z"));
    const first = composePromptSections({
      session,
      workingDir: "/repo",
      providerFamily: "deepseek",
      experienceProfileId: "balanced",
      skills: [],
      mcpTools: [],
    });

    vi.setSystemTime(new Date("2026-05-16T10:00:05Z"));
    const second = composePromptSections({
      session,
      workingDir: "/repo",
      providerFamily: "deepseek",
      experienceProfileId: "balanced",
      skills: [],
      mcpTools: [],
    });

    expect(renderPromptSectionsByCacheTier(first).stablePrefixText)
      .toBe(renderPromptSectionsByCacheTier(second).stablePrefixText);
    expect(renderPromptSectionsByCacheTier(first).volatileTailText)
      .not.toBe(renderPromptSectionsByCacheTier(second).volatileTailText);
    vi.useRealTimers();
  });

  it("keeps stable prefix independent from semi-stable environment fields", () => {
    const first = composePromptSections({
      session,
      workingDir: "/repo-a",
      providerFamily: "deepseek",
      experienceProfileId: "balanced",
      gitBranch: "main",
      skills: [],
      mcpTools: [],
    });
    const second = composePromptSections({
      session,
      workingDir: "/repo-b",
      providerFamily: "deepseek",
      experienceProfileId: "balanced",
      gitBranch: "feature/cache",
      skills: [],
      mcpTools: [],
    });

    const firstRendered = renderPromptSectionsByCacheTier(first);
    const secondRendered = renderPromptSectionsByCacheTier(second);
    expect(firstRendered.stablePrefixText).toBe(secondRendered.stablePrefixText);
    expect(firstRendered.semiStableText).not.toBe(secondRendered.semiStableText);
  });
});
