import { describe, expect, it, vi } from "vitest";

import { createAwarenessSourceAdapter } from "../src/main/services/awareness-source-adapter";

describe("awareness source adapter", () => {
  it("builds one runtime snapshot from real source getters and groups latest schedule-job executions", async () => {
    const scheduleJobs = [
      { id: "job-personal", title: "个人任务", ownerScope: "personal", status: "scheduled" },
      { id: "job-employee", title: "员工任务", ownerScope: "silicon_person", ownerId: "person-1", status: "failed" },
    ];
    const executionRuns = [
      { id: "run-old", jobId: "job-employee", status: "failed", startedAt: "2026-05-16T08:00:00.000Z" },
      { id: "run-new", jobId: "job-employee", status: "succeeded", startedAt: "2026-05-16T09:00:00.000Z" },
      { id: "run-personal", jobId: "job-personal", status: "failed", startedAt: "2026-05-16T07:00:00.000Z" },
    ];
    const activeSessionRuns = new Map([["session-1", { status: "running", phase: "model" }]]);
    const adapter = createAwarenessSourceAdapter({
      timeStore: {
        listScheduleJobs: vi.fn().mockResolvedValue(scheduleJobs),
        listExecutionRuns: vi.fn().mockResolvedValue(executionRuns),
      } as any,
      getSessions: () => [{ id: "session-1", backgroundTask: { status: "failed" } }],
      getWorkflowRuns: () => [{ id: "workflow-run-1", workflowId: "workflow-1", status: "failed" }],
      getApprovalRequests: () => [{ id: "approval-1", createdAt: "2026-05-16T08:30:00.000Z" }],
      getSiliconPersons: () => [{ id: "person-1", status: "error" }],
      getActiveSessionRuns: () => activeSessionRuns as any,
    });

    const snapshot = await adapter.snapshot();

    expect(snapshot.scheduleJobs).toBe(scheduleJobs);
    expect(snapshot.executionRuns).toBe(executionRuns);
    expect(snapshot.latestExecutionRunsByScheduleJobId.get("job-employee")?.id).toBe("run-new");
    expect(snapshot.sessions).toHaveLength(1);
    expect(snapshot.workflowRuns).toHaveLength(1);
    expect(snapshot.approvalRequests).toHaveLength(1);
    expect(snapshot.siliconPersons).toHaveLength(1);
    expect(snapshot.activeSessionRuns).toBe(activeSessionRuns);
  });
});
