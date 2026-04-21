// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import TimeCenterPage from "../src/renderer/pages/TimeCenterPage";
import { useWorkspaceStore } from "../src/renderer/stores/workspace";

describe("TimeCenterPage", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      time: {
        calendarEvents: [],
        taskCommitments: [],
        reminders: [],
        scheduleJobs: [],
        executionRuns: [],
        availabilityPolicy: null,
        todayBrief: null,
      },
      suggestTimeboxes: async () => [],
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

  it("renders agenda-first tabs and calendar view controls", () => {
    renderPage();

    expect(screen.getByRole("tab", { name: "日程" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "自动化" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "日" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "周" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "月" })).toBeTruthy();
    expect(screen.getByText("本周日历")).toBeTruthy();
    expect(screen.getByText("今日安排")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建安排" })).toBeTruthy();
    expect(screen.getByTestId("time-overview-band")).toBeTruthy();
    expect(screen.getByTestId("time-agenda-shell")).toBeTruthy();
    expect(screen.getByTestId("time-agenda-sidebar")).toBeTruthy();
  });

  it("switches to the automation workspace", () => {
    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "自动化" }));

    expect(screen.getByRole("heading", { name: "提醒" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "自动任务" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "时间规则" })).toBeTruthy();
    expect(screen.queryByTestId("time-agenda-sidebar")).toBeNull();
  });

  it("renders mini calendar navigation and pending task backlog", () => {
    useWorkspaceStore.setState({
      time: {
        ...useWorkspaceStore.getState().time,
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
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z",
          },
        ],
      },
    } as any);

    renderPage();

    expect(screen.getByRole("heading", { name: "日期导航" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "上个月" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "下个月" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "待安排任务" })).toBeTruthy();
    expect(screen.getByText("整理季度复盘素材")).toBeTruthy();
  });
});
