import { describe, expect, it } from "vitest";

import { createTimeJobExecutor } from "../src/main/services/time-job-executor";

describe("time job executor", () => {
  it("starts a workflow run when a silicon-person schedule job becomes due", async () => {
    const started: Array<{ workflowId: string; siliconPersonId?: string }> = [];
    const executor = createTimeJobExecutor({
      startWorkflowRun: async (input) => {
        started.push(input);
      },
      sendSiliconPersonMessage: async () => undefined,
      runAssistantPrompt: async () => ({ outputSummary: "", sessionId: "" }),
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

  it("returns sessionId from runAssistantPrompt when executing an assistant_prompt job", async () => {
    const executor = createTimeJobExecutor({
      startWorkflowRun: async () => undefined,
      sendSiliconPersonMessage: async () => undefined,
      runAssistantPrompt: async () => ({ outputSummary: "ok", sessionId: "sess-x" }),
    });

    const result = await executor.execute({
      id: "job-2",
      kind: "schedule_job",
      title: "每日要闻",
      description: "总结今天的科技热点",
      scheduleKind: "interval",
      timezone: "Asia/Shanghai",
      ownerScope: "personal",
      status: "scheduled",
      source: "manual",
      intervalMinutes: 60,
      executor: "assistant_prompt",
      sessionMode: "per_run",
      nextRunAt: "2026-04-20T01:00:00.000Z",
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z",
    });

    expect(result).toEqual({ outputSummary: "ok", sessionId: "sess-x" });
  });
});
