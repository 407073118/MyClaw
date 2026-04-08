/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { PlanState } from "@shared/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Phase 3 plan mode UI", () => {
  const planState: PlanState = {
    updatedAt: "2026-04-06T00:10:00.000Z",
    tasks: [
      {
        id: "step-collect-context",
        title: "Collect context",
        status: "pending",
      },
      {
        id: "step-apply-change",
        title: "Apply change",
        status: "pending",
      },
    ],
  };

  afterEach(() => {
    cleanup();
  });

  it("shows explicit approval actions while the plan is waiting for approval", async () => {
    const { PlanSidePanel } = await import("../src/renderer/components/PlanSidePanel");
    const onApprove = vi.fn();
    const onRevise = vi.fn();
    const onCancel = vi.fn();

    render(React.createElement(PlanSidePanel, {
      planState,
      planModeState: {
        mode: "awaiting_approval",
        approvalStatus: "pending",
        planVersion: 1,
      },
      onApprove,
      onRevise,
      onCancel,
    }));

    const panel = screen.getByTestId("plan-side-panel");
    expect(within(panel).getByTestId("plan-approve-button")).toBeTruthy();
    expect(within(panel).getByTestId("plan-revise-button")).toBeTruthy();
    expect(within(panel).getByTestId("plan-cancel-button")).toBeTruthy();
    expect(within(panel).getByTestId("plan-version-label").textContent).toContain("v1");
  });

  it("keeps rendering existing plan tasks outside approval mode", async () => {
    const { PlanSidePanel } = await import("../src/renderer/components/PlanSidePanel");

    render(React.createElement(PlanSidePanel, {
      planState,
      planModeState: {
        mode: "executing",
        approvalStatus: "approved",
        planVersion: 2,
      },
    }));

    const panel = screen.getByTestId("plan-side-panel");
    expect(within(panel).getByTestId("plan-task-step-collect-context").textContent).toContain("Collect context");
    expect(within(panel).queryByTestId("plan-approve-button")).toBeNull();
    expect(within(panel).queryByTestId("plan-revise-button")).toBeNull();
  });

  it("shows the current step and parallel workstreams for complex plan execution", async () => {
    const { PlanSidePanel } = await import("../src/renderer/components/PlanSidePanel");

    render(React.createElement(PlanSidePanel, {
      planState: {
        updatedAt: "2026-04-06T00:10:00.000Z",
        tasks: [
          {
            id: "step-analyze",
            title: "Analyze the request",
            status: "completed",
            lane: "planner",
          },
          {
            id: "step-implement",
            title: "Implement the change",
            status: "in_progress",
            lane: "implementer",
          },
          {
            id: "step-verify",
            title: "Verify the change",
            status: "pending",
            lane: "verifier",
          },
        ],
      },
      planModeState: {
        mode: "executing",
        approvalStatus: "approved",
        planVersion: 2,
        currentTaskTitle: "Implement the change",
        currentTaskKind: "tool",
        workflowRun: {
          status: "running",
        },
        workstreams: [
          {
            id: "planner",
            label: "planner",
            status: "completed",
            stepIds: ["step-analyze"],
          },
          {
            id: "implementer",
            label: "implementer",
            status: "in_progress",
            stepIds: ["step-implement"],
          },
          {
            id: "verifier",
            label: "verifier",
            status: "pending",
            stepIds: ["step-verify"],
          },
        ],
      },
    }));

    const panel = screen.getByTestId("plan-side-panel");
    expect(within(panel).getByTestId("plan-current-step").textContent).toContain("Implement the change");
    expect(within(panel).getByTestId("plan-current-step").textContent).toContain("tool");
    expect(within(panel).getByTestId("plan-workflow-run-status").textContent).toContain("running");
    expect(within(panel).getByTestId("plan-workstream-implementer").textContent).toContain("in_progress");
    expect(within(panel).getByTestId("plan-workstream-verifier").textContent).toContain("pending");
  });
});
