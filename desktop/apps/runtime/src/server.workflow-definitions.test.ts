import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRuntimeApp } from "./server";

describe("runtime server workflow definition api", () => {
  let dispose: (() => Promise<void>) | undefined;
  let tempDir: string | undefined;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-workflow-definitions-"));
    stateFilePath = join(tempDir, "runtime-state.db");
  });

  afterEach(async () => {
    await dispose?.();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("reads and updates full workflow definitions while list remains summaries", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createResponse = await fetch(`${app.baseUrl}/api/workflows`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Risk Review",
        description: "Collects and routes risk signals.",
      }),
    });
    const createPayload = await createResponse.json();

    expect(createResponse.status).toBe(201);
    const workflowId = createPayload.workflow.id as string;

    const detailResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`);
    const detailPayload = await detailResponse.json();

    expect(detailResponse.status).toBe(200);
    expect(detailPayload.workflow.id).toBe(workflowId);
    expect(Array.isArray(detailPayload.workflow.nodes)).toBe(true);
    expect(Array.isArray(detailPayload.workflow.edges)).toBe(true);
    expect(Array.isArray(detailPayload.workflow.stateSchema)).toBe(true);
    expect(detailPayload.workflow.editor?.canvas?.viewport).toEqual({
      offsetX: 0,
      offsetY: 0,
    });
    expect(detailPayload.workflow.editor?.canvas?.nodes).toHaveLength(2);

    const patchResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        status: "active",
        defaults: {
          run: {
            maxParallelNodes: 4,
            checkpointPolicy: "always",
          },
          nodePolicy: {
            timeoutMs: 30000,
            retry: {
              maxAttempts: 3,
              backoffMs: 1000,
            },
            onFailure: {
              mode: "stop",
            },
          },
        },
        nodes: [
          {
            id: "node-start",
            kind: "start",
            label: "Start",
          },
          {
            id: "node-review",
            kind: "condition",
            label: "Review Decision",
          },
          {
            id: "node-end",
            kind: "end",
            label: "End",
          },
        ],
        edges: [
          {
            id: "edge-start-review",
            fromNodeId: "node-start",
            toNodeId: "node-review",
            kind: "normal",
          },
          {
            id: "edge-review-end",
            fromNodeId: "node-review",
            toNodeId: "node-end",
            kind: "conditional",
            condition: {
              operator: "exists",
              leftPath: "state.business.decision",
            },
          },
        ],
        stateSchema: [
          {
            key: "decision",
            label: "Decision",
            description: "Current decision value",
            valueType: "string",
            mergeStrategy: "replace",
            required: false,
            producerNodeIds: ["node-review"],
            consumerNodeIds: ["node-end"],
          },
        ],
        entryNodeId: "node-start",
        editor: {
          canvas: {
            viewport: {
              offsetX: 30,
              offsetY: -20,
            },
            nodes: [
              {
                nodeId: "node-start",
                position: {
                  x: 80,
                  y: 120,
                },
              },
              {
                nodeId: "node-review",
                position: {
                  x: 360,
                  y: 120,
                },
              },
              {
                nodeId: "node-end",
                position: {
                  x: 640,
                  y: 120,
                },
              },
            ],
          },
        },
      }),
    });
    const patchPayload = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(patchPayload.workflow.status).toBe("active");
    expect(patchPayload.workflow.nodes).toHaveLength(3);
    expect(patchPayload.workflow.edges).toHaveLength(2);
    expect(patchPayload.workflow.nodeCount).toBe(3);
    expect(patchPayload.workflow.edgeCount).toBe(2);
    expect(patchPayload.workflow.defaults?.run?.maxParallelNodes).toBe(4);
    expect(patchPayload.workflow.defaults?.run?.checkpointPolicy).toBe("always");
    expect(patchPayload.workflow.defaults?.nodePolicy?.retry?.maxAttempts).toBe(3);
    expect(patchPayload.workflow.editor?.canvas?.viewport).toEqual({
      offsetX: 30,
      offsetY: -20,
    });
    expect(patchPayload.workflow.editor?.canvas?.nodes?.[1]).toEqual({
      nodeId: "node-review",
      position: {
        x: 360,
        y: 120,
      },
    });

    const detailAfterPatchResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`);
    const detailAfterPatchPayload = await detailAfterPatchResponse.json();
    expect(detailAfterPatchResponse.status).toBe(200);
    expect(detailAfterPatchPayload.workflow.editor).toEqual(patchPayload.workflow.editor);

    const listResponse = await fetch(`${app.baseUrl}/api/workflows`);
    const listPayload = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listPayload.items).toHaveLength(1);
    expect(listPayload.items[0].id).toBe(workflowId);
    expect(listPayload.items[0].status).toBe("active");
    expect(listPayload.items[0].nodeCount).toBe(3);
    expect(listPayload.items[0].edgeCount).toBe(2);
  });

  it("rejects invalid workflow definition patches", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createResponse = await fetch(`${app.baseUrl}/api/workflows`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Weekly Review",
        description: "Weekly workflow",
      }),
    });
    const createPayload = await createResponse.json();
    const workflowId = createPayload.workflow.id as string;

    const detailBeforeResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`);
    const detailBeforePayload = await detailBeforeResponse.json();

    const invalidPatchResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        nodes: {
          not: "an-array",
        },
      }),
    });
    const invalidPatchPayload = await invalidPatchResponse.json();

    expect(invalidPatchResponse.status).toBe(400);
    expect(invalidPatchPayload.error).toBe("invalid_workflow_payload");

    const detailAfterResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`);
    const detailAfterPayload = await detailAfterResponse.json();
    expect(detailAfterResponse.status).toBe(200);
    expect(detailAfterPayload.workflow.version).toBe(detailBeforePayload.workflow.version);
    expect(detailAfterPayload.workflow.updatedAt).toBe(detailBeforePayload.workflow.updatedAt);
    expect(detailAfterPayload.workflow.nodes).toEqual(detailBeforePayload.workflow.nodes);
  });

  it("rejects condition nodes that do not provide rule semantics", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createResponse = await fetch(`${app.baseUrl}/api/workflows`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Condition Validation",
        description: "Condition node must have explicit rule semantics",
      }),
    });
    const createPayload = await createResponse.json();
    const workflowId = createPayload.workflow.id as string;

    const invalidPatchResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        entryNodeId: "node-start",
        nodes: [
          { id: "node-start", kind: "start", label: "Start" },
          { id: "node-condition", kind: "condition", label: "Condition" },
          { id: "node-end", kind: "end", label: "End" },
        ],
        edges: [
          { id: "edge-start-condition", fromNodeId: "node-start", toNodeId: "node-condition", kind: "normal" },
          { id: "edge-condition-end", fromNodeId: "node-condition", toNodeId: "node-end", kind: "normal" },
        ],
        stateSchema: [],
      }),
    });
    const invalidPatchPayload = await invalidPatchResponse.json();

    expect(invalidPatchResponse.status).toBe(400);
    expect(invalidPatchPayload.error).toBe("invalid_workflow_payload");
    expect(invalidPatchPayload.detail).toBe("condition_node_rule_required");
  });

  it("rejects malformed defaults and policy patch payloads without persisting", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createResponse = await fetch(`${app.baseUrl}/api/workflows`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Policy Guard",
        description: "Policy payload must be validated",
      }),
    });
    const createPayload = await createResponse.json();
    const workflowId = createPayload.workflow.id as string;

    const detailBeforeResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`);
    const detailBeforePayload = await detailBeforeResponse.json();

    const invalidPatchResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        defaults: {
          run: {
            maxParallelNodes: -5,
            checkpointPolicy: "sometimes",
          },
          nodePolicy: {
            retry: {
              maxAttempts: "3",
              backoffMs: 100,
            },
          },
        },
      }),
    });
    const invalidPatchPayload = await invalidPatchResponse.json();
    expect(invalidPatchResponse.status).toBe(400);
    expect(invalidPatchPayload.error).toBe("invalid_workflow_payload");

    const detailAfterResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`);
    const detailAfterPayload = await detailAfterResponse.json();
    expect(detailAfterResponse.status).toBe(200);
    expect(detailAfterPayload.workflow.version).toBe(detailBeforePayload.workflow.version);
    expect(detailAfterPayload.workflow.updatedAt).toBe(detailBeforePayload.workflow.updatedAt);
    expect(detailAfterPayload.workflow.defaults).toEqual(detailBeforePayload.workflow.defaults);
  });

  it("rejects invalid editor canvas patch payloads without persisting", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createResponse = await fetch(`${app.baseUrl}/api/workflows`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Editor Validation",
        description: "Editor canvas payload must be validated",
      }),
    });
    const createPayload = await createResponse.json();
    const workflowId = createPayload.workflow.id as string;

    const detailBeforeResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`);
    const detailBeforePayload = await detailBeforeResponse.json();
    const existingNodeId = detailBeforePayload.workflow.nodes[0].id as string;

    const invalidPatchResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        editor: {
          canvas: {
            viewport: {
              offsetX: 0,
              offsetY: 0,
            },
            nodes: [
              {
                nodeId: existingNodeId,
                position: {
                  x: 100,
                  y: 100,
                },
              },
              {
                nodeId: existingNodeId,
                position: {
                  x: 300,
                  y: 100,
                },
              },
            ],
          },
        },
      }),
    });
    const invalidPatchPayload = await invalidPatchResponse.json();
    expect(invalidPatchResponse.status).toBe(400);
    expect(invalidPatchPayload.error).toBe("invalid_workflow_payload");
    expect(invalidPatchPayload.detail).toBe("editor_canvas_duplicate_node_id");

    const detailAfterResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`);
    const detailAfterPayload = await detailAfterResponse.json();
    expect(detailAfterResponse.status).toBe(200);
    expect(detailAfterPayload.workflow.version).toBe(detailBeforePayload.workflow.version);
    expect(detailAfterPayload.workflow.editor).toEqual(detailBeforePayload.workflow.editor);
  });

  it("fails fast when workflow definition file is corrupted", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createResponse = await fetch(`${app.baseUrl}/api/workflows`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Corrupt Definition",
        description: "Corrupt file should fail fast",
      }),
    });
    const createPayload = await createResponse.json();
    const workflowId = createPayload.workflow.id as string;
    const definitionFilePath = join(
      tempDir as string,
      "workflows",
      "roots",
      "personal",
      workflowId,
      "definition.json",
    );
    writeFileSync(definitionFilePath, "{invalid-json", "utf8");

    const getResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`);
    const getPayload = await getResponse.json();
    expect(getResponse.status).toBe(500);
    expect(getPayload.error).toBe("workflow_definition_load_failed");

    const patchResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        status: "active",
      }),
    });
    const patchPayload = await patchResponse.json();
    expect(patchResponse.status).toBe(500);
    expect(patchPayload.error).toBe("workflow_definition_load_failed");
    expect(readFileSync(definitionFilePath, "utf8")).toBe("{invalid-json");
  });

  it("fails fast when workflow definition file is semantically invalid", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createResponse = await fetch(`${app.baseUrl}/api/workflows`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Invalid Policy Definition",
        description: "Semantic validation should fail fast",
      }),
    });
    const createPayload = await createResponse.json();
    const workflowId = createPayload.workflow.id as string;
    const definitionFilePath = join(
      tempDir as string,
      "workflows",
      "roots",
      "personal",
      workflowId,
      "definition.json",
    );
    const invalidDefinition = {
      ...createPayload.workflow,
      nodes: [
        {
          id: "node-start",
          kind: "start",
          label: "Start",
          policy: {
            onFailure: {
              mode: "route",
            },
          },
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
      entryNodeId: "node-start",
      nodeCount: 2,
      edgeCount: 1,
    };
    writeFileSync(definitionFilePath, JSON.stringify(invalidDefinition, null, 2), "utf8");

    const getResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`);
    const getPayload = await getResponse.json();
    expect(getResponse.status).toBe(500);
    expect(getPayload.error).toBe("workflow_definition_load_failed");

    const patchResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        status: "active",
      }),
    });
    const patchPayload = await patchResponse.json();
    expect(patchResponse.status).toBe(500);
    expect(patchPayload.error).toBe("workflow_definition_load_failed");
    expect(JSON.parse(readFileSync(definitionFilePath, "utf8"))).toEqual(invalidDefinition);
  });

  it("does not backfill a missing definition file on get/patch", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createResponse = await fetch(`${app.baseUrl}/api/workflows`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Missing Definition",
        description: "Missing file should fail fast",
      }),
    });
    const createPayload = await createResponse.json();
    const workflowId = createPayload.workflow.id as string;
    const definitionFilePath = join(
      tempDir as string,
      "workflows",
      "roots",
      "personal",
      workflowId,
      "definition.json",
    );
    unlinkSync(definitionFilePath);
    expect(existsSync(definitionFilePath)).toBe(false);

    const getResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`);
    const getPayload = await getResponse.json();
    expect(getResponse.status).toBe(500);
    expect(getPayload.error).toBe("workflow_definition_load_failed");
    expect(existsSync(definitionFilePath)).toBe(false);

    const patchResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        status: "active",
      }),
    });
    const patchPayload = await patchResponse.json();
    expect(patchResponse.status).toBe(500);
    expect(patchPayload.error).toBe("workflow_definition_load_failed");
    expect(existsSync(definitionFilePath)).toBe(false);
  });
});
