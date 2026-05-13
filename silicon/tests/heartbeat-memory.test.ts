import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { readMemoryJournal } from "../src/core/memory-store";
import { createEmployeeTask } from "../src/core/task-store";
import { runEmployeeHeartbeat } from "../src/runtime/heartbeat";

const tempRoots: string[] = [];

/** 创建测试专用临时根目录。 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-heartbeat-memory-"));
  tempRoots.push(root);
  return root;
}

/** 创建带 memory 目录的测试员工。 */
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

describe("runEmployeeHeartbeat memory journal", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("records task success and approval request events into memory", async () => {
    const { employeeDir } = await makeEmployee();
    await createEmployeeTask({
      employeeDir,
      taskId: "task-001",
      title: "整理资料",
      instruction: "请整理资料。",
      now: () => new Date("2026-05-13T01:00:00.000Z"),
    });
    await runEmployeeHeartbeat({
      employeeDir,
      now: () => new Date("2026-05-13T01:01:00.000Z"),
    });

    await createEmployeeTask({
      employeeDir,
      taskId: "task-approval",
      title: "执行命令",
      instruction: "请执行本地命令。",
      requestedCapability: "shell.execute",
      now: () => new Date("2026-05-13T01:02:00.000Z"),
    });
    await runEmployeeHeartbeat({
      employeeDir,
      now: () => new Date("2026-05-13T01:03:00.000Z"),
    });

    const entries = await readMemoryJournal(employeeDir);
    expect(entries).toEqual([
      expect.objectContaining({
        eventId: "memory-run-task-001-01-succeeded",
        type: "task_succeeded",
        subjectId: "task-001",
        sourcePath: "runs/run-task-001-01/state.json",
        createdAt: "2026-05-13T01:01:00.000Z",
      }),
      expect.objectContaining({
        eventId: "memory-approval-task-approval-requested",
        type: "approval_requested",
        subjectId: "task-approval",
        sourcePath: "approvals/approval-task-approval.json",
        createdAt: "2026-05-13T01:03:00.000Z",
      }),
    ]);
  });
});
