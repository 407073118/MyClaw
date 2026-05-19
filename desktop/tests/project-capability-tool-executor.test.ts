import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CapabilityBundle, SkillDefinition } from "../shared/contracts";
import { BuiltinToolExecutor } from "../src/main/services/builtin-tool-executor";

let tempRoot = "";

/** 构造能力包。 */
function bundle(installDir: string): CapabilityBundle {
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
        installDir,
        functionName: "skill_invoke__project_crm_review",
        displayName: "CRM Review",
      },
    },
    createdAt: "2026-05-18T00:00:00.000Z",
  };
}

/** 构造全局 Skill 能力包，用于验证 bundle 自包含读取目录。 */
function globalBundle(installDir: string): CapabilityBundle {
  return {
    id: "bundle-global",
    hash: "hash-global",
    sessionId: "session-1",
    project: null,
    skills: [],
    mcpTools: [],
    functionNameMap: {
      skill_invoke__global_review: {
        source: "global",
        kind: "skill",
        id: "global-review",
        installDir,
        functionName: "skill_invoke__global_review",
        displayName: "Global Review",
      },
    },
    createdAt: "2026-05-18T00:00:00.000Z",
  };
}

beforeEach(async () => {
  tempRoot = join(tmpdir(), `myclaw-tool-executor-${Date.now()}`);
  await mkdir(tempRoot, { recursive: true });
});

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

describe("project capability tool executor", () => {
  it("resolves a project Skill tool call via bundle.functionNameMap", async () => {
    const installDir = join(tempRoot, "project-review");
    await mkdir(installDir, { recursive: true });
    await writeFile(join(installDir, "SKILL.md"), "# Project Review\n", "utf8");
    const executor = new BuiltinToolExecutor();

    const result = await executor.execute("skill_invoke__project_crm_review", "", tempRoot, {
      capabilityBundle: bundle(installDir),
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("Project Review");
  });

  it("two bundles with the same tool label execute against their own dirs", async () => {
    const leftDir = join(tempRoot, "left");
    const rightDir = join(tempRoot, "right");
    await mkdir(leftDir, { recursive: true });
    await mkdir(rightDir, { recursive: true });
    await writeFile(join(leftDir, "SKILL.md"), "# Left Skill\n", "utf8");
    await writeFile(join(rightDir, "SKILL.md"), "# Right Skill\n", "utf8");
    const executor = new BuiltinToolExecutor();

    const left = await executor.execute("skill_invoke__project_crm_review", "", tempRoot, {
      capabilityBundle: bundle(leftDir),
    });
    const right = await executor.execute("skill_invoke__project_crm_review", "", tempRoot, {
      capabilityBundle: bundle(rightDir),
    });

    expect(left.output).toContain("Left Skill");
    expect(right.output).toContain("Right Skill");
  });

  it("legacy global skill_invoke__id still works without a bundle", async () => {
    const skillDir = join(tempRoot, "global");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Global Skill\n", "utf8");
    const executor = new BuiltinToolExecutor();
    executor.setSkills([{ id: "global", name: "Global", path: skillDir, enabled: true } as SkillDefinition]);

    const result = await executor.execute("skill_invoke__global", "", tempRoot);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Global Skill");
  });

  it("global Skill bundle ref executes from installDir without shared skills state", async () => {
    const skillDir = join(tempRoot, "bundle-global");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Bundled Global Skill\n", "utf8");
    const executor = new BuiltinToolExecutor();

    const result = await executor.execute("skill_invoke__global_review", "", tempRoot, {
      capabilityBundle: globalBundle(skillDir),
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("Bundled Global Skill");
  });
});
