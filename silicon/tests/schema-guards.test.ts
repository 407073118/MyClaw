import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { listApprovalRequests, readApprovalRequest } from "../src/core/approval-store";
import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { listEmployeeTasks, readEmployeeTask } from "../src/core/task-store";

const tempRoots: string[] = [];

/** 创建测试专用临时根目录。 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-schema-"));
  tempRoots.push(root);
  return root;
}

/** 创建带完整生命体目录的测试员工。 */
async function makeEmployee(): Promise<{ runtimeRoot: string; employeeDir: string }> {
  const runtimeRoot = await makeTempRoot();
  const { employeeDir } = await scaffoldEmployeeFolder({
    runtimeRoot,
    employeeId: "ada",
    displayName: "Ada",
    definitionId: "document-organizer",
  });
  return { runtimeRoot, employeeDir };
}

describe("runtime schema guards", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("skips malformed task records in lists and rejects direct reads", async () => {
    const { employeeDir } = await makeEmployee();
    await writeFile(join(employeeDir, "inbox", "bad-json.json"), "{", "utf8");
    await writeFile(join(employeeDir, "inbox", "bad-status.json"), JSON.stringify({
      schemaVersion: 1,
      id: "bad-status",
      title: "坏任务",
      instruction: "坏任务",
      status: "unknown",
      attempt: 1,
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    }), "utf8");

    await expect(listEmployeeTasks(employeeDir)).resolves.toEqual([]);
    await expect(readEmployeeTask(employeeDir, "bad-status")).rejects.toThrow("Invalid EmployeeTask");
  });

  it("rejects malformed task run history and optional output fields", async () => {
    const { employeeDir } = await makeEmployee();
    await writeFile(join(employeeDir, "inbox", "bad-history.json"), JSON.stringify({
      schemaVersion: 1,
      id: "bad-history",
      title: "坏历史",
      instruction: "坏历史",
      status: "failed",
      attempt: 1,
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
      artifactPath: 123,
      runHistory: [{ runId: "run-bad-history-01", status: "done", finishedAt: "2026-05-13T00:00:00.000Z" }],
    }), "utf8");

    await expect(listEmployeeTasks(employeeDir)).resolves.toEqual([]);
    await expect(readEmployeeTask(employeeDir, "bad-history")).rejects.toThrow("Invalid EmployeeTask");
  });

  it("skips malformed approval records in lists and rejects direct reads", async () => {
    const { employeeDir } = await makeEmployee();
    await mkdir(join(employeeDir, "approvals"), { recursive: true });
    await writeFile(join(employeeDir, "approvals", "bad-json.json"), "{", "utf8");
    await writeFile(join(employeeDir, "approvals", "bad-status.json"), JSON.stringify({
      schemaVersion: 1,
      id: "bad-status",
      taskId: "task-001",
      capability: "shell.execute",
      reason: "测试",
      status: "done",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    }), "utf8");

    await expect(listApprovalRequests(employeeDir)).resolves.toEqual([]);
    await expect(readApprovalRequest(employeeDir, "bad-status")).rejects.toThrow("Invalid ApprovalRequest");
  });
});
