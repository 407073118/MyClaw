import { describe, expect, it, vi } from "vitest";

import { createTimeJobExecutor } from "../src/main/services/time-job-executor";

describe("time job executor", () => {
  it("starts a workflow run when a silicon-person schedule job becomes due", async () => {
    const started: Array<{ workflowId: string; siliconPersonId?: string }> = [];
    const executor = createTimeJobExecutor({
      startWorkflowRun: async (input) => {
        started.push(input);
      },
      sendSiliconPersonMessage: async () => undefined,
    });

    await executor.execute({
      id: "job-1",
      kind: "schedule_job",
      title: "周报执行",
      scheduleKind: "interval",
      timezone: "Asia/Shanghai",
      ownerScope: "silicon_person",
      ownerId: "sp-1",
      status: "scheduled",
      source: "manual",
      intervalMinutes: 60,
      executor: "workflow",
      executorTargetId: "wf-1",
      nextRunAt: "2026-04-20T01:00:00.000Z",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    });

    expect(started).toEqual([
      {
        workflowId: "wf-1",
        siliconPersonId: "sp-1",
      },
    ]);
  });
});
