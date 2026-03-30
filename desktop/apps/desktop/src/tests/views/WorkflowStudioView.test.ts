import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WorkflowCanvas from "@/components/workflow/WorkflowCanvas.vue";
import * as runtimeClient from "@/services/runtime-client";
import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";
import WorkflowStudioView from "@/views/WorkflowStudioView.vue";

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

async function mountStudio(definitionOverride = createWorkspaceFixture().workflowDefinitions[0]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const workspace = useWorkspaceStore();
  const fixture = createWorkspaceFixture();
  workspace.hydrate(fixture);
  workspace.workflowDefinitions[definitionOverride.id] = definitionOverride;

  vi.spyOn(workspace as never, "loadWorkflowById").mockRejectedValue(new Error("should not run"));

  const router = createRouter({
    history: createWebHistory(),
    routes: [{ path: "/workflows/:id", component: WorkflowStudioView }],
  });
  router.push("/workflows/workflow-onboarding");
  await router.isReady();

  const wrapper = mount(WorkflowStudioView, {
    global: {
      plugins: [pinia, router],
    },
    attachTo: document.body,
  });

  await flushPromises();
  setStageRect(wrapper);

  return { wrapper, workspace, fixture };
}

describe("WorkflowStudioView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("edits workflow metadata in studio", async () => {
    const { wrapper, workspace } = await mountStudio();
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue({
      ...createWorkspaceFixture().workflowDefinitions[0],
      name: "Onboarding Workflow v2",
      status: "active",
      source: "enterprise",
    });

    await wrapper.get("[data-testid='workflow-studio-name']").setValue("Onboarding Workflow v2");
    await wrapper.get("[data-testid='workflow-studio-source']").setValue("enterprise");
    await wrapper.get("[data-testid='workflow-studio-status']").setValue("active");
    await wrapper.get("[data-testid='workflow-studio-save']").trigger("click");

    expect(updateSpy).toHaveBeenCalledWith("workflow-onboarding", {
      name: "Onboarding Workflow v2",
      description: "Covers setup and completion checks.",
      status: "active",
      source: "enterprise",
    });
  });

  it("blocks metadata save when name is empty", async () => {
    const { wrapper, workspace } = await mountStudio();
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue({
      ...createWorkspaceFixture().workflowDefinitions[0],
    });

    await wrapper.get("[data-testid='workflow-studio-name']").setValue("   ");
    await wrapper.get("[data-testid='workflow-studio-save']").trigger("click");

    expect(updateSpy).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("工作流名称不能为空");
  });

  it("starts a workflow run from the studio run panel", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    workspace.hydrate({
      ...fixture,
      workflowRuns: [],
      approvals: fixture.approvals,
    });
    workspace.workflowDefinitions[fixture.workflowDefinitions[0].id] = fixture.workflowDefinitions[0];

    vi.spyOn(workspace as never, "loadWorkflowById").mockRejectedValue(new Error("should not run"));
    vi.spyOn(workspace as never, "loadWorkflowRuns").mockResolvedValue([]);
    const startSpy = vi.spyOn(workspace as never, "startWorkflowRun").mockResolvedValue({
      ...fixture.workflowRuns[0]!,
      status: "waiting-input",
      currentNodeIds: ["node-start"],
    });
    vi.spyOn(runtimeClient as never, "getWorkflowRun").mockResolvedValue({
      run: {
        ...fixture.workflowRuns[0]!,
        status: "waiting-input",
        currentNodeIds: ["node-start"],
        state: {},
      },
      checkpoints: [
        {
          id: "cp-start-1",
          runId: fixture.workflowRuns[0]!.id,
          createdAt: "2026-03-22T09:40:00.000Z",
          nodeId: "node-start",
          status: "node-start",
          state: {},
          attempts: {},
        },
      ],
    });

    const router = createRouter({
      history: createWebHistory(),
      routes: [{ path: "/workflows/:id", component: WorkflowStudioView }],
    });
    router.push("/workflows/workflow-onboarding");
    await router.isReady();

    const wrapper = mount(WorkflowStudioView, {
      global: {
        plugins: [pinia, router],
      },
    });

    await flushPromises();
    expect(wrapper.find("[data-testid='workflow-run-panel']").exists()).toBe(true);

    await wrapper.get("[data-testid='workflow-run-start']").trigger("click");
    await flushPromises();

    expect(startSpy).toHaveBeenCalledWith("workflow-onboarding");
    expect(wrapper.text()).toContain("waiting-input");
  });

  it("adds a new node from the canvas palette with a persisted layout seed", async () => {
    const { wrapper, workspace, fixture } = await mountStudio();
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue({
      ...fixture.workflowDefinitions[0],
      nodes: [
        ...fixture.workflowDefinitions[0].nodes,
        {
          id: "node-human-input-1700000000000",
          kind: "human-input",
          label: "Human Input",
          humanInput: { formKey: "form.node-human-input-1700000000000" },
        },
      ],
      edges: [
        ...fixture.workflowDefinitions[0].edges,
        {
          id: "edge-node-start-node-human-input-1700000000000",
          fromNodeId: "node-start",
          toNodeId: "node-human-input-1700000000000",
          kind: "normal",
        },
      ],
      editor: {
        canvas: {
          viewport: { offsetX: 0, offsetY: 0 },
          nodes: [
            ...fixture.workflowDefinitions[0].editor!.canvas.nodes,
            {
              nodeId: "node-human-input-1700000000000",
              position: { x: 680, y: 180 },
            },
          ],
        },
      },
      nodeCount: 3,
      edgeCount: 2,
    });

    wrapper.getComponent(WorkflowCanvas).vm.$emit("add:node", "human-input");
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith("workflow-onboarding", expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: "node-human-input-1700000000000",
          kind: "human-input",
        }),
      ]),
      edges: expect.arrayContaining([
        expect.objectContaining({
          fromNodeId: "node-start",
          toNodeId: "node-human-input-1700000000000",
        }),
      ]),
      editor: expect.objectContaining({
        canvas: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              nodeId: "node-human-input-1700000000000",
              position: { x: 680, y: 180 },
            }),
          ]),
        }),
      }),
    }));
  });

  it("persists dragged node positions back through studio updates", async () => {
    const { wrapper, workspace, fixture } = await mountStudio();
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue({
      ...fixture.workflowDefinitions[0],
      editor: {
        canvas: {
          viewport: { offsetX: 0, offsetY: 0 },
          nodes: [
            { nodeId: "node-start", position: { x: 200, y: 240 } },
            { nodeId: "node-end", position: { x: 400, y: 180 } },
          ],
        },
      },
    });

    const node = wrapper.get("[data-testid='workflow-canvas-node-node-start']");
    await node.trigger("mousedown", { clientX: 140, clientY: 200, button: 0 });
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 220, clientY: 260, bubbles: true }));
    await wrapper.vm.$nextTick();
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 220, clientY: 260, bubbles: true }));
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith("workflow-onboarding", expect.objectContaining({
      editor: {
        canvas: {
          viewport: { offsetX: 0, offsetY: 0 },
          nodes: [
            { nodeId: "node-start", position: { x: 200, y: 240 } },
            { nodeId: "node-end", position: { x: 400, y: 180 } },
          ],
        },
      },
    }));
  });

  it("deletes the selected node and removes its layout metadata", async () => {
    const fixture = createWorkspaceFixture();
    const definition = {
      ...fixture.workflowDefinitions[0],
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-human", kind: "human-input", label: "Human", humanInput: { formKey: "human-form" } },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [
        { id: "edge-start-human", fromNodeId: "node-start", toNodeId: "node-human", kind: "normal" },
        { id: "edge-human-end", fromNodeId: "node-human", toNodeId: "node-end", kind: "normal" },
      ],
      editor: {
        canvas: {
          viewport: { offsetX: 0, offsetY: 0 },
          nodes: [
            { nodeId: "node-start", position: { x: 120, y: 180 } },
            { nodeId: "node-human", position: { x: 400, y: 180 } },
            { nodeId: "node-end", position: { x: 680, y: 180 } },
          ],
        },
      },
      nodeCount: 3,
      edgeCount: 2,
    } as typeof fixture.workflowDefinitions[0];
    const { wrapper, workspace } = await mountStudio(definition);
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue({
      ...definition,
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [],
      editor: {
        canvas: {
          viewport: { offsetX: 0, offsetY: 0 },
          nodes: [
            { nodeId: "node-start", position: { x: 120, y: 180 } },
            { nodeId: "node-end", position: { x: 680, y: 180 } },
          ],
        },
      },
      nodeCount: 2,
      edgeCount: 0,
    });

    wrapper.getComponent(WorkflowCanvas).vm.$emit("delete:node", "node-human");
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith("workflow-onboarding", expect.objectContaining({
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [],
      editor: expect.objectContaining({
        canvas: expect.objectContaining({
          nodes: [
            { nodeId: "node-start", position: { x: 120, y: 180 } },
            { nodeId: "node-end", position: { x: 680, y: 180 } },
          ],
        }),
      }),
    }));
  });

  it("switches inspector fields when different typed nodes are selected from the canvas", async () => {
    const fixture = createWorkspaceFixture();
    const definition = {
      ...fixture.workflowDefinitions[0],
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        {
          id: "node-llm",
          kind: "llm",
          label: "Draft reply",
          llm: { prompt: "Summarize the customer issue." },
        },
        {
          id: "node-tool",
          kind: "tool",
          label: "Lookup CRM",
          tool: { toolId: "crm.lookup" },
        },
        {
          id: "node-subgraph",
          kind: "subgraph",
          label: "Escalation flow",
          subgraph: { workflowId: "workflow-escalation" },
        },
      ],
      edges: [
        { id: "edge-start-llm", fromNodeId: "node-start", toNodeId: "node-llm", kind: "normal" },
        { id: "edge-llm-tool", fromNodeId: "node-llm", toNodeId: "node-tool", kind: "normal" },
        { id: "edge-tool-subgraph", fromNodeId: "node-tool", toNodeId: "node-subgraph", kind: "normal" },
      ],
      editor: {
        canvas: {
          viewport: { offsetX: 0, offsetY: 0 },
          nodes: [
            { nodeId: "node-start", position: { x: 120, y: 180 } },
            { nodeId: "node-llm", position: { x: 400, y: 180 } },
            { nodeId: "node-tool", position: { x: 680, y: 180 } },
            { nodeId: "node-subgraph", position: { x: 960, y: 180 } },
          ],
        },
      },
      nodeCount: 4,
      edgeCount: 3,
    } as typeof fixture.workflowDefinitions[0];

    const { wrapper } = await mountStudio(definition);

    await wrapper.get("[data-testid='workflow-canvas-node-node-llm']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='workflow-node-editor-llm-prompt']").exists()).toBe(true);

    await wrapper.get("[data-testid='workflow-canvas-node-node-tool']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='workflow-node-editor-tool-id']").exists()).toBe(true);

    await wrapper.get("[data-testid='workflow-canvas-node-node-subgraph']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='workflow-node-editor-subgraph-workflow-id']").exists()).toBe(true);
  });

  it("persists structured condition node edits through the studio sidebar", async () => {
    const fixture = createWorkspaceFixture();
    const definition = {
      ...fixture.workflowDefinitions[0],
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        {
          id: "node-condition",
          kind: "condition",
          label: "Need manual review?",
          condition: {
            operator: "exists",
            leftPath: "$.risk.score",
            rightValue: "",
          },
          route: {
            trueNodeId: "node-manual",
            falseNodeId: "node-auto",
          },
        },
        { id: "node-manual", kind: "human-input", label: "Manual", humanInput: { formKey: "manual-review" } },
        { id: "node-auto", kind: "tool", label: "Auto", tool: { toolId: "risk.approve" } },
      ],
      edges: [
        { id: "edge-start-condition", fromNodeId: "node-start", toNodeId: "node-condition", kind: "normal" },
        {
          id: "edge-condition-manual",
          fromNodeId: "node-condition",
          toNodeId: "node-manual",
          kind: "conditional",
          condition: { operator: "exists", leftPath: "$.risk.score" },
        },
        { id: "edge-condition-auto", fromNodeId: "node-condition", toNodeId: "node-auto", kind: "normal" },
      ],
      editor: {
        canvas: {
          viewport: { offsetX: 0, offsetY: 0 },
          nodes: [
            { nodeId: "node-start", position: { x: 120, y: 180 } },
            { nodeId: "node-condition", position: { x: 400, y: 180 } },
            { nodeId: "node-manual", position: { x: 680, y: 120 } },
            { nodeId: "node-auto", position: { x: 680, y: 260 } },
          ],
        },
      },
      nodeCount: 4,
      edgeCount: 3,
    } as typeof fixture.workflowDefinitions[0];

    const { wrapper, workspace } = await mountStudio(definition);
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue(definition);

    await wrapper.get("[data-testid='workflow-canvas-node-node-condition']").trigger("click");
    await flushPromises();

    await wrapper.get("[data-testid='workflow-node-editor-condition-operator']").setValue("equals");
    await wrapper.get("[data-testid='workflow-node-editor-condition-left-path']").setValue("$.risk.level");
    await wrapper.get("[data-testid='workflow-node-editor-condition-right-value']").setValue("high");
    await wrapper.get("[data-testid='workflow-node-editor-condition-true-node-id']").setValue("node-manual");
    await wrapper.get("[data-testid='workflow-node-editor-condition-false-node-id']").setValue("node-auto");
    await wrapper.get("[data-testid='workflow-graph-inspector-save']").trigger("click");

    expect(updateSpy).toHaveBeenCalledWith("workflow-onboarding", expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: "node-condition",
          condition: expect.objectContaining({
            operator: "equals",
            leftPath: "$.risk.level",
            rightValue: "high",
          }),
          route: expect.objectContaining({
            trueNodeId: "node-manual",
            falseNodeId: "node-auto",
          }),
        }),
      ]),
    }));
  });
});
