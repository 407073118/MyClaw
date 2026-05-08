// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("MeetingsPage follow-up import", () => {
  afterEach(() => {
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("imports meeting follow-ups into schedule planning from the detail view", async () => {
    const buildFollowUps = vi.fn(async () => ({
      commitments: [
        {
          id: "commitment-1",
          kind: "task_commitment",
          title: "交付方案",
        },
      ],
      reminders: [],
      suggestedEvents: [
        {
          id: "event-1",
          kind: "calendar_event",
          title: "回看结果",
        },
      ],
    }));

    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        meetings: {
          list: vi.fn(async () => ({ items: [] })),
          get: vi.fn(async () => ({
            meeting: {
              id: "meeting-1",
              title: "Weekly sync",
              createdAt: "2026-04-18T08:00:00.000Z",
              durationMs: 3_600_000,
              status: "done",
            },
            transcript: null,
            summary: "- Alice Friday前交付方案\n- 下周二 10:00 回看结果",
          })),
          buildFollowUps,
          delete: vi.fn(async () => ({ ok: true })),
          updateSpeaker: vi.fn(async () => ({ ok: true })),
          updateTitle: vi.fn(async () => ({ ok: true })),
          readAudio: vi.fn(async () => ({ buffer: null })),
          onEvent: vi.fn(() => () => undefined),
        },
      },
    });

    const { default: MeetingsPage } = await import("../src/renderer/pages/MeetingsPage");
    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/meetings/meeting-1"] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: "/meetings/:id",
            element: React.createElement(MeetingsPage),
          }),
        ),
      ),
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "导入到日程规划" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "导入到日程规划" }));

    await waitFor(() => expect(buildFollowUps).toHaveBeenCalledWith("meeting-1"));
    expect(screen.getByText("已导入 2 个跟进事项到日程规划。")).toBeTruthy();
  });

  it("uses meeting layout classes for list title and detail tabs", async () => {
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        meetings: {
          list: vi.fn(async () => ({
            items: [
              {
                id: "meeting-1",
                title: "周会复盘",
                createdAt: "2026-04-18T08:00:00.000Z",
                durationMs: 1_200_000,
                status: "done",
              },
            ],
          })),
          get: vi.fn(async () => ({
            meeting: {
              id: "meeting-1",
              title: "周会复盘",
              createdAt: "2026-04-18T08:00:00.000Z",
              durationMs: 1_200_000,
              status: "done",
            },
            transcript: {
              segments: [],
            },
            summary: "测试纪要",
          })),
          buildFollowUps: vi.fn(async () => ({
            commitments: [],
            reminders: [],
            suggestedEvents: [],
          })),
          delete: vi.fn(async () => ({ ok: true })),
          updateSpeaker: vi.fn(async () => ({ ok: true })),
          updateTitle: vi.fn(async () => ({ ok: true })),
          readAudio: vi.fn(async () => ({ buffer: null })),
          onEvent: vi.fn(() => () => undefined),
        },
      },
    });

    const { default: MeetingsPage } = await import("../src/renderer/pages/MeetingsPage");
    const listView = render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/meetings"] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: "/meetings",
            element: React.createElement(MeetingsPage),
          }),
          React.createElement(Route, {
            path: "/meetings/:id",
            element: React.createElement(MeetingsPage),
          }),
        ),
      ),
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "周会复盘" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "周会复盘" }).className).toContain("list-row__title-btn");
    listView.unmount();

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/meetings/meeting-1"] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: "/meetings",
            element: React.createElement(MeetingsPage),
          }),
          React.createElement(Route, {
            path: "/meetings/:id",
            element: React.createElement(MeetingsPage),
          }),
        ),
      ),
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "转写稿" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "转写稿" }).className).toContain("meeting-detail-tab");
    expect(screen.getByRole("button", { name: "转写稿" }).className).toContain("is-active");
    expect(screen.getByRole("button", { name: "会议纪要" }).className).toContain("meeting-detail-tab");
  });
});
