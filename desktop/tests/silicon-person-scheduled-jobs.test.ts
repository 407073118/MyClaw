// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("creates a recurring workflow job for the silicon person from the studio", async () => {
    const { default: SiliconPersonWorkspacePage } = await import("../src/renderer/pages/SiliconPersonWorkspacePage");

    render(
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

    fireEvent.click(screen.getByRole("button", { name: "能力" }));
    fireEvent.change(screen.getByLabelText("定时工作流"), { target: { value: "wf-1" } });
    fireEvent.change(screen.getByLabelText("首次运行时间"), { target: { value: "2026-04-21T09:00" } });
    fireEvent.change(screen.getByLabelText("周期分钟"), { target: { value: "1440" } });
    fireEvent.click(screen.getByRole("button", { name: "创建定时工作流" }));

    await waitFor(() => {
      const state = useWorkspaceStore.getState() as any;
      expect(state.createScheduleJob).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerScope: "silicon_person",
          ownerId: "sp-1",
          executor: "workflow",
          executorTargetId: "wf-1",
          intervalMinutes: 1440,
        }),
      );
    });
  });
});
