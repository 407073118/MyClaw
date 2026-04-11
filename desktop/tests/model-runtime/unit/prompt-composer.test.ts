import { describe, expect, it } from "vitest";

import { composePromptSections, renderPromptSections } from "../../../src/main/services/model-runtime/prompt-composer";
import type { ChatSession } from "@shared/contracts";

const session: ChatSession = {
  id: "session-1",
  title: "Prompt",
  modelProfileId: "profile-1",
  attachedDirectory: "/repo",
  createdAt: "2026-04-10T00:00:00.000Z",
  messages: [],
};

describe("prompt composer", () => {
  it("renders layered sections with family overlay", () => {
    const sections = composePromptSections({
      session,
      workingDir: "/repo",
      providerFamily: "qwen-dashscope",
      experienceProfileId: "qwen-best",
      promptPolicyId: "qwen.responses.default",
      toolPolicyId: "qwen.tools.conservative",
      reasoningProfileId: "qwen.reasoning.responses",
      gitBranch: "main",
      enrichedContextBlock: "Context block",
      skills: [],
      mcpTools: [],
    });
    const rendered = renderPromptSections(sections);

    expect(sections.some((section) => section.layer === "family-overlay")).toBe(true);
    expect(rendered).toContain("Provider family: qwen-dashscope");
    expect(rendered).toContain("Assume compatible transport and conservative tool compilation.");
    expect(rendered).toContain("Prefer explicit tool intent before execution.");
    expect(rendered).not.toContain("browser_evaluate");
    expect(rendered).not.toContain("exec_command");
    expect(rendered).not.toContain("git_commit");
    expect(rendered).toContain("git_status");
    expect(rendered).toContain("Tool policy: qwen.tools.conservative");
    expect(rendered).toContain("Reasoning profile: qwen.reasoning.responses");
    expect(rendered).toContain("Prefer medium/high effort for multi-step code and analysis turns.");
    expect(rendered).toContain("Git branch: main");
  });
});
