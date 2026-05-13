import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { evaluateEmployeeCapabilityPolicy, parsePolicyText } from "../src/policy/policy-engine";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-policy-"));
  tempRoots.push(root);
  return root;
}

describe("parsePolicyText", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("parses valid simplified policy rules", () => {
    const policy = parsePolicyText([
      "filesystem:",
      "  workspaceRead: allow",
      "  artifactWrite: allow",
      "process:",
      "  shellCommand: approval_required",
      "network:",
      "  externalNetwork: approval_required",
      "employee:",
      "  crossEmployeeAccess: forbid",
    ].join("\n"));

    expect(policy.errors).toEqual([]);
    expect(policy.rules.get("workspaceRead")).toBe("allow");
    expect(policy.rules.get("shellCommand")).toBe("approval_required");
    expect(policy.rules.get("crossEmployeeAccess")).toBe("forbid");
  });

  it("reports duplicate rules and unknown decisions", () => {
    const policy = parsePolicyText([
      "filesystem:",
      "  workspaceRead: allow",
      "  workspaceRead: forbid",
      "process:",
      "  shellCommand: maybe",
    ].join("\n"));

    expect(policy.errors).toContain("第 3 行重复规则 workspaceRead");
    expect(policy.errors).toContain("第 5 行规则 shellCommand 使用未知裁决 maybe");
  });

  it("fails closed when employee policy has parser errors", async () => {
    const runtimeRoot = await makeTempRoot();
    const { employeeDir } = await scaffoldEmployeeFolder({
      runtimeRoot,
      employeeId: "ada",
      displayName: "Ada",
      definitionId: "document-organizer",
    });
    await writeFile(join(employeeDir, "policy.yaml"), [
      "process:",
      "  shellCommand: approval_required",
      "  shellCommand: allow",
    ].join("\n"), "utf8");

    const decision = await evaluateEmployeeCapabilityPolicy({
      employeeDir,
      capability: "shell.execute",
    });

    expect(decision.decision).toBe("forbid");
    expect(decision.reason).toContain("policy.yaml 解析失败");
  });
});
