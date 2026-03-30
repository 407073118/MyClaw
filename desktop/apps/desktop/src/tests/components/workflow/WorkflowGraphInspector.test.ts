import type { WorkflowDefinition } from "@myclaw-desktop/shared";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import WorkflowGraphInspector from "@/components/workflow/WorkflowGraphInspector.vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";

function createDefinition(overrides: Partial<WorkflowDefinition>): WorkflowDefinition {
  const base = createWorkspaceFixture().workflowDefinitions[0];
  return {
    ...base,
    ...overrides,
  } as WorkflowDefinition;
}

describe("WorkflowGraphInspector", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("editing nodes and edges updates the in-memory definition", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue(createDefinition({}));

    const definition = createDefinition({
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [{ id: "edge-start-end", kind: "normal", fromNodeId: "node-start", toNodeId: "node-end" }],
    });

    const wrapper = mount(WorkflowGraphInspector, {
      props: {
        workflowId: "workflow-onboarding",
        definition,
      },
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    await wrapper.get("[data-testid='workflow-graph-node-row-node-end']").trigger("click");
    await wrapper.get("[data-testid='workflow-node-editor-label']").setValue("Finish");

    // Optimistic: UI list reflects change before saving.
    expect(wrapper.get("[data-testid='workflow-graph-node-label-node-end']").text()).toContain("Finish");

    await wrapper.get("[data-testid='workflow-graph-edge-row-edge-start-end']").trigger("click");
    await wrapper.get("[data-testid='workflow-edge-editor-kind']").setValue("parallel");
    expect(wrapper.get("[data-testid='workflow-graph-edge-kind-edge-start-end']").text()).toContain("parallel");

    await wrapper.get("[data-testid='workflow-graph-inspector-save']").trigger("click");

    expect(updateSpy).toHaveBeenCalledWith("workflow-onboarding", expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({ id: "node-end", label: "Finish" })]),
      edges: expect.arrayContaining([expect.objectContaining({ id: "edge-start-end", kind: "parallel" })]),
    }));
  });

  it("validates state schema fields and merge strategies in the UI", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue(createDefinition({}));

    const definition = createDefinition({
      stateSchema: [
        {
          key: "customerName",
          label: "Customer Name",
          description: "",
          valueType: "string",
          mergeStrategy: "replace",
          required: false,
          producerNodeIds: [],
          consumerNodeIds: [],
        },
      ],
    });

    const wrapper = mount(WorkflowGraphInspector, {
      props: { workflowId: "workflow-onboarding", definition },
      global: { plugins: [pinia] },
    });

    await flushPromises();

    await wrapper.get("[data-testid='workflow-state-schema-mergeStrategy-0']").setValue("object-merge");
    expect(wrapper.get("[data-testid='workflow-state-schema-error']").text()).toContain("mergeStrategy");
    expect(wrapper.get("[data-testid='workflow-graph-inspector-save']").attributes("disabled")).toBeDefined();

    // Duplicate key should also block saving.
    await wrapper.get("[data-testid='workflow-state-schema-add-field']").trigger("click");
    await wrapper.get("[data-testid='workflow-state-schema-key-1']").setValue("customerName");
    expect(wrapper.get("[data-testid='workflow-state-schema-error']").text()).toContain("key");
  });

  it("requires state schema label and description before saving", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue(createDefinition({}));

    const definition = createDefinition({
      stateSchema: [
        {
          key: "customerName",
          label: "",
          description: "",
          valueType: "string",
          mergeStrategy: "replace",
          required: false,
          producerNodeIds: [],
          consumerNodeIds: [],
        },
      ],
    });

    const wrapper = mount(WorkflowGraphInspector, {
      props: { workflowId: "workflow-onboarding", definition },
      global: { plugins: [pinia] },
    });

    await flushPromises();

    expect(wrapper.get("[data-testid='workflow-state-schema-error']").text()).toContain("label");
    expect(wrapper.get("[data-testid='workflow-state-schema-error']").text()).toContain("description");
    expect(wrapper.get("[data-testid='workflow-graph-inspector-save']").attributes("disabled")).toBeDefined();

    await wrapper.get("[data-testid='workflow-state-schema-label-0']").setValue("Customer Name");
    expect(wrapper.get("[data-testid='workflow-state-schema-error']").text()).toContain("description");

    await wrapper.get("[data-testid='workflow-state-schema-description-0']").setValue("Stores the customer name.");
    expect(wrapper.find("[data-testid='workflow-state-schema-error']").exists()).toBe(false);

    await wrapper.get("[data-testid='workflow-graph-inspector-save']").trigger("click");
    expect(updateSpy).toHaveBeenCalled();
  });

  it("explicit join configuration can list upstream dependencies", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue(createDefinition({}));

    const definition = createDefinition({
      nodes: [
        { id: "node-a", kind: "tool", label: "A", tool: { toolId: "tool-a" } },
        { id: "node-b", kind: "tool", label: "B", tool: { toolId: "tool-b" } },
        {
          id: "node-join",
          kind: "join",
          label: "Join",
          join: { mode: "all", upstreamNodeIds: [] },
        },
      ],
      edges: [
        { id: "edge-a-join", kind: "parallel", fromNodeId: "node-a", toNodeId: "node-join" },
        { id: "edge-b-join", kind: "parallel", fromNodeId: "node-b", toNodeId: "node-join" },
      ],
      entryNodeId: "node-a",
    });

    const wrapper = mount(WorkflowGraphInspector, {
      props: { workflowId: "workflow-onboarding", definition },
      global: { plugins: [pinia] },
    });

    await flushPromises();

    await wrapper.get("[data-testid='workflow-graph-node-row-node-join']").trigger("click");
    expect(wrapper.get("[data-testid='workflow-node-editor-join-upstream-candidate-node-a']").text()).toContain("node-a");
    expect(wrapper.get("[data-testid='workflow-node-editor-join-upstream-candidate-node-b']").text()).toContain("node-b");

    // Explicit configuration should be editable and persisted.
    await wrapper.get("[data-testid='workflow-node-editor-join-upstream-toggle-node-a']").setValue(true);
    await wrapper.get("[data-testid='workflow-node-editor-join-upstream-toggle-node-b']").setValue(true);
    await wrapper.get("[data-testid='workflow-graph-inspector-save']").trigger("click");

    expect(updateSpy).toHaveBeenCalledWith("workflow-onboarding", expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: "node-join",
          join: expect.objectContaining({
            upstreamNodeIds: ["node-a", "node-b"],
          }),
        }),
      ]),
    }));
  });

  it("node retry and timeout policy edits persist correctly", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue(createDefinition({}));

    const definition = createDefinition({
      nodes: [
        {
          id: "node-tool",
          kind: "tool",
          label: "Tool node",
          tool: { toolId: "tool-x" },
          policy: {
            timeoutMs: 1000,
            retry: { maxAttempts: 1, backoffMs: 100 },
          },
        },
      ],
      edges: [],
      entryNodeId: "node-tool",
    });

    const wrapper = mount(WorkflowGraphInspector, {
      props: { workflowId: "workflow-onboarding", definition },
      global: { plugins: [pinia] },
    });

    await flushPromises();

    await wrapper.get("[data-testid='workflow-graph-node-row-node-tool']").trigger("click");
    await wrapper.get("[data-testid='workflow-node-editor-timeout-ms']").setValue("2500");
    await wrapper.get("[data-testid='workflow-node-editor-retry-max-attempts']").setValue("3");
    await wrapper.get("[data-testid='workflow-node-editor-retry-backoff-ms']").setValue("400");
    await wrapper.get("[data-testid='workflow-graph-inspector-save']").trigger("click");

    expect(updateSpy).toHaveBeenCalledWith("workflow-onboarding", expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: "node-tool",
          policy: expect.objectContaining({
            timeoutMs: 2500,
            retry: { maxAttempts: 3, backoffMs: 400 },
          }),
        }),
      ]),
    }));
  });

  it("does not allow retry maxAttempts below one", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue(createDefinition({}));

    const definition = createDefinition({
      nodes: [
        {
          id: "node-tool",
          kind: "tool",
          label: "Tool node",
          tool: { toolId: "tool-x" },
          policy: {
            timeoutMs: 1000,
            retry: { maxAttempts: 2, backoffMs: 100 },
          },
        },
      ],
      edges: [],
      entryNodeId: "node-tool",
    });

    const wrapper = mount(WorkflowGraphInspector, {
      props: { workflowId: "workflow-onboarding", definition },
      global: { plugins: [pinia] },
    });

    await flushPromises();

    await wrapper.get("[data-testid='workflow-graph-node-row-node-tool']").trigger("click");
    await wrapper.get("[data-testid='workflow-node-editor-retry-max-attempts']").setValue("0");
    await wrapper.get("[data-testid='workflow-graph-inspector-save']").trigger("click");

    expect(updateSpy).toHaveBeenCalledWith("workflow-onboarding", expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: "node-tool",
          policy: expect.not.objectContaining({
            retry: expect.anything(),
          }),
        }),
      ]),
    }));
  });

  it("a human-input node exposes structured fields instead of freeform text blobs", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const definition = createDefinition({
      nodes: [
        {
          id: "node-human",
          kind: "human-input",
          label: "Collect info",
          humanInput: { formKey: "onboarding-form" },
        },
      ],
      edges: [],
      entryNodeId: "node-human",
    });

    const wrapper = mount(WorkflowGraphInspector, {
      props: { workflowId: "workflow-onboarding", definition },
      global: { plugins: [pinia] },
    });

    await flushPromises();

    await wrapper.get("[data-testid='workflow-graph-node-row-node-human']").trigger("click");
    expect(wrapper.get("[data-testid='workflow-node-editor-human-form-key']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='workflow-node-editor-human-raw']").exists()).toBe(false);
  });

  it("renders typed node editors for llm, tool, subgraph, start and end nodes", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const definition = createDefinition({
      nodes: [
        {
          id: "node-llm",
          kind: "llm",
          label: "Draft reply",
          llm: { prompt: "Summarize the context." },
        },
        {
          id: "node-tool",
          kind: "tool",
          label: "Lookup profile",
          tool: { toolId: "customer.lookup" },
        },
        {
          id: "node-subgraph",
          kind: "subgraph",
          label: "Escalation flow",
          subgraph: { workflowId: "workflow-escalation" },
        },
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [],
      entryNodeId: "node-start",
    });

    const wrapper = mount(WorkflowGraphInspector, {
      props: { workflowId: "workflow-onboarding", definition },
      global: { plugins: [pinia] },
    });

    await flushPromises();

    await wrapper.get("[data-testid='workflow-graph-node-row-node-llm']").trigger("click");
    expect(wrapper.get("[data-testid='workflow-node-editor-llm-prompt']").exists()).toBe(true);

    await wrapper.get("[data-testid='workflow-graph-node-row-node-tool']").trigger("click");
    expect(wrapper.get("[data-testid='workflow-node-editor-tool-id']").exists()).toBe(true);

    await wrapper.get("[data-testid='workflow-graph-node-row-node-subgraph']").trigger("click");
    expect(wrapper.get("[data-testid='workflow-node-editor-subgraph-workflow-id']").exists()).toBe(true);

    await wrapper.get("[data-testid='workflow-graph-node-row-node-start']").trigger("click");
    expect(wrapper.get("[data-testid='workflow-node-editor-stage-hint']").text()).toContain("入口阶段");

    await wrapper.get("[data-testid='workflow-graph-node-row-node-end']").trigger("click");
    expect(wrapper.get("[data-testid='workflow-node-editor-stage-hint']").text()).toContain("终止阶段");
  });

  it("supports structured condition routing configuration from node editor", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue(createDefinition({}));

    const conditionNode = {
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
    } as unknown as WorkflowDefinition["nodes"][number];

    const definition = createDefinition({
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        conditionNode,
        { id: "node-manual", kind: "human-input", label: "Manual", humanInput: { formKey: "manual-review" } },
        { id: "node-auto", kind: "tool", label: "Auto", tool: { toolId: "risk.approve" } },
      ],
      edges: [
        { id: "edge-start-condition", kind: "normal", fromNodeId: "node-start", toNodeId: "node-condition" },
        { id: "edge-condition-manual", kind: "conditional", fromNodeId: "node-condition", toNodeId: "node-manual", condition: { operator: "exists", leftPath: "$.risk.score" } },
        { id: "edge-condition-auto", kind: "normal", fromNodeId: "node-condition", toNodeId: "node-auto" },
      ],
      entryNodeId: "node-start",
    });

    const wrapper = mount(WorkflowGraphInspector, {
      props: { workflowId: "workflow-onboarding", definition },
      global: { plugins: [pinia] },
    });

    await flushPromises();

    await wrapper.get("[data-testid='workflow-graph-node-row-node-condition']").trigger("click");
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

  it("blocks saving and shows UI validation for invalid graph references", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue(createDefinition({}));

    const definition = createDefinition({
      entryNodeId: "node-missing-entry",
      nodes: [
        { id: "node-join", kind: "join", label: "Join", join: { mode: "all", upstreamNodeIds: ["node-ghost"] } },
      ],
      edges: [{ id: "edge-bad", kind: "normal", fromNodeId: "node-join", toNodeId: "node-missing-target" }],
      stateSchema: [],
    });

    const wrapper = mount(WorkflowGraphInspector, {
      props: { workflowId: "workflow-onboarding", definition },
      global: { plugins: [pinia] },
    });

    await flushPromises();

    expect(wrapper.get("[data-testid='workflow-graph-inspector-graph-error']").text()).toContain("entryNodeId");
    expect(wrapper.get("[data-testid='workflow-graph-inspector-graph-error']").text()).toContain("edge");
    expect(wrapper.get("[data-testid='workflow-graph-inspector-graph-error']").text()).toContain("join");
    expect(wrapper.get("[data-testid='workflow-graph-inspector-save']").attributes("disabled")).toBeDefined();

    await wrapper.get("[data-testid='workflow-graph-inspector-save']").trigger("click");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("blocks saving when a condition route has no matching outgoing edge", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue(createDefinition({}));

    const definition = createDefinition({
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        {
          id: "node-condition",
          kind: "condition",
          label: "Condition",
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

    const wrapper = mount(WorkflowGraphInspector, {
      props: { workflowId: "workflow-onboarding", definition },
      global: { plugins: [pinia] },
    });

    await flushPromises();

    expect(wrapper.get("[data-testid='workflow-graph-inspector-graph-error']").text()).toContain("false route edge missing");
    expect(wrapper.get("[data-testid='workflow-graph-inspector-save']").attributes("disabled")).toBeDefined();

    await wrapper.get("[data-testid='workflow-graph-inspector-save']").trigger("click");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("keeps at least one join upstream dependency selected", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue(createDefinition({}));

    const definition = createDefinition({
      nodes: [
        { id: "node-a", kind: "tool", label: "A", tool: { toolId: "tool-a" } },
        {
          id: "node-join",
          kind: "join",
          label: "Join",
          join: { mode: "all", upstreamNodeIds: ["node-a"] },
        },
      ],
      edges: [{ id: "edge-a-join", kind: "parallel", fromNodeId: "node-a", toNodeId: "node-join" }],
      entryNodeId: "node-a",
    });

    const wrapper = mount(WorkflowGraphInspector, {
      props: { workflowId: "workflow-onboarding", definition },
      global: { plugins: [pinia] },
    });

    await flushPromises();

    await wrapper.get("[data-testid='workflow-graph-node-row-node-join']").trigger("click");
    await wrapper.get("[data-testid='workflow-node-editor-join-upstream-toggle-node-a']").setValue(false);

    expect(wrapper.get("[data-testid='workflow-node-editor-join-error']").text()).toContain("上游节点");
    expect(
      (wrapper.get("[data-testid='workflow-node-editor-join-upstream-toggle-node-a']").element as HTMLInputElement)
        .checked,
    ).toBe(true);

    await wrapper.get("[data-testid='workflow-graph-inspector-save']").trigger("click");
    expect(updateSpy).toHaveBeenCalledWith("workflow-onboarding", expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: "node-join",
          join: expect.objectContaining({
            upstreamNodeIds: ["node-a"],
          }),
        }),
      ]),
    }));
  });

  it("supports sidebar mode selection driven by the canvas", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const definition = createDefinition({
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-end", kind: "end", label: "Finish" },
      ],
      edges: [{ id: "edge-start-end", kind: "normal", fromNodeId: "node-start", toNodeId: "node-end" }],
    });

    const wrapper = mount(WorkflowGraphInspector, {
      props: {
        workflowId: "workflow-onboarding",
        definition,
        selectedNodeId: "node-end",
        showGraphList: false,
      },
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    expect(wrapper.find("[data-testid='workflow-graph-node-row-node-start']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='workflow-edge-editor']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='workflow-node-editor']").text()).toContain("node-end");
    expect(wrapper.get("[data-testid='workflow-node-editor-label']").element).toHaveProperty("value", "Finish");
  });

  it("preserves editor metadata when saving graph edits", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    const definition = createDefinition({});
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue(definition);

    const wrapper = mount(WorkflowGraphInspector, {
      props: { workflowId: "workflow-onboarding", definition },
      global: { plugins: [pinia] },
    });

    await flushPromises();
    await wrapper.get("[data-testid='workflow-graph-inspector-save']").trigger("click");

    expect(updateSpy).toHaveBeenCalledWith("workflow-onboarding", expect.objectContaining({
      editor: definition.editor,
    }));
  });
});
