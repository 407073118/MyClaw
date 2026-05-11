/** @vitest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import WorkflowCheckpointTimeline from "../src/renderer/components/workflow/WorkflowCheckpointTimeline";

describe("WorkflowCheckpointTimeline", () => {
  it("shows each triggered node output directly in the timeline", () => {
    render(
      React.createElement(WorkflowCheckpointTimeline, {
        definition: {
          id: "workflow-1",
          name: "Output Workflow",
          description: "workflow",
          version: 1,
          status: "draft",
          source: "personal",
          entryNodeId: "node-llm",
          nodes: [
            { id: "node-llm", kind: "llm", label: "生成回复", llm: { prompt: "回答" } },
          ],
          edges: [],
          stateSchema: [],
          updatedAt: "2026-05-11T00:00:00.000Z",
        },
        checkpoints: [
          {
            checkpointId: "checkpoint-1",
            step: 1,
            status: "succeeded",
            triggeredNodes: ["node-llm"],
            durationMs: 120,
            createdAt: "2026-05-11T00:01:00.000Z",
            nodeOutputs: {
              "node-llm": { content: "这是节点返回内容" },
            },
          },
        ],
      }),
    );

    expect(screen.getAllByText("生成回复").length).toBeGreaterThan(0);
    expect(screen.getByText("这是节点返回内容")).toBeTruthy();
    expect(screen.queryByText("node-llm")).toBeNull();
  });
});
