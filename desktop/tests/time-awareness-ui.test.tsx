/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AwarenessCatchUp from "../src/renderer/components/time/AwarenessCatchUp";
import AwarenessRoutineManager from "../src/renderer/components/time/AwarenessRoutineManager";
import { useWorkspaceStore } from "../src/renderer/stores/workspace";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 写入值守 UI 测试所需的最小 workspace 状态。 */
function seedAwarenessState() {
  useWorkspaceStore.setState((state) => ({
    ...state,
    time: {
      ...state.time,
      awarenessDeliveries: [
        { id: "delivery-1", title: "值守任务状态更新", body: "等待处理", createdAt: new Date().toISOString() },
      ],
      awarenessSnapshot: {
        routines: [
          {
            id: "routine-1",
            name: "个人值守",
            purpose: "守护定时任务",
            cadenceMinutes: 30,
            status: "enabled",
            consecutiveFailures: 0,
          },
        ],
        activeSignals: [
          {
            id: "signal-1",
            sourceKind: "schedule_job",
            severity: "warning",
            summary: "定时任务失败",
            status: "active",
            createdAt: new Date().toISOString(),
            occurrenceCount: 2,
          },
        ],
        failedRoutineCount: 0,
        pendingApprovals: 0,
      },
    },
    createAwarenessRoutine: vi.fn(),
    updateAwarenessRoutine: vi.fn(),
    deleteAwarenessRoutine: vi.fn(),
    pauseAwarenessRoutine: vi.fn(),
    resumeAwarenessRoutine: vi.fn(),
    runAwarenessRoutineNow: vi.fn(),
    dismissAwarenessSignal: vi.fn(),
    acknowledgeAwarenessSignal: vi.fn(),
  }));
}

describe("time awareness UI", () => {
  it("renders routine manager with active signals and can run a routine", () => {
    seedAwarenessState();

    render(<AwarenessRoutineManager />);
    fireEvent.click(screen.getByTitle("立即运行"));

    expect(screen.getByText("值守规则")).toBeTruthy();
    expect(screen.getByText("个人值守")).toBeTruthy();
    expect(screen.getAllByText("定时任务失败").length).toBeGreaterThan(0);
    expect(useWorkspaceStore.getState().runAwarenessRoutineNow).toHaveBeenCalledWith("routine-1");
  });

  it("renders catch-up items from active signals and delivery events", () => {
    seedAwarenessState();

    render(<AwarenessCatchUp />);

    expect(screen.getByText("值守补看")).toBeTruthy();
    expect(screen.getByText("定时任务失败")).toBeTruthy();
    expect(screen.getByText("值守任务状态更新")).toBeTruthy();
  });
});
