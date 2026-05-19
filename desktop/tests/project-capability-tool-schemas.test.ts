import { describe, expect, it } from "vitest";

import type { CapabilityBundle, SkillDefinition } from "../shared/contracts";
import { buildToolSchemas } from "../src/main/services/tool-schemas";

/** 构造测试能力包。 */
function bundle(): CapabilityBundle {
  return {
    id: "bundle-1",
    hash: "hash-1",
    sessionId: "session-1",
    project: null,
    skills: [],
    mcpTools: [],
    functionNameMap: {
      skill_invoke__project_crm_review: {
        source: "project",
        kind: "skill",
        id: "review",
        localProjectId: "project-1",
        capabilityRefId: "ref-1",
        installDir: "/project-cache/review",
        functionName: "skill_invoke__project_crm_review",
        displayName: "review",
      },
      skill_invoke__global_review: {
        source: "global",
        kind: "skill",
        id: "review",
        installDir: "/skills/review",
        functionName: "skill_invoke__global_review",
        displayName: "review",
      },
      mcp__global__search: {
        source: "global",
        kind: "mcp",
        id: "mcp__global__search",
        functionName: "mcp__global__search",
        displayName: "search",
        serverId: "global",
        toolName: "search",
        inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      },
    },
    createdAt: "2026-05-18T00:00:00.000Z",
  };
}

describe("project capability tool schemas", () => {
  it("bundle-provided project Skill produces the exact function name in functionNameMap", () => {
    const tools = buildToolSchemas("/work", [], [], undefined, { capabilityBundle: bundle() });

    expect(tools.some((tool) => tool.function.name === "skill_invoke__project_crm_review")).toBe(true);
  });

  it("same sanitized Skill IDs do not collide when bundle already disambiguates names", () => {
    const tools = buildToolSchemas("/work", [], [], undefined, { capabilityBundle: bundle() });
    const skillNames = tools.map((tool) => tool.function.name).filter((name) => name.startsWith("skill_invoke__"));

    expect(new Set(skillNames).size).toBe(skillNames.length);
  });

  it("existing global Skill schema behavior remains unchanged when no bundle is supplied", () => {
    const skills: SkillDefinition[] = [{
      id: "global.review",
      name: "Global Review",
      description: "Global review skill",
      path: "/skills/global-review",
      enabled: true,
    } as SkillDefinition];

    const tools = buildToolSchemas("/work", skills, [], undefined, undefined);

    expect(tools.some((tool) => tool.function.name === "skill_invoke__global_review")).toBe(true);
  });

  it("bundle-provided MCP schema preserves original inputSchema", () => {
    const tools = buildToolSchemas("/work", [], [], undefined, { capabilityBundle: bundle() });
    const mcpTool = tools.find((tool) => tool.function.name === "mcp__global__search");

    expect(mcpTool?.function.parameters).toEqual({
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
    });
  });

  it("keeps skill_view available when capabilityBundle is supplied", () => {
    const skills: SkillDefinition[] = [{
      id: "ppt-designer",
      name: "PPT Designer",
      description: "Preview slides",
      path: "/skills/ppt-designer",
      enabled: true,
      hasViewFile: true,
      viewFiles: ["preview.html"],
    } as SkillDefinition];

    const tools = buildToolSchemas("/work", skills, [], undefined, { capabilityBundle: bundle() });

    expect(tools.some((tool) => tool.function.name === "skill_view")).toBe(true);
  });
});
