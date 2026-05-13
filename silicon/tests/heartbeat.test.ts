import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { createEmployeeTask, readEmployeeTask } from "../src/core/task-store";
import { runEmployeeHeartbeat } from "../src/runtime/heartbeat";

const tempRoots: string[] = [];

/** 创建测试专用临时根目录。 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-heartbeat-"));
  tempRoots.push(root);
  return root;
}

describe("runEmployeeHeartbeat", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("executes one queued task into run ledger, artifact, and review", async () => {
    const runtimeRoot = await makeTempRoot();
    const { employeeDir } = await scaffoldEmployeeFolder({
      runtimeRoot,
      employeeId: "ada",
      displayName: "Ada",
      definitionId: "document-organizer",
    });
    await createEmployeeTask({
      employeeDir,
      taskId: "task-001",
      title: "整理资料",
      instruction: "请整理资料并输出摘要。",
      now: () => new Date("2026-05-13T01:00:00.000Z"),
    });

    const result = await runEmployeeHeartbeat({
      employeeDir,
      now: () => new Date("2026-05-13T01:01:00.000Z"),
    });

    expect(result).toMatchObject({
      processedTaskIds: ["task-001"],
      eventCount: 5,
    });

    const task = await readEmployeeTask(employeeDir, "task-001");
    expect(task.status).toBe("succeeded");
    expect(task.attempt).toBe(1);
    expect(task.runId).toBe("run-task-001-01");
    expect(task.artifactPath).toBe("artifacts/task-001/run-task-001-01/report.md");
    expect(task.reviewPath).toBe("reviews/run-task-001-01.md");
    expect(task.runHistory?.map((entry) => entry.runId)).toEqual(["run-task-001-01"]);

    const runDir = join(employeeDir, "runs", "run-task-001-01");
    expect((await stat(join(runDir, "state.json"))).isFile()).toBe(true);
    const events = (await readFile(join(runDir, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "task_observed",
      "artifact_written",
      "review_written",
      "run_succeeded",
    ]);

    const artifact = await readFile(join(employeeDir, "artifacts", "task-001", "run-task-001-01", "report.md"), "utf8");
    expect(artifact).toContain("# 整理资料");
    expect(artifact).toContain("请整理资料并输出摘要。");

    const review = await readFile(join(employeeDir, "reviews", "run-task-001-01.md"), "utf8");
    expect(review).toContain("# Run Review: run-task-001-01");
    expect(review).toContain("状态：succeeded");
  });

  it("marks a task failed when run output cannot be written", async () => {
    const runtimeRoot = await makeTempRoot();
    const { employeeDir } = await scaffoldEmployeeFolder({
      runtimeRoot,
      employeeId: "ada",
      displayName: "Ada",
      definitionId: "document-organizer",
    });
    await createEmployeeTask({
      employeeDir,
      taskId: "task-001",
      title: "写入失败",
      instruction: "制造产物目录冲突。",
      now: () => new Date("2026-05-13T01:00:00.000Z"),
    });
    await writeFile(join(employeeDir, "artifacts", "task-001"), "not-a-directory", "utf8");

    const result = await runEmployeeHeartbeat({
      employeeDir,
      now: () => new Date("2026-05-13T01:01:00.000Z"),
    });

    expect(result.blockedTaskIds).toEqual(["task-001"]);
    const task = await readEmployeeTask(employeeDir, "task-001");
    expect(task.status).toBe("failed");
    expect(task.runHistory?.map((entry) => entry.status)).toEqual(["failed"]);
    expect((await stat(join(employeeDir, "runs", "run-task-001-01", "state.json"))).isFile()).toBe(true);
  });
});
