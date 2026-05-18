/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AwarenessRoutineManager from "../src/renderer/components/time/AwarenessRoutineManager";
import { useWorkspaceStore } from "../src/renderer/stores/workspace";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 准备值守护栏设置测试状态。 */
function seedStore() {
  useWorkspaceStore.setState((state) => ({
    ...state,
    time: {
      ...state.time,
      awarenessSnapshot: { routines: [], activeSignals: [] },
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

describe("awareness settings guardrails", () => {
  it("passes budget, catch-up, and delivery guardrails when creating a routine", () => {
    seedStore();
    render(<AwarenessRoutineManager />);

    fireEvent.change(screen.getByPlaceholderText("值守名称"), { target: { value: "预算值守" } });
    fireEvent.change(screen.getByLabelText("值守护栏设置").querySelector("input[type='number']") as HTMLInputElement, {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByDisplayValue("只补一次"), { target: { value: "skip_missed" } });
    fireEvent.change(screen.getByDisplayValue("今日补看"), { target: { value: "dock_badge" } });
    fireEvent.click(screen.getByTitle("新建值守"));

    expect(useWorkspaceStore.getState().createAwarenessRoutine).toHaveBeenCalledWith(expect.objectContaining({
      name: "预算值守",
      budgetPolicy: expect.objectContaining({ maxModelCallsPerRoutinePerDay: 3 }),
      catchUpPolicy: expect.objectContaining({ mode: "skip_missed" }),
      deliveryPolicy: expect.objectContaining({ deliveryChannel: "dock_badge" }),
    }));
  });
});
