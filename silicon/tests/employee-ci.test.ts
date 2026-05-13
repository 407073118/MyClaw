import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { validateEmployeeFolder } from "../src/testing/employee-ci";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-ci-"));
  tempRoots.push(root);
  return root;
}

describe("validateEmployeeFolder", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("passes a freshly scaffolded employee folder", async () => {
    const runtimeRoot = await makeTempRoot();
    const { employeeDir } = await scaffoldEmployeeFolder({
      runtimeRoot,
      employeeId: "ada",
      displayName: "Ada",
      definitionId: "document-organizer",
    });

    const result = await validateEmployeeFolder(employeeDir);

    expect(result.passed).toBe(true);
    expect(result.checks.length).toBeGreaterThan(5);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it("fails when policy contains duplicate or unknown decisions", async () => {
    const runtimeRoot = await makeTempRoot();
    const { employeeDir } = await scaffoldEmployeeFolder({
      runtimeRoot,
      employeeId: "ada",
      displayName: "Ada",
      definitionId: "document-organizer",
    });
    await writeFile(join(employeeDir, "policy.yaml"), [
      "filesystem:",
      "  workspaceRead: allow",
      "  workspaceRead: forbid",
      "process:",
      "  shellCommand: maybe",
    ].join("\n"), "utf8");

    const result = await validateEmployeeFolder(employeeDir);

    expect(result.passed).toBe(false);
    expect(result.checks.find((check) => check.name === "policy:parse")?.message).toContain("重复规则");
    expect(result.checks.find((check) => check.name === "policy:parse")?.message).toContain("未知裁决");
  });
});
