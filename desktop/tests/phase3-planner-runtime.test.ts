import { describe, expect, it } from "vitest";

import {
  blockTask,
  completeTask,
  createPlanState,
  derivePlannerStatus,
  startTask,
  updateTaskStatus,
} from "../src/main/services/planner-runtime";

describe("Phase 3 planner runtime", () => {
  it("creates initial plan state with pending tasks and a stable timestamp", () => {
    const planState = createPlanState([
      {
        id: "task-collect-context",
        title: "Collect context",
      },
      {
        id: "task-run-tool",
        title: "Run tool",
        detail: "Ready to execute",
      },
    ], "2026-04-06T00:00:00.000Z");

    expect(planState).toEqual({
      tasks: [
        {
          id: "task-collect-context",
          title: "Collect context",
          status: "pending",
        },
        {
          id: "task-run-tool",
          title: "Run tool",
          status: "pending",
          detail: "Ready to execute",
        },
      ],
      updatedAt: "2026-04-06T00:00:00.000Z",
    });
    expect(derivePlannerStatus(planState)).toBe("pending");
  });

  it("updates task status and timestamps through progress helpers", () => {
    const pendingPlan = createPlanState([
      {
        id: "task-collect-context",
        title: "Collect context",
      },
    ], "2026-04-06T00:00:00.000Z");

    const inProgressPlan = startTask(
      pendingPlan,
      "task-collect-context",
      "Scanning files",
      "2026-04-06T00:00:01.000Z",
    );
    const completedPlan = completeTask(
      inProgressPlan,
      "task-collect-context",
      "Context captured",
      "2026-04-06T00:00:02.000Z",
    );

    expect(inProgressPlan.tasks[0]).toMatchObject({
      id: "task-collect-context",
      status: "in_progress",
      detail: "Scanning files",
    });
    expect(inProgressPlan.updatedAt).toBe("2026-04-06T00:00:01.000Z");
    expect(completedPlan.tasks[0]).toMatchObject({
      id: "task-collect-context",
      status: "completed",
      detail: "Context captured",
    });
    expect(completedPlan.tasks[0].blocker).toBeUndefined();
    expect(completedPlan.updatedAt).toBe("2026-04-06T00:00:02.000Z");
  });

  it("derives planner state transitions from task progress", () => {
    const initialPlan = createPlanState([
      {
        id: "task-collect-context",
        title: "Collect context",
      },
      {
        id: "task-run-verification",
        title: "Run verification",
      },
    ], "2026-04-06T00:00:00.000Z");

    const activePlan = startTask(
      initialPlan,
      "task-collect-context",
      "Reading scoped files",
      "2026-04-06T00:00:01.000Z",
    );
    const partiallyDonePlan = completeTask(
      activePlan,
      "task-collect-context",
      "Files reviewed",
      "2026-04-06T00:00:02.000Z",
    );
    const blockedPlan = blockTask(
      partiallyDonePlan,
      "task-run-verification",
      "Waiting for runtime implementation",
      "2026-04-06T00:00:03.000Z",
    );
    const resumedPlan = updateTaskStatus(blockedPlan, {
      taskId: "task-run-verification",
      status: "in_progress",
      detail: "Verification restarted",
      blocker: null,
      now: "2026-04-06T00:00:04.000Z",
    });
    const completedPlan = completeTask(
      resumedPlan,
      "task-run-verification",
      "Verification finished",
      "2026-04-06T00:00:05.000Z",
    );

    expect(derivePlannerStatus(initialPlan)).toBe("pending");
    expect(derivePlannerStatus(activePlan)).toBe("in_progress");
    expect(derivePlannerStatus(blockedPlan)).toBe("blocked");
    expect(derivePlannerStatus(resumedPlan)).toBe("in_progress");
    expect(derivePlannerStatus(completedPlan)).toBe("completed");
  });

  it("rejects invalid task state transitions", () => {
    const planState = createPlanState([
      {
        id: "task-collect-context",
        title: "Collect context",
      },
    ], "2026-04-06T00:00:00.000Z");

    expect(() => updateTaskStatus(planState, {
      taskId: "task-collect-context",
      status: "completed",
      now: "2026-04-06T00:00:01.000Z",
    })).toThrow("Invalid planner task transition");

    const completedPlan = completeTask(
      startTask(planState, "task-collect-context", undefined, "2026-04-06T00:00:01.000Z"),
      "task-collect-context",
      undefined,
      "2026-04-06T00:00:02.000Z",
    );

    expect(() => updateTaskStatus(completedPlan, {
      taskId: "task-collect-context",
      status: "in_progress",
      now: "2026-04-06T00:00:03.000Z",
    })).toThrow("Invalid planner task transition");
  });

  it("degrades safely for restored unknown statuses and preserves extra task fields across updates", () => {
    const restoredPlan = {
      tasks: [
        {
          id: "task-future-status",
          title: "Future task",
          status: "queued",
          owner: "planner-v2",
          detail: "Restored from newer runtime",
        },
        {
          id: "task-done",
          title: "Done task",
          status: "completed",
        },
      ],
      updatedAt: "2026-04-06T00:00:00.000Z",
    };

    expect(() => derivePlannerStatus(restoredPlan)).not.toThrow();
    expect(derivePlannerStatus(restoredPlan)).toBe("pending");

    const updatedPlan = updateTaskStatus(restoredPlan, {
      taskId: "task-future-status",
      status: "in_progress",
      detail: "Adopted by current runtime",
      blocker: null,
      now: "2026-04-06T00:00:01.000Z",
    });

    expect(updatedPlan.tasks[0]).toMatchObject({
      id: "task-future-status",
      status: "in_progress",
      owner: "planner-v2",
      detail: "Adopted by current runtime",
    });
    expect(updatedPlan.updatedAt).toBe("2026-04-06T00:00:01.000Z");
    expect(derivePlannerStatus(updatedPlan)).toBe("in_progress");
  });
});
