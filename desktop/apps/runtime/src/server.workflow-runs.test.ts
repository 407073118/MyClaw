import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRuntimeApp } from "./server";

describe("runtime server workflow runs", () => {
  let dispose: (() => Promise<void>) | undefined;
  let tempDir: string | undefined;
  let stateFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-workflow-runs-"));
    stateFilePath = join(tempDir, "runtime-state.json");
  });

  afterEach(async () => {
    await dispose?.();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("creates a run, allows inspection, then resumes from checkpoint", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createResponse = await fetch(`${app.baseUrl}/api/workflow-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        definition: {
          id: "graph-human-api",
          entryNodeId: "node-start",
          nodes: [
            { id: "node-start", kind: "start", label: "Start" },
            { id: "node-human", kind: "human-input", label: "Human", humanInput: { field: "answer" } },
            { id: "node-end", kind: "end", label: "End" },
          ],
          edges: [
            { id: "edge-start-human", fromNodeId: "node-start", toNodeId: "node-human", kind: "normal" },
            { id: "edge-human-end", fromNodeId: "node-human", toNodeId: "node-end", kind: "normal" },
          ],
        },
        initialState: {},
      }),
    });
    const createPayload = await createResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createPayload.run.status).toBe("waiting-input");
    expect(createPayload.run.currentNodeIds).toEqual(["node-human"]);

    const inspectResponse = await fetch(`${app.baseUrl}/api/workflow-runs/${createPayload.run.id}`);
    const inspectPayload = await inspectResponse.json();
    expect(inspectResponse.status).toBe(200);
    expect(inspectPayload.run.status).toBe("waiting-input");

    const resumeResponse = await fetch(`${app.baseUrl}/api/workflow-runs/${createPayload.run.id}/resume`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: { answer: "yes" },
      }),
    });
    const resumePayload = await resumeResponse.json();

    expect(resumeResponse.status).toBe(200);
    expect(resumePayload.run.status).toBe("succeeded");
    expect(resumePayload.run.state.answer).toBe("yes");
  });

  it("lists runs through GET /api/workflow-runs", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createResponse = await fetch(`${app.baseUrl}/api/workflow-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        definition: {
          id: "graph-list",
          entryNodeId: "node-start",
          nodes: [
            { id: "node-start", kind: "start", label: "Start" },
            { id: "node-end", kind: "end", label: "End" },
          ],
          edges: [{ id: "edge-start-end", fromNodeId: "node-start", toNodeId: "node-end", kind: "normal" }],
        },
        initialState: {},
      }),
    });
    const createPayload = await createResponse.json();

    const listResponse = await fetch(`${app.baseUrl}/api/workflow-runs`);
    const listPayload = await listResponse.json();

    expect(createResponse.status).toBe(201);
    expect(listResponse.status).toBe(200);
    expect(listPayload.items.some((run: { id: string }) => run.id === createPayload.run.id)).toBe(true);
  });

  it("rejects definitions whose entryNodeId is not a start node", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/workflow-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        definition: {
          id: "graph-bad-entry",
          entryNodeId: "node-human",
          nodes: [
            { id: "node-human", kind: "human-input", label: "Human", humanInput: { field: "answer" } },
            { id: "node-end", kind: "end", label: "End" },
          ],
          edges: [{ id: "edge-human-end", fromNodeId: "node-human", toNodeId: "node-end", kind: "normal" }],
        },
        initialState: {},
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe("invalid_workflow_run_payload");
  });

  it("runs stored workflow definitions (workflowId) with typed node semantics preserved", async () => {
    const app = await createRuntimeApp({ port: 0, stateFilePath });
    dispose = app.close;

    const createWorkflowResponse = await fetch(`${app.baseUrl}/api/workflows`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Runnable Workflow",
        description: "Includes llm/tool/subgraph nodes and still runs deterministically.",
      }),
    });
    const createWorkflowPayload = await createWorkflowResponse.json();

    const workflowId = createWorkflowPayload.workflow.id as string;

    const patchResponse = await fetch(`${app.baseUrl}/api/workflows/${workflowId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entryNodeId: "node-start",
        nodes: [
          { id: "node-start", kind: "start", label: "Start" },
          { id: "node-condition", kind: "condition", label: "Condition", condition: { operator: "equals", leftPath: "allow", rightValue: true }, route: { trueNodeId: "node-llm", falseNodeId: "node-end" } },
          { id: "node-llm", kind: "llm", label: "LLM", llm: { prompt: "Say hi", outputKey: "llmOutput" } },
          { id: "node-tool", kind: "tool", label: "Tool", tool: { toolId: "fs.list", outputKey: "toolOutput" } },
          { id: "node-subgraph", kind: "subgraph", label: "Subgraph", subgraph: { workflowId: "wf-child", outputKey: "subgraphOutput" } },
          { id: "node-end", kind: "end", label: "End" },
        ],
        edges: [
          { id: "edge-start-condition", fromNodeId: "node-start", toNodeId: "node-condition", kind: "normal" },
          { id: "edge-condition-llm", fromNodeId: "node-condition", toNodeId: "node-llm", kind: "normal" },
          { id: "edge-condition-end", fromNodeId: "node-condition", toNodeId: "node-end", kind: "normal" },
          { id: "edge-llm-tool", fromNodeId: "node-llm", toNodeId: "node-tool", kind: "normal" },
          { id: "edge-tool-subgraph", fromNodeId: "node-tool", toNodeId: "node-subgraph", kind: "normal" },
          { id: "edge-subgraph-end", fromNodeId: "node-subgraph", toNodeId: "node-end", kind: "normal" },
        ],
        stateSchema: [],
      }),
    });
    const patchPayload = await patchResponse.json();

    expect(createWorkflowResponse.status).toBe(201);
    expect(patchResponse.status).toBe(200);
    expect(patchPayload.workflow.id).toBe(workflowId);

    const runResponse = await fetch(`${app.baseUrl}/api/workflow-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflowId, initialState: { allow: true } }),
    });
    const runPayload = await runResponse.json();

    expect(runResponse.status).toBe(201);
    expect(runPayload.run.workflowId).toBe(workflowId);
    expect(runPayload.run.status).toBe("succeeded");
    expect(runPayload.run.state.llmOutput).toContain("llm");
    expect(runPayload.run.state.toolOutput).toContain("tool");
    expect(runPayload.run.state.subgraphOutput).toContain("subgraph");
  });
});
