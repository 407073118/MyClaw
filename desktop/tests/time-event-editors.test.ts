// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CalendarEventEditor from "../src/renderer/components/time/CalendarEventEditor";
import TaskCommitmentEditor from "../src/renderer/components/time/TaskCommitmentEditor";

describe("time event editors", () => {
  it("submits a new reminder-free manual calendar event", async () => {
    const handleSave = vi.fn();

    render(
      React.createElement(CalendarEventEditor, {
        timezone: "Asia/Shanghai",
        onSave: handleSave,
      }),
    );

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "客户复盘" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-04-21T10:00" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-04-21T11:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Event" }));

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "客户复盘",
          timezone: "Asia/Shanghai",
          startsAt: "2026-04-21T02:00:00.000Z",
          endsAt: "2026-04-21T03:30:00.000Z",
        }),
      );
    });
  });

  it("submits a task commitment with normalized duration and deadline", async () => {
    const handleSave = vi.fn();

    render(
      React.createElement(TaskCommitmentEditor, {
        timezone: "Asia/Shanghai",
        onSave: handleSave,
      }),
    );

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "整理周报素材" } });
    fireEvent.change(screen.getByLabelText("Due"), { target: { value: "2026-04-21T18:00" } });
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "90" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "urgent" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Task" }));

    await waitFor(() => {
      expect(handleSave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "整理周报素材",
          timezone: "Asia/Shanghai",
          dueAt: "2026-04-21T10:00:00.000Z",
          durationMinutes: 90,
          priority: "urgent",
        }),
      );
    });
  });
});
