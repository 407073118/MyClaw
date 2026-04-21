// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("MeetingsPage follow-up import", () => {
  afterEach(() => {
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("imports meeting follow-ups into the time center from the detail view", async () => {
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

    await waitFor(() => expect(screen.getByRole("button", { name: "导入到时间中心" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "导入到时间中心" }));

    await waitFor(() => expect(buildFollowUps).toHaveBeenCalledWith("meeting-1"));
    expect(screen.getByText("已导入 2 个跟进事项到时间中心。")).toBeTruthy();
  });
});
