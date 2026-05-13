import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { createEmployeeTask, writeEmployeeTask } from "../src/core/task-store";
import { listEmployeeTodos, readEmployeeTodo } from "../src/core/todo-store";

const tempRoots: string[] = [];

/** 创建测试专用临时根目录。 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-todo-"));
  tempRoots.push(root);
  return root;
}

/** 创建带 todos 目录的测试员工。 */
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

describe("employee todo store", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("projects task lifecycle into the employee todos folder", async () => {
    const { employeeDir } = await makeEmployee();

    const task = await createEmployeeTask({
      employeeDir,
      taskId: "task-001",
      title: "整理资料",
      instruction: "请整理资料。",
      now: () => new Date("2026-05-13T01:00:00.000Z"),
    });

    const todoPath = join(employeeDir, "todos", "task-001.json");
    expect((await stat(todoPath)).isFile()).toBe(true);
    expect(JSON.parse(await readFile(todoPath, "utf8"))).toMatchObject({
      id: "todo-task-001",
      taskId: "task-001",
      title: "整理资料",
      status: "open",
      source: "inbox_task",
      createdAt: "2026-05-13T01:00:00.000Z",
      updatedAt: "2026-05-13T01:00:00.000Z",
    });

    await writeEmployeeTask(employeeDir, {
      ...task,
      status: "succeeded",
      updatedAt: "2026-05-13T01:01:00.000Z",
      runId: "run-task-001",
    });

    await expect(readEmployeeTodo(employeeDir, "task-001")).resolves.toMatchObject({
      id: "todo-task-001",
      taskId: "task-001",
      status: "done",
      runId: "run-task-001",
      updatedAt: "2026-05-13T01:01:00.000Z",
    });
  });

  it("skips malformed todo projections in list and rejects direct reads", async () => {
    const { employeeDir } = await makeEmployee();
    await writeFile(join(employeeDir, "todos", "bad.json"), "{", "utf8");
    await writeFile(join(employeeDir, "todos", "bad-status.json"), JSON.stringify({
      schemaVersion: 1,
      id: "todo-bad-status",
      taskId: "bad-status",
      title: "坏投影",
      status: "unknown",
      source: "inbox_task",
      createdAt: "2026-05-13T00:00:00.000Z",
      updatedAt: "2026-05-13T00:00:00.000Z",
    }), "utf8");

    await expect(listEmployeeTodos(employeeDir)).resolves.toEqual([]);
    await expect(readEmployeeTodo(employeeDir, "bad-status")).rejects.toThrow("Invalid EmployeeTodo");
  });
});
