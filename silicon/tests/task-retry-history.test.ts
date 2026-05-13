import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { approveApprovalRequest } from "../src/core/approval-store";
import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { createEmployeeTask, readEmployeeTask, retryEmployeeTask } from "../src/core/task-store";
import { runEmployeeHeartbeat } from "../src/runtime/heartbeat";

const tempRoots: string[] = [];

/** 创建测试专用临时根目录。 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-retry-history-"));
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

describe("employee task retry run history", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("keeps previous run records when a blocked task is retried", async () => {
    const { employeeDir } = await makeEmployee();
    await createEmployeeTask({
      employeeDir,
      taskId: "task-001",
      title: "执行本地命令",
      instruction: "请运行命令并保存结果。",
      requestedCapability: "shell.execute",
      now: () => new Date("2026-05-13T01:00:00.000Z"),
    });

    await runEmployeeHeartbeat({ employeeDir, now: () => new Date("2026-05-13T01:01:00.000Z") });
    await approveApprovalRequest({
      employeeDir,
      approvalId: "approval-task-001",
      now: () => new Date("2026-05-13T01:02:00.000Z"),
    });
    await runEmployeeHeartbeat({ employeeDir, now: () => new Date("2026-05-13T01:03:00.000Z") });

    await expect(readEmployeeTask(employeeDir, "task-001")).resolves.toMatchObject({
      status: "blocked",
      attempt: 1,
      runId: "run-task-001-01",
      runHistory: [
        {
          runId: "run-task-001-01",
          status: "blocked",
        },
      ],
    });

    await retryEmployeeTask({
      employeeDir,
      taskId: "task-001",
      now: () => new Date("2026-05-13T01:04:00.000Z"),
    });

    await runEmployeeHeartbeat({ employeeDir, now: () => new Date("2026-05-13T01:05:00.000Z") });
    await approveApprovalRequest({
      employeeDir,
      approvalId: "approval-task-001-02",
      now: () => new Date("2026-05-13T01:06:00.000Z"),
    });
    await runEmployeeHeartbeat({ employeeDir, now: () => new Date("2026-05-13T01:07:00.000Z") });

    const task = await readEmployeeTask(employeeDir, "task-001");
    expect(task).toMatchObject({
      status: "blocked",
      attempt: 2,
      runId: "run-task-001-02",
    });
    expect(task.runHistory?.map((entry) => entry.runId)).toEqual(["run-task-001-01", "run-task-001-02"]);
    expect(task.runHistory?.map((entry) => entry.status)).toEqual(["blocked", "blocked"]);
    expect((await stat(join(employeeDir, "runs", "run-task-001-01", "state.json"))).isFile()).toBe(true);
    expect((await stat(join(employeeDir, "runs", "run-task-001-02", "state.json"))).isFile()).toBe(true);
  });
});
