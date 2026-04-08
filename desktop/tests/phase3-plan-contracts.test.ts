import { describe, expect, it } from "vitest";

import type {
  ChatSession,
  PlanModeApprovalStatus,
  PlanModeState,
  PlanModeWorkflowMode,
  PlanState,
  PlanStepKind,
  PlanTask,
  PlanTaskStatus,
} from "@shared/contracts";
import {
  PLAN_MODE_APPROVAL_STATUS_VALUES,
  PLAN_MODE_STATE_VALUES,
  PLAN_MODE_WORKFLOW_MODE_VALUES,
  PLAN_STEP_KIND_VALUES,
  PLAN_TASK_STATUS_VALUES,
} from "@shared/contracts";

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

  it("exports stable plan mode values for workflow mode, phase, approval state, and step kind", () => {
    const knownWorkflowModes = [
      "default",
      "plan",
    ] satisfies readonly PlanModeWorkflowMode[];
    const knownPlanModes = [
      "off",
      "planning",
      "awaiting_approval",
      "executing",
      "completed",
      "blocked",
    ] satisfies readonly PlanModeState[];
    const knownApprovalStatuses = [
      "idle",
      "pending",
      "approved",
      "rejected",
    ] satisfies readonly PlanModeApprovalStatus[];
    const knownStepKinds = [
      "analysis",
      "tool",
      "verification",
      "user_confirmation",
    ] satisfies readonly PlanStepKind[];

    expect(PLAN_MODE_WORKFLOW_MODE_VALUES).toEqual(expect.arrayContaining(knownWorkflowModes));
    expect(PLAN_MODE_STATE_VALUES).toEqual(expect.arrayContaining(knownPlanModes));
    expect(PLAN_MODE_APPROVAL_STATUS_VALUES).toEqual(expect.arrayContaining(knownApprovalStatuses));
    expect(PLAN_STEP_KIND_VALUES).toEqual(expect.arrayContaining(knownStepKinds));
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

  it("supports serializable plan mode state metadata alongside structured plan drafts", () => {
    const sessionWithPlanMode = JSON.parse(JSON.stringify({
      id: "session-with-plan-mode",
      title: "Session With Plan Mode",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      planState: {
        tasks: [
          {
            id: "task-plan-goal",
            title: "Define plan goal",
            status: "pending",
          },
        ],
        updatedAt: "2026-04-06T00:00:01.000Z",
      },
      planModeState: {
        mode: "awaiting_approval",
        approvalStatus: "pending",
        planVersion: 2,
        lastPlanMessageId: "assistant-plan-message",
        approvedAt: null,
        structuredPlan: {
          goal: "Ship visible plan mode",
          summary: "Draft a visible execution plan before running tools",
          assumptions: ["Existing planState task runtime remains reusable"],
          openQuestions: ["Should plan mode auto-enable on complex prompts?"],
          acceptanceCriteria: ["User must approve before execution"],
          steps: [
            {
              id: "step-analyze",
              title: "Analyze the request",
              status: "pending",
              kind: "analysis",
            },
            {
              id: "step-approve",
              title: "Wait for approval",
              status: "pending",
              kind: "user_confirmation",
            },
          ],
        },
      },
      messages: [],
    })) as ChatSession;

    const sessionRecord = sessionWithPlanMode as ChatSession & Record<string, unknown>;

    expect(sessionRecord.planModeState).toMatchObject({
      mode: "awaiting_approval",
      approvalStatus: "pending",
      planVersion: 2,
      lastPlanMessageId: "assistant-plan-message",
    });
    expect((sessionRecord.planModeState as { structuredPlan?: unknown } | undefined)?.structuredPlan).toMatchObject({
      goal: "Ship visible plan mode",
      steps: [
        {
          id: "step-analyze",
          kind: "analysis",
        },
        {
          id: "step-approve",
          kind: "user_confirmation",
        },
      ],
    });
  });
});
