import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-defaults-"));
  tempRoots.push(root);
  return root;
}

describe("employee default soul and policy", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("writes a soul constitution with required control sections", async () => {
    const runtimeRoot = await makeTempRoot();

    const result = await scaffoldEmployeeFolder({
      runtimeRoot,
      employeeId: "ada",
      displayName: "Ada",
      definitionId: "document-organizer",
    });

    const soul = await readFile(join(result.employeeDir, "soul", "current.md"), "utf8");

    for (const heading of ["# 身份", "# 职责", "# 工作原则", "# 行为边界", "# 汇报标准", "# 记忆规则", "# 测试标准"]) {
      expect(soul).toContain(heading);
    }
  });

  it("writes a conservative default policy", async () => {
    const runtimeRoot = await makeTempRoot();

    const result = await scaffoldEmployeeFolder({
      runtimeRoot,
      employeeId: "ada",
      displayName: "Ada",
      definitionId: "document-organizer",
    });

    const policy = await readFile(join(result.employeeDir, "policy.yaml"), "utf8");

    for (const line of [
      "workspaceRead: allow",
      "artifactWrite: allow",
      "shellCommand: approval_required",
      "externalNetwork: approval_required",
      "crossEmployeeAccess: forbid",
    ]) {
      expect(policy).toContain(line);
    }
  });
});
