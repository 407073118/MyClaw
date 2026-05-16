// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "../src/renderer/stores/workspace";

describe("silicon person scheduled jobs", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      sessions: [],
      models: [],
      defaultModelProfileId: null,
      approvalRequests: [],
      workflows: [
        {
          id: "wf-1",
          name: "客户跟进",
          description: "每周跟进客户状态",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      ],
      workflowSummaries: {
        "wf-1": {
          id: "wf-1",
          name: "客户跟进",
          description: "每周跟进客户状态",
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      },
      workflowRuns: {},
      siliconPersons: [
        {
          id: "sp-1",
          name: "运营助理",
          title: "运营助理",
          description: "负责周期性运营跟进",
          status: "idle",
          source: "personal",
          approvalMode: "inherit",
          currentSessionId: null,
          sessions: [],
          unreadCount: 0,
          hasUnread: false,
          needsApproval: false,
          workflowIds: ["wf-1"],
          updatedAt: "2026-04-18T00:00:00.000Z",
        },
      ],
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
      loadSiliconPersonById: vi.fn(async () => undefined),
      loadWorkflows: vi.fn(async () => undefined),
      updateSiliconPerson: vi.fn(async () => undefined),
      sendSiliconPersonMessage: vi.fn(async () => undefined),
      startSiliconPersonWorkflowRun: vi.fn(async () => undefined),
      createScheduleJob: vi.fn(async () => undefined),
      updateScheduleJob: vi.fn(async () => undefined),
      deleteScheduleJob: vi.fn(async () => undefined),
      executeScheduleJobNow: vi.fn(async () => undefined),
    } as any);

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        listSiliconPersonSkills: vi.fn(async () => ({ items: [] })),
        listSiliconPersonMcpServers: vi.fn(async () => ({ servers: [] })),
        getSiliconPersonPaths: vi.fn(async () => ({ personDir: "", skillsDir: "", sessionsDir: "" })),
        listArtifactsByScope: vi.fn(async () => []),
        onSessionStream: vi.fn(() => () => undefined),
        onWorkflowStream: vi.fn(() => () => undefined),
      },
    });
  });

  afterEach(() => {
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  /** 渲染硅基员工工作台，复用同一条员工详情路由。 */
  function renderStudio(SiliconPersonWorkspacePage: React.ComponentType) {
    return render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/employees/sp-1/studio"] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: "/employees/:id/studio",
            element: React.createElement(SiliconPersonWorkspacePage),
          }),
        ),
      ),
    );
  }

  it("creates an employee message job without asking for the current employee again", async () => {
    const { default: SiliconPersonWorkspacePage } = await import("../src/renderer/pages/SiliconPersonWorkspacePage");

    renderStudio(SiliconPersonWorkspacePage);

    fireEvent.click(screen.getByRole("button", { name: "能力" }));
    fireEvent.click(screen.getByRole("button", { name: "定时派发给员工" }));

    expect(screen.queryByLabelText("选择员工")).toBeNull();

    fireEvent.change(screen.getByLabelText("任务标题"), { target: { value: "每日运营巡检" } });
    fireEvent.click(screen.getByRole("radio", { name: "每 N 分钟" }));
    fireEvent.change(screen.getByLabelText("间隔分钟（5 - 1440）"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("派发消息"), { target: { value: "检查今日运营异常并回复结果。" } });

    expect(screen.getByText(/向 运营助理 派发/)).toBeTruthy();
    expect(screen.getByText(/下次运行/)).toBeTruthy();

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
          intervalMinutes: 120,
          description: "检查今日运营异常并回复结果。",
        }),
      );
    });
  });

  it("shows next run, latest failure and a run-now action for employee jobs", async () => {
    const { default: SiliconPersonWorkspacePage } = await import("../src/renderer/pages/SiliconPersonWorkspacePage");

    useWorkspaceStore.setState({
      time: {
        ...useWorkspaceStore.getState().time,
        scheduleJobs: [
          {
            id: "job-1",
            kind: "schedule_job",
            title: "日报巡检",
            description: "每天检查运营异常",
            scheduleKind: "cron",
            timezone: "Asia/Shanghai",
            ownerScope: "silicon_person",
            ownerId: "sp-1",
            status: "scheduled",
            source: "manual",
            cronExpression: "0 9 * * 1-5",
            executor: "silicon_person",
            executorTargetId: "sp-1",
            nextRunAt: "2026-04-21T01:00:00.000Z",
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z",
          },
        ],
        executionRuns: [
          {
            id: "run-1",
            jobId: "job-1",
            status: "failed",
            startedAt: "2026-04-20T01:00:00.000Z",
            finishedAt: "2026-04-20T01:01:00.000Z",
            errorMessage: "接口超时",
          },
        ],
      },
    } as any);

    renderStudio(SiliconPersonWorkspacePage);

    fireEvent.click(screen.getByRole("button", { name: "能力" }));
    const row = screen.getByRole("article", { name: /日报巡检/ });

    expect(within(row).getByText("定时派发给员工")).toBeTruthy();
    expect(within(row).getByText(/下次执行/)).toBeTruthy();
    expect(within(row).getByText(/上次失败/)).toBeTruthy();
    expect(within(row).getByText(/接口超时/)).toBeTruthy();

    fireEvent.click(within(row).getByRole("button", { name: "立即运行 日报巡检" }));

    await waitFor(() => {
      const state = useWorkspaceStore.getState() as any;
      expect(state.executeScheduleJobNow).toHaveBeenCalledWith("job-1");
    });
  });
});
