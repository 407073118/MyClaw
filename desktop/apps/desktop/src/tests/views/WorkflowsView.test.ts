import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";
import WorkflowsView from "@/views/WorkflowsView.vue";

describe("WorkflowsView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("summary list shows graph stats like node count and last edited timestamp", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const wrapper = mount(WorkflowsView, {
      global: {
        plugins: [pinia],
        stubs: {
          RouterLink: {
            template: "<a><slot /></a>",
          },
        },
      },
    });

    expect(wrapper.find("[data-testid='workflows-view']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='workflow-library-card-workflow-onboarding']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='workflow-library-stat-nodes-workflow-onboarding']").text()).toContain("2");
    expect(wrapper.find("[data-testid='workflow-library-stat-updated-workflow-onboarding']").text()).toContain(
      "2026-03-22T09:35:00.000Z",
    );
  });

  it("create action creates a real draft graph, not just metadata row", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    const createSpy = vi.spyOn(workspace as never, "createWorkflow").mockResolvedValue({
      id: "workflow-weekly-review",
      name: "Weekly Review",
      description: "Runs weekly backlog and status checks.",
      status: "draft",
      source: "personal",
      updatedAt: "2026-03-23T10:00:00.000Z",
      version: 1,
      nodeCount: 0,
      edgeCount: 0,
      libraryRootId: "personal",
      entryNodeId: "",
      nodes: [],
      edges: [],
      stateSchema: [],
    });
    const updateSpy = vi.spyOn(workspace as never, "updateWorkflow").mockResolvedValue({
      id: "workflow-weekly-review",
      name: "Weekly Review",
      description: "Runs weekly backlog and status checks.",
      status: "draft",
      source: "personal",
      updatedAt: "2026-03-23T10:00:00.000Z",
      version: 1,
      nodeCount: 2,
      edgeCount: 1,
      libraryRootId: "personal",
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [{ id: "edge-start-end", fromNodeId: "node-start", toNodeId: "node-end", kind: "normal" }],
      stateSchema: [],
    });

    const wrapper = mount(WorkflowsView, {
      global: {
        plugins: [pinia],
        stubs: {
          RouterLink: {
            template: "<a><slot /></a>",
          },
        },
      },
    });

    await wrapper.get("[data-testid='workflow-create-name']").setValue("Weekly Review");
    await wrapper.get("[data-testid='workflow-create-description']").setValue("Runs weekly backlog and status checks.");
    await wrapper.get("[data-testid='workflow-create-form']").trigger("submit");
    await flushPromises();

    expect(createSpy).toHaveBeenCalledWith({
      name: "Weekly Review",
      description: "Runs weekly backlog and status checks.",
    });
    expect(updateSpy).toHaveBeenCalledWith("workflow-weekly-review", {
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [{ id: "edge-start-end", fromNodeId: "node-start", toNodeId: "node-end", kind: "normal" }],
    });
  });

  it("list gracefully handles invalid definition summaries reported by runtime", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());
    // 模拟 runtime 返回了畸形 summary：字段类型不正确但仍有 id。
    workspace.workflowSummaries["workflow-bad"] = {
      id: "workflow-bad",
      name: "Broken Workflow",
      description: "Bad payload from runtime should not crash UI.",
      status: "draft",
      source: "personal",
      updatedAt: "not-a-date",
      version: 1,
      nodeCount: Number.NaN,
      edgeCount: -1,
      libraryRootId: "personal",
    } as never;

    const wrapper = mount(WorkflowsView, {
      global: {
        plugins: [pinia],
        stubs: {
          RouterLink: {
            template: "<a><slot /></a>",
          },
        },
      },
    });

    expect(wrapper.find("[data-testid='workflow-library-card-workflow-bad']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='workflow-library-stat-nodes-workflow-bad']").text()).toContain("--");
    expect(wrapper.find("[data-testid='workflow-library-stat-updated-workflow-bad']").text()).toContain("Unknown");
  });

  it("does not reload when workflow summaries already exist", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    workspace.hydrate({
      ...fixture,
      workflows: [],
      approvals: fixture.approvals,
    });
    workspace.workflowSummaries = {
      [fixture.workflows[0]!.id]: fixture.workflows[0]!,
    };
    const loadSpy = vi.spyOn(workspace as never, "loadWorkflows").mockRejectedValue(new Error("should not run"));

    const wrapper = mount(WorkflowsView, {
      global: {
        plugins: [pinia],
        stubs: {
          RouterLink: {
            template: "<a><slot /></a>",
          },
        },
      },
    });

    await flushPromises();

    expect(loadSpy).not.toHaveBeenCalled();
    expect(wrapper.find("[data-testid='workflow-library-card-workflow-onboarding']").exists()).toBe(true);
  });
});
