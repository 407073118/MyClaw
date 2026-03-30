import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkflowDefinition } from "@myclaw-desktop/shared";
import { resolveRuntimeLayout } from "../services/runtime-layout";
import { resolveWorkflowLibraryRoots } from "./workflow-library-root-store";
import {
  loadWorkflowDefinition,
  resolveWorkflowDefinitionFilePath,
  saveWorkflowDefinition,
} from "./workflow-definition-store";

describe("workflow definition store", () => {
  let tempDir: string | undefined;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-workflow-definition-store-"));
    stateFilePath = join(tempDir, "runtime-state.db");
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("creates a default personal workflow root abstraction", () => {
    const layout = resolveRuntimeLayout(stateFilePath);
    const roots = resolveWorkflowLibraryRoots(undefined, layout);

    expect(roots).toHaveLength(1);
    expect(roots[0]?.id).toBe("personal");
    expect(roots[0]?.writable).toBe(true);
    expect(roots[0]?.path).toBe(join(layout.workflowRootsDir, "personal"));
  });

  it("does not treat mounted 'personal' id as the writable personal root", () => {
    const layout = resolveRuntimeLayout(stateFilePath);
    const roots = resolveWorkflowLibraryRoots(
      [
        {
          id: "personal",
          name: "Mounted Personal Alias",
          path: "D:/mounted/personal",
          writable: true,
          kind: "mounted",
          createdAt: "2026-03-24T00:00:00.000Z",
          updatedAt: "2026-03-24T00:00:00.000Z",
        },
      ],
      layout,
    );

    const personalRoot = roots.find((item) => item.id === "personal" && item.kind === "personal");
    expect(personalRoot).toBeTruthy();
    expect(personalRoot?.path).toBe(join(layout.workflowRootsDir, "personal"));
  });

  it("round-trips a full workflow definition through definition.json", async () => {
    const layout = resolveRuntimeLayout(stateFilePath);
    const roots = resolveWorkflowLibraryRoots(undefined, layout);
    const definition: WorkflowDefinition = {
      id: "workflow-risk-review",
      name: "Risk Review Workflow",
      description: "Collects risk signals before decision.",
      status: "draft",
      source: "personal",
      updatedAt: "2026-03-24T00:00:00.000Z",
      version: 1,
      nodeCount: 2,
      edgeCount: 1,
      libraryRootId: "personal",
      entryNodeId: "node-start",
      nodes: [
        {
          id: "node-start",
          kind: "start",
          label: "Start",
        },
        {
          id: "node-end",
          kind: "end",
          label: "End",
        },
      ],
      edges: [
        {
          id: "edge-start-end",
          fromNodeId: "node-start",
          toNodeId: "node-end",
          kind: "normal",
        },
      ],
      stateSchema: [
        {
          key: "decision",
          label: "Decision",
          description: "审批结果",
          valueType: "string",
          mergeStrategy: "replace",
          required: false,
          producerNodeIds: ["node-start"],
          consumerNodeIds: ["node-end"],
        },
      ],
    };

    const savedPath = await saveWorkflowDefinition({
      definition,
      roots,
      layout,
    });
    const loadedDefinition = await loadWorkflowDefinition({
      workflowId: definition.id,
      libraryRootId: "personal",
      roots,
      layout,
    });

    expect(savedPath).toBe(resolveWorkflowDefinitionFilePath(definition.id, "personal", roots, layout));
    expect(loadedDefinition).toEqual(definition);
    expect(readFileSync(savedPath, "utf8")).toContain("\"nodes\"");
    expect(readFileSync(savedPath, "utf8")).toContain("\"edges\"");
  });

  it("fails fast when the requested library root is unknown", () => {
    const layout = resolveRuntimeLayout(stateFilePath);
    const roots = resolveWorkflowLibraryRoots(undefined, layout);

    expect(() =>
      resolveWorkflowDefinitionFilePath("workflow-risk-review", "unknown-root", roots, layout),
    ).toThrow(/unknown workflow library root/i);
  });

  it("allows mounted roots outside runtime-owned workflow roots", () => {
    const layout = resolveRuntimeLayout(stateFilePath);
    const roots = [
      ...resolveWorkflowLibraryRoots(undefined, layout),
      {
        id: "mounted-a",
        name: "Mounted A",
        path: "D:/external-workflows/mounted-a",
        writable: true,
        kind: "mounted" as const,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
      },
    ];

    const resolved = resolveWorkflowDefinitionFilePath("workflow-risk-review", "mounted-a", roots, layout);
    expect(resolved).toBe(
      join("D:/external-workflows/mounted-a", "workflow-risk-review", "definition.json"),
    );
  });

  it("rejects mounted roots with relative paths", () => {
    const layout = resolveRuntimeLayout(stateFilePath);
    expect(() =>
      resolveWorkflowLibraryRoots(
        [
          {
            id: "mounted-relative",
            name: "Mounted Relative",
            path: "./mounted-relative",
            writable: true,
            kind: "mounted",
            createdAt: "2026-03-24T00:00:00.000Z",
            updatedAt: "2026-03-24T00:00:00.000Z",
          },
        ],
        layout,
      ),
    ).toThrow(/mounted workflow library root path must be absolute/i);
  });

  it("rejects malformed definition json with a structural error", async () => {
    const layout = resolveRuntimeLayout(stateFilePath);
    const roots = resolveWorkflowLibraryRoots(undefined, layout);
    const filePath = resolveWorkflowDefinitionFilePath(
      "workflow-malformed",
      "personal",
      roots,
      layout,
    );
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ id: "workflow-malformed" }), "utf8");

    await expect(
      loadWorkflowDefinition({
        workflowId: "workflow-malformed",
        libraryRootId: "personal",
        roots,
        layout,
      }),
    ).rejects.toThrow(/invalid workflow definition/i);
  });

  it("rejects definitions missing required summary/index fields", async () => {
    const layout = resolveRuntimeLayout(stateFilePath);
    const roots = resolveWorkflowLibraryRoots(undefined, layout);
    const filePath = resolveWorkflowDefinitionFilePath(
      "workflow-summary-missing",
      "personal",
      roots,
      layout,
    );
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify({
        id: "workflow-summary-missing",
        name: "Broken Definition",
        description: "Missing summary/index fields.",
        entryNodeId: "node-start",
        nodes: [],
        edges: [],
        stateSchema: [],
      }),
      "utf8",
    );

    await expect(
      loadWorkflowDefinition({
        workflowId: "workflow-summary-missing",
        libraryRootId: "personal",
        roots,
        layout,
      }),
    ).rejects.toThrow(/invalid workflow definition/i);
  });

  it("rejects malformed definition graph references near storage layer", async () => {
    const layout = resolveRuntimeLayout(stateFilePath);
    const roots = resolveWorkflowLibraryRoots(undefined, layout);
    const filePath = resolveWorkflowDefinitionFilePath(
      "workflow-cross-ref-invalid",
      "personal",
      roots,
      layout,
    );
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify({
        id: "workflow-cross-ref-invalid",
        name: "Cross Ref Invalid",
        description: "Edge targets unknown node.",
        status: "draft",
        source: "personal",
        updatedAt: "2026-03-24T00:00:00.000Z",
        version: 1,
        nodeCount: 1,
        edgeCount: 1,
        libraryRootId: "personal",
        entryNodeId: "node-start",
        nodes: [
          {
            id: "node-start",
            kind: "start",
            label: "Start",
          },
        ],
        edges: [
          {
            id: "edge-invalid",
            fromNodeId: "node-start",
            toNodeId: "node-missing",
            kind: "normal",
          },
        ],
        stateSchema: [],
      }),
      "utf8",
    );

    await expect(
      loadWorkflowDefinition({
        workflowId: "workflow-cross-ref-invalid",
        libraryRootId: "personal",
        roots,
        layout,
      }),
    ).rejects.toThrow(/invalid workflow definition/i);
  });
});
