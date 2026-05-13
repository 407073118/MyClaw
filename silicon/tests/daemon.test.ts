import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { createEmployeeTask, readEmployeeTask } from "../src/core/task-store";
import { runSiliconDaemonTick } from "../src/runtime/daemon";

const tempRoots: string[] = [];

/** 创建测试专用临时根目录。 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-daemon-"));
  tempRoots.push(root);
  return root;
}

describe("runSiliconDaemonTick", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("ticks every employee folder under a runtime root", async () => {
    const runtimeRoot = await makeTempRoot();
    const ada = await scaffoldEmployeeFolder({
      runtimeRoot,
      employeeId: "ada",
      displayName: "Ada",
      definitionId: "document-organizer",
    });
    const lin = await scaffoldEmployeeFolder({
      runtimeRoot,
      employeeId: "lin",
      displayName: "Lin",
      definitionId: "code-reviewer",
    });
    await createEmployeeTask({
      employeeDir: ada.employeeDir,
      taskId: "task-ada",
      title: "整理资料",
      instruction: "请整理资料。",
    });
    await createEmployeeTask({
      employeeDir: lin.employeeDir,
      taskId: "task-lin",
      title: "审查代码",
      instruction: "请审查代码。",
    });

    const result = await runSiliconDaemonTick({ runtimeRoot });

    expect(result).toMatchObject({
      scannedEmployees: 2,
      processedTasks: 2,
      processedTaskIds: ["task-ada", "task-lin"],
    });
    await expect(readEmployeeTask(ada.employeeDir, "task-ada")).resolves.toMatchObject({ status: "succeeded" });
    await expect(readEmployeeTask(lin.employeeDir, "task-lin")).resolves.toMatchObject({ status: "succeeded" });
  });
});
