import { describe, expect, it } from "vitest";

import { createAwarenessSignalCollector } from "../src/main/services/awareness-signal-collector";

function collector(overrides: Partial<Parameters<typeof createAwarenessSignalCollector>[0]> = {}) {
  return createAwarenessSignalCollector({
    getActiveSessionRuns: () => new Map(),
    getAgentTasks: () => [],
    getScheduleJobs: () => [],
    getWorkflowRuns: () => [],
    getBackgroundTasks: () => [],
    getApprovalRequests: () => [],
    getSiliconPersons: () => [],
    getAvailabilityPolicy: () => null,
    now: () => new Date("2026-05-16T10:00:00.000Z"),
    ...overrides,
  });
}

describe("awareness signal collector", () => {
  it("creates scoped warning signals for failed schedule jobs", () => {
    const signals = collector({
      getScheduleJobs: () => [{
        id: "job-1",
        status: "failed",
        ownerScope: "silicon_person",
        ownerId: "person-1",
      }],
    }).collect();

    expect(signals).toContainEqual(expect.objectContaining({
      sourceKind: "schedule_job",
      sourceId: "job-1",
      scope: { kind: "silicon_person", ownerId: "person-1" },
      severity: "warning",
      fingerprint: "job:failed:job-1",
    }));
  });

  it("creates critical stale-job signals only after the delay threshold", () => {
    const signals = collector({
      getScheduleJobs: () => [
        { id: "fresh", status: "scheduled", nextRunAt: "2026-05-16T09:30:00.000Z" },
        { id: "stale", status: "scheduled", nextRunAt: "2026-05-16T07:00:00.000Z" },
      ],
    }).collect();

    expect(signals.map((s) => s.sourceId)).not.toContain("fresh");
    expect(signals).toContainEqual(expect.objectContaining({
      sourceKind: "schedule_job",
      sourceId: "stale",
      severity: "critical",
      fingerprint: "job:stale:stale",
    }));
  });

  it("collects workflow, background, stuck session, pending approval, and system-health signals", () => {
    const activeRuns = new Map([[
      "session-1",
      { status: "running", phase: "model", currentMessageId: "m1", startedAt: "2026-05-16T09:00:00.000Z" },
    ]]);
    const signals = collector({
      getActiveSessionRuns: () => activeRuns as any,
      getWorkflowRuns: () => [
        { id: "wf-failed", workflowId: "wf", status: "failed" },
        { id: "wf-waiting", workflowId: "wf", status: "waiting-input", interruptRequested: true },
      ],
      getBackgroundTasks: () => [{ sessionId: "bg-session", backgroundTask: { status: "failed" } }],
      getApprovalRequests: () => [{ id: "approval-1", createdAt: "2026-05-16T09:40:00.000Z" }],
      getSiliconPersons: () => [{ id: "person-error", status: "error" }],
    }).collect();

    expect(signals.map((s) => s.fingerprint)).toEqual(expect.arrayContaining([
      "workflow:failed:wf-failed",
      "workflow:waiting:wf-waiting",
      "bg:failed:bg-session",
      "stuck:session-1",
      "approval:approval-1",
      "health:person_error:person-error",
    ]));
    expect(signals.find((s) => s.fingerprint === "health:person_error:person-error")?.scope)
      .toEqual({ kind: "silicon_person", ownerId: "person-error" });
  });

  it("uses assignee scope for employee agent task signals", () => {
    const signals = collector({
      getAgentTasks: () => [{
        id: "task-1",
        status: "waiting_user",
        assignees: [{ siliconPersonId: "person-2", status: "waiting_user" }],
      }],
    }).collect();

    expect(signals).toContainEqual(expect.objectContaining({
      sourceKind: "agent_task",
      sourceId: "task-1",
      scope: { kind: "silicon_person", ownerId: "person-2" },
      severity: "info",
    }));
  });
});
