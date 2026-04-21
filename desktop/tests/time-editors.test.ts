// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TimeCenterPage from "../src/renderer/pages/TimeCenterPage";
import { useWorkspaceStore } from "../src/renderer/stores/workspace";

describe("time editors", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      time: {
        calendarEvents: [],
        taskCommitments: [],
        reminders: [],
        scheduleJobs: [],
        executionRuns: [],
        availabilityPolicy: {
          timezone: "Asia/Shanghai",
          workingHours: [
            { weekday: 1, start: "09:00", end: "18:00" },
            { weekday: 2, start: "09:00", end: "18:00" },
          ],
          quietHours: { enabled: true, start: "22:00", end: "08:00" },
          notificationWindows: [],
          focusBlocks: [],
        },
        todayBrief: null,
      },
      suggestTimeboxes: vi.fn().mockResolvedValue([]),
      createReminder: vi.fn().mockResolvedValue(undefined),
      createScheduleJob: vi.fn().mockResolvedValue(undefined),
      saveAvailabilityPolicy: vi.fn().mockResolvedValue(undefined),
      updateScheduleJob: vi.fn().mockResolvedValue(undefined),
      deleteReminder: vi.fn().mockResolvedValue(undefined),
      deleteScheduleJob: vi.fn().mockResolvedValue(undefined),
    } as any);
  });

  function renderPage() {
    return render(
      React.createElement(
        MemoryRouter,
        {
          future: {
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          },
        },
        React.createElement(TimeCenterPage),
      ),
    );
  }

  it("creates a recurring schedule job and persists availability rules", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "自动化" }));

    fireEvent.change(screen.getByLabelText("Reminder Title"), { target: { value: "催一下周报" } });
    fireEvent.change(screen.getByLabelText("Reminder Time"), { target: { value: "2026-04-22T09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Reminder" }));

    fireEvent.change(screen.getByLabelText("Job Title"), { target: { value: "每周跟进流程" } });
    fireEvent.change(screen.getByLabelText("Schedule Type"), { target: { value: "interval" } });
    fireEvent.change(screen.getByLabelText("Job Start"), { target: { value: "2026-04-22T10:00" } });
    fireEvent.change(screen.getByLabelText("Interval Minutes"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Job" }));

    fireEvent.change(screen.getByLabelText("Workday Start"), { target: { value: "08:30" } });
    fireEvent.change(screen.getByLabelText("Workday End"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("Quiet Start"), { target: { value: "23:00" } });
    fireEvent.change(screen.getByLabelText("Quiet End"), { target: { value: "07:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Rules" }));

    await waitFor(() => {
      const state = useWorkspaceStore.getState() as any;
      expect(state.createReminder).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "催一下周报",
          timezone: "Asia/Shanghai",
          triggerAt: "2026-04-22T01:30:00.000Z",
        }),
      );
      expect(state.createScheduleJob).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "每周跟进流程",
          scheduleKind: "interval",
          intervalMinutes: 120,
          startsAt: "2026-04-22T02:00:00.000Z",
        }),
      );
      expect(state.saveAvailabilityPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          timezone: "Asia/Shanghai",
          quietHours: expect.objectContaining({
            start: "23:00",
            end: "07:30",
          }),
        }),
      );
    });
  });

  it("supports pausing jobs and deleting existing reminder rows", async () => {
    useWorkspaceStore.setState({
      time: {
        ...useWorkspaceStore.getState().time,
        reminders: [
          {
            id: "rem-1",
            kind: "reminder",
            title: "清理收件箱",
            triggerAt: "2026-04-22T01:30:00.000Z",
            timezone: "Asia/Shanghai",
            ownerScope: "personal",
            status: "scheduled",
            source: "manual",
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z",
          },
        ],
        scheduleJobs: [
          {
            id: "job-1",
            kind: "schedule_job",
            title: "日报播报",
            scheduleKind: "interval",
            timezone: "Asia/Shanghai",
            ownerScope: "personal",
            status: "scheduled",
            source: "manual",
            intervalMinutes: 60,
            executor: "assistant_prompt",
            nextRunAt: "2026-04-22T02:00:00.000Z",
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z",
          },
        ],
      },
    } as any);

    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "自动化" }));

    fireEvent.click(screen.getByRole("button", { name: "暂停任务" }));
    fireEvent.click(screen.getByRole("button", { name: "删除提醒" }));

    await waitFor(() => {
      const state = useWorkspaceStore.getState() as any;
      expect(state.updateScheduleJob).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "job-1",
          status: "paused",
        }),
      );
      expect(state.deleteReminder).toHaveBeenCalledWith("rem-1");
    });
  });
});
