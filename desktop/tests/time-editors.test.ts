// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TimeCenterPage from "../src/renderer/pages/TimeCenterPage";
import { useWorkspaceStore } from "../src/renderer/stores/workspace";

describe("time editors", () => {
  beforeEach(() => {
    vi.useRealTimers();
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
      executeScheduleJobNow: vi.fn().mockResolvedValue(undefined),
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

    expect(screen.queryByRole("button", { name: "新建提醒" })).toBeNull();
    expect(screen.queryByRole("button", { name: "新建定时任务" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    let composerModal = screen.getByTestId("schedule-composer-modal");
    fireEvent.click(within(composerModal).getByRole("button", { name: "提醒" }));

    fireEvent.change(screen.getByLabelText("提醒标题"), { target: { value: "催一下周报" } });
    fireEvent.change(screen.getByLabelText("提醒时间"), { target: { value: "2026-04-22T09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "保存提醒" }));

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    composerModal = screen.getByTestId("schedule-composer-modal");
    const expandLowFreqButtonA = within(composerModal).queryByRole("button", { name: "展开低频选项（任务 / 时间规则）" });
    if (expandLowFreqButtonA) {
      fireEvent.click(expandLowFreqButtonA);
    }
    fireEvent.click(within(composerModal).getByRole("button", { name: "时间规则" }));
    fireEvent.change(screen.getByLabelText("工作日开始"), { target: { value: "08:30" } });
    fireEvent.change(screen.getByLabelText("工作日结束"), { target: { value: "19:00" } });
    fireEvent.change(screen.getByLabelText("静默开始"), { target: { value: "23:00" } });
    fireEvent.change(screen.getByLabelText("静默结束"), { target: { value: "07:30" } });
    fireEvent.click(screen.getByRole("button", { name: "保存规则" }));

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    composerModal = screen.getByTestId("schedule-composer-modal");
    const expandLowFreqButtonB = within(composerModal).queryByRole("button", { name: "展开低频选项（任务 / 时间规则）" });
    if (expandLowFreqButtonB) {
      fireEvent.click(expandLowFreqButtonB);
    }
    fireEvent.click(within(composerModal).getByRole("button", { name: "定时任务" }));
    fireEvent.change(screen.getByLabelText("任务标题"), { target: { value: "每周跟进流程" } });
    fireEvent.click(screen.getByRole("radio", { name: "每 N 分钟" }));
    fireEvent.change(screen.getByLabelText("间隔分钟（5 - 1440）"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("提示词"), { target: { value: "检查流程推进并给出下一步。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存定时任务" }));

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

    fireEvent.click(screen.getByRole("button", { name: "定时任务" }));
    fireEvent.click(screen.getByRole("button", { name: "立即执行" }));
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    fireEvent.click(screen.getByRole("button", { name: "提醒列表" }));
    fireEvent.click(screen.getByRole("button", { name: "删除提醒" }));

    await waitFor(() => {
      const state = useWorkspaceStore.getState() as any;
      expect(state.executeScheduleJobNow).toHaveBeenCalledWith("job-1");
      expect(state.updateScheduleJob).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "job-1",
          status: "paused",
        }),
      );
      expect(state.deleteReminder).toHaveBeenCalledWith("rem-1");
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores silicon person scheduled messages under the employee owner", async () => {
    useWorkspaceStore.setState({
      siliconPersons: [
        {
          id: "sp-1",
          name: "运营助手",
          title: "运营助手",
          description: "处理周期运营事项",
          status: "idle",
          source: "personal",
          approvalMode: "inherit",
          currentSessionId: null,
          sessions: [],
          unreadCount: 0,
          hasUnread: false,
          needsApproval: false,
          workflowIds: [],
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      ],
    } as any);

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "新建" }));
    const composerModal = screen.getByTestId("schedule-composer-modal");
    fireEvent.click(within(composerModal).getByRole("button", { name: "定时任务" }));
    const changeTypeButton = within(composerModal).queryByRole("button", { name: "← 换类型" });
    if (changeTypeButton) {
      fireEvent.click(changeTypeButton);
    }
    fireEvent.click(within(composerModal).getByRole("button", { name: /定时派发给员工/ }));
    fireEvent.change(screen.getByLabelText("任务标题"), { target: { value: "每日运营巡检" } });
    fireEvent.click(screen.getByRole("radio", { name: "每 N 分钟" }));
    fireEvent.change(screen.getByLabelText("间隔分钟（5 - 1440）"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("选择员工"), { target: { value: "sp-1" } });
    fireEvent.change(screen.getByLabelText("派发消息"), { target: { value: "检查今日运营异常并回复结果。" } });
    fireEvent.click(screen.getByRole("button", { name: "保存定时任务" }));

    await waitFor(() => {
      const state = useWorkspaceStore.getState() as any;
      expect(state.createScheduleJob).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "每日运营巡检",
          ownerScope: "silicon_person",
          ownerId: "sp-1",
          executor: "silicon_person",
          executorTargetId: "sp-1",
        }),
      );
    });
  });

  it("updates assistant prompt session mode when editing a scheduled job", async () => {
    useWorkspaceStore.setState({
      time: {
        ...useWorkspaceStore.getState().time,
        scheduleJobs: [
          {
            id: "job-shared",
            kind: "schedule_job",
            title: "每日简报",
            description: "生成当天简报",
            scheduleKind: "interval",
            timezone: "Asia/Shanghai",
            ownerScope: "personal",
            status: "scheduled",
            source: "manual",
            intervalMinutes: 60,
            executor: "assistant_prompt",
            sessionMode: "shared",
            nextRunAt: "2026-04-22T02:00:00.000Z",
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z",
          },
        ],
      },
    } as any);

    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "定时任务" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("任务标题"), { target: { value: "每日简报更新" } });
    fireEvent.click(screen.getByRole("radio", { name: "每次新会话" }));
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      const state = useWorkspaceStore.getState() as any;
      expect(state.updateScheduleJob).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "job-shared",
          title: "每日简报更新",
          sessionMode: "per_run",
        }),
      );
    });
  });

  it("renders a Monday-start week planner and keeps unscheduled jobs out of day lanes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T02:00:00.000Z"));
    useWorkspaceStore.setState({
      siliconPersons: [
        {
          id: "sp-1",
          name: "运营助手",
          title: "运营助手",
          description: "处理周期运营事项",
          status: "idle",
          source: "personal",
          approvalMode: "inherit",
          currentSessionId: null,
          sessions: [],
          unreadCount: 0,
          hasUnread: false,
          needsApproval: false,
          workflowIds: [],
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      ],
      time: {
        ...useWorkspaceStore.getState().time,
        scheduleJobs: [
          {
            id: "job-real",
            kind: "schedule_job",
            title: "晨间巡检",
            scheduleKind: "cron",
            timezone: "Asia/Shanghai",
            ownerScope: "silicon_person",
            ownerId: "sp-1",
            status: "scheduled",
            source: "manual",
            cronExpression: "0 9 * * 1-5",
            executor: "silicon_person",
            executorTargetId: "sp-1",
            nextRunAt: "2026-04-20T01:00:00.000Z",
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z",
          },
          {
            id: "job-floating",
            kind: "schedule_job",
            title: "后台巡检",
            scheduleKind: "interval",
            timezone: "Asia/Shanghai",
            ownerScope: "personal",
            status: "scheduled",
            source: "manual",
            intervalMinutes: 60,
            executor: "assistant_prompt",
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z",
          },
        ],
      },
    } as any);

    const { container } = renderPage();

    const weekButtons = screen.getAllByRole("button", { name: "本周" });
    fireEvent.click(weekButtons[weekButtons.length - 1]);

    expect(container.querySelector(".date-navigator__label")?.textContent).toBe("4月20日周一 - 4月26日周日");

    const headers = within(screen.getByTestId("week-planner-grid")).getAllByTestId("week-planner-day-header");
    expect(headers.map((header) => within(header).getByTestId("week-planner-weekday").textContent)).toEqual([
      "一",
      "二",
      "三",
      "四",
      "五",
      "六",
      "日",
    ]);
    expect(within(screen.getByTestId("week-planner-lane-morning-2026-04-20")).getByText("晨间巡检")).toBeTruthy();
    expect(within(screen.getByTestId("week-planner-lane-morning-2026-04-21")).getByText("晨间巡检")).toBeTruthy();
    expect(within(screen.getByTestId("week-planner-lane-morning-2026-04-22")).getByText("晨间巡检")).toBeTruthy();
    expect(within(screen.getByTestId("week-planner-lane-morning-2026-04-23")).getByText("晨间巡检")).toBeTruthy();
    expect(within(screen.getByTestId("week-planner-lane-morning-2026-04-24")).getByText("晨间巡检")).toBeTruthy();
    expect(within(screen.getByTestId("week-planner-lane-morning-2026-04-25")).queryByText("晨间巡检")).toBeNull();
    expect(within(screen.getByTestId("week-planner-grid")).queryByText("后台巡检")).toBeNull();
    expect(within(screen.getByTestId("week-planner-side-rail")).getByText("后台巡检")).toBeTruthy();
  });
});
