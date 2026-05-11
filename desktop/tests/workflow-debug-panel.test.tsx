/** @vitest-environment jsdom */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkflowDebugPanel } from "../src/renderer/components/workflow/WorkflowDebugPanel";

describe("WorkflowDebugPanel", () => {
  it("shows node-level outputs in a dedicated tab", () => {
    render(
      React.createElement(WorkflowDebugPanel, {
        runId: "run-1",
        status: "running",
        currentStep: 2,
        state: {},
        events: [],
        nodeOutputs: {
          "llm-1": { content: "分析完成" },
        },
        nodeLabels: {
          "llm-1": "分析节点",
        },
      }),
    );

    fireEvent.click(screen.getByText("节点输出"));

    expect(screen.getByText("分析节点")).toBeTruthy();
    expect(screen.queryByText("llm-1")).toBeNull();
    expect(screen.getByText(/分析完成/)).toBeTruthy();
  });
});
