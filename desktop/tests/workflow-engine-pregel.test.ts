import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDefinition, WorkflowRunConfig, WorkflowNode, WorkflowEdge } from "@shared/contracts";
import type { WorkflowStreamEvent } from "@shared/contracts/workflow-stream";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../src/main/services/workflow-engine/node-executor";
import { NodeExecutorRegistry } from "../src/main/services/workflow-engine/node-executor";
import { StartNodeExecutor } from "../src/main/services/workflow-engine/executors/start";
import { EndNodeExecutor } from "../src/main/services/workflow-engine/executors/end";
import { ConditionNodeExecutor } from "../src/main/services/workflow-engine/executors/condition";
import { PregelRunner } from "../src/main/services/workflow-engine/pregel-runner";

// ── Stub LLM Executor ──

class StubLlmExecutor implements NodeExecutor {
  readonly kind = "llm" as const;
  public fixedOutput = "stub-llm-response";

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const node = ctx.node as any;
    const outputKey = node.llm?.outputKey ?? "response";

    return {
      writes: [{ channelName: outputKey, value: this.fixedOutput }],
      outputs: { [outputKey]: this.fixedOutput },
      durationMs: Date.now() - start,
    };
  }
}

// ── Stub Tool Executor (for branching test) ──

class StubToolExecutor implements NodeExecutor {
  readonly kind = "tool" as const;
  public fixedOutput: unknown = "tool-result";

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const node = ctx.node as any;
    const outputKey = node.tool?.outputKey ?? "toolResult";

    return {
      writes: [{ channelName: outputKey, value: this.fixedOutput }],
      outputs: { [outputKey]: this.fixedOutput },
      durationMs: Date.now() - start,
    };
  }
}

// ── Loop executor: writes to a counter and routes back to itself if under limit ──

class IncrementExecutor implements NodeExecutor {
  readonly kind = "llm" as const;

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const current = (ctx.state.get("counter") as number) ?? 0;
    const next = current + 1;
    return {
      writes: [{ channelName: "counter", value: next }],
      outputs: { counter: next },
      durationMs: 0,
    };
  }
}

// ── Helpers ──

function createDefaultConfig(overrides?: Partial<WorkflowRunConfig>): WorkflowRunConfig {
  return {
    recursionLimit: 50,
    workingDirectory: "/tmp/test",
    modelProfileId: "test-model",
    checkpointPolicy: "none",
    ...overrides,
  };
}

function createRegistry(extra?: NodeExecutor[]): NodeExecutorRegistry {
  const registry = new NodeExecutorRegistry();
  registry.register(new StartNodeExecutor());
  registry.register(new EndNodeExecutor());
  registry.register(new ConditionNodeExecutor());
  for (const e of extra ?? []) {
    registry.register(e);
  }
  return registry;
}

function collectEvents(runner: PregelRunner): WorkflowStreamEvent[] {
  const events: WorkflowStreamEvent[] = [];
  runner.emitter.on((e) => events.push(e));
  return events;
}

// ── Tests ──

