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
    expect(rendered).toContain("Prefer Qwen-native Responses features first, including continuation and vendor-native search/extractor tools.");
    expect(rendered).toContain("Prefer explicit tool intent and Responses-native continuation before execution.");
    // 工具分类引导始终包含完整工具列表；实际可用工具由 tool schema 层的 policy 过滤控制
    expect(rendered).toContain("fs_read");
    expect(rendered).toContain("git_status");
    expect(rendered).toContain("Tool policy: qwen.tools.conservative");
    expect(rendered).toContain("Reasoning profile: qwen.reasoning.responses");
    expect(rendered).toContain("Map effort into Qwen enable_thinking/thinking_budget and avoid forced tool_choice while thinking is enabled.");
    expect(rendered).toContain("Git branch: main");
    // Task planning 引导必须包含工具名和强制工作流
    expect(rendered).toContain("task_create");
    expect(rendered).toContain("Mandatory Workflow");
  });
});
