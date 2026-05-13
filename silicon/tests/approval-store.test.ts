import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  approveApprovalRequest,
  createApprovalRequest,
  denyApprovalRequest,
  readApprovalRequest,
} from "../src/core/approval-store";
import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";

const tempRoots: string[] = [];

/** 创建测试专用临时根目录。 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-approval-"));
  tempRoots.push(root);
  return root;
}

/** 创建带审批目录的测试员工。 */
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

describe("approval store", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("creates and approves a requested capability approval", async () => {
    const { employeeDir } = await makeEmployee();

    const approval = await createApprovalRequest({
      employeeDir,
      approvalId: "approval-task-001",
      taskId: "task-001",
      capability: "shell.execute",
      reason: "执行 shell 命令需要人工确认。",
      now: () => new Date("2026-05-13T01:00:00.000Z"),
    });

    expect(approval).toMatchObject({
      id: "approval-task-001",
      taskId: "task-001",
      capability: "shell.execute",
      status: "requested",
      createdAt: "2026-05-13T01:00:00.000Z",
      updatedAt: "2026-05-13T01:00:00.000Z",
    });
    const approvalPath = join(employeeDir, "approvals", "approval-task-001.json");
    expect((await stat(approvalPath)).isFile()).toBe(true);
    expect(JSON.parse(await readFile(approvalPath, "utf8"))).toMatchObject(approval);

    const approved = await approveApprovalRequest({
      employeeDir,
      approvalId: "approval-task-001",
      now: () => new Date("2026-05-13T01:01:00.000Z"),
    });

    expect(approved).toMatchObject({
      id: "approval-task-001",
      status: "approved",
      updatedAt: "2026-05-13T01:01:00.000Z",
      resolvedAt: "2026-05-13T01:01:00.000Z",
    });
    await expect(readApprovalRequest(employeeDir, "approval-task-001")).resolves.toMatchObject(approved);
  });

  it("denies a requested capability approval", async () => {
    const { employeeDir } = await makeEmployee();
    await createApprovalRequest({
      employeeDir,
      approvalId: "approval-task-002",
      taskId: "task-002",
      capability: "network.external",
      reason: "访问外部网络需要人工确认。",
      now: () => new Date("2026-05-13T01:00:00.000Z"),
    });

    const denied = await denyApprovalRequest({
      employeeDir,
      approvalId: "approval-task-002",
      now: () => new Date("2026-05-13T01:02:00.000Z"),
    });

    expect(denied).toMatchObject({
      id: "approval-task-002",
      status: "denied",
      updatedAt: "2026-05-13T01:02:00.000Z",
      resolvedAt: "2026-05-13T01:02:00.000Z",
    });
  });
});
