import { describe, expect, it } from "vitest";

import {
  resolveAllowedBuiltinToolGroups,
  resolveBlockedBuiltinToolNames,
  resolveDefaultExperienceProfileId,
  resolvePromptProfileLines,
  resolveReasoningProfileId,
  resolveReasoningProfileLines,
  resolvePromptOverlayLines,
  resolveRegistryToolCompileMode,
  resolveToolPolicySummaryLines,
} from "../../../src/main/services/model-runtime/vendor-policy-registry";

describe("vendor policy profile selection", () => {
  it("resolves prompt overlay lines from the registry", () => {
    expect(resolvePromptOverlayLines("qwen-dashscope")).toEqual(expect.arrayContaining([
      "Prefer Qwen-native Responses features first, including continuation and vendor-native search/extractor tools.",
      "When thinking is enabled, do not force tool_choice and do not rely on server-side continuity outside the current turn.",
    ]));
  });

  it("resolves experience profile defaults from the registry", () => {
    expect(resolveDefaultExperienceProfileId("openai-native")).toBe("gpt-best");
    expect(resolveDefaultExperienceProfileId("anthropic-native")).toBe("claude-best");
    expect(resolveDefaultExperienceProfileId("qwen-dashscope")).toBe("qwen-best");
  });

  it("resolves tool compile mode from the registry", () => {
    expect(resolveRegistryToolCompileMode("volcengine-ark")).toBe("openai-compatible-ark");
    expect(resolveRegistryToolCompileMode("generic-openai-compatible")).toBe("openai-compatible-relaxed");
  });

  it("resolves prompt and reasoning profiles from the registry", () => {
    expect(resolvePromptProfileLines("qwen.responses.default")).toEqual(expect.arrayContaining([
      "Prefer explicit tool intent and Responses-native continuation before execution.",
    ]));
    expect(resolveReasoningProfileId("openai-native", "openai-responses")).toBe("openai.reasoning.native");
    expect(resolveReasoningProfileId("br-minimax", "openai-chat-compatible")).toBe("minimax.reasoning.br-private");
  });

  it("resolves builtin tool restrictions from the tool profile", () => {
    expect(resolveBlockedBuiltinToolNames("qwen.tools.conservative")).toContain("browser_evaluate");
    expect(resolveBlockedBuiltinToolNames("qwen.tools.conservative")).toContain("exec_command");
    expect(resolveBlockedBuiltinToolNames("kimi.tools.conservative")).toContain("git_commit");
    expect(resolveBlockedBuiltinToolNames("ark.tools.coding")).toContain("ppt_generate");
    expect(resolveBlockedBuiltinToolNames("openai.tools.full")).toEqual([]);
    expect(resolveAllowedBuiltinToolGroups("qwen.tools.conservative")).toEqual(
      expect.arrayContaining(["fs", "git", "http", "web", "task", "browser"]),
    );
    expect(resolveAllowedBuiltinToolGroups("qwen.tools.conservative")).not.toContain("ppt");
  });

  it("resolves tool and reasoning profile summary lines", () => {
    expect(resolveToolPolicySummaryLines("qwen.tools.conservative")).toEqual(expect.arrayContaining([
      "Hide high-risk shell and browser script tools unless explicitly needed, and let Qwen native search/extractor cover the overlapping paths first.",
    ]));
    expect(resolveReasoningProfileLines("anthropic.reasoning.native")).toEqual(expect.arrayContaining([
      "Use Anthropic thinking budgets for deeper reasoning turns.",
    ]));
  });
});
