// @vitest-environment jsdom

import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TimeCenterPage from "../src/renderer/pages/TimeCenterPage";
import { useWorkspaceStore } from "../src/renderer/stores/workspace";

describe("TimeCenterPage", () => {
  const updateCalendarEventMock = vi.fn();
  const deleteReminderMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T01:00:00.000Z"));
    updateCalendarEventMock.mockResolvedValue(undefined);
    deleteReminderMock.mockResolvedValue(undefined);
    useWorkspaceStore.setState({
      time: {
        calendarEvents: [
          {
            id: "event-personal",
            kind: "calendar_event",
            title: "产品例会",
            startsAt: "2026-05-07T02:00:00.000Z",
            endsAt: "2026-05-07T03:00:00.000Z",
            timezone: "Asia/Shanghai",
            ownerScope: "personal",
            status: "confirmed",
            source: "manual",
            createdAt: "2026-05-07T00:00:00.000Z",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
          {
            id: "event-silicon",
            kind: "calendar_event",
            title: "准备会议材料",
            startsAt: "2026-05-07T03:30:00.000Z",
            endsAt: "2026-05-07T04:00:00.000Z",
            timezone: "Asia/Shanghai",
            ownerScope: "silicon_person",
            ownerId: "sp-1",
            status: "confirmed",
            source: "agent",
            createdAt: "2026-05-07T00:00:00.000Z",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
        ],
        taskCommitments: [
          {
            id: "task-1",
            kind: "task_commitment",
            title: "整理季度复盘素材",
            timezone: "Asia/Shanghai",
            ownerScope: "personal",
            priority: "high",
            status: "pending",
            source: "manual",
            createdAt: "2026-05-07T00:00:00.000Z",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
        ],
        reminders: [
          {
            id: "rem-1",
            kind: "reminder",
            title: "提交报销材料",
            triggerAt: "2026-05-07T02:30:00.000Z",
            timezone: "Asia/Shanghai",
            ownerScope: "personal",
            status: "scheduled",
            source: "manual",
            createdAt: "2026-05-07T00:00:00.000Z",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
        ],
        scheduleJobs: [
          {
            id: "job-1",
            kind: "schedule_job",
            title: "同步飞书审批",
            scheduleKind: "cron",
            timezone: "Asia/Shanghai",
            ownerScope: "silicon_person",
            ownerId: "sp-1",
            status: "scheduled",
            source: "manual",
            cronExpression: "0 10 * * *",
            executor: "silicon_person",
            nextRunAt: "2026-05-07T02:00:00.000Z",
            lastRunAt: "2026-05-06T02:00:00.000Z",
            createdAt: "2026-05-07T00:00:00.000Z",
            updatedAt: "2026-05-07T00:00:00.000Z",
          },
          {
            id: "job-2",
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
            status: "failed",
            startedAt: "2026-05-06T02:00:00.000Z",
            finishedAt: "2026-05-06T02:05:00.000Z",
            errorMessage: "工具超时",
          },
        ],
        availabilityPolicy: null,
        todayBrief: null,
      },
      siliconPersons: [
        {
          id: "sp-1",
          name: "张三",
        },
      ],
      suggestTimeboxes: async () => [],
      updateCalendarEvent: updateCalendarEventMock,
      deleteReminder: deleteReminderMock,
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderPage(initialEntries?: React.ComponentProps<typeof MemoryRouter>["initialEntries"]) {
    const routerProps: React.ComponentProps<typeof MemoryRouter> = {
      future: {
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      },
    };
    if (initialEntries) {
      routerProps.initialEntries = initialEntries;
    }
    return render(
      React.createElement(
        MemoryRouter,
        routerProps,
        React.createElement(TimeCenterPage),
      ),
    );
  }

  it("renders schedule planning as a timeline-first workspace", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "日程规划" })).toBeTruthy();
    const summaryBar = within(screen.getByTestId("schedule-summary-bar"));
    expect(summaryBar.getByText("我的安排")).toBeTruthy();
    expect(summaryBar.getByText("硅基人任务")).toBeTruthy();
    expect(summaryBar.getByText("定时任务")).toBeTruthy();
    expect(screen.getByTestId("schedule-timeline")).toBeTruthy();
    expect(screen.getByTestId("timeline-hour-0")).toBeTruthy();
    expect(screen.getByTestId("timeline-hour-24")).toBeTruthy();
    expect(screen.getByText("产品例会")).toBeTruthy();
    expect(screen.getByText("张三 · 准备会议材料")).toBeTruthy();
    expect(screen.getByText("张三 · 同步飞书审批")).toBeTruthy();
    expect(within(screen.getByTestId("timeline-hour-20")).getByText("日报汇总")).toBeTruthy();
    const resourceRail = within(screen.getByTestId("schedule-resource-rail"));
    expect(resourceRail.getByText("张三")).toBeTruthy();
    expect(resourceRail.getByText("有异常")).toBeTruthy();
  });

  it("switches between timeline, calendar event, reminder, and schedule job lists", () => {
    renderPage();

    expect(screen.getByRole("button", { name: "时间轴" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "日程列表" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "提醒列表" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "定时任务" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "日程列表" }));
    expect(screen.getByRole("heading", { name: "日程列表" })).toBeTruthy();
    expect(screen.getByText("产品例会")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "提醒列表" }));
    expect(screen.getByRole("heading", { name: "提醒列表" })).toBeTruthy();
    expect(screen.getByText("提交报销材料")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "定时任务" }));
    expect(screen.getByRole("heading", { name: "定时任务" })).toBeTruthy();
    expect(screen.getByText("日报汇总")).toBeTruthy();
  });

  it("opens the schedule job list when navigation state requests it", () => {
    renderPage([{ pathname: "/time", state: { activeView: "jobs" } }]);

    expect(screen.getByRole("heading", { name: "定时任务" })).toBeTruthy();
    expect(screen.getByText("日报汇总")).toBeTruthy();
  });

  it("keeps unscheduled tasks visible without taking over the timeline", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "待安排任务" })).toBeTruthy();
    expect(screen.getByText("整理季度复盘素材")).toBeTruthy();
    expect(screen.getByRole("button", { name: "安排时间" })).toBeTruthy();
  });

  it("limits initial timeline and side rail rendering for large schedule datasets", () => {
    const reminders = Array.from({ length: 360 }, (_, index) => ({
      id: `perf-rem-${index}`,
      kind: "reminder" as const,
      title: `Perf reminder ${index}`,
      triggerAt: new Date(Date.UTC(2026, 4, 7, 2, index % 60, 0)).toISOString(),
      timezone: "Asia/Shanghai",
      ownerScope: "personal" as const,
      status: "scheduled" as const,
      source: "manual" as const,
      createdAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T00:00:00.000Z",
    }));
    const taskCommitments = Array.from({ length: 80 }, (_, index) => ({
      id: `perf-task-${index}`,
      kind: "task_commitment" as const,
      title: `Perf task ${index}`,
      timezone: "Asia/Shanghai",
      ownerScope: "personal" as const,
      priority: "medium" as const,
      status: "pending" as const,
      source: "manual" as const,
      createdAt: "2026-05-07T00:00:00.000Z",
      updatedAt: "2026-05-07T00:00:00.000Z",
    }));
    useWorkspaceStore.setState((state) => ({
      time: {
        ...state.time,
        reminders,
        taskCommitments,
        calendarEvents: [],
        scheduleJobs: [],
        executionRuns: [],
      },
    }) as any);

    const { container } = renderPage();

    expect(container.querySelectorAll(".timeline-entry-item")).toHaveLength(200);
    expect(screen.getByTestId("timeline-overflow-notice")).toBeTruthy();
    expect(container.querySelectorAll('[data-testid="schedule-resource-rail"] .compact-row')).toHaveLength(8);
    expect(screen.getByTestId("unscheduled-task-overflow")).toBeTruthy();
  });

  it("opens timeline event details and supports edit and delete actions", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /查看产品例会/ }));

    const detailDialog = within(screen.getByRole("dialog", { name: "日程详情" }));
    expect(detailDialog.getByRole("heading", { name: "产品例会" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("dialog", { name: "编辑日程" })).toBeTruthy();
    expect(screen.getByDisplayValue("产品例会")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭编辑" }));
    fireEvent.click(screen.getByRole("button", { name: /查看产品例会/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "删除" }));
    });

    expect(updateCalendarEventMock).toHaveBeenCalledWith(expect.objectContaining({ id: "event-personal", status: "cancelled" }));
  });

  it("opens timeline reminder details and supports deleting the reminder", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /查看提醒：提交报销材料/ }));

    expect(screen.getByRole("dialog", { name: "提醒详情" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "删除" }));
    });

    expect(deleteReminderMock).toHaveBeenCalledWith("rem-1");
  });
});
