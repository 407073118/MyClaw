/** @vitest-environment jsdom */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import WorkflowNodeEditor from "../src/renderer/components/workflow/WorkflowNodeEditor";
import { getWorkflowNodeKindLabel } from "../src/renderer/components/workflow/workflow-node-factory";

describe("workflow node text", () => {
  it("renders readable Chinese labels for workflow node kinds", () => {
    expect(getWorkflowNodeKindLabel("start")).toBe("开始");
    expect(getWorkflowNodeKindLabel("tool")).toBe("工具");
    expect(getWorkflowNodeKindLabel("http-request")).toBe("HTTP 调用");
    expect(getWorkflowNodeKindLabel("human-input")).toBe("人工输入");
    expect(getWorkflowNodeKindLabel("condition")).toBe("条件分支");
    expect(getWorkflowNodeKindLabel("subgraph")).toBe("子工作流");
    expect(getWorkflowNodeKindLabel("join")).toBe("汇聚");
    expect(getWorkflowNodeKindLabel("end")).toBe("结束");
  });

  it("shows readable Chinese copy in the node editor", () => {
    render(
      React.createElement(WorkflowNodeEditor, {
        node: {
          id: "node-http",
          kind: "http-request",
          label: "HTTP Request",
          httpRequest: {
            method: "GET",
            url: "https://example.com",
            headers: {},
          },
        },
        onUpdateNode: () => {},
      }),
    );

    expect(screen.getByText("节点配置 · HTTP 调用")).toBeTruthy();
    expect(screen.getByText("HTTP 调用")).toBeTruthy();
    expect(screen.getByText("配置方法、URL、请求头、请求体和输出字段。")).toBeTruthy();
    expect(screen.getByText("输出字段")).toBeTruthy();
  });

  it("shows input and output binding controls for tool nodes", () => {
    render(
      React.createElement(WorkflowNodeEditor, {
        node: {
          id: "node-tool",
          kind: "tool",
          label: "Tool",
          inputBindings: { prompt: "title" },
          outputBindings: { result: "toolResult" },
          tool: {
            toolId: "tool-1",
            outputKey: "toolResult",
          },
        },
        stateFieldKeyOptions: ["title", "toolResult"],
        onUpdateNode: () => {},
      }),
    );

    expect(screen.getByText("输入绑定")).toBeTruthy();
    expect(screen.getByText("输出绑定")).toBeTruthy();
    expect(screen.getByDisplayValue("prompt")).toBeTruthy();
    expect(screen.getByDisplayValue("title")).toBeTruthy();
  });

  it("lets users insert variable tokens into llm prompts", () => {
    const onUpdateNode = vi.fn();
    render(
      React.createElement(WorkflowNodeEditor, {
        node: {
          id: "node-llm",
          kind: "llm",
          label: "LLM",
          llm: {
            prompt: "总结：",
          },
        },
        stateFieldKeyOptions: ["topic"],
        onUpdateNode,
      }),
    );

    expect(screen.getByText("运行变量")).toBeTruthy();
    fireEvent.click(screen.getByTitle("{{ topic }}"));

    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({
      llm: expect.objectContaining({ prompt: "总结： {{ topic }}" }),
    }));
  });

  it("lets users bind typed node inputs from visible workflow variables", () => {
    const onUpdateNode = vi.fn();

    render(
      React.createElement(WorkflowNodeEditor, {
        node: {
          id: "node-tool",
          kind: "tool",
          label: "Tool",
          tool: {
            toolId: "tool-1",
            outputKey: "toolResult",
          },
        },
        variableSourceOptions: [
          {
            id: "vars.limit",
            group: "全局变量",
            label: "limit",
            ref: { scope: "run", path: "limit", valueType: "number" },
          },
        ],
        onUpdateNode,
      }),
    );

    fireEvent.click(screen.getByTestId("workflow-node-editor-add-input-source"));

    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({
      inputSources: {
        param_1: {
          mode: "variable",
          ref: { scope: "run", path: "limit", valueType: "number" },
        },
      },
    }));
  });

  it("offers global run variables as prompt insertion tokens", () => {
    const onUpdateNode = vi.fn();

    render(
      React.createElement(WorkflowNodeEditor, {
        node: {
          id: "node-llm",
          kind: "llm",
          label: "LLM",
          llm: {
            prompt: "限制",
          },
        },
        variableSourceOptions: [
          {
            id: "vars.limit",
            group: "全局变量",
            label: "limit",
            ref: { scope: "run", path: "limit", valueType: "number" },
          },
        ],
        onUpdateNode,
      }),
    );

    fireEvent.click(screen.getByTitle("{{ vars.limit }}"));

    expect(onUpdateNode).toHaveBeenCalledWith(expect.objectContaining({
      llm: expect.objectContaining({ prompt: "限制 {{ vars.limit }}" }),
    }));
  });

  it("uses node names instead of raw node ids in route and join choices", () => {
    const onUpdateNode = vi.fn();

    const { rerender } = render(
      React.createElement(WorkflowNodeEditor, {
        node: {
          id: "node-condition",
          kind: "condition",
          label: "判断是否通过",
          condition: { operator: "exists", leftPath: "$.state.result" },
          route: { trueNodeId: "node-llm", falseNodeId: "node-end" },
        },
        routeCandidateNodeIds: ["node-llm", "node-end"],
        nodeLabelOptions: [
          { id: "node-llm", label: "生成回复" },
          { id: "node-end", label: "结束流程" },
        ],
        onUpdateNode,
      }),
    );

    expect(screen.getByTestId("workflow-node-editor-condition-true-node-id").textContent).toContain("生成回复");
    expect(screen.getByTestId("workflow-node-editor-condition-true-node-id").textContent).not.toContain("node-llm");

    rerender(
      React.createElement(WorkflowNodeEditor, {
        node: {
          id: "node-join",
          kind: "join",
          label: "汇总结果",
          join: { mode: "all", upstreamNodeIds: ["node-llm"] },
        },
        upstreamCandidateNodeIds: ["node-llm"],
        nodeLabelOptions: [
          { id: "node-llm", label: "生成回复" },
        ],
        onUpdateNode,
      }),
    );

    expect(screen.getByTestId("workflow-node-editor-join-upstream-candidate-node-llm").textContent).toBe("生成回复");
  });
});
