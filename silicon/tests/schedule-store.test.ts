import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { createScheduledTask, dispatchDueScheduledTasks, readScheduledTask } from "../src/core/schedule-store";
import { createEmployeeTask } from "../src/core/task-store";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-schedule-"));
  tempRoots.push(root);
  return root;
}

describe("schedule store dispatch", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("refuses to mark a schedule dispatched when the target task already belongs to different work", async () => {
    const runtimeRoot = await makeTempRoot();
    const { employeeDir } = await scaffoldEmployeeFolder({
      runtimeRoot,
      employeeId: "ada",
      displayName: "Ada",
      definitionId: "document-organizer",
    });
    await createScheduledTask({
      employeeDir,
      scheduleId: "daily",
      title: "每日整理",
      instruction: "整理资料。",
      dueAt: "2026-05-13T00:00:00.000Z",
    });
    await createEmployeeTask({
      employeeDir,
      taskId: "task-daily",
      title: "其他任务",
      instruction: "这不是 schedule 派发的任务。",
    });

    await expect(dispatchDueScheduledTasks({
      employeeDir,
      now: () => new Date("2026-05-13T00:00:01.000Z"),
    })).rejects.toThrow("Schedule dispatch target task mismatch");
    await expect(readScheduledTask(employeeDir, "daily")).resolves.toMatchObject({ status: "scheduled" });
  });
});
