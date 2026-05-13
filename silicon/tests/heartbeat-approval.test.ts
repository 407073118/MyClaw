import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { approveApprovalRequest, denyApprovalRequest, readApprovalRequest } from "../src/core/approval-store";
import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { createEmployeeTask, readEmployeeTask } from "../src/core/task-store";
import { runEmployeeHeartbeat } from "../src/runtime/heartbeat";

const tempRoots: string[] = [];

/** 创建测试专用临时根目录。 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-heartbeat-approval-"));
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

describe("runEmployeeHeartbeat approval gate", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("pauses approval-required tasks and resumes them after approval", async () => {
    const { employeeDir } = await makeEmployee();
    await createEmployeeTask({
      employeeDir,
      taskId: "task-001",
      title: "执行本地命令",
      instruction: "请运行本地命令并保存结果。",
      requestedCapability: "shell.execute",
      now: () => new Date("2026-05-13T01:00:00.000Z"),
    });

    const paused = await runEmployeeHeartbeat({
      employeeDir,
      now: () => new Date("2026-05-13T01:01:00.000Z"),
    });

    expect(paused).toMatchObject({
      processedTaskIds: [],
      approvalTaskIds: ["task-001"],
      eventCount: 0,
    });
    await expect(readEmployeeTask(employeeDir, "task-001")).resolves.toMatchObject({
      status: "waiting_approval",
      approvalId: "approval-task-001",
    });
    await expect(readApprovalRequest(employeeDir, "approval-task-001")).resolves.toMatchObject({
      taskId: "task-001",
      capability: "shell.execute",
      status: "requested",
    });
    await expect(stat(join(employeeDir, "artifacts", "task-001", "report.md"))).rejects.toThrow();

    await approveApprovalRequest({
      employeeDir,
      approvalId: "approval-task-001",
      now: () => new Date("2026-05-13T01:02:00.000Z"),
    });

    const resumed = await runEmployeeHeartbeat({
      employeeDir,
      now: () => new Date("2026-05-13T01:03:00.000Z"),
    });

    expect(resumed).toMatchObject({
      processedTaskIds: [],
      approvalTaskIds: [],
      blockedTaskIds: ["task-001"],
      eventCount: 5,
    });
    await expect(readEmployeeTask(employeeDir, "task-001")).resolves.toMatchObject({
      status: "blocked",
      attempt: 1,
      runId: "run-task-001-01",
      artifactPath: "artifacts/task-001/run-task-001-01/report.md",
    });
  });

  it("fails waiting tasks when their approval is denied", async () => {
    const { employeeDir } = await makeEmployee();
    await createEmployeeTask({
      employeeDir,
      taskId: "task-002",
      title: "访问外部网络",
      instruction: "请访问外部网络并保存结果。",
      requestedCapability: "network.external",
      now: () => new Date("2026-05-13T01:00:00.000Z"),
    });
    await runEmployeeHeartbeat({
      employeeDir,
      now: () => new Date("2026-05-13T01:01:00.000Z"),
    });
    await denyApprovalRequest({
      employeeDir,
      approvalId: "approval-task-002",
      now: () => new Date("2026-05-13T01:02:00.000Z"),
    });

    const denied = await runEmployeeHeartbeat({
      employeeDir,
      now: () => new Date("2026-05-13T01:03:00.000Z"),
    });

    expect(denied).toMatchObject({
      processedTaskIds: [],
      deniedTaskIds: ["task-002"],
      eventCount: 0,
    });
    await expect(readEmployeeTask(employeeDir, "task-002")).resolves.toMatchObject({
      status: "failed",
      approvalId: "approval-task-002",
      errorMessage: "审批已拒绝，任务终止。",
    });
  });
});
