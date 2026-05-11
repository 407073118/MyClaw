// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TimeJobDetailPage from "../src/renderer/pages/TimeJobDetailPage";
import { useWorkspaceStore } from "../src/renderer/stores/workspace";

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location-probe">
      {location.pathname}
      {location.search}
    </output>
  );
}

describe("TimeJobDetailPage", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      time: {
        calendarEvents: [],
        taskCommitments: [],
        reminders: [],
        scheduleJobs: [
          {
            id: "job-1",
            kind: "schedule_job",
            title: "日报汇总",
            scheduleKind: "once",
            timezone: "Asia/Shanghai",
            ownerScope: "personal",
            status: "scheduled",
            source: "manual",
            startsAt: "2026-05-07T12:00:00.000Z",
            executor: "assistant_prompt",
            nextRunAt: "2026-05-07T12:00:00.000Z",
            createdAt: "2026-05-07T00:00:00.000Z",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
        ],
        executionRuns: [
          {
            id: "run-1",
            jobId: "job-1",
            status: "succeeded",
            startedAt: "2026-05-07T12:00:00.000Z",
            finishedAt: "2026-05-07T12:01:00.000Z",
            sessionId: "session-1",
            outputSummary: "今天的自动日报执行结果：完成了销售线索汇总，并标记了 3 个高优先级跟进项。",
          },
        ],
        availabilityPolicy: null,
        todayBrief: null,
      },
      refreshExecutionRuns: vi.fn(async () => []),
    } as any);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a run result when clicking a trigger card and keeps chat behind a dedicated button", () => {
    render(
      <MemoryRouter initialEntries={["/time/jobs/job-1"]}>
        <Routes>
          <Route path="/time/jobs/:id" element={<><TimeJobDetailPage /><LocationProbe /></>} />
          <Route path="/chat" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("heading", { name: "本次执行结果" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "查看本次触发结果" }));

    expect(screen.getByRole("heading", { name: "本次执行结果" })).toBeTruthy();
    expect(within(screen.getByLabelText("本次执行结果")).getByText(/销售线索汇总/)).toBeTruthy();
    expect(screen.getByTestId("location-probe").textContent).toBe("/time/jobs/job-1");

    fireEvent.click(screen.getByRole("button", { name: "打开聊天" }));

    expect(screen.getByTestId("location-probe").textContent).toBe("/chat?sessionId=session-1");
  });
});
