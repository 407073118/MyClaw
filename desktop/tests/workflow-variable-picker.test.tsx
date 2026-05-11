/** @vitest-environment jsdom */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import WorkflowVariablePicker from "../src/renderer/components/workflow/WorkflowVariablePicker";

describe("WorkflowVariablePicker", () => {
  it("groups workflow variables and inserts a template token", () => {
    const onInsert = vi.fn();

    render(
      React.createElement(WorkflowVariablePicker, {
        variables: [
          { label: "主题", token: "{{ inputs.topic }}", group: "开始输入" },
          { label: "LLM 内容", token: "{{ nodes.llm_1.content }}", group: "节点输出" },
        ],
        onInsert,
      }),
    );

    expect(screen.getByText("开始输入")).toBeTruthy();
    expect(screen.getByText("节点输出")).toBeTruthy();

    fireEvent.click(screen.getByText("LLM 内容"));

    expect(onInsert).toHaveBeenCalledWith("{{ nodes.llm_1.content }}");
  });
});
