/** @vitest-environment jsdom */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowEndNode } from "@shared/contracts";
import WorkflowNodeEditor from "../src/renderer/components/workflow/WorkflowNodeEditor";

describe("WorkflowNodeEditor end outputs", () => {
  it("允许为结束节点绑定最终输出字段", () => {
    const onUpdateNode = vi.fn();
    const node: WorkflowEndNode = {
      id: "node-end",
      kind: "end",
      label: "结束",
    };

    render(
      <WorkflowNodeEditor
        node={node}
        variableSourceOptions={[
          {
            id: "nodes.node-llm.content",
            group: "节点输出",
            label: "天气总结.content",
            ref: { scope: "node", nodeId: "node-llm", path: "content", valueType: "string" },
          },
        ]}
        onUpdateNode={onUpdateNode}
      />,
    );

    fireEvent.click(screen.getByTestId("workflow-node-editor-end-add-output-source"));

    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({
      outputSources: {
        answer: {
          mode: "variable",
          ref: { scope: "node", nodeId: "node-llm", path: "content", valueType: "string" },
        },
      },
    }));
  });

  it("允许编辑已有结束输出字段名称", () => {
    const onUpdateNode = vi.fn();
    const node: WorkflowEndNode = {
      id: "node-end",
      kind: "end",
      label: "结束",
      outputSources: {
        answer: { mode: "static", value: "天气结果" },
      },
    };

    render(<WorkflowNodeEditor node={node} onUpdateNode={onUpdateNode} />);

    fireEvent.change(screen.getByTestId("workflow-node-editor-end-output-key-0"), {
      target: { value: "summary" },
    });

    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({
      outputSources: {
        summary: { mode: "static", value: "天气结果" },
      },
    }));
  });
});
