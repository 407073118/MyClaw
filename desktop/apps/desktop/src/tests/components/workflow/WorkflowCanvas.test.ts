import type { WorkflowDefinition } from "@myclaw-desktop/shared";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import WorkflowCanvas from "@/components/workflow/WorkflowCanvas.vue";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";

function createDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    ...createWorkspaceFixture().workflowDefinitions[0]!,
    ...overrides,
  } as WorkflowDefinition;
}

function setStageRect(wrapper: ReturnType<typeof mount>) {
  const stage = wrapper.get("[data-testid='workflow-canvas-stage']").element as HTMLDivElement;
  vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1200,
    bottom: 720,
    width: 1200,
    height: 720,
    toJSON: () => ({}),
  });
}

describe("WorkflowCanvas", () => {
  it("renders nodes from persisted canvas positions", () => {
    const wrapper = mount(WorkflowCanvas, {
      props: {
        definition: createDefinition(),
      },
    });

    expect(wrapper.get("[data-testid='workflow-canvas']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='workflow-canvas-node-node-start']").text()).toContain("Start");
    expect(wrapper.get("[data-testid='workflow-canvas-node-node-end']").text()).toContain("End");
    expect(wrapper.get("[data-testid='workflow-canvas-node-node-start']").attributes("style")).toContain(
      "translate(120px, 180px)",
    );
    expect(wrapper.get("[data-testid='workflow-canvas-edge-edge-start-end']").exists()).toBe(true);
    // Terminal nodes (start/end) don't show summary text
    expect(wrapper.get("[data-testid='workflow-canvas-node-node-start']").text()).toContain("Start");
    expect(wrapper.get("[data-testid='workflow-canvas-add-node-human-input']").text()).toContain("人工");
  });

  it("renders typed node summaries on cards", () => {
    const definition = createDefinition({
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-llm", kind: "llm", label: "Draft", llm: { prompt: "Generate a concise draft response." } },
        { id: "node-tool", kind: "tool", label: "Lookup", tool: { toolId: "profile.lookup" } },
        { id: "node-human", kind: "human-input", label: "Manual", humanInput: { formKey: "manual-check" } },
        {
          id: "node-condition",
          kind: "condition",
          label: "Gate",
          condition: { operator: "equals", leftPath: "$.risk.level", rightValue: "high" },
          route: { trueNodeId: "node-human", falseNodeId: "node-tool" },
        } as unknown as WorkflowDefinition["nodes"][number],
        { id: "node-subgraph", kind: "subgraph", label: "Escalation", subgraph: { workflowId: "workflow-escalation" } },
        { id: "node-join", kind: "join", label: "Join", join: { mode: "all", upstreamNodeIds: ["node-llm", "node-tool"] } },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [
        { id: "edge-start-llm", kind: "normal", fromNodeId: "node-start", toNodeId: "node-llm" },
        { id: "edge-llm-join", kind: "parallel", fromNodeId: "node-llm", toNodeId: "node-join" },
        { id: "edge-tool-join", kind: "parallel", fromNodeId: "node-tool", toNodeId: "node-join" },
      ],
      entryNodeId: "node-start",
      editor: {
        canvas: {
          viewport: { offsetX: 0, offsetY: 0 },
          nodes: [
            { nodeId: "node-start", position: { x: 120, y: 180 } },
            { nodeId: "node-llm", position: { x: 360, y: 180 } },
            { nodeId: "node-tool", position: { x: 600, y: 180 } },
            { nodeId: "node-human", position: { x: 840, y: 180 } },
            { nodeId: "node-condition", position: { x: 120, y: 340 } },
            { nodeId: "node-subgraph", position: { x: 360, y: 340 } },
            { nodeId: "node-join", position: { x: 600, y: 340 } },
            { nodeId: "node-end", position: { x: 840, y: 340 } },
          ],
        },
      },
      nodeCount: 8,
      edgeCount: 3,
    });

    const wrapper = mount(WorkflowCanvas, {
      props: {
        definition,
      },
    });

    expect(wrapper.get("[data-testid='workflow-canvas-node-summary-node-llm']").text()).toContain("Generate a concise");
    expect(wrapper.get("[data-testid='workflow-canvas-node-summary-node-tool']").text()).toContain("profile.lookup");
    expect(wrapper.get("[data-testid='workflow-canvas-node-summary-node-human']").text()).toContain("manual-check");
    expect(wrapper.get("[data-testid='workflow-canvas-node-summary-node-condition']").text()).toContain("$.risk.level");
    expect(wrapper.get("[data-testid='workflow-canvas-node-summary-node-condition']").text()).toContain("T:node-human");
    expect(wrapper.get("[data-testid='workflow-canvas-node-summary-node-condition']").text()).toContain("F:node-tool");
    expect(wrapper.get("[data-testid='workflow-canvas-node-summary-node-subgraph']").text()).toContain("workflow-escalation");
    expect(wrapper.get("[data-testid='workflow-canvas-node-summary-node-join']").text()).toContain("2 个上游");
    // Terminal nodes (start/end) don't render summary elements
    expect(wrapper.get("[data-testid='workflow-canvas-node-node-end']").text()).toContain("End");
  });

  it("shows condition route errors directly on the canvas", () => {
    const definition = createDefinition({
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        {
          id: "node-condition",
          kind: "condition",
          label: "Need review",
          condition: { operator: "exists", leftPath: "$.risk.level" },
          route: { trueNodeId: "node-manual", falseNodeId: "node-auto" },
        } as WorkflowDefinition["nodes"][number],
        { id: "node-manual", kind: "human-input", label: "Manual", humanInput: { formKey: "manual-review" } },
        { id: "node-auto", kind: "tool", label: "Auto", tool: { toolId: "risk.approve" } },
      ],
      edges: [
        { id: "edge-start-condition", kind: "normal", fromNodeId: "node-start", toNodeId: "node-condition" },
        {
          id: "edge-condition-manual",
          kind: "conditional",
          fromNodeId: "node-condition",
          toNodeId: "node-manual",
          condition: { operator: "exists", leftPath: "$.risk.level" },
        },
      ],
      stateSchema: [],
    });

    const wrapper = mount(WorkflowCanvas, {
      props: {
        definition,
      },
    });

    expect(wrapper.get("[data-testid='workflow-canvas-graph-status']").text()).toContain("1");
    expect(wrapper.get("[data-testid='workflow-canvas-graph-issues']").text()).toContain("false route edge missing");
  });

  it("emits selection and delete events for nodes and edges", async () => {
    const wrapper = mount(WorkflowCanvas, {
      props: {
        definition: createDefinition(),
        selectedEdgeId: "edge-start-end",
      },
    });

    await wrapper.get("[data-testid='workflow-canvas-node-node-start']").trigger("click");
    await wrapper.get("[data-testid='workflow-canvas-edge-edge-start-end']").trigger("click");
    await wrapper.get("[data-testid='workflow-canvas-delete-edge']").trigger("click");

    expect(wrapper.emitted("select:node")?.[0]).toEqual(["node-start"]);
    expect(wrapper.emitted("select:edge")?.[0]).toEqual(["edge-start-end"]);
    expect(wrapper.emitted("delete:edge")?.[0]).toEqual(["edge-start-end"]);
  });

  it("emits add:node when a palette item is clicked", async () => {
    const wrapper = mount(WorkflowCanvas, {
      props: {
        definition: createDefinition(),
      },
    });

    await wrapper.get("[data-testid='workflow-canvas-add-node-human-input']").trigger("click");

    expect(wrapper.emitted("add:node")?.[0]).toEqual(["human-input"]);
  });

  it("emits delete:node for a selected non-entry node", async () => {
    const wrapper = mount(WorkflowCanvas, {
      props: {
        definition: createDefinition(),
        selectedNodeId: "node-end",
      },
    });

    await wrapper.get("[data-testid='workflow-canvas-delete-node']").trigger("click");

    expect(wrapper.emitted("delete:node")?.[0]).toEqual(["node-end"]);
  });

  it("emits connect events when a source handle is dragged onto a target handle", async () => {
    const baseDefinition = createDefinition();
    const definition = createDefinition({
      nodes: [
        ...baseDefinition.nodes,
        {
          id: "node-review",
          kind: "tool",
          label: "Review",
          tool: { toolId: "tool-review" },
        },
      ],
      nodeCount: 3,
      editor: {
        canvas: {
          viewport: { offsetX: 0, offsetY: 0 },
          nodes: [
            { nodeId: "node-start", position: { x: 120, y: 180 } },
            { nodeId: "node-end", position: { x: 400, y: 180 } },
            { nodeId: "node-review", position: { x: 680, y: 180 } },
          ],
        },
      },
    });

    const wrapper = mount(WorkflowCanvas, {
      props: {
        definition,
      },
      attachTo: document.body,
    });
    setStageRect(wrapper);

    await wrapper.get("[data-testid='workflow-canvas-source-handle-node-start']").trigger("mousedown", {
      clientX: 300,
      clientY: 228,
      button: 0,
    });
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 620, clientY: 228, bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find("[data-testid='workflow-canvas-preview-edge']").exists()).toBe(true);

    await wrapper.get("[data-testid='workflow-canvas-target-handle-node-review']").trigger("mouseup", {
      clientX: 680,
      clientY: 228,
      button: 0,
    });

    expect(wrapper.emitted("connect:node")?.[0]).toEqual([{ fromNodeId: "node-start", toNodeId: "node-review" }]);
  });

  it("supports keyboard delete for the selected edge", async () => {
    const wrapper = mount(WorkflowCanvas, {
      props: {
        definition: createDefinition(),
        selectedEdgeId: "edge-start-end",
      },
    });

    await wrapper.get("[data-testid='workflow-canvas']").trigger("keydown", { key: "Delete" });

    expect(wrapper.emitted("delete:edge")?.[0]).toEqual(["edge-start-end"]);
  });
});
