import { describe, expect, it } from "vitest";

import type { CapabilityBundle, ChatSession } from "../shared/contracts";
import { composePromptSections } from "../src/main/services/model-runtime/prompt-composer";

/** 构造测试会话。 */
function session(): ChatSession {
  return {
    id: "session-1",
    title: "测试会话",
    modelProfileId: "model-1",
    attachedDirectory: null,
    messages: [],
    createdAt: "2026-05-18T00:00:00.000Z",
    runtimeVersion: 1,
  } as ChatSession;
}

/** 构造测试能力包。 */
function bundle(): CapabilityBundle {
  return {
    id: "bundle-1",
    hash: "hash-1",
    sessionId: "session-1",
    project: null,
    skills: [
      {
        source: "project",
        kind: "skill",
        id: "review",
        localProjectId: "project-1",
        capabilityRefId: "ref-1",
        installDir: "/project/review",
        functionName: "skill_invoke__project_crm_review",
        displayName: "CRM Review",
        description: "Project review skill",
      },
      {
        source: "global",
        kind: "skill",
        id: "brainstorming",
        functionName: "skill_invoke__global_brainstorming",
        displayName: "Brainstorming",
        description: "User brainstorming skill",
      },
    ],
    mcpTools: [],
    functionNameMap: {
      skill_invoke__project_crm_review: {
        source: "project",
        kind: "skill",
        id: "review",
        localProjectId: "project-1",
        capabilityRefId: "ref-1",
        installDir: "/project/review",
        functionName: "skill_invoke__project_crm_review",
        displayName: "CRM Review",
        description: "Project review skill",
      },
      skill_invoke__global_brainstorming: {
        source: "global",
        kind: "skill",
        id: "brainstorming",
        functionName: "skill_invoke__global_brainstorming",
        displayName: "Brainstorming",
        description: "User brainstorming skill",
      },
    },
    createdAt: "2026-05-18T00:00:00.000Z",
  };
}

describe("project capability prompt", () => {
  it("groups project and user Skills and tells model the bundle function names", () => {
    const sections = composePromptSections({
      session: session(),
      workingDir: "/work",
      providerFamily: "openai-compatible",
      experienceProfileId: "balanced",
      capabilityBundle: bundle(),
    });
    const skills = sections.find((section) => section.id === "skills")?.content ?? "";

    expect(skills).toContain("Project Skills");
    expect(skills).toContain("User Skills");
    expect(skills).toContain("skill_invoke__project_crm_review");
    expect(skills).toContain("skill_invoke__global_brainstorming");
  });

  it("omits project Skills when they are absent from the bundle", () => {
    const emptyBundle = { ...bundle(), skills: [], functionNameMap: {} };
    const sections = composePromptSections({
      session: session(),
      workingDir: "/work",
      providerFamily: "openai-compatible",
      experienceProfileId: "balanced",
      capabilityBundle: emptyBundle,
    });
    const skills = sections.find((section) => section.id === "skills")?.content ?? "";

    expect(skills).toContain("No skills in this group.");
    expect(skills).not.toContain("CRM Review");
  });
});
