/** @vitest-environment jsdom */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import WorkflowVariablesPanel from "../src/renderer/components/workflow/WorkflowVariablesPanel";

describe("WorkflowVariablesPanel", () => {
  it("lets users maintain only variable Chinese name, English name, and field type", () => {
    const onUpdateDefinition = vi.fn();

    render(
      React.createElement(WorkflowVariablesPanel, {
        definition: {
          id: "workflow-1",
          name: "Variables",
          description: "variables",
          version: 1,
          status: "draft",
          source: "personal",
          updatedAt: "2026-05-09T00:00:00.000Z",
          nodeCount: 0,
          edgeCount: 0,
          libraryRootId: "root-1",
          entryNodeId: "start",
          nodes: [{ id: "start", kind: "start", label: "Start" }],
          edges: [],
          stateSchema: [],
          variables: [
            {
              id: "run-limit",
              key: "limit",
              label: "条数限制",
              scope: "run",
              valueType: "number",
              defaultValue: 5,
            },
          ],
        },
        runState: { vars: { limit: 7 } },
        onUpdateDefinition,
      }),
    );

    expect(screen.getByText("中文名")).toBeTruthy();
    expect(screen.getByText("英文名")).toBeTruthy();
    expect(screen.getByText("字段类型")).toBeTruthy();
    expect(screen.queryByText("当前值")).toBeNull();
    expect(screen.queryByText("来源")).toBeNull();

    fireEvent.change(screen.getByTestId("workflow-variable-chinese-name-run-limit"), {
      target: { value: "最大条数" },
    });

    expect(onUpdateDefinition).toHaveBeenCalledWith({
      variables: [
        expect.objectContaining({
          id: "run-limit",
          label: "最大条数",
        }),
      ],
    });

    fireEvent.change(screen.getByTestId("workflow-variable-english-name-run-limit"), {
      target: { value: "max_count" },
    });

    expect(onUpdateDefinition).toHaveBeenCalledWith({
      variables: [
        expect.objectContaining({
          id: "run-limit",
          key: "max_count",
        }),
      ],
    });

    const fieldTypeTrigger = screen.getByTestId("workflow-variable-field-type-run-limit");
    expect(fieldTypeTrigger.tagName.toLowerCase()).toBe("button");

    fireEvent.click(fieldTypeTrigger);
    expect(screen.getByRole("listbox", { name: "字段类型" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "文本" }));

    expect(onUpdateDefinition).toHaveBeenCalledWith({
      variables: [
        expect.objectContaining({
          id: "run-limit",
          valueType: "string",
        }),
      ],
    });
  });
});
