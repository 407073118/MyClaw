import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { createEmployeeTask, readEmployeeTask } from "../src/core/task-store";

const tempRoots: string[] = [];

/** 创建测试专用临时根目录。 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-task-"));
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

describe("employee task store", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("creates a queued task in the employee inbox", async () => {
    const { employeeDir } = await makeEmployee();

    const task = await createEmployeeTask({
      employeeDir,
      taskId: "task-001",
      title: "整理资料",
      instruction: "请整理 inbox 里的资料并输出摘要。",
      now: () => new Date("2026-05-13T01:00:00.000Z"),
    });

    expect(task).toMatchObject({
      id: "task-001",
      title: "整理资料",
      instruction: "请整理 inbox 里的资料并输出摘要。",
      status: "queued",
      createdAt: "2026-05-13T01:00:00.000Z",
      updatedAt: "2026-05-13T01:00:00.000Z",
    });

    const taskPath = join(employeeDir, "inbox", "task-001.json");
    expect((await stat(taskPath)).isFile()).toBe(true);
    expect(JSON.parse(await readFile(taskPath, "utf8"))).toMatchObject(task);
    await expect(readEmployeeTask(employeeDir, "task-001")).resolves.toMatchObject(task);
  });
});
