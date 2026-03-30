import type { WorkflowDefinition } from "@myclaw-desktop/shared";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as runtimeClient from "@/services/runtime-client";
import WorkflowRunPanel from "@/components/workflow/WorkflowRunPanel.vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";

function createDefinition(overrides: Partial<WorkflowDefinition>): WorkflowDefinition {
  const base = createWorkspaceFixture().workflowDefinitions[0]!;
  return {
    ...base,
    ...overrides,
  } as WorkflowDefinition;
}

describe("WorkflowRunPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("shows paused human-input state and resumes from the pending checkpoint", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    const waitingRun = {
      ...fixture.workflowRuns[0]!,
      status: "waiting-input" as const,
      currentNodeIds: ["node-human"],
    };
    workspace.hydrate({
      ...fixture,
      workflowRuns: [waitingRun],
      approvals: fixture.approvals,
    });

    const definition = createDefinition({
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        {
          id: "node-human",
          kind: "human-input",
          label: "Collect Approval",
          humanInput: { field: "approval" },
        },
        { id: "node-end", kind: "end", label: "Done" },
      ],
      edges: [
        { id: "edge-start-human", kind: "normal", fromNodeId: "node-start", toNodeId: "node-human" },
        { id: "edge-human-end", kind: "normal", fromNodeId: "node-human", toNodeId: "node-end" },
      ],
      stateSchema: [
        {
          key: "approval",
          label: "Approval",
          description: "User approval result.",
          valueType: "string",
          mergeStrategy: "replace",
          required: false,
          producerNodeIds: ["node-human"],
          consumerNodeIds: ["node-end"],
        },
      ],
    });

    vi.spyOn(workspace as never, "loadWorkflowRuns").mockResolvedValue([waitingRun]);
    const resumeSpy = vi.spyOn(workspace as never, "resumeWorkflowRun").mockResolvedValue({
      ...waitingRun,
      status: "succeeded",
      currentNodeIds: ["node-end"],
    });
    vi.spyOn(runtimeClient as never, "getWorkflowRun").mockResolvedValueOnce({
      run: {
        ...waitingRun,
        state: {},
      },
      checkpoints: [
        {
          id: "cp-1",
          runId: waitingRun.id,
          createdAt: "2026-03-22T09:40:00.000Z",
          nodeId: "node-start",
          status: "node-complete",
          state: {},
          attempts: {},
        },
        {
          id: "cp-2",
          runId: waitingRun.id,
          createdAt: "2026-03-22T09:40:01.000Z",
          nodeId: "node-human",
          status: "waiting-human-input",
          state: {},
          attempts: {},
        },
      ],
    }).mockResolvedValueOnce({
      run: {
        ...waitingRun,
        status: "succeeded",
        currentNodeIds: ["node-end"],
        state: {
          approval: "approved",
        },
      },
      checkpoints: [
        {
          id: "cp-3",
          runId: waitingRun.id,
          createdAt: "2026-03-22T09:41:00.000Z",
          nodeId: "node-end",
          status: "run-complete",
          state: {
            approval: "approved",
          },
          attempts: {},
        },
      ],
    });

    const wrapper = mount(WorkflowRunPanel, {
      props: {
        workflowId: definition.id,
        definition,
      },
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    expect(wrapper.get("[data-testid='workflow-run-status']").text()).toContain("waiting-input");
    expect(wrapper.text()).toContain("Collect Approval");
    expect(wrapper.get("[data-testid='workflow-checkpoint-timeline']").text()).toContain("waiting-human-input");

    await wrapper.get("[data-testid='workflow-run-resume']").trigger("click");
    await flushPromises();

    expect(resumeSpy).toHaveBeenCalledWith(waitingRun.id);
    expect(wrapper.get("[data-testid='workflow-run-status']").text()).toContain("succeeded");
    expect(wrapper.get("[data-testid='workflow-run-state-field-approval']").text()).toContain("approved");
  });

  it("shows retry attempts, last error, and join state previews from run detail", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    const retryRun = {
      ...fixture.workflowRuns[0]!,
      id: "run-retry",
      status: "retry-scheduled" as const,
      currentNodeIds: ["node-tool"],
    };
    const joinRun = {
      ...fixture.workflowRuns[0]!,
      id: "run-join",
      status: "waiting-join" as const,
      currentNodeIds: ["node-join"],
      updatedAt: "2026-03-22T09:42:00.000Z",
    };
    workspace.hydrate({
      ...fixture,
      workflowRuns: [retryRun, joinRun],
      approvals: fixture.approvals,
    });

    const definition = createDefinition({
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-tool", kind: "tool", label: "Fetch CRM", tool: { toolId: "crm.fetch" } },
        {
          id: "node-join",
          kind: "join",
          label: "Merge Results",
          join: { mode: "all", upstreamNodeIds: ["node-tool"], mergeStrategyOverrides: { profile: "object-merge" } },
        },
        { id: "node-end", kind: "end", label: "Done" },
      ],
      edges: [
        { id: "edge-start-tool", kind: "normal", fromNodeId: "node-start", toNodeId: "node-tool" },
        { id: "edge-tool-join", kind: "parallel", fromNodeId: "node-tool", toNodeId: "node-join" },
        { id: "edge-join-end", kind: "normal", fromNodeId: "node-join", toNodeId: "node-end" },
      ],
      stateSchema: [
        {
          key: "profile",
          label: "Customer Profile",
          description: "Merged customer profile.",
          valueType: "object",
          mergeStrategy: "object-merge",
          required: false,
          producerNodeIds: ["node-tool", "node-join"],
          consumerNodeIds: ["node-end"],
        },
        {
          key: "riskTags",
          label: "Risk Tags",
          description: "Unioned review tags.",
          valueType: "array",
          mergeStrategy: "union",
          required: false,
          producerNodeIds: ["node-tool", "node-join"],
          consumerNodeIds: ["node-end"],
        },
      ],
    });

    vi.spyOn(workspace as never, "loadWorkflowRuns").mockResolvedValue([retryRun, joinRun]);
    vi.spyOn(runtimeClient as never, "getWorkflowRun")
      .mockResolvedValueOnce({
        run: {
          ...joinRun,
          state: {
            profile: { name: "Ada" },
            riskTags: ["manual-review"],
          },
        },
        checkpoints: [
          {
            id: "cp-join-1",
            runId: joinRun.id,
            createdAt: "2026-03-22T09:42:00.000Z",
            nodeId: "node-join",
            status: "node-start",
            state: {
              profile: { name: "Ada" },
            },
            attempts: {},
          },
        ],
      })
      .mockResolvedValueOnce({
        run: {
          ...retryRun,
          state: {
            profile: { name: "Grace" },
          },
        },
        checkpoints: [
          {
            id: "cp-retry-1",
            runId: retryRun.id,
            createdAt: "2026-03-22T09:40:00.000Z",
            nodeId: "node-tool",
            status: "node-error",
            state: {
              profile: { name: "Grace" },
            },
            attempts: {
              "node-tool": 2,
            },
            error: "CRM timeout",
          },
          {
            id: "cp-retry-2",
            runId: retryRun.id,
            createdAt: "2026-03-22T09:40:02.000Z",
            nodeId: "node-tool",
            status: "retry-scheduled",
            state: {
              profile: { name: "Grace" },
            },
            attempts: {
              "node-tool": 2,
            },
            error: "CRM timeout",
            retryAt: "2026-03-22T09:40:05.000Z",
          },
        ],
      });

    const wrapper = mount(WorkflowRunPanel, {
      props: {
        workflowId: definition.id,
        definition,
      },
      global: {
        plugins: [pinia],
      },
    });

    await flushPromises();

    expect(wrapper.get("[data-testid='workflow-run-status']").text()).toContain("waiting-join");
    expect(wrapper.get("[data-testid='workflow-run-state-field-profile']").text()).toContain("Customer Profile");
    expect(wrapper.get("[data-testid='workflow-run-state-field-riskTags']").text()).toContain("manual-review");

    await wrapper.get("[data-testid='workflow-run-row-run-retry']").trigger("click");
    await flushPromises();

    expect(wrapper.get("[data-testid='workflow-run-status']").text()).toContain("retry-scheduled");
    expect(wrapper.get("[data-testid='workflow-run-last-error']").text()).toContain("CRM timeout");
    expect(wrapper.get("[data-testid='workflow-run-attempt-node-tool']").text()).toContain("2");
    expect(wrapper.get("[data-testid='workflow-checkpoint-timeline']").text()).toContain("retry-scheduled");
  });
});
