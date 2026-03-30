import { describe, expect, it } from "vitest";

import { WorkflowCheckpointStore } from "./workflow-checkpoint-store";
import {
  WorkflowGraphExecutor,
  type WorkflowGraphDefinition,
  type WorkflowNodeHandlerMap,
} from "./workflow-graph-executor";

function createStore() {
  return new WorkflowCheckpointStore({
    now: () => "2026-03-24T00:00:00.000Z",
    storageDir: undefined,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  });
}

function createExecutor(store: WorkflowCheckpointStore, handlers: WorkflowNodeHandlerMap) {
  return new WorkflowGraphExecutor({
    store,
    handlers,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  });
}

describe("workflow graph executor", () => {
  it("create path starts at a start node (entry node must be start)", async () => {
    const store = createStore();
    const executor = createExecutor(store, {
      "node-task": async (input) => ({ ...input.state, ok: true }),
    });

    const definition: WorkflowGraphDefinition = {
      id: "graph-entry-not-start",
      entryNodeId: "node-task",
      nodes: [
        { id: "node-task", kind: "task", label: "Task" },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [{ id: "edge-task-end", fromNodeId: "node-task", toNodeId: "node-end", kind: "normal" }],
    };

    const run = store.createRun({ definitionId: definition.id, initialState: {} });
    const result = await executor.run({ runId: run.id, definition });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toContain("entry_node_not_start");
    }
  });

  it("run starts at start and ends at end", async () => {
    const store = createStore();
    const handlers: WorkflowNodeHandlerMap = {
      "node-task": async (input) => ({ ...input.state, result: "ok" }),
    };
    const executor = createExecutor(store, handlers);

    const definition: WorkflowGraphDefinition = {
      id: "graph-start-end",
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-task", kind: "task", label: "Task" },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [
        { id: "edge-start-task", fromNodeId: "node-start", toNodeId: "node-task", kind: "normal" },
        { id: "edge-task-end", fromNodeId: "node-task", toNodeId: "node-end", kind: "normal" },
      ],
    };

    const run = store.createRun({ definitionId: definition.id, initialState: { started: true } });
    const result = await executor.run({ runId: run.id, definition });

    expect(result.status).toBe("succeeded");
    expect(result.state.result).toBe("ok");
  });

  it("condition routes by current state", async () => {
    const store = createStore();
    const seen: string[] = [];
    const handlers: WorkflowNodeHandlerMap = {
      "node-a": async (input) => {
        seen.push("a");
        return { ...input.state, path: "a" };
      },
      "node-b": async (input) => {
        seen.push("b");
        return { ...input.state, path: "b" };
      },
    };
    const executor = createExecutor(store, handlers);

    const definition: WorkflowGraphDefinition = {
      id: "graph-condition",
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-cond", kind: "condition", label: "Cond", condition: { operator: "equals", leftPath: "flag", rightValue: true } },
        { id: "node-a", kind: "task", label: "A" },
        { id: "node-b", kind: "task", label: "B" },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [
        { id: "edge-start-cond", fromNodeId: "node-start", toNodeId: "node-cond", kind: "normal" },
        { id: "edge-cond-a", fromNodeId: "node-cond", toNodeId: "node-a", kind: "conditional", condition: { operator: "equals", leftPath: "flag", rightValue: true } },
        { id: "edge-cond-b", fromNodeId: "node-cond", toNodeId: "node-b", kind: "conditional", condition: { operator: "equals", leftPath: "flag", rightValue: false } },
        { id: "edge-a-end", fromNodeId: "node-a", toNodeId: "node-end", kind: "normal" },
        { id: "edge-b-end", fromNodeId: "node-b", toNodeId: "node-end", kind: "normal" },
      ],
    };

    const run = store.createRun({ definitionId: definition.id, initialState: { flag: false } });
    const result = await executor.run({ runId: run.id, definition });

    expect(result.status).toBe("succeeded");
    expect(seen).toEqual(["b"]);
    expect(result.state.path).toBe("b");
  });

  it("parallel fan-out waits on explicit join", async () => {
    const store = createStore();
    const order: string[] = [];
    const handlers: WorkflowNodeHandlerMap = {
      "node-left": async (input) => {
        order.push("left");
        return { ...input.state, left: true };
      },
      "node-right": async (input) => {
        order.push("right");
        return { ...input.state, right: true };
      },
      "node-after-join": async (input) => {
        order.push("after-join");
        return { ...input.state, after: true };
      },
    };
    const executor = createExecutor(store, handlers);

    const definition: WorkflowGraphDefinition = {
      id: "graph-parallel-join",
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-left", kind: "task", label: "Left" },
        { id: "node-right", kind: "task", label: "Right" },
        { id: "node-join", kind: "join", label: "Join", join: { upstreamNodeIds: ["node-left", "node-right"] } },
        { id: "node-after-join", kind: "task", label: "AfterJoin" },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [
        { id: "edge-start-left", fromNodeId: "node-start", toNodeId: "node-left", kind: "parallel" },
        { id: "edge-start-right", fromNodeId: "node-start", toNodeId: "node-right", kind: "parallel" },
        { id: "edge-left-join", fromNodeId: "node-left", toNodeId: "node-join", kind: "normal" },
        { id: "edge-right-join", fromNodeId: "node-right", toNodeId: "node-join", kind: "normal" },
        { id: "edge-join-after", fromNodeId: "node-join", toNodeId: "node-after-join", kind: "normal" },
        { id: "edge-after-end", fromNodeId: "node-after-join", toNodeId: "node-end", kind: "normal" },
      ],
    };

    const run = store.createRun({ definitionId: definition.id, initialState: {} });
    const result = await executor.run({ runId: run.id, definition });

    expect(result.status).toBe("succeeded");
    expect(order).toEqual(["left", "right", "after-join"]);
  });

  it("field-level merge strategies apply at join", async () => {
    const store = createStore();
    const handlers: WorkflowNodeHandlerMap = {
      "node-left": async (input) => ({ ...input.state, tags: ["a"], profile: { name: "left" } }),
      "node-right": async (input) => ({ ...input.state, tags: ["b"], profile: { age: 1 } }),
    };
    const executor = createExecutor(store, handlers);

    const definition: WorkflowGraphDefinition = {
      id: "graph-merge",
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-left", kind: "task", label: "Left" },
        { id: "node-right", kind: "task", label: "Right" },
        {
          id: "node-join",
          kind: "join",
          label: "Join",
          join: {
            upstreamNodeIds: ["node-left", "node-right"],
            mergeStrategyOverrides: {
              tags: "union",
              profile: "object-merge",
            },
          },
        },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [
        { id: "edge-start-left", fromNodeId: "node-start", toNodeId: "node-left", kind: "parallel" },
        { id: "edge-start-right", fromNodeId: "node-start", toNodeId: "node-right", kind: "parallel" },
        { id: "edge-left-join", fromNodeId: "node-left", toNodeId: "node-join", kind: "normal" },
        { id: "edge-right-join", fromNodeId: "node-right", toNodeId: "node-join", kind: "normal" },
        { id: "edge-join-end", fromNodeId: "node-join", toNodeId: "node-end", kind: "normal" },
      ],
    };

    const run = store.createRun({ definitionId: definition.id, initialState: { tags: [] } });
    const result = await executor.run({ runId: run.id, definition });

    expect(result.status).toBe("succeeded");
    expect(result.state.tags).toEqual(["a", "b"]);
    expect(result.state.profile).toEqual({ name: "left", age: 1 });
  });

  it("node retry policy increments attempts and creates checkpoints", async () => {
    const store = createStore();
    let attempts = 0;
    const handlers: WorkflowNodeHandlerMap = {
      "node-flaky": async (input) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("boom");
        }
        return { ...input.state, ok: true };
      },
    };
    const executor = createExecutor(store, handlers);

    const definition: WorkflowGraphDefinition = {
      id: "graph-retry",
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-flaky", kind: "task", label: "Flaky", policy: { retry: { maxAttempts: 2 } } },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [
        { id: "edge-start-flaky", fromNodeId: "node-start", toNodeId: "node-flaky", kind: "normal" },
        { id: "edge-flaky-end", fromNodeId: "node-flaky", toNodeId: "node-end", kind: "normal" },
      ],
    };

    const run = store.createRun({ definitionId: definition.id, initialState: {} });
    const result = await executor.run({ runId: run.id, definition });
    const checkpoints = store.listCheckpoints(run.id).filter((cp) => cp.nodeId === "node-flaky");
    const nodeCompleteCheckpoints = checkpoints.filter((cp) => cp.status === "node-complete");

    expect(result.status).toBe("succeeded");
    expect(attempts).toBe(2);
    expect(result.attempts["node-flaky"]).toBe(2);
    expect(checkpoints.length).toBeGreaterThanOrEqual(2);
    expect(nodeCompleteCheckpoints).toHaveLength(1);
  });

  it("retry scheduler metadata is recorded when a retry is scheduled", async () => {
    const store = createStore();
    let attempts = 0;
    const handlers: WorkflowNodeHandlerMap = {
      "node-flaky": async (input) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("boom");
        }
        return { ...input.state, ok: true };
      },
    };
    const executor = createExecutor(store, handlers);

    const definition: WorkflowGraphDefinition = {
      id: "graph-retry-meta",
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-flaky", kind: "task", label: "Flaky", policy: { retry: { maxAttempts: 2, backoffMs: 1000 } } },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [
        { id: "edge-start-flaky", fromNodeId: "node-start", toNodeId: "node-flaky", kind: "normal" },
        { id: "edge-flaky-end", fromNodeId: "node-flaky", toNodeId: "node-end", kind: "normal" },
      ],
    };

    const run = store.createRun({ definitionId: definition.id, initialState: {} });
    const result = await executor.run({ runId: run.id, definition });

    expect(result.status).toBe("succeeded");
    const retryScheduled = store
      .listCheckpoints(run.id)
      .find((cp) => cp.nodeId === "node-flaky" && cp.status === "retry-scheduled");
    expect(retryScheduled?.retryAt).toBe("2026-03-24T00:00:01.000Z");
  });

  it("explicit join enforces join.upstreamNodeIds (missing upstream fails)", async () => {
    const store = createStore();
    const executor = createExecutor(store, {
      "node-left": async (input) => ({ ...input.state, left: true }),
      "node-right": async (input) => ({ ...input.state, right: true }),
    });

    const definition: WorkflowGraphDefinition = {
      id: "graph-join-enforce",
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        { id: "node-left", kind: "task", label: "Left" },
        { id: "node-right", kind: "task", label: "Right" },
        { id: "node-join", kind: "join", label: "Join", join: { upstreamNodeIds: ["node-left"] } },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [
        { id: "edge-start-left", fromNodeId: "node-start", toNodeId: "node-left", kind: "parallel" },
        { id: "edge-start-right", fromNodeId: "node-start", toNodeId: "node-right", kind: "parallel" },
        { id: "edge-left-join", fromNodeId: "node-left", toNodeId: "node-join", kind: "normal" },
        { id: "edge-right-join", fromNodeId: "node-right", toNodeId: "node-join", kind: "normal" },
        { id: "edge-join-end", fromNodeId: "node-join", toNodeId: "node-end", kind: "normal" },
      ],
    };

    const run = store.createRun({ definitionId: definition.id, initialState: {} });
    const result = await executor.run({ runId: run.id, definition });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toContain("join_upstream_missing");
    }
  });

  it("human-input pauses run and resumes from checkpoint", async () => {
    const store = createStore();
    const executor = createExecutor(store, {});

    const definition: WorkflowGraphDefinition = {
      id: "graph-human",
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
    };

    const run = store.createRun({ definitionId: definition.id, initialState: {} });
    const paused = await executor.run({ runId: run.id, definition });

    expect(paused.status).toBe("paused");
    if (paused.status === "paused") {
      expect(paused.pausedAtNodeId).toBe("node-human");
    }
    const latest = store.getLatestCheckpoint(run.id);
    expect(latest?.status).toBe("waiting-human-input");

    const resumed = await executor.resume({
      runId: run.id,
      definition,
      input: { answer: "yes" },
    });

    expect(resumed.status).toBe("succeeded");
    expect(resumed.state.answer).toBe("yes");
  });

  it("condition node supports inline condition route config", async () => {
    const store = createStore();
    const executor = createExecutor(store, {});

    const definition: WorkflowGraphDefinition = {
      id: "graph-condition-route",
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        {
          id: "node-condition",
          kind: "condition",
          label: "Decide",
          condition: { operator: "greater-than", leftPath: "score", rightValue: 80 },
          route: { trueNodeId: "node-pass", falseNodeId: "node-fail" },
        },
        { id: "node-pass", kind: "end", label: "Pass" },
        { id: "node-fail", kind: "end", label: "Fail" },
      ],
      edges: [
        { id: "edge-start-condition", fromNodeId: "node-start", toNodeId: "node-condition", kind: "normal" },
        { id: "edge-condition-pass", fromNodeId: "node-condition", toNodeId: "node-pass", kind: "normal" },
        { id: "edge-condition-fail", fromNodeId: "node-condition", toNodeId: "node-fail", kind: "normal" },
      ],
    };

    const run = store.createRun({ definitionId: definition.id, initialState: { score: 90 } });
    const result = await executor.run({ runId: run.id, definition });

    expect(result.status).toBe("succeeded");
    const latestCheckpoint = store.getLatestCheckpoint(run.id);
    expect(latestCheckpoint?.nodeId).toBe("node-pass");
  });

  it("llm/tool/subgraph nodes execute as typed executable nodes instead of task-only mode", async () => {
    const store = createStore();
    const executor = createExecutor(store, {});

    const definition: WorkflowGraphDefinition = {
      id: "graph-typed-exec",
      entryNodeId: "node-start",
      nodes: [
        { id: "node-start", kind: "start", label: "Start" },
        {
          id: "node-llm",
          kind: "llm",
          label: "LLM",
          llm: { prompt: "Summarize.", outputKey: "llmDraft" },
        },
        {
          id: "node-tool",
          kind: "tool",
          label: "Tool",
          tool: { toolId: "fs.read", outputKey: "toolResult" },
        },
        {
          id: "node-subgraph",
          kind: "subgraph",
          label: "Subgraph",
          subgraph: { workflowId: "wf-child", outputKey: "subgraphResult" },
        },
        { id: "node-end", kind: "end", label: "End" },
      ],
      edges: [
        { id: "edge-start-llm", fromNodeId: "node-start", toNodeId: "node-llm", kind: "normal" },
        { id: "edge-llm-tool", fromNodeId: "node-llm", toNodeId: "node-tool", kind: "normal" },
        { id: "edge-tool-subgraph", fromNodeId: "node-tool", toNodeId: "node-subgraph", kind: "normal" },
        { id: "edge-subgraph-end", fromNodeId: "node-subgraph", toNodeId: "node-end", kind: "normal" },
      ],
    };

    const run = store.createRun({ definitionId: definition.id, initialState: {} });
    const result = await executor.run({ runId: run.id, definition });

    expect(result.status).toBe("succeeded");
    expect(result.state.llmDraft).toContain("llm");
    expect(result.state.toolResult).toContain("tool");
    expect(result.state.subgraphResult).toContain("subgraph");
  });
});
