import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { appendMemoryEvent, readMemoryJournal } from "../src/core/memory-store";

const tempRoots: string[] = [];

/** 创建测试专用临时根目录。 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-memory-"));
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

describe("memory store", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("appends and reads employee memory journal events", async () => {
    const { employeeDir } = await makeEmployee();

    const entry = await appendMemoryEvent({
      employeeDir,
      eventId: "memory-task-001",
      type: "task_succeeded",
      subjectId: "task-001",
      summary: "任务已成功完成并产生产物。",
      confidence: 0.9,
      sourcePath: "runs/run-task-001/state.json",
      now: () => new Date("2026-05-13T01:00:00.000Z"),
    });

    expect(entry).toMatchObject({
      eventId: "memory-task-001",
      type: "task_succeeded",
      subjectId: "task-001",
      summary: "任务已成功完成并产生产物。",
      confidence: 0.9,
      sourcePath: "runs/run-task-001/state.json",
      createdAt: "2026-05-13T01:00:00.000Z",
    });
    await expect(readMemoryJournal(employeeDir)).resolves.toEqual([entry]);
  });

  it("rejects non-finite memory confidence before writing journal", async () => {
    const { employeeDir } = await makeEmployee();

    await expect(appendMemoryEvent({
      employeeDir,
      eventId: "memory-bad-confidence",
      type: "task_succeeded",
      subjectId: "task-001",
      summary: "坏置信度",
      confidence: Number.NaN,
    })).rejects.toThrow("Invalid memory confidence");
    await expect(readMemoryJournal(employeeDir)).resolves.toEqual([]);
  });
});
