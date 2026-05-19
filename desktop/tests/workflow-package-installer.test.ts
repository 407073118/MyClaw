import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import JSZip from "jszip";

import { resolveWorkflowPackageDefinition } from "../src/main/services/workflow-package-installer";
import type { WorkflowDefinition } from "@shared/contracts";

function buildWorkflowDefinition(): WorkflowDefinition {
  return {
    id: "source-workflow",
    name: "Cloud Workflow",
    description: "真实工作流",
    status: "active",
    source: "hub",
    updatedAt: "2026-05-19T00:00:00.000Z",
    version: 3,
    nodeCount: 2,
    edgeCount: 1,
    libraryRootId: "",
    entryNodeId: "start",
    nodes: [
      { id: "start", kind: "start", label: "Start" },
      { id: "end", kind: "end", label: "End" },
    ],
    edges: [{ id: "edge-1", fromNodeId: "start", toNodeId: "end", kind: "normal" }],
    stateSchema: [],
  };
}

describe("workflow package installer", () => {
  it("installs workflow package from a real JSON artifact instead of creating an empty workflow", async () => {
    const root = await mkdtemp(join(tmpdir(), "myclaw-workflow-package-"));
    try {
      const artifactPath = join(root, "workflow-package.json");
      await writeFile(artifactPath, JSON.stringify({ workflow: buildWorkflowDefinition() }), "utf8");

      const result = await resolveWorkflowPackageDefinition({
        name: "Imported Workflow",
        downloadUrl: pathToFileURL(artifactPath).toString(),
        manifest: {
          kind: "workflow-package",
          name: "Cloud Workflow",
          version: "3.0.0",
          description: "来自云端 artifact",
          entryWorkflowId: "source-workflow",
        },
      });

      expect(result.workflow.name).toBe("Imported Workflow");
      expect(result.workflow.nodeCount).toBe(2);
      expect(result.workflow.edgeCount).toBe(1);
      expect(result.definition.nodes).toHaveLength(2);
      expect(result.definition.id).not.toBe("source-workflow");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("installs workflow package from a zip artifact entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "myclaw-workflow-package-"));
    try {
      const artifactPath = join(root, "workflow-package.zip");
      const zip = new JSZip();
      zip.file("workflows/source-workflow.json", JSON.stringify(buildWorkflowDefinition()));
      await writeFile(artifactPath, await zip.generateAsync({ type: "nodebuffer" }));

      const result = await resolveWorkflowPackageDefinition({
        downloadUrl: pathToFileURL(artifactPath).toString(),
        manifest: {
          kind: "workflow-package",
          entryWorkflowId: "source-workflow",
        },
      });

      expect(result.workflow.nodeCount).toBe(2);
      expect(result.definition.entryNodeId).toBe("start");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the downloaded artifact has no workflow definition", async () => {
    const root = await mkdtemp(join(tmpdir(), "myclaw-workflow-package-"));
    try {
      const artifactPath = join(root, "empty.json");
      await writeFile(artifactPath, JSON.stringify({ workflows: [] }), "utf8");

      await expect(resolveWorkflowPackageDefinition({
        downloadUrl: pathToFileURL(artifactPath).toString(),
        manifest: {
          kind: "workflow-package",
          entryWorkflowId: "missing",
        },
      })).rejects.toThrow("workflow_package_artifact_missing_workflow_definition");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
