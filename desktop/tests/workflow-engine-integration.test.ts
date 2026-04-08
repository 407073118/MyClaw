import { describe, it, expect, vi } from "vitest";
import type {
  WorkflowDefinition,
  WorkflowRunConfig,
  WorkflowNode,
  WorkflowEdge,
  WorkflowStateSchemaField,
  WorkflowLlmNode,
  WorkflowToolNode,
  WorkflowConditionNode,
  WorkflowHumanInputNode,
} from "@shared/contracts";
import type { WorkflowStreamEvent } from "@shared/contracts/workflow-stream";
import { PregelRunner } from "../src/main/services/workflow-engine/pregel-runner";
import { NodeExecutorRegistry } from "../src/main/services/workflow-engine/node-executor";
import { StartNodeExecutor } from "../src/main/services/workflow-engine/executors/start";
import { EndNodeExecutor } from "../src/main/services/workflow-engine/executors/end";
import { ConditionNodeExecutor } from "../src/main/services/workflow-engine/executors/condition";
import { LlmNodeExecutor } from "../src/main/services/workflow-engine/executors/llm";
import type { ModelCaller, ModelProfileResolver } from "../src/main/services/workflow-engine/executors/llm";
import { ToolNodeExecutor } from "../src/main/services/workflow-engine/executors/tool";
import type { ToolExecutorFn } from "../src/main/services/workflow-engine/executors/tool";
import { HumanInputNodeExecutor } from "../src/main/services/workflow-engine/executors/human-input";
import { JoinNodeExecutor } from "../src/main/services/workflow-engine/executors/join";

// ── Stub helpers ──

/** Stub model caller that returns a fixed response, emitting deltas word-by-word */
const createStubModelCaller = (response = "AI response: analysis complete."): ModelCaller => {
  return async (opts) => {
    const content = response;
    if (opts.onDelta) {
      for (const word of content.split(" ")) {
        opts.onDelta({ content: word + " " });
      }
    }
    return { content };
  };
};

/** Stub profile resolver that returns a plain object */
const stubProfileResolver: ModelProfileResolver = (_id?: string) => ({
  id: "test-profile",
  name: "Test",
});

/** Stub tool executor that returns success */
const stubToolExecutor: ToolExecutorFn = async (toolId, label, _workingDir) => {
  return { success: true, output: `Tool ${toolId} result for: ${label}` };
};

/** Build a registry with all node executors registered */
function buildRegistry(modelCaller?: ModelCaller): NodeExecutorRegistry {
  const registry = new NodeExecutorRegistry();
  registry.register(new StartNodeExecutor());
  registry.register(new EndNodeExecutor());
  registry.register(new ConditionNodeExecutor());
  registry.register(new LlmNodeExecutor(modelCaller ?? createStubModelCaller(), stubProfileResolver));
  registry.register(new ToolNodeExecutor(stubToolExecutor, null));
  registry.register(new HumanInputNodeExecutor());
  registry.register(new JoinNodeExecutor());
  return registry;
}

/** Default run config for tests */
function defaultRunConfig(overrides?: Partial<WorkflowRunConfig>): WorkflowRunConfig {
  return {
    recursionLimit: 50,
    workingDirectory: "/tmp/test",
    modelProfileId: "test-profile",
    checkpointPolicy: "none",
    maxParallelNodes: 4,
    ...overrides,
  };
}

/** Helper to collect all emitted events */
function collectEvents(runner: PregelRunner): WorkflowStreamEvent[] {
  const events: WorkflowStreamEvent[] = [];
  runner.emitter.on((e) => events.push(e));
  return events;
}

/** Shared base fields for WorkflowDefinition */
function definitionBase(id: string, name: string): Omit<WorkflowDefinition, "entryNodeId" | "nodes" | "edges" | "stateSchema"> {
  return {
    id,
    name,
    description: `Test: ${name}`,
    status: "active",
    source: "personal",
    updatedAt: new Date().toISOString(),
    version: 1,
    nodeCount: 0,
    edgeCount: 0,
    libraryRootId: "root",
  };
}

// ── 1. Linear pipeline: Start → LLM → Tool → End ──

