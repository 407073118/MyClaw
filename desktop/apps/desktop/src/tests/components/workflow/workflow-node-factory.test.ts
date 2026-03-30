import { describe, expect, it } from "vitest";

import { createWorkflowNode, createWorkflowNodeDraft } from "@/components/workflow/workflow-node-factory";

describe("workflow node factory", () => {
  it("creates runtime-safe defaults for typed workflow nodes", () => {
    expect(createWorkflowNode({ kind: "llm", nodeId: "node-llm-1" })).toEqual(expect.objectContaining({
      id: "node-llm-1",
      kind: "llm",
      llm: { prompt: "请补充“对话”节点要完成的具体任务。" },
    }));

    expect(createWorkflowNode({ kind: "tool", nodeId: "node-tool-1" })).toEqual(expect.objectContaining({
      id: "node-tool-1",
      kind: "tool",
      tool: { toolId: "tool.node-tool-1" },
    }));

    expect(createWorkflowNode({ kind: "human-input", nodeId: "node-human-1" })).toEqual(expect.objectContaining({
      id: "node-human-1",
      kind: "human-input",
      humanInput: { formKey: "form.node-human-1" },
    }));

    expect(createWorkflowNode({ kind: "subgraph", nodeId: "node-subgraph-1" })).toEqual(expect.objectContaining({
      id: "node-subgraph-1",
      kind: "subgraph",
      subgraph: { workflowId: "workflow.node-subgraph-1" },
    }));

    expect(createWorkflowNode({ kind: "condition", nodeId: "node-condition-1" })).toEqual(expect.objectContaining({
      id: "node-condition-1",
      kind: "condition",
      condition: expect.objectContaining({
        operator: "exists",
        leftPath: "$.state.result",
      }),
    }));
  });

  it("uses the selected upstream node when creating join nodes", () => {
    expect(createWorkflowNode({
      kind: "join",
      nodeId: "node-join-1",
      upstreamNodeId: "node-start",
    })).toEqual(expect.objectContaining({
      id: "node-join-1",
      kind: "join",
      join: {
        mode: "all",
        upstreamNodeIds: ["node-start"],
      },
    }));
  });

  it("returns node draft with layout seed for downstream canvas persistence", () => {
    const draft = createWorkflowNodeDraft({
      kind: "tool",
      nodeId: "node-tool-2",
      position: { x: 640, y: 180 },
    });

    expect(draft.node).toEqual(expect.objectContaining({
      id: "node-tool-2",
      kind: "tool",
    }));
    expect(draft.layout).toEqual({
      nodeId: "node-tool-2",
      position: { x: 640, y: 180 },
    });
  });
});
