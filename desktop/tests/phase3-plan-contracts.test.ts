import { describe, expect, it } from "vitest";

import type { ChatSession, PlanState, PlanTask, PlanTaskStatus } from "@shared/contracts";
import { PLAN_TASK_STATUS_VALUES } from "@shared/contracts";

describe("Phase 3 plan contracts", () => {
  it("exports stable plan task status values", () => {
    const knownStatuses = [
      "pending",
      "in_progress",
      "completed",
      "blocked",
    ] satisfies readonly PlanTaskStatus[];

    expect(PLAN_TASK_STATUS_VALUES).toHaveLength(knownStatuses.length);
    expect(PLAN_TASK_STATUS_VALUES).toEqual(expect.arrayContaining(knownStatuses));
  });

  it("supports serializable plan task and plan state fields, including forward-compatible statuses", () => {
    const futureStatus: PlanTaskStatus = "queued";
    const task: PlanTask = {
      id: "task-collect-context",
      title: "Collect context",
      status: "in_progress",
      detail: "Reading scoped files",
    };

    const planState: PlanState = {
      tasks: [
        task,
        {
          id: "task-run-verification",
          title: "Run verification",
          status: "blocked",
          blocker: "Waiting for contract implementation",
        },
        {
          id: "task-waiting-review",
          title: "Waiting for review",
          status: futureStatus,
        },
      ],
      updatedAt: "2026-04-06T00:00:00.000Z",
    };

    const parsed = JSON.parse(JSON.stringify(planState)) as PlanState;

    expect(parsed.updatedAt).toBe("2026-04-06T00:00:00.000Z");
    expect(parsed.tasks).toHaveLength(3);
    expect(parsed.tasks[0]).toMatchObject({
      id: "task-collect-context",
      status: "in_progress",
      detail: "Reading scoped files",
    });
    expect(parsed.tasks[1]).toMatchObject({
      id: "task-run-verification",
      status: "blocked",
      blocker: "Waiting for contract implementation",
    });
    expect(parsed.tasks[2]).toMatchObject({
      id: "task-waiting-review",
      status: "queued",
    });
  });

  it("keeps older sessions valid when planState is absent or null and supports persisted planState when present", () => {
    const legacySession = JSON.parse(JSON.stringify({
      id: "session-legacy",
      title: "Legacy Session",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      messages: [],
    } satisfies ChatSession)) as ChatSession;

    const legacyNullPlanStateSession = JSON.parse(JSON.stringify({
      id: "session-legacy-null-plan",
      title: "Legacy Null Plan",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      planState: null,
      messages: [],
    } satisfies ChatSession)) as ChatSession;

    const sessionWithPlan = JSON.parse(JSON.stringify({
      id: "session-with-plan",
      title: "Session With Plan",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      planState: {
        tasks: [
          {
            id: "task-1",
            title: "Define contract",
            status: "completed",
          },
        ],
        updatedAt: "2026-04-06T00:00:01.000Z",
      },
      messages: [],
    } satisfies ChatSession)) as ChatSession;

    expect(legacySession.planState).toBeUndefined();
    expect(legacyNullPlanStateSession.planState).toBeNull();
    expect(sessionWithPlan.planState).toMatchObject({
      updatedAt: "2026-04-06T00:00:01.000Z",
      tasks: [
        {
          id: "task-1",
          status: "completed",
        },
      ],
    });
  });
});
