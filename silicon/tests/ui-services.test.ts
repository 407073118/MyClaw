import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { approveApprovalRequest } from "../src/core/approval-store";
import { scaffoldEmployeeFolder } from "../src/core/employee-scaffold";
import { initializeSiliconRuntimeRoot } from "../src/core/runtime-root";
import { createEmployeeTask } from "../src/core/task-store";
import { runEmployeeHeartbeat } from "../src/runtime/heartbeat";
import { getEmployeeDetailView } from "../src/services/employee-detail";
import { getRuntimeDashboardView } from "../src/services/runtime-dashboard";
import { readArtifactReviewView } from "../src/services/artifact-review";
import { readRunTimelineView } from "../src/services/run-timeline";

const tempRoots: string[] = [];

/** 创建临时 runtime 根目录，测试结束后统一清理。 */
async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "silicon-ui-services-"));
  tempRoots.push(root);
  return root;
}

describe("silicon UI service views", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("builds a dashboard and inspector data from runtime records", async () => {
    const runtimeRoot = await makeTempRoot();
    await initializeSiliconRuntimeRoot({ runtimeRoot });
    const { employeeDir } = await scaffoldEmployeeFolder({
      runtimeRoot,
      employeeId: "ada",
      displayName: "Ada",
      definitionId: "ops-runner",
    });

    await createEmployeeTask({
      employeeDir,
      taskId: "shell-check",
      title: "检查 shell 能力",
      instruction: "尝试执行需要 shell.execute 的任务。",
      requestedCapability: "shell.execute",
    });
    await runEmployeeHeartbeat({ employeeDir });
    await approveApprovalRequest({ employeeDir, approvalId: "approval-shell-check" });
    await runEmployeeHeartbeat({ employeeDir });

    const dashboard = await getRuntimeDashboardView({ runtimeRoot });
    expect(dashboard.summary).toMatchObject({
      employees: 1,
      blocked: 1,
      waitingApproval: 0,
      failed: 0,
    });
    expect(dashboard.actionRequired.some((item) => item.kind === "blocked_task" && item.taskId === "shell-check")).toBe(true);
    expect(dashboard.queueStream.some((item) => item.kind === "task" && item.status === "blocked")).toBe(true);

    const employee = await getEmployeeDetailView({ runtimeRoot, employeeId: "ada" });
    expect(employee.profile.displayName).toBe("Ada");
    expect(employee.counts.blockedTasks).toBe(1);
    expect(employee.tasks[0]).toMatchObject({
      id: "shell-check",
      status: "blocked",
      requestedCapability: "shell.execute",
    });

    const runId = employee.tasks[0]?.runId;
    expect(runId).toBeTruthy();
    const timeline = await readRunTimelineView({ runtimeRoot, employeeId: "ada", runId: runId ?? "" });
    expect(timeline.status).toBe("blocked");
    expect(timeline.evidence.some((item) => item.path.endsWith("state.json"))).toBe(true);
    expect(timeline.events.some((event) => event.type === "run_blocked")).toBe(true);

    const output = await readArtifactReviewView({ runtimeRoot, employeeId: "ada", taskId: "shell-check" });
    expect(output.artifact.content).toContain("shell-check");
    expect(output.review.content).toContain("missing_adapter");
  });
});
