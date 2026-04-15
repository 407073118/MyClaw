/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Task } from "@shared/contracts";
import { PlanStatePanel } from "../src/renderer/components/plan-state-panel";

afterEach(() => {
  cleanup();
});

describe("PlanStatePanel", () => {
  it("shows numbered logical tasks and ignores duplicate leftovers in progress", () => {
    const tasks: Task[] = [
      { id: "t1", subject: "Read repo docs", description: "Read repo docs", status: "completed", blocks: [], blockedBy: [] },
      { id: "t2", subject: "Fix task dedupe", description: "Fix task dedupe", status: "completed", blocks: [], blockedBy: [] },
      { id: "t3", subject: "Update task UI", description: "Update task UI", status: "completed", blocks: [], blockedBy: [] },
      { id: "t4", subject: "Update task UI", description: "Update task UI", status: "pending", blocks: [], blockedBy: [] },
    ];

    render(React.createElement(PlanStatePanel, { tasks }));

    expect(screen.getByText("3/3 已完成")).toBeTruthy();
    expect(screen.getByText("1.")).toBeTruthy();
    expect(screen.getByText("2.")).toBeTruthy();
    expect(screen.getByText("3.")).toBeTruthy();
    expect(screen.getAllByText("Update task UI")).toHaveLength(1);
  });
});