describe("Workflow Engine Integration — Linear Pipeline", () => {
  function buildLinearDefinition(): WorkflowDefinition {
    const nodes: WorkflowNode[] = [
      { id: "start-1", kind: "start", label: "Start" },
      {
        id: "llm-1",
        kind: "llm",
        label: "Analyze",
        llm: { prompt: "Analyze the topic: {{topic}}", outputKey: "llmOutput" },
      } as WorkflowLlmNode,
      {
        id: "tool-1",
        kind: "tool",
        label: "Fetch Data",
        tool: { toolId: "data-fetcher", outputKey: "toolOutput" },
      } as WorkflowToolNode,
      { id: "end-1", kind: "end", label: "Done" },
    ];

    const edges: WorkflowEdge[] = [
      { id: "e1", fromNodeId: "start-1", toNodeId: "llm-1", kind: "normal" },
      { id: "e2", fromNodeId: "llm-1", toNodeId: "tool-1", kind: "normal" },
      { id: "e3", fromNodeId: "tool-1", toNodeId: "end-1", kind: "normal" },
    ];

    const stateSchema: WorkflowStateSchemaField[] = [
      {
        key: "topic",
        label: "Topic",
        description: "Input topic",
        valueType: "string",
        mergeStrategy: "replace",
        required: true,
        producerNodeIds: [],
        consumerNodeIds: ["llm-1"],
      },
      {
        key: "llmOutput",
        label: "LLM Output",
        description: "LLM analysis result",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["llm-1"],
        consumerNodeIds: ["tool-1"],
      },
      {
        key: "toolOutput",
        label: "Tool Output",
        description: "Tool execution result",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["tool-1"],
        consumerNodeIds: [],
      },
    ];

    return {
      ...definitionBase("wf-linear", "Linear Pipeline"),
      entryNodeId: "start-1",
      nodes,
      edges,
      stateSchema,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  }

  it("should execute Start → LLM → Tool → End and produce correct final state", async () => {
    const def = buildLinearDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    const result = await runner.run({ topic: "quantum computing" });

    expect(result.status).toBe("succeeded");
    expect(result.finalState.topic).toBe("quantum computing");
    expect(result.finalState.llmOutput).toBe("AI response: analysis complete. ");
    expect(typeof result.finalState.toolOutput).toBe("string");
    expect((result.finalState.toolOutput as string).length).toBeGreaterThan(0);
    expect(result.totalSteps).toBeGreaterThanOrEqual(4);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should emit run-start, node-start/node-complete for each node, and run-complete events", async () => {
    const def = buildLinearDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    await runner.run({ topic: "testing" });

    // run-start must be first
    expect(events[0].type).toBe("run-start");

    // run-complete must be last
    expect(events[events.length - 1].type).toBe("run-complete");

    // Verify each node has node-start and node-complete events
    const nodeIds = ["start-1", "llm-1", "tool-1", "end-1"];
    for (const nodeId of nodeIds) {
      const starts = events.filter((e) => e.type === "node-start" && e.nodeId === nodeId);
      const completes = events.filter((e) => e.type === "node-complete" && e.nodeId === nodeId);
      expect(starts.length).toBeGreaterThanOrEqual(1);
      expect(completes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("should emit node-streaming events from the LLM executor", async () => {
    const def = buildLinearDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    await runner.run({ topic: "streaming test" });

    const streamingEvents = events.filter(
      (e) => e.type === "node-streaming" && e.nodeId === "llm-1",
    );
    expect(streamingEvents.length).toBeGreaterThan(0);

    // Each streaming event should have a chunk with content
    for (const se of streamingEvents) {
      if (se.type === "node-streaming") {
        expect(se.chunk.content).toBeDefined();
        expect(typeof se.chunk.content).toBe("string");
      }
    }
  });

  it("should emit state-updated events for llmOutput and toolOutput channels", async () => {
    const def = buildLinearDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    await runner.run({ topic: "state tracking" });

    const stateUpdates = events.filter((e) => e.type === "state-updated");
    const channelNames = stateUpdates.map((e) => (e as any).channelName);
    expect(channelNames).toContain("llmOutput");
    expect(channelNames).toContain("toolOutput");
  });
});

// ── 2. Condition branching: Start → Condition → [LLM-A | LLM-B] → End ──

describe("Workflow Engine Integration — Condition Branching", () => {
  function buildConditionDefinition(): WorkflowDefinition {
    const nodes: WorkflowNode[] = [
      { id: "start-1", kind: "start", label: "Start" },
      {
        id: "cond-1",
        kind: "condition",
        label: "Check Flag",
        condition: {
          operator: "equals",
          leftPath: "$.flag",
          rightValue: true,
        },
        route: {
          trueNodeId: "llm-a",
          falseNodeId: "llm-b",
        },
      } as WorkflowConditionNode,
      {
        id: "llm-a",
        kind: "llm",
        label: "LLM Branch A",
        llm: { prompt: "Branch A: {{topic}}", outputKey: "branchOutput" },
      } as WorkflowLlmNode,
      {
        id: "llm-b",
        kind: "llm",
        label: "LLM Branch B",
        llm: { prompt: "Branch B: {{topic}}", outputKey: "branchOutput" },
      } as WorkflowLlmNode,
      { id: "end-1", kind: "end", label: "Done" },
    ];

    const edges: WorkflowEdge[] = [
      { id: "e1", fromNodeId: "start-1", toNodeId: "cond-1", kind: "normal" },
      { id: "e2", fromNodeId: "cond-1", toNodeId: "llm-a", kind: "conditional", condition: { operator: "equals", leftPath: "$.flag", rightValue: true } },
      { id: "e3", fromNodeId: "cond-1", toNodeId: "llm-b", kind: "conditional", condition: { operator: "equals", leftPath: "$.flag", rightValue: false } },
      { id: "e4", fromNodeId: "llm-a", toNodeId: "end-1", kind: "normal" },
      { id: "e5", fromNodeId: "llm-b", toNodeId: "end-1", kind: "normal" },
    ];

    const stateSchema: WorkflowStateSchemaField[] = [
      {
        key: "flag",
        label: "Flag",
        description: "Condition flag",
        valueType: "boolean",
        mergeStrategy: "replace",
        required: true,
        producerNodeIds: [],
        consumerNodeIds: ["cond-1"],
      },
      {
        key: "topic",
        label: "Topic",
        description: "Topic input",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: [],
        consumerNodeIds: [],
      },
      {
        key: "branchOutput",
        label: "Branch Output",
        description: "Output from selected branch",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["llm-a", "llm-b"],
        consumerNodeIds: [],
      },
    ];

    return {
      ...definitionBase("wf-condition", "Condition Branching"),
      entryNodeId: "start-1",
      nodes,
      edges,
      stateSchema,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  }

  it("should execute LLM-A branch when flag is true", async () => {
    const def = buildConditionDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    const result = await runner.run({ flag: true, topic: "branch test" });

    expect(result.status).toBe("succeeded");
    expect(result.finalState.branchOutput).toBeDefined();

    // Verify LLM-A ran
    const llmAStarts = events.filter((e) => e.type === "node-start" && e.nodeId === "llm-a");
    expect(llmAStarts.length).toBe(1);

    // Verify LLM-B did NOT run
    const llmBStarts = events.filter((e) => e.type === "node-start" && e.nodeId === "llm-b");
    expect(llmBStarts.length).toBe(0);
  });

  it("should execute LLM-B branch when flag is false", async () => {
    const def = buildConditionDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    const result = await runner.run({ flag: false, topic: "branch test" });

    expect(result.status).toBe("succeeded");
    expect(result.finalState.branchOutput).toBeDefined();

    // Verify LLM-B ran
    const llmBStarts = events.filter((e) => e.type === "node-start" && e.nodeId === "llm-b");
    expect(llmBStarts.length).toBe(1);

    // Verify LLM-A did NOT run
    const llmAStarts = events.filter((e) => e.type === "node-start" && e.nodeId === "llm-a");
    expect(llmAStarts.length).toBe(0);
  });

  it("should emit condition result outputs in node-complete event", async () => {
    const def = buildConditionDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    await runner.run({ flag: true, topic: "condition outputs" });

    const condComplete = events.find(
      (e) => e.type === "node-complete" && e.nodeId === "cond-1",
    );
    expect(condComplete).toBeDefined();
    if (condComplete && condComplete.type === "node-complete") {
      expect(condComplete.outputs.conditionResult).toBe(true);
      expect(condComplete.outputs.targetNodeId).toBe("llm-a");
    }
  });
});

// ── 3. Human-input interrupt ──

describe("Workflow Engine Integration — Human-Input Interrupt", () => {
  function buildHumanInputDefinition(): WorkflowDefinition {
    const nodes: WorkflowNode[] = [
      { id: "start-1", kind: "start", label: "Start" },
      {
        id: "llm-1",
        kind: "llm",
        label: "Pre-process",
        llm: { prompt: "Pre-process: {{topic}}", outputKey: "llmOutput" },
      } as WorkflowLlmNode,
      {
        id: "human-1",
        kind: "human-input",
        label: "Please confirm",
        humanInput: { formKey: "userConfirmation" },
      } as WorkflowHumanInputNode,
      { id: "end-1", kind: "end", label: "Done" },
    ];

    const edges: WorkflowEdge[] = [
      { id: "e1", fromNodeId: "start-1", toNodeId: "llm-1", kind: "normal" },
      { id: "e2", fromNodeId: "llm-1", toNodeId: "human-1", kind: "normal" },
      { id: "e3", fromNodeId: "human-1", toNodeId: "end-1", kind: "normal" },
    ];

    const stateSchema: WorkflowStateSchemaField[] = [
      {
        key: "topic",
        label: "Topic",
        description: "Topic",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: [],
        consumerNodeIds: ["llm-1"],
      },
      {
        key: "llmOutput",
        label: "LLM Output",
        description: "LLM output",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["llm-1"],
        consumerNodeIds: [],
      },
      {
        key: "userConfirmation",
        label: "User Confirmation",
        description: "User confirmation value",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["human-1"],
        consumerNodeIds: [],
      },
    ];

    return {
      ...definitionBase("wf-human", "Human-Input Interrupt"),
      entryNodeId: "start-1",
      nodes,
      edges,
      stateSchema,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  }

  it("should return status 'waiting-input' when human-input node is reached", async () => {
    const def = buildHumanInputDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    const result = await runner.run({ topic: "need confirmation" });

    expect(result.status).toBe("waiting-input");
    expect(result.interruptPayload).toBeDefined();
  });

  it("should emit interrupt-requested event with correct payload", async () => {
    const def = buildHumanInputDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    await runner.run({ topic: "interrupt test" });

    const interruptEvents = events.filter((e) => e.type === "interrupt-requested");
    expect(interruptEvents.length).toBe(1);

    const interrupt = interruptEvents[0];
    if (interrupt.type === "interrupt-requested") {
      expect(interrupt.nodeId).toBe("human-1");
      expect(interrupt.payload).toBeDefined();
      expect(interrupt.payload.type).toBe("input");
      expect(interrupt.payload.nodeId).toBe("human-1");
      expect(interrupt.payload.formKey).toBe("userConfirmation");
    }
  });

  it("should include LLM output in final state even after interrupt", async () => {
    const def = buildHumanInputDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });

    const result = await runner.run({ topic: "partial state" });

    expect(result.status).toBe("waiting-input");
    // LLM ran before the human-input node, so its output should be in the state
    expect(result.finalState.llmOutput).toBe("AI response: analysis complete. ");
  });
});

// ── 4. Cycle with recursion limit ──

describe("Workflow Engine Integration — Cycle with Recursion Limit", () => {
  function buildCycleDefinition(): WorkflowDefinition {
    // Build a graph: Start → LLM → Condition → (true: back to LLM, false: End)
    // The condition always evaluates to true (counter never satisfies exit),
    // so the cycle will keep running until recursion limit is hit.
    const nodes: WorkflowNode[] = [
      { id: "start-1", kind: "start", label: "Start" },
      {
        id: "llm-loop",
        kind: "llm",
        label: "Loop LLM",
        llm: { prompt: "Iteration on: {{topic}}", outputKey: "loopResult" },
      } as WorkflowLlmNode,
      {
        id: "cond-loop",
        kind: "condition",
        label: "Continue?",
        condition: {
          operator: "equals",
          leftPath: "$.shouldContinue",
          rightValue: true,
        },
        route: {
          trueNodeId: "llm-loop",
          falseNodeId: "end-1",
        },
      } as WorkflowConditionNode,
      { id: "end-1", kind: "end", label: "Done" },
    ];

    const edges: WorkflowEdge[] = [
      { id: "e1", fromNodeId: "start-1", toNodeId: "llm-loop", kind: "normal" },
      { id: "e2", fromNodeId: "llm-loop", toNodeId: "cond-loop", kind: "normal" },
      { id: "e3", fromNodeId: "cond-loop", toNodeId: "llm-loop", kind: "conditional", condition: { operator: "equals", leftPath: "$.shouldContinue", rightValue: true } },
      { id: "e4", fromNodeId: "cond-loop", toNodeId: "end-1", kind: "conditional", condition: { operator: "equals", leftPath: "$.shouldContinue", rightValue: false } },
    ];

    const stateSchema: WorkflowStateSchemaField[] = [
      {
        key: "topic",
        label: "Topic",
        description: "Topic",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: [],
        consumerNodeIds: ["llm-loop"],
      },
      {
        key: "shouldContinue",
        label: "Should Continue",
        description: "Flag to keep looping",
        valueType: "boolean",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: [],
        consumerNodeIds: ["cond-loop"],
      },
      {
        key: "loopResult",
        label: "Loop Result",
        description: "Output from loop LLM",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["llm-loop"],
        consumerNodeIds: [],
      },
    ];

    return {
      ...definitionBase("wf-cycle", "Cycle with Recursion Limit"),
      entryNodeId: "start-1",
      nodes,
      edges,
      stateSchema,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      defaults: { allowCycles: true },
    };
  }

  it("should terminate with 'failed' status when recursion limit is reached", async () => {
    const def = buildCycleDefinition();
    const registry = buildRegistry();
    const recursionLimit = 5;
    const runner = new PregelRunner(def, defaultRunConfig({ recursionLimit }), {
      executorRegistry: registry,
    });
    const events = collectEvents(runner);

    const result = await runner.run({ topic: "loop test", shouldContinue: true });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Recursion limit");
    expect(result.error).toContain(String(recursionLimit));
    expect(result.totalSteps).toBe(recursionLimit);
  });

  it("should execute multiple iterations of the loop before reaching limit", async () => {
    const def = buildCycleDefinition();
    const registry = buildRegistry();
    const recursionLimit = 5;
    const runner = new PregelRunner(def, defaultRunConfig({ recursionLimit }), {
      executorRegistry: registry,
    });
    const events = collectEvents(runner);

    await runner.run({ topic: "loop iterations", shouldContinue: true });

    // The LLM node should have been started multiple times
    const llmStarts = events.filter(
      (e) => e.type === "node-start" && e.nodeId === "llm-loop",
    );
    expect(llmStarts.length).toBeGreaterThan(1);
  });

  it("should exit the loop normally when condition becomes false", async () => {
    const def = buildCycleDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig({ recursionLimit: 50 }), {
      executorRegistry: registry,
    });

    // shouldContinue = false means the condition routes to end-1
    const result = await runner.run({ topic: "exit loop", shouldContinue: false });

    expect(result.status).toBe("succeeded");
  });
});

// ── 5. Abort cancellation ──

describe("Workflow Engine Integration — Abort Cancellation", () => {
  function buildSlowDefinition(): WorkflowDefinition {
    const nodes: WorkflowNode[] = [
      { id: "start-1", kind: "start", label: "Start" },
      {
        id: "llm-slow",
        kind: "llm",
        label: "Slow LLM",
        llm: { prompt: "Slow work: {{topic}}", outputKey: "slowOutput" },
      } as WorkflowLlmNode,
      { id: "end-1", kind: "end", label: "Done" },
    ];

    const edges: WorkflowEdge[] = [
      { id: "e1", fromNodeId: "start-1", toNodeId: "llm-slow", kind: "normal" },
      { id: "e2", fromNodeId: "llm-slow", toNodeId: "end-1", kind: "normal" },
    ];

    const stateSchema: WorkflowStateSchemaField[] = [
      {
        key: "topic",
        label: "Topic",
        description: "Topic",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: [],
        consumerNodeIds: ["llm-slow"],
      },
      {
        key: "slowOutput",
        label: "Slow Output",
        description: "Output from slow LLM",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["llm-slow"],
        consumerNodeIds: [],
      },
    ];

    return {
      ...definitionBase("wf-abort", "Abort Cancellation"),
      entryNodeId: "start-1",
      nodes,
      edges,
      stateSchema,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  }

  it("should return status 'canceled' when abort() is called before run starts executing nodes", async () => {
    // Use a slow model caller that delays so we can abort
    const slowModelCaller: ModelCaller = async (opts) => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { content: "should not finish" };
    };

    const def = buildSlowDefinition();
    const registry = buildRegistry(slowModelCaller);
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    // Abort immediately — the abort is checked between supersteps
    runner.abort();
    const result = await runner.run({ topic: "abort test" });

    expect(result.status).toBe("canceled");
  });

  it("should emit run-complete with canceled status", async () => {
    const def = buildSlowDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    // Abort before running
    runner.abort();
    await runner.run({ topic: "cancel events" });

    const runComplete = events.find((e) => e.type === "run-complete");
    expect(runComplete).toBeDefined();
    if (runComplete && runComplete.type === "run-complete") {
      expect(runComplete.status).toBe("canceled");
    }
  });
});

// ── 6. Step and state-update event consistency ──

describe("Workflow Engine Integration — Event Consistency", () => {
  function buildSimpleDefinition(): WorkflowDefinition {
    const nodes: WorkflowNode[] = [
      { id: "start-1", kind: "start", label: "Start" },
      {
        id: "llm-1",
        kind: "llm",
        label: "Process",
        llm: { prompt: "Process: {{input}}", outputKey: "result" },
      } as WorkflowLlmNode,
      { id: "end-1", kind: "end", label: "Done" },
    ];

    const edges: WorkflowEdge[] = [
      { id: "e1", fromNodeId: "start-1", toNodeId: "llm-1", kind: "normal" },
      { id: "e2", fromNodeId: "llm-1", toNodeId: "end-1", kind: "normal" },
    ];

    const stateSchema: WorkflowStateSchemaField[] = [
      {
        key: "input",
        label: "Input",
        description: "Input data",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: [],
        consumerNodeIds: ["llm-1"],
      },
      {
        key: "result",
        label: "Result",
        description: "Processing result",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["llm-1"],
        consumerNodeIds: [],
      },
    ];

    return {
      ...definitionBase("wf-simple", "Simple Pipeline"),
      entryNodeId: "start-1",
      nodes,
      edges,
      stateSchema,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  }

  it("should have matching step-start and step-complete events for each step", async () => {
    const def = buildSimpleDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    await runner.run({ input: "test data" });

    const stepStarts = events.filter((e) => e.type === "step-start");
    const stepCompletes = events.filter((e) => e.type === "step-complete");

    expect(stepStarts.length).toBe(stepCompletes.length);

    for (let i = 0; i < stepStarts.length; i++) {
      const start = stepStarts[i] as Extract<WorkflowStreamEvent, { type: "step-start" }>;
      const complete = stepCompletes[i] as Extract<WorkflowStreamEvent, { type: "step-complete" }>;
      expect(start.step).toBe(complete.step);
    }
  });

  it("should emit events in correct chronological order", async () => {
    const def = buildSimpleDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    await runner.run({ input: "ordering test" });

    // run-start should be first
    expect(events[0].type).toBe("run-start");
    // run-complete should be last
    expect(events[events.length - 1].type).toBe("run-complete");

    // For each node, node-start should come before node-complete
    const nodeStartIdx = events.findIndex((e) => e.type === "node-start" && e.nodeId === "llm-1");
    const nodeCompleteIdx = events.findIndex((e) => e.type === "node-complete" && e.nodeId === "llm-1");
    expect(nodeStartIdx).toBeLessThan(nodeCompleteIdx);
  });

  it("run-complete event should match the returned result", async () => {
    const def = buildSimpleDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    const result = await runner.run({ input: "result match" });

    const runComplete = events.find((e) => e.type === "run-complete");
    expect(runComplete).toBeDefined();
    if (runComplete && runComplete.type === "run-complete") {
      expect(runComplete.status).toBe(result.status);
      expect(runComplete.totalSteps).toBe(result.totalSteps);
    }
  });
});
