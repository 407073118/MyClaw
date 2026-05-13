import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runSiliconCli } from "../src/cli/main";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-cli-"));
  tempRoots.push(root);
  return root;
}

describe("runSiliconCli", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("creates an employee folder from employee create arguments", async () => {
    const runtimeRoot = await makeTempRoot();

    const result = await runSiliconCli([
      "employee",
      "create",
      "--id",
      "ada",
      "--name",
      "Ada",
      "--template",
      "document-organizer",
      "--runtime-root",
      runtimeRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("硅基员工已创建");
    const info = await stat(join(runtimeRoot, "employees", "ada", "profile.json"));
    expect(info.isFile()).toBe(true);
  });

  it("creates, runs, and reports a task through CLI commands", async () => {
    const runtimeRoot = await makeTempRoot();
    await runSiliconCli([
      "employee",
      "create",
      "--id",
      "ada",
      "--name",
      "Ada",
      "--template",
      "document-organizer",
      "--runtime-root",
      runtimeRoot,
    ]);

    const createTask = await runSiliconCli([
      "task",
      "create",
      "--employee",
      "ada",
      "--id",
      "task-001",
      "--title",
      "整理资料",
      "--instruction",
      "请整理资料并输出摘要。",
      "--runtime-root",
      runtimeRoot,
    ]);
    expect(createTask.exitCode).toBe(0);
    expect(createTask.stdout).toContain("任务已创建");

    const tick = await runSiliconCli([
      "heartbeat",
      "tick",
      "--employee",
      "ada",
      "--runtime-root",
      runtimeRoot,
    ]);
    expect(tick.exitCode).toBe(0);
    expect(tick.stdout).toContain("processed=1");

    const status = await runSiliconCli([
      "task",
      "status",
      "--employee",
      "ada",
      "--id",
      "task-001",
      "--runtime-root",
      runtimeRoot,
    ]);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("succeeded");
    expect(status.stdout).toContain("run-task-001");
  });

  it("ticks all employees through daemon tick CLI command", async () => {
    const runtimeRoot = await makeTempRoot();
    await runSiliconCli([
      "employee",
      "create",
      "--id",
      "ada",
      "--name",
      "Ada",
      "--template",
      "document-organizer",
      "--runtime-root",
      runtimeRoot,
    ]);
    await runSiliconCli([
      "task",
      "create",
      "--employee",
      "ada",
      "--id",
      "task-001",
      "--title",
      "整理资料",
      "--instruction",
      "请整理资料。",
      "--runtime-root",
      runtimeRoot,
    ]);

    const result = await runSiliconCli(["daemon", "tick", "--runtime-root", runtimeRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("employees=1");
    expect(result.stdout).toContain("processed=1");
  });

  it("pauses capability-gated tasks and resumes them through approval CLI commands", async () => {
    const runtimeRoot = await makeTempRoot();
    await runSiliconCli([
      "employee",
      "create",
      "--id",
      "ada",
      "--name",
      "Ada",
      "--template",
      "document-organizer",
      "--runtime-root",
      runtimeRoot,
    ]);
    await runSiliconCli([
      "task",
      "create",
      "--employee",
      "ada",
      "--id",
      "task-approval",
      "--title",
      "执行命令",
      "--instruction",
      "请执行本地命令并保存结果。",
      "--capability",
      "shell.execute",
      "--runtime-root",
      runtimeRoot,
    ]);

    const paused = await runSiliconCli([
      "heartbeat",
      "tick",
      "--employee",
      "ada",
      "--runtime-root",
      runtimeRoot,
    ]);
    expect(paused.exitCode).toBe(0);
    expect(paused.stdout).toContain("processed=0");
    expect(paused.stdout).toContain("approvals=1");

    const approvalStatus = await runSiliconCli([
      "approval",
      "status",
      "--employee",
      "ada",
      "--id",
      "approval-task-approval",
      "--runtime-root",
      runtimeRoot,
    ]);
    expect(approvalStatus.exitCode).toBe(0);
    expect(approvalStatus.stdout).toContain("requested");
    expect(approvalStatus.stdout).toContain("shell.execute");

    const approved = await runSiliconCli([
      "approval",
      "approve",
      "--employee",
      "ada",
      "--id",
      "approval-task-approval",
      "--runtime-root",
      runtimeRoot,
    ]);
    expect(approved.exitCode).toBe(0);
    expect(approved.stdout).toContain("审批已通过");

    const resumed = await runSiliconCli([
      "heartbeat",
      "tick",
      "--employee",
      "ada",
      "--runtime-root",
      runtimeRoot,
    ]);
    expect(resumed.exitCode).toBe(0);
    expect(resumed.stdout).toContain("processed=0");
    expect(resumed.stdout).toContain("approvals=0");
    expect(resumed.stdout).toContain("blocked=1");
  });

  it("validates an employee folder through employee validate CLI command", async () => {
    const runtimeRoot = await makeTempRoot();
    await runSiliconCli([
      "employee",
      "create",
      "--id",
      "ada",
      "--name",
      "Ada",
      "--template",
      "document-organizer",
      "--runtime-root",
      runtimeRoot,
    ]);

    const result = await runSiliconCli([
      "employee",
      "validate",
      "--employee",
      "ada",
      "--runtime-root",
      runtimeRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("employee CI 通过");
  });

  it("reports stale locks and malformed records through runtime doctor", async () => {
    const runtimeRoot = await makeTempRoot();
    await runSiliconCli(["runtime", "init", "--runtime-root", runtimeRoot]);
    await runSiliconCli([
      "employee",
      "create",
      "--id",
      "ada",
      "--name",
      "Ada",
      "--template",
      "document-organizer",
      "--runtime-root",
      runtimeRoot,
    ]);
    await runSiliconCli([
      "employee",
      "create",
      "--id",
      "bad",
      "--name",
      "Bad",
      "--template",
      "document-organizer",
      "--runtime-root",
      runtimeRoot,
    ]);
    await writeFile(join(runtimeRoot, "employees", "bad", "inbox", "broken.json"), "{", "utf8");
    const lockDir = join(runtimeRoot, "employees", "bad", "locks", "heartbeat.lock");
    await mkdir(lockDir, { recursive: true });
    await writeFile(join(lockDir, "lock.json"), `${JSON.stringify({
      schemaVersion: 1,
      lockName: "heartbeat",
      ownerPid: 123,
      acquiredAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:00:01.000Z",
    }, null, 2)}\n`, "utf8");

    const result = await runSiliconCli(["runtime", "doctor", "--runtime-root", runtimeRoot]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("ada=ok staleLocks=0 malformedRecords=0");
    expect(result.stdout).toContain("bad=failed staleLocks=1 malformedRecords=1");
    expect(result.stdout).toContain("bad.error=task:broken.json");
    expect(result.stdout).toContain("runtime doctor: employees=2 passed=1 failed=1 staleLocks=1 malformedRecords=1");
  });

  it("reports malformed heartbeat state and events through runtime doctor", async () => {
    const runtimeRoot = await makeTempRoot();
    await runSiliconCli(["runtime", "init", "--runtime-root", runtimeRoot]);
    await runSiliconCli([
      "employee",
      "create",
      "--id",
      "ada",
      "--name",
      "Ada",
      "--template",
      "document-organizer",
      "--runtime-root",
      runtimeRoot,
    ]);
    await writeFile(join(runtimeRoot, "employees", "ada", "heartbeat", "state.json"), JSON.stringify({
      schemaVersion: 1,
      status: "alive",
      tickCount: "bad",
      lastBeatAt: null,
      nextBeatAt: null,
    }), "utf8");
    await writeFile(join(runtimeRoot, "employees", "ada", "heartbeat", "events.jsonl"), JSON.stringify({
      schemaVersion: 1,
      type: "unknown",
      createdAt: "2026-05-13T00:00:00.000Z",
      message: "bad",
    }), "utf8");

    const result = await runSiliconCli(["runtime", "doctor", "--runtime-root", runtimeRoot]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("ada=failed staleLocks=0 malformedRecords=2");
    expect(result.stdout).toContain("ada.error=heartbeat-state:heartbeat\\state.json");
    expect(result.stdout).toContain("ada.error=heartbeat-event:1");
  });
});