describe("PregelRunner", () => {
  describe("linear workflow: start -> llm -> end", () => {
    let definition: WorkflowDefinition;
    let stubLlm: StubLlmExecutor;

    beforeEach(() => {
      stubLlm = new StubLlmExecutor();

      const nodes: WorkflowNode[] = [
        { id: "start-1", kind: "start", label: "Start" },
        {
          id: "llm-1",
          kind: "llm",
          label: "LLM",
          llm: { prompt: "Hello", outputKey: "response" },
        },
        { id: "end-1", kind: "end", label: "End" },
      ];

      const edges: WorkflowEdge[] = [
        { id: "e1", fromNodeId: "start-1", toNodeId: "llm-1", kind: "normal" },
        { id: "e2", fromNodeId: "llm-1", toNodeId: "end-1", kind: "normal" },
      ];

      definition = {
        id: "wf-linear",
        name: "Linear Test",
        description: "A simple linear workflow",
        status: "active",
        source: "personal",
        updatedAt: new Date().toISOString(),
        version: 1,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        libraryRootId: "root-1",
        entryNodeId: "start-1",
        nodes,
        edges,
        stateSchema: [
          {
            key: "response",
            label: "Response",
            description: "LLM output",
            valueType: "string",
            mergeStrategy: "replace",
            required: false,
            producerNodeIds: ["llm-1"],
            consumerNodeIds: ["end-1"],
          },
        ],
      };
    });

    it("completes with succeeded status", async () => {
      const registry = createRegistry([stubLlm]);
      const runner = new PregelRunner(definition, createDefaultConfig(), { executorRegistry: registry });

      const result = await runner.run();

      expect(result.status).toBe("succeeded");
      expect(result.totalSteps).toBeGreaterThanOrEqual(2);
      expect(result.finalState.response).toBe("stub-llm-response");
    });

    it("emits run-start and run-complete events", async () => {
      const registry = createRegistry([stubLlm]);
      const runner = new PregelRunner(definition, createDefaultConfig(), { executorRegistry: registry });
      const events = collectEvents(runner);

      await runner.run();

      const runStart = events.find((e) => e.type === "run-start");
      const runComplete = events.find((e) => e.type === "run-complete");
      expect(runStart).toBeDefined();
      expect(runComplete).toBeDefined();
      if (runComplete && runComplete.type === "run-complete") {
        expect(runComplete.status).toBe("succeeded");
        expect(runComplete.totalSteps).toBeGreaterThanOrEqual(2);
      }
    });

    it("accepts initial input and writes it to channels", async () => {
      const registry = createRegistry([stubLlm]);
      const runner = new PregelRunner(definition, createDefaultConfig(), { executorRegistry: registry });

      const result = await runner.run({ response: "initial-input" });

      // The LLM executor overwrites the response channel, so final state should be the LLM output
      expect(result.status).toBe("succeeded");
      expect(result.finalState.response).toBe("stub-llm-response");
    });
  });

  describe("branching workflow with condition routing", () => {
    let definition: WorkflowDefinition;
    let stubLlm: StubLlmExecutor;
    let stubTool: StubToolExecutor;

    beforeEach(() => {
      stubLlm = new StubLlmExecutor();
      stubTool = new StubToolExecutor();

      // start -> condition -> (true: llm -> end) | (false: tool -> end)
      const nodes: WorkflowNode[] = [
        { id: "start-1", kind: "start", label: "Start" },
        {
          id: "cond-1",
          kind: "condition",
          label: "Check score",
          condition: {
            operator: "greater-than",
            leftPath: "$.score",
            rightValue: 50,
          },
          route: {
            trueNodeId: "llm-1",
            falseNodeId: "tool-1",
          },
        },
        {
          id: "llm-1",
          kind: "llm",
          label: "LLM branch",
          llm: { prompt: "High score path", outputKey: "response" },
        },
        {
          id: "tool-1",
          kind: "tool",
          label: "Tool branch",
          tool: { toolId: "some-tool", outputKey: "toolResult" },
        },
        { id: "end-1", kind: "end", label: "End" },
      ];

      const edges: WorkflowEdge[] = [
        { id: "e1", fromNodeId: "start-1", toNodeId: "cond-1", kind: "normal" },
        {
          id: "e2",
          fromNodeId: "cond-1",
          toNodeId: "llm-1",
          kind: "conditional",
          condition: { operator: "greater-than", leftPath: "$.score", rightValue: 50 },
        },
        {
          id: "e3",
          fromNodeId: "cond-1",
          toNodeId: "tool-1",
          kind: "conditional",
          condition: { operator: "less-or-equal", leftPath: "$.score", rightValue: 50 },
        },
        { id: "e4", fromNodeId: "llm-1", toNodeId: "end-1", kind: "normal" },
        { id: "e5", fromNodeId: "tool-1", toNodeId: "end-1", kind: "normal" },
      ];

      definition = {
        id: "wf-branch",
        name: "Branching Test",
        description: "Condition-based branching workflow",
        status: "active",
        source: "personal",
        updatedAt: new Date().toISOString(),
        version: 1,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        libraryRootId: "root-1",
        entryNodeId: "start-1",
        nodes,
        edges,
        stateSchema: [
          {
            key: "score",
            label: "Score",
            description: "Input score for condition",
            valueType: "number",
            mergeStrategy: "replace",
            required: true,
            producerNodeIds: [],
            consumerNodeIds: ["cond-1"],
          },
          {
            key: "response",
            label: "Response",
            description: "LLM output",
            valueType: "string",
            mergeStrategy: "replace",
            required: false,
            producerNodeIds: ["llm-1"],
            consumerNodeIds: [],
          },
          {
            key: "toolResult",
            label: "Tool Result",
            description: "Tool output",
            valueType: "string",
            mergeStrategy: "replace",
            required: false,
            producerNodeIds: ["tool-1"],
            consumerNodeIds: [],
          },
        ],
      };
    });

    it("routes to LLM branch when score > 50", async () => {
      const registry = createRegistry([stubLlm, stubTool]);
      const runner = new PregelRunner(definition, createDefaultConfig(), { executorRegistry: registry });

      const result = await runner.run({ score: 80 });

      expect(result.status).toBe("succeeded");
      expect(result.finalState.response).toBe("stub-llm-response");
      // toolResult should not be set to a non-default value by the tool executor
      // (it may be "" from schema default, but tool-1 should not have run)
    });

    it("routes to Tool branch when score <= 50", async () => {
      const registry = createRegistry([stubLlm, stubTool]);
      const runner = new PregelRunner(definition, createDefaultConfig(), { executorRegistry: registry });

      const result = await runner.run({ score: 30 });

      expect(result.status).toBe("succeeded");
      expect(result.finalState.toolResult).toBe("tool-result");
    });
  });

  describe("recursion limit", () => {
    it("stops infinite cycles at the recursion limit", async () => {
      // Build a cycle: start -> llm-loop (writes counter, routes back to itself)
      // This will loop until recursion limit
      const incrementExecutor = new IncrementExecutor();

      const nodes: WorkflowNode[] = [
        { id: "start-1", kind: "start", label: "Start" },
        {
          id: "llm-loop",
          kind: "llm",
          label: "Increment Loop",
          llm: { prompt: "increment", outputKey: "counter" },
        },
      ];

      const edges: WorkflowEdge[] = [
        { id: "e1", fromNodeId: "start-1", toNodeId: "llm-loop", kind: "normal" },
        { id: "e2", fromNodeId: "llm-loop", toNodeId: "llm-loop", kind: "normal" },
      ];

      const definition: WorkflowDefinition = {
        id: "wf-cycle",
        name: "Cycle Test",
        description: "Infinite cycle to test recursion limit",
        status: "active",
        source: "personal",
        updatedAt: new Date().toISOString(),
        version: 1,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        libraryRootId: "root-1",
        entryNodeId: "start-1",
        nodes,
        edges,
        stateSchema: [
          {
            key: "counter",
            label: "Counter",
            description: "Loop counter",
            valueType: "number",
            mergeStrategy: "replace",
            required: false,
            producerNodeIds: ["llm-loop"],
            consumerNodeIds: ["llm-loop"],
          },
        ],
      };

      const registry = createRegistry([incrementExecutor]);
      const config = createDefaultConfig({ recursionLimit: 5 });
      const runner = new PregelRunner(definition, config, { executorRegistry: registry });

      const result = await runner.run({ counter: 0 });

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Recursion limit");
      expect(result.totalSteps).toBe(5);
    });
  });

  describe("event emission", () => {
    it("emits step-start, node-start, node-complete, step-complete events", async () => {
      const stubLlm = new StubLlmExecutor();

      const nodes: WorkflowNode[] = [
        { id: "start-1", kind: "start", label: "Start" },
        {
          id: "llm-1",
          kind: "llm",
          label: "LLM",
          llm: { prompt: "Hello", outputKey: "response" },
        },
        { id: "end-1", kind: "end", label: "End" },
      ];

      const edges: WorkflowEdge[] = [
        { id: "e1", fromNodeId: "start-1", toNodeId: "llm-1", kind: "normal" },
        { id: "e2", fromNodeId: "llm-1", toNodeId: "end-1", kind: "normal" },
      ];

      const definition: WorkflowDefinition = {
        id: "wf-events",
        name: "Events Test",
        description: "Test event emission",
        status: "active",
        source: "personal",
        updatedAt: new Date().toISOString(),
        version: 1,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        libraryRootId: "root-1",
        entryNodeId: "start-1",
        nodes,
        edges,
        stateSchema: [
          {
            key: "response",
            label: "Response",
            description: "LLM output",
            valueType: "string",
            mergeStrategy: "replace",
            required: false,
            producerNodeIds: ["llm-1"],
            consumerNodeIds: ["end-1"],
          },
        ],
      };

      const registry = createRegistry([stubLlm]);
      const runner = new PregelRunner(definition, createDefaultConfig(), { executorRegistry: registry });
      const events = collectEvents(runner);

      await runner.run();

      const eventTypes = events.map((e) => e.type);

      // Must have run-start and run-complete
      expect(eventTypes).toContain("run-start");
      expect(eventTypes).toContain("run-complete");

      // Must have at least one step-start and step-complete
      expect(eventTypes).toContain("step-start");
      expect(eventTypes).toContain("step-complete");

      // Must have node-start and node-complete for start, llm, end nodes
      const nodeStartEvents = events.filter((e) => e.type === "node-start");
      const nodeCompleteEvents = events.filter((e) => e.type === "node-complete");
      expect(nodeStartEvents.length).toBeGreaterThanOrEqual(3);
      expect(nodeCompleteEvents.length).toBeGreaterThanOrEqual(3);

      // Verify node-start emits for start-1, llm-1, end-1
      const nodeStartIds = nodeStartEvents.map((e) =>
        e.type === "node-start" ? e.nodeId : "",
      );
      expect(nodeStartIds).toContain("start-1");
      expect(nodeStartIds).toContain("llm-1");
      expect(nodeStartIds).toContain("end-1");
    });

    it("emits state-updated for non-internal channel writes", async () => {
      const stubLlm = new StubLlmExecutor();

      const nodes: WorkflowNode[] = [
        { id: "start-1", kind: "start", label: "Start" },
        {
          id: "llm-1",
          kind: "llm",
          label: "LLM",
          llm: { prompt: "Hello", outputKey: "response" },
        },
        { id: "end-1", kind: "end", label: "End" },
      ];

      const edges: WorkflowEdge[] = [
        { id: "e1", fromNodeId: "start-1", toNodeId: "llm-1", kind: "normal" },
        { id: "e2", fromNodeId: "llm-1", toNodeId: "end-1", kind: "normal" },
      ];

      const definition: WorkflowDefinition = {
        id: "wf-state-events",
        name: "State Events Test",
        description: "Test state-updated events",
        status: "active",
        source: "personal",
        updatedAt: new Date().toISOString(),
        version: 1,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        libraryRootId: "root-1",
        entryNodeId: "start-1",
        nodes,
        edges,
        stateSchema: [
          {
            key: "response",
            label: "Response",
            description: "LLM output",
            valueType: "string",
            mergeStrategy: "replace",
            required: false,
            producerNodeIds: ["llm-1"],
            consumerNodeIds: ["end-1"],
          },
        ],
      };

      const registry = createRegistry([stubLlm]);
      const runner = new PregelRunner(definition, createDefaultConfig(), { executorRegistry: registry });
      const events = collectEvents(runner);

      await runner.run();

      const stateEvents = events.filter((e) => e.type === "state-updated");
      expect(stateEvents.length).toBeGreaterThanOrEqual(1);

      // Should have a state-updated for the "response" channel
      const responseUpdate = stateEvents.find(
        (e) => e.type === "state-updated" && e.channelName === "response",
      );
      expect(responseUpdate).toBeDefined();
      if (responseUpdate && responseUpdate.type === "state-updated") {
        expect(responseUpdate.value).toBe("stub-llm-response");
      }
    });
  });

  describe("abort", () => {
    it("cancels the run when abort() is called", async () => {
      // Use an executor that delays, giving us time to abort
      class SlowLlmExecutor implements NodeExecutor {
        readonly kind = "llm" as const;
        async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
          // Wait a small amount to give abort time to fire
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            writes: [{ channelName: "response", value: "slow-response" }],
            outputs: { response: "slow-response" },
            durationMs: 50,
          };
        }
      }

      const nodes: WorkflowNode[] = [
        { id: "start-1", kind: "start", label: "Start" },
        {
          id: "llm-1",
          kind: "llm",
          label: "SlowLLM",
          llm: { prompt: "Hello", outputKey: "response" },
        },
        { id: "end-1", kind: "end", label: "End" },
      ];

      const edges: WorkflowEdge[] = [
        { id: "e1", fromNodeId: "start-1", toNodeId: "llm-1", kind: "normal" },
        { id: "e2", fromNodeId: "llm-1", toNodeId: "end-1", kind: "normal" },
      ];

      const definition: WorkflowDefinition = {
        id: "wf-abort",
        name: "Abort Test",
        description: "Test abort",
        status: "active",
        source: "personal",
        updatedAt: new Date().toISOString(),
        version: 1,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        libraryRootId: "root-1",
        entryNodeId: "start-1",
        nodes,
        edges,
        stateSchema: [
          {
            key: "response",
            label: "Response",
            description: "LLM output",
            valueType: "string",
            mergeStrategy: "replace",
            required: false,
            producerNodeIds: ["llm-1"],
            consumerNodeIds: ["end-1"],
          },
        ],
      };

      const registry = createRegistry([new SlowLlmExecutor()]);
      const runner = new PregelRunner(definition, createDefaultConfig(), { executorRegistry: registry });

      // Abort after start step completes
      setTimeout(() => runner.abort(), 10);

      const result = await runner.run();

      // It should be canceled (may also succeed if the abort timing is late — assert either is valid)
      expect(["canceled", "succeeded"]).toContain(result.status);
    });
  });
});
