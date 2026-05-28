import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadSkillsFromDisk, resolveBuiltinSkillsDirectory } from "../src/main/services/skill-loader";

describe("skill loader agents directory", () => {
  let rootDir = "";

  beforeEach(() => {
    rootDir = join(tmpdir(), `myclaw-skill-agents-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
  });

  afterEach(() => {
    if (rootDir) {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("detects an agents directory for SKILL.md skills but ignores a same-name file", () => {
    const skillDir = join(rootDir, "review-skill");
    const fileSkillDir = join(rootDir, "file-skill");
    mkdirSync(join(skillDir, "agents"), { recursive: true });
    mkdirSync(fileSkillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: Review Skill\ndescription: Review work\n---\n", "utf8");
    writeFileSync(join(fileSkillDir, "SKILL.md"), "---\nname: File Skill\ndescription: No agents dir\n---\n", "utf8");
    writeFileSync(join(fileSkillDir, "agents"), "not a directory", "utf8");

    const skills = loadSkillsFromDisk(rootDir);

    expect(skills.find((skill) => skill.name === "Review Skill")?.hasAgentsDirectory).toBe(true);
    expect(skills.find((skill) => skill.name === "File Skill")?.hasAgentsDirectory).toBe(false);
  });

  it("derives hasAgentsDirectory for JSON manifests from the manifest path", () => {
    const skillDir = join(rootDir, "json-skill");
    mkdirSync(join(skillDir, "agents"), { recursive: true });
    writeFileSync(join(rootDir, "json-skill.json"), JSON.stringify({
      id: "json-skill",
      name: "JSON Skill",
      path: skillDir,
    }), "utf8");

    const skills = loadSkillsFromDisk(rootDir);

    expect(skills.find((skill) => skill.id === "json-skill")?.hasAgentsDirectory).toBe(true);
  });

  it("resolves builtin skills from the desktop root when runtime code runs under dist", () => {
    const appRoot = join(rootDir, "desktop");
    const builtinDir = join(appRoot, "builtin-skills");
    const runtimeDir = join(appRoot, "dist", "src", "main", "services");
    mkdirSync(join(builtinDir, "skill-starter"), { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });

    expect(resolveBuiltinSkillsDirectory("", runtimeDir)).toBe(builtinDir);
  });
});
