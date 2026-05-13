import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-employee-"));
  tempRoots.push(root);
  return root;
}

async function expectDirectory(path: string): Promise<void> {
  const info = await stat(path);
  expect(info.isDirectory()).toBe(true);
}

async function expectFile(path: string): Promise<void> {
  const info = await stat(path);
  expect(info.isFile()).toBe(true);
}

describe("scaffoldEmployeeFolder", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("creates a complete employee folder body with profile and heartbeat files", async () => {
    const runtimeRoot = await makeTempRoot();

    const result = await scaffoldEmployeeFolder({
      runtimeRoot,
      employeeId: "ada",
      displayName: "Ada",
      definitionId: "document-organizer",
    });

    expect(result.employeeDir).toBe(join(runtimeRoot, "employees", "ada"));

    for (const relativePath of [
      "soul",
      "heartbeat",
      "inbox",
      "todos",
      "runs",
      "memory",
      "skills",
      "tools",
      "loadouts",
      "approvals",
      "artifacts",
      "reviews",
      "logs",
      "tests",
    ]) {
      await expectDirectory(join(result.employeeDir, relativePath));
    }

    for (const relativePath of [
      "soul/current.md",
      "soul/changelog.md",
      "profile.json",
      "policy.yaml",
      "heartbeat/state.json",
      "heartbeat/events.jsonl",
    ]) {
      await expectFile(join(result.employeeDir, relativePath));
    }

    const profile = JSON.parse(await readFile(join(result.employeeDir, "profile.json"), "utf8"));
    expect(profile).toMatchObject({
      employeeId: "ada",
      displayName: "Ada",
      definitionId: "document-organizer",
      status: "idle",
    });
  });
});
