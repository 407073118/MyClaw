/**
 * Phase 1: SkillTool — model can invoke loaded skills
 *
 * 测试内容：
 * - SKILL-01: buildToolSchemas generates skill_invoke__ function tools
 * - SKILL-02: Skill content (SKILL.md) is read and returned
 * - SKILL-03: Skill execution result is proper format for tool result
 * - SKILL-04: tool-schemas.ts dynamically registers enabled skills
 */

import { describe, it, expect } from "vitest";
import { buildToolSchemas, functionNameToToolId, buildToolLabel } from "../src/main/services/tool-schemas";
import type { SkillDefinition } from "../shared/contracts/skill";
import { EXPECTED_BUILTIN_TOOL_NAMES } from "./shared/builtin-tool-contract";

// ---------------------------------------------------------------------------
// 辅助方法
// ---------------------------------------------------------------------------

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: "test-skill-1",
    name: "Test Skill",
    description: "A test skill for unit testing",
    path: "/fake/path/test-skill-1",
    enabled: true,
    disableModelInvocation: false,
    hasScriptsDirectory: false,
    hasReferencesDirectory: false,
    hasAssetsDirectory: false,
    hasTestsDirectory: false,
    hasAgentsDirectory: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SKILL-01 + SKILL-04: buildToolSchemas generates skill function tools
// ---------------------------------------------------------------------------

describe("Phase 1: SkillTool schemas", () => {
  it("should include builtin tools without skills", () => {
    const tools = buildToolSchemas("/test/cwd");
    expect(tools.map((tool) => tool.function.name)).toEqual(EXPECTED_BUILTIN_TOOL_NAMES);
    expect(tools.every((t) => t.type === "function")).toBe(true);
  });

  it("should append skill_invoke__ tools for enabled skills", () => {
    const skills = [makeSkill()];
    const tools = buildToolSchemas("/test/cwd", skills);
    expect(tools.map((tool) => tool.function.name)).toEqual([
      ...EXPECTED_BUILTIN_TOOL_NAMES,
      "skill_invoke__test-skill-1",
    ]);

    const skillTool = tools.find((t) => t.function.name.startsWith("skill_invoke__"));
    expect(skillTool).toBeDefined();
    expect(skillTool!.function.name).toBe("skill_invoke__test-skill-1");
    expect(skillTool!.function.description).toContain("Test Skill");
    expect(skillTool!.function.parameters).toHaveProperty("properties");
    expect((skillTool!.function.parameters as any).properties).toHaveProperty("input");
  });

  it("should NOT include disabled skills", () => {
    const skills = [makeSkill({ enabled: false })];
    const tools = buildToolSchemas("/test/cwd", skills);
    expect(tools.map((tool) => tool.function.name)).toEqual(EXPECTED_BUILTIN_TOOL_NAMES);
  });

  it("should NOT include skills with disableModelInvocation=true", () => {
    const skills = [makeSkill({ disableModelInvocation: true })];
    const tools = buildToolSchemas("/test/cwd", skills);
    expect(tools.map((tool) => tool.function.name)).toEqual(EXPECTED_BUILTIN_TOOL_NAMES);
  });

  it("should handle multiple skills", () => {
    const skills = [
      makeSkill({ id: "skill-a", name: "Skill A" }),
      makeSkill({ id: "skill-b", name: "Skill B" }),
      makeSkill({ id: "skill-c", name: "Skill C", enabled: false }),
    ];
    const tools = buildToolSchemas("/test/cwd", skills);
    expect(tools.map((tool) => tool.function.name)).toEqual([
      ...EXPECTED_BUILTIN_TOOL_NAMES,
      "skill_invoke__skill-a",
      "skill_invoke__skill-b",
    ]);
  });

  it("should sanitize skill IDs in function names", () => {
    const skills = [makeSkill({ id: "my.special/skill@v1" })];
    const tools = buildToolSchemas("/test/cwd", skills);
    const skillTool = tools.find((t) => t.function.name.startsWith("skill_invoke__"));
    expect(skillTool!.function.name).toBe("skill_invoke__my_special_skill_v1");
  });
});

// ---------------------------------------------------------------------------
// functionNameToToolId — skill names
// ---------------------------------------------------------------------------

describe("Phase 1: functionNameToToolId with skills", () => {
  it("should return builtin tool IDs with dots", () => {
    expect(functionNameToToolId("fs_read")).toBe("fs.read");
    expect(functionNameToToolId("exec_command")).toBe("exec.command");
    expect(functionNameToToolId("git_commit")).toBe("git.commit");
  });

  it("should keep skill_invoke__ names unchanged", () => {
    expect(functionNameToToolId("skill_invoke__test-skill-1")).toBe("skill_invoke__test-skill-1");
    expect(functionNameToToolId("skill_invoke__my_special_skill")).toBe("skill_invoke__my_special_skill");
  });
});

// ---------------------------------------------------------------------------
// buildToolLabel — skill args
// ---------------------------------------------------------------------------

describe("Phase 1: buildToolLabel with skills", () => {
  it("should return input for skill tools", () => {
    const label = buildToolLabel("skill_invoke__test-skill-1", { input: "help me code" });
    expect(label).toBe("help me code");
  });

  it("should return empty string when no input", () => {
    const label = buildToolLabel("skill_invoke__test-skill-1", {});
    expect(label).toBe("");
  });
});
