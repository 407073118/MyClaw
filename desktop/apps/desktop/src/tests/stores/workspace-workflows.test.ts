import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDefinition } from "@myclaw-desktop/shared";

import * as runtimeClient from "@/services/runtime-client";
import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";

describe("workspace workflow store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("loads workflow summaries separately from workflow definitions", async () => {
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    const summary = fixture.workflows[0]!;

    vi.spyOn(runtimeClient, "fetchWorkflows").mockResolvedValue({
      items: [summary],
    });

    await workspace.loadWorkflows();

    expect(workspace.workflows).toHaveLength(1);
    expect(workspace.workflowSummaries[summary.id]?.nodeCount).toBe(summary.nodeCount);
    expect(workspace.workflowDefinitions[summary.id]).toBeUndefined();
  });

  it("preserves runtime defaultModelProfileId null during hydrate", () => {
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();

    workspace.hydrate({
      ...fixture,
      defaultModelProfileId: null,
      approvals: fixture.approvals,
    });

    expect(workspace.defaultModelProfileId).toBeNull();
  });

  it("creates workflow and stores returned default draft definition", async () => {
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    const definition = fixture.workflowDefinitions[0]!;
    const summary = fixture.workflows[0]!;

    vi.spyOn(runtimeClient, "createWorkflow").mockResolvedValue({
      workflow: definition,
      items: [summary],
    });

    await workspace.createWorkflow({
      name: "Onboarding Workflow",
      description: "Covers setup and completion checks.",
    });

    expect(workspace.workflowDefinitions[definition.id]?.entryNodeId).toBe("node-start");
    expect(workspace.workflowSummaries[definition.id]?.nodeCount).toBe(2);
    expect(workspace.workflows[0]?.id).toBe(definition.id);
  });

  it("creates workflow with stale or empty items and still hydrates list/summary", async () => {
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    const definition = {
      ...fixture.workflowDefinitions[0]!,
      id: "workflow-new",
      name: "New Workflow",
      updatedAt: "2026-03-22T10:00:00.000Z",
    };

    workspace.hydrate({
      ...fixture,
      workflows: [fixture.workflows[0]!],
      workflowRuns: fixture.workflowRuns,
      approvals: fixture.approvals,
    });

    vi.spyOn(runtimeClient, "createWorkflow").mockResolvedValue({
      workflow: definition,
      items: [],
    });

    await workspace.createWorkflow({
      name: definition.name,
      description: definition.description,
    });

    expect(workspace.workflowDefinitions[definition.id]?.name).toBe("New Workflow");
    expect(workspace.workflowSummaries[definition.id]?.version).toBe(definition.version);
    expect(workspace.workflows.some((item) => item.id === definition.id)).toBe(true);
  });

  it("loads workflow detail and hydrates editor state map", async () => {
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    workspace.hydrate({
      ...fixture,
      workflows: [fixture.workflows[0]!],
      workflowRuns: fixture.workflowRuns,
      approvals: fixture.approvals,
    });

    const definition = {
      ...fixture.workflowDefinitions[0]!,
      version: 2,
      nodeCount: 3,
      edgeCount: 2,
    };
    vi.spyOn(runtimeClient, "getWorkflow").mockResolvedValue({
      workflow: definition,
    });

    await workspace.loadWorkflowById(definition.id);

    expect(workspace.workflowDefinitions[definition.id]?.version).toBe(2);
    expect(workspace.workflowSummaries[definition.id]?.edgeCount).toBe(2);
    expect(workspace.workflows.find((item) => item.id === definition.id)?.nodeCount).toBe(3);
  });

  it("backfills canvas editor metadata when loading legacy workflow detail without editor", async () => {
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    workspace.hydrate({
      ...fixture,
      workflows: [fixture.workflows[0]!],
      workflowRuns: fixture.workflowRuns,
      approvals: fixture.approvals,
    });

    const legacyDefinition = { ...fixture.workflowDefinitions[0]! } as WorkflowDefinition & { editor?: unknown };
    delete legacyDefinition.editor;
    vi.spyOn(runtimeClient, "getWorkflow").mockResolvedValue({
      workflow: legacyDefinition,
    });

    await workspace.loadWorkflowById(legacyDefinition.id);

    const hydrated = workspace.workflowDefinitions[legacyDefinition.id] as WorkflowDefinition & {
      editor?: {
        canvas?: {
          viewport?: { offsetX: number; offsetY: number };
          nodes?: Array<{ nodeId: string; position: { x: number; y: number } }>;
        };
      };
    };

    expect(hydrated.editor?.canvas?.viewport).toEqual({ offsetX: 0, offsetY: 0 });
    expect(hydrated.editor?.canvas?.nodes?.length).toBe(legacyDefinition.nodes.length);
  });

  it("preserves existing canvas editor metadata when update response omits editor", async () => {
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    const definition = fixture.workflowDefinitions[0] as WorkflowDefinition & {
      editor?: { canvas?: { nodes?: Array<{ nodeId: string }> } };
    };
    workspace.hydrate({
      ...fixture,
      workflows: [fixture.workflows[0]!],
      workflowRuns: fixture.workflowRuns,
      approvals: fixture.approvals,
    });
    workspace.workflowDefinitions[definition.id] = definition;

    const updatedWithoutEditor = {
      ...definition,
      name: "Onboarding Workflow Updated",
      version: definition.version + 1,
    } as WorkflowDefinition & { editor?: unknown };
    delete updatedWithoutEditor.editor;

    vi.spyOn(runtimeClient, "updateWorkflow").mockResolvedValue({
      workflow: updatedWithoutEditor,
    });

    await workspace.updateWorkflow(definition.id, { name: "Onboarding Workflow Updated" });

    const stored = workspace.workflowDefinitions[definition.id] as WorkflowDefinition & {
      editor?: { canvas?: { nodes?: Array<{ nodeId: string }> } };
    };
    expect(stored.editor?.canvas?.nodes?.map((item) => item.nodeId)).toEqual(
      definition.editor?.canvas?.nodes?.map((item) => item.nodeId),
    );
  });

  it("hydrates workflow run state when starting and resuming runs without dropping unrelated runs", async () => {
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    const initialRun = fixture.workflowRuns[0]!;
    const unrelatedRun = {
      ...initialRun,
      id: "run-unrelated",
      workflowId: "workflow-unrelated",
      status: "completed" as const,
    };
    const resumedRun = {
      ...initialRun,
      status: "waiting-input" as const,
      updatedAt: "2026-03-22T09:41:00.000Z",
    };

    workspace.hydrate({
      ...fixture,
      workflowRuns: [initialRun, unrelatedRun],
      approvals: fixture.approvals,
    });

    vi.spyOn(runtimeClient, "startWorkflowRun").mockResolvedValue({
      run: initialRun,
      items: [initialRun],
    });
    vi.spyOn(runtimeClient, "resumeWorkflowRun").mockResolvedValue({
      run: resumedRun,
      items: [resumedRun],
    });

    await workspace.startWorkflowRun("workflow-onboarding");
    expect(workspace.workflowRuns[initialRun.id]?.status).toBe("running");
    expect(workspace.workflowRuns[unrelatedRun.id]?.status).toBe("completed");

    await workspace.resumeWorkflowRun(initialRun.id);
    expect(workspace.workflowRuns[initialRun.id]?.status).toBe("waiting-input");
    expect(workspace.workflowRuns[unrelatedRun.id]?.status).toBe("completed");
  });

  it("keeps existing runs when loadWorkflowRuns returns partial snapshots", async () => {
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    const runA = fixture.workflowRuns[0]!;
    const runB = {
      ...runA,
      id: "run-2",
      workflowId: "workflow-2",
      status: "completed" as const,
    };

    workspace.hydrate({
      ...fixture,
      workflowRuns: [runA, runB],
      approvals: fixture.approvals,
    });

    vi.spyOn(runtimeClient, "fetchWorkflowRuns").mockResolvedValue({
      items: [{ ...runA, status: "failed" as const }],
    });

    await workspace.loadWorkflowRuns();

    expect(workspace.workflowRuns[runA.id]?.status).toBe("failed");
    expect(workspace.workflowRuns[runB.id]?.status).toBe("completed");
  });

  it("syncs workflowSummaries when importing cloud workflow packages", async () => {
    const workspace = useWorkspaceStore();
    const fixture = createWorkspaceFixture();
    const importedSummary = {
      ...fixture.workflows[0]!,
      id: "workflow-cloud-1",
      source: "hub" as const,
      libraryRootId: "hub/cloud",
    };

    vi.spyOn(workspace, "loadCloudHubDownloadToken").mockResolvedValue({
      downloadUrl: "https://example.com/workflow-package.zip",
      expiresIn: 300,
    });
    vi.spyOn(runtimeClient, "installWorkflowPackageFromCloud").mockResolvedValue({
      workflow: importedSummary,
      packageRecord: {
        id: "pkg-1",
        itemId: "cloud-workflow",
        releaseId: "release-1",
        filePath: "workflow-packages/cloud-workflow.json",
        downloadUrl: "https://example.com/workflow-package.zip",
        installedAt: "2026-03-22T11:00:00.000Z",
        manifest: {
          kind: "workflow-package",
          name: "Cloud Workflow",
          version: "1.0.0",
          description: "Cloud workflow package",
          entryWorkflowId: importedSummary.id,
        },
      },
      items: [importedSummary],
    });

    await workspace.importCloudWorkflowPackage({
      itemId: "cloud-workflow",
      releaseId: "release-1",
      name: "Cloud Workflow",
      manifest: {
        kind: "workflow-package",
        name: "Cloud Workflow",
        version: "1.0.0",
        description: "Cloud workflow package",
        entryWorkflowId: importedSummary.id,
      },
    });

    expect(workspace.workflows.some((item) => item.id === importedSummary.id)).toBe(true);
    expect(workspace.workflowSummaries[importedSummary.id]?.source).toBe("hub");
  });
});
