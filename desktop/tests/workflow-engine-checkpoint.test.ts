import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type {
  WorkflowDefinition,
  WorkflowRunConfig,
  WorkflowNode,
  WorkflowEdge,
  WorkflowStateSchemaField,
  WorkflowLlmNode,
  WorkflowHumanInputNode,
} from "@shared/contracts";
import { GraphInterrupt } from "../src/main/services/workflow-engine/errors";
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
import { LastValueChannel, ReducerChannel, compileChannels } from "../src/main/services/workflow-engine/channels";
import { SqliteCheckpointer } from "../src/main/services/workflow-engine/sqlite-checkpointer";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";

// ── Stub helpers (reused from integration tests) ──

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

const stubProfileResolver: ModelProfileResolver = (_id?: string) => ({
  id: "test-profile",
  name: "Test",
});

const stubToolExecutor: ToolExecutorFn = async (toolId, label, _workingDir) => {
  return { success: true, output: `Tool ${toolId} result for: ${label}` };
};

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

function collectEvents(runner: PregelRunner): WorkflowStreamEvent[] {
  const events: WorkflowStreamEvent[] = [];
  runner.emitter.on((e) => events.push(e));
  return events;
}

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

// ════════════════════════════════════════════════════════════════════════
// 1. Channel checkpoint / restore roundtrip
// ════════════════════════════════════════════════════════════════════════

describe("Channel Checkpoint / Restore Roundtrip", () => {
  it("should checkpoint and restore LastValueChannel preserving value and version", () => {
    const channel = new LastValueChannel<string>("topic", "");

    // Set some values to increment version
    channel.update(["hello"]);
    channel.update(["world"]);

    expect(channel.get()).toBe("world");
    expect(channel.version).toBe(2);

    // Checkpoint
    const cp = channel.checkpoint();

    // Mutate the channel further
    channel.update(["changed"]);
    expect(channel.get()).toBe("changed");
    expect(channel.version).toBe(3);

    // Restore from checkpoint
    channel.fromCheckpoint(cp);
    expect(channel.get()).toBe("world");
    expect(channel.version).toBe(2);
  });

  it("should checkpoint and restore ReducerChannel with appended data", () => {
    const appendReducer = (current: string[], update: string[]): string[] => [...current, ...update];
    const channel = new ReducerChannel<string[]>("messages", appendReducer, []);

    channel.update([["msg1"]]);
    channel.update([["msg2"]]);

    expect(channel.get()).toEqual(["msg1", "msg2"]);
    expect(channel.version).toBe(2);

    // Checkpoint
    const cp = channel.checkpoint();

    // Mutate further
    channel.update([["msg3"]]);
    expect(channel.get()).toEqual(["msg1", "msg2", "msg3"]);
    expect(channel.version).toBe(3);

    // Restore
    channel.fromCheckpoint(cp);
    expect(channel.get()).toEqual(["msg1", "msg2"]);
    expect(channel.version).toBe(2);
  });

  it("should preserve version numbers correctly across checkpoint/restore cycles", () => {
    const channel = new LastValueChannel<number>("counter", 0);

    // Increment several times
    channel.update([1]);
    channel.update([2]);
    channel.update([3]);

    const cpV3 = channel.checkpoint();
    expect(channel.version).toBe(3);

    channel.update([4]);
    channel.update([5]);
    const cpV5 = channel.checkpoint();
    expect(channel.version).toBe(5);

    // Restore to v3
    channel.fromCheckpoint(cpV3);
    expect(channel.version).toBe(3);
    expect(channel.get()).toBe(3);

    // Restore to v5
    channel.fromCheckpoint(cpV5);
    expect(channel.version).toBe(5);
    expect(channel.get()).toBe(5);
  });

  it("should handle checkpoint/restore on a fresh (default) channel", () => {
    const channel = new LastValueChannel<string>("empty", "default");
    const cp = channel.checkpoint();

    channel.update(["changed"]);
    expect(channel.get()).toBe("changed");

    channel.fromCheckpoint(cp);
    expect(channel.get()).toBe("default");
    expect(channel.version).toBe(0);
  });

  it("should checkpoint and restore compileChannels result", () => {
    const schema: WorkflowStateSchemaField[] = [
      {
        key: "topic",
        label: "Topic",
        description: "Topic",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: [],
        consumerNodeIds: [],
      },
      {
        key: "logs",
        label: "Logs",
        description: "Log entries",
        valueType: "array",
        mergeStrategy: "append",
        required: false,
        producerNodeIds: [],
        consumerNodeIds: [],
      },
    ];

    const channels = compileChannels(schema);

    // Set values
    const topicCh = channels.get("topic")!;
    topicCh.update(["quantum"]);

    const logsCh = channels.get("logs")!;
    logsCh.update([["entry1"]]);
    logsCh.update([["entry2"]]);

    // Checkpoint all
    const checkpoints = new Map<string, unknown>();
    for (const [name, ch] of channels) {
      checkpoints.set(name, ch.checkpoint());
    }

    // Mutate
    topicCh.update(["changed"]);
    logsCh.update([["entry3"]]);

    // Restore all
    for (const [name, ch] of channels) {
      const cp = checkpoints.get(name);
      if (cp !== null && cp !== undefined) {
        ch.fromCheckpoint(cp);
      }
    }

    expect(topicCh.get()).toBe("quantum");
    expect(logsCh.get()).toEqual(["entry1", "entry2"]);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2. PregelRunner state capture
// ════════════════════════════════════════════════════════════════════════

describe("PregelRunner State Capture", () => {
  function buildLinearDefinition(): WorkflowDefinition {
    const nodes: WorkflowNode[] = [
      { id: "start-1", kind: "start", label: "Start" },
      {
        id: "llm-1",
        kind: "llm",
        label: "Analyze",
        llm: { prompt: "Analyze: {{topic}}", outputKey: "llmOutput" },
      } as WorkflowLlmNode,
      { id: "end-1", kind: "end", label: "Done" },
    ];

    const edges: WorkflowEdge[] = [
      { id: "e1", fromNodeId: "start-1", toNodeId: "llm-1", kind: "normal" },
      { id: "e2", fromNodeId: "llm-1", toNodeId: "end-1", kind: "normal" },
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
        consumerNodeIds: [],
      },
    ];

    return {
      ...definitionBase("wf-state-capture", "State Capture"),
      entryNodeId: "start-1",
      nodes,
      edges,
      stateSchema,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  }

  it("should return correct final state via getCurrentState() after completion", async () => {
    const def = buildLinearDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });

    const result = await runner.run({ topic: "state test" });

    expect(result.status).toBe("succeeded");

    // finalState is derived from getCurrentState()
    const state = result.finalState;
    expect(state.topic).toBe("state test");
    expect(state.llmOutput).toBe("AI response: analysis complete. ");
  });

  it("should include all output channels in getCurrentState() result", async () => {
    const def = buildLinearDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });

    await runner.run({ topic: "channel check" });

    const state = runner.getCurrentState();
    // Should have topic and llmOutput (from schema), but NOT internal channels like __done__
    expect("topic" in state).toBe(true);
    expect("llmOutput" in state).toBe(true);
    expect("__done__" in state).toBe(false);
    expect("__route__" in state).toBe(false);
    expect("__interrupt__" in state).toBe(false);
  });

  it("should reflect intermediate state correctly when run is interrupted", async () => {
    const nodes: WorkflowNode[] = [
      { id: "start-1", kind: "start", label: "Start" },
      {
        id: "llm-1",
        kind: "llm",
        label: "Pre-process",
        llm: { prompt: "Process: {{input}}", outputKey: "processed" },
      } as WorkflowLlmNode,
      {
        id: "human-1",
        kind: "human-input",
        label: "Confirm",
        humanInput: { formKey: "confirmation" },
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
        key: "input",
        label: "Input",
        description: "Input",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: [],
        consumerNodeIds: ["llm-1"],
      },
      {
        key: "processed",
        label: "Processed",
        description: "Processed output",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["llm-1"],
        consumerNodeIds: [],
      },
      {
        key: "confirmation",
        label: "Confirmation",
        description: "User confirmation",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["human-1"],
        consumerNodeIds: [],
      },
    ];

    const def: WorkflowDefinition = {
      ...definitionBase("wf-interrupt-state", "Interrupt State"),
      entryNodeId: "start-1",
      nodes,
      edges,
      stateSchema,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };

    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const result = await runner.run({ input: "partial data" });

    expect(result.status).toBe("waiting-input");
    // LLM ran, so processed should be populated; confirmation should still be default
    expect(result.finalState.input).toBe("partial data");
    expect(result.finalState.processed).toBe("AI response: analysis complete. ");
    expect(result.finalState.confirmation).toBe("");
  });
});

// ════════════════════════════════════════════════════════════════════════
// 3. Human-input interrupt preserves state
// ════════════════════════════════════════════════════════════════════════

describe("Human-Input Interrupt Preserves State", () => {
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
      ...definitionBase("wf-interrupt-preserve", "Human-Input Preserve State"),
      entryNodeId: "start-1",
      nodes,
      edges,
      stateSchema,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  }

  it("should return status 'waiting-input' and preserve LLM output in state", async () => {
    const def = buildHumanInputDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });

    const result = await runner.run({ topic: "preserve test" });

    expect(result.status).toBe("waiting-input");
    // LLM output must be preserved even though the run was interrupted
    expect(result.finalState.llmOutput).toBe("AI response: analysis complete. ");
    expect(result.finalState.topic).toBe("preserve test");
  });

  it("should emit interrupt-requested event with currentState containing LLM output", async () => {
    const def = buildHumanInputDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    await runner.run({ topic: "interrupt event test" });

    const interruptEvents = events.filter((e) => e.type === "interrupt-requested");
    expect(interruptEvents.length).toBe(1);

    const interrupt = interruptEvents[0];
    if (interrupt.type === "interrupt-requested") {
      expect(interrupt.nodeId).toBe("human-1");
      expect(interrupt.payload.type).toBe("input");
      expect(interrupt.payload.formKey).toBe("userConfirmation");
      // The interrupt payload currentState should contain the LLM output
      expect(interrupt.payload.currentState.llmOutput).toBe("AI response: analysis complete. ");
    }
  });

  it("should not have executed the end node when interrupted", async () => {
    const def = buildHumanInputDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    await runner.run({ topic: "no end" });

    const endStarts = events.filter((e) => e.type === "node-start" && e.nodeId === "end-1");
    expect(endStarts.length).toBe(0);
  });

  it("should have interruptPayload on the result", async () => {
    const def = buildHumanInputDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });

    const result = await runner.run({ topic: "payload check" });

    expect(result.interruptPayload).toBeDefined();
    expect((result.interruptPayload as any).type).toBe("input");
    expect((result.interruptPayload as any).nodeId).toBe("human-1");
    expect((result.interruptPayload as any).formKey).toBe("userConfirmation");
  });
});

// ════════════════════════════════════════════════════════════════════════
// 4. Hot resume flow
// ════════════════════════════════════════════════════════════════════════

describe("Hot Resume Flow", () => {
  function buildResumeDefinition(): WorkflowDefinition {
    const nodes: WorkflowNode[] = [
      { id: "start-1", kind: "start", label: "Start" },
      {
        id: "llm-1",
        kind: "llm",
        label: "Pre-process",
        llm: { prompt: "Process: {{topic}}", outputKey: "llmResult" },
      } as WorkflowLlmNode,
      {
        id: "human-1",
        kind: "human-input",
        label: "Enter value",
        humanInput: { formKey: "userInput" },
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
        description: "Input topic",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: [],
        consumerNodeIds: ["llm-1"],
      },
      {
        key: "llmResult",
        label: "LLM Result",
        description: "LLM output",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["llm-1"],
        consumerNodeIds: [],
      },
      {
        key: "userInput",
        label: "User Input",
        description: "User-provided input",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["human-1"],
        consumerNodeIds: [],
      },
    ];

    return {
      ...definitionBase("wf-resume", "Resume Flow"),
      entryNodeId: "start-1",
      nodes,
      edges,
      stateSchema,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  }

  it("should interrupt at human-input node during initial run", async () => {
    const def = buildResumeDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });

    const result = await runner.run({ topic: "resume test" });

    expect(result.status).toBe("waiting-input");
    expect(result.interruptPayload).toBeDefined();
    expect(result.finalState.llmResult).toBe("AI response: analysis complete. ");
  });

  it("should have resume() method on PregelRunner", () => {
    const def = buildResumeDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });

    expect(typeof runner.resume).toBe("function");
  });

  it("should throw if resume() is called when not in waiting-input status", async () => {
    const def = buildResumeDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });

    // Before running, the status is not "waiting-input"
    await expect(runner.resume("test")).rejects.toThrow(/Cannot resume/);
  });

  // Note: resume() writes to __resume__ channel, but executeNodes() filters out
  // __ channels from the state snapshot. The HumanInputNodeExecutor reads
  // ctx.state.get("__resume__") which won't be in the snapshot. This is a known
  // gap that needs the executeNodes snapshot to include __resume__ as a special case.
  // Once that fix lands, this test should pass.
  it("should complete workflow after resume() with user input", async () => {
    const def = buildResumeDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });

    // Run to interrupt
    const result1 = await runner.run({ topic: "resume flow" });
    expect(result1.status).toBe("waiting-input");

    // Resume with user input
    const result2 = await runner.resume("user confirmed");
    expect(result2.status).toBe("succeeded");
    expect(result2.finalState.userInput).toBe("user confirmed");
    expect(result2.finalState.llmResult).toBe("AI response: analysis complete. ");
  });

  it("should verify HumanInputNodeExecutor resume path works when __resume__ is in state", async () => {
    // Test the executor directly to verify its resume logic works
    const executor = new HumanInputNodeExecutor();
    const node: WorkflowHumanInputNode = {
      id: "human-1",
      kind: "human-input",
      label: "Enter value",
      humanInput: { formKey: "userInput" },
    };

    // When __resume__ is present in state, executor should return writes
    const stateWithResume = new Map<string, unknown>();
    stateWithResume.set("__resume__", "user typed this");
    stateWithResume.set("topic", "test");

    const result = await executor.execute({
      node,
      state: stateWithResume,
      config: {
        recursionLimit: 50,
        workingDirectory: "/tmp",
        modelProfileId: "test",
        checkpointPolicy: "none",
      },
      emitter: new (await import("../src/main/services/workflow-engine/event-emitter")).WorkflowEventEmitter(),
      signal: new AbortController().signal,
      runId: "test-run",
    });

    expect(result.writes).toEqual([{ channelName: "userInput", value: "user typed this" }]);
    expect(result.outputs.humanInput).toBe("user typed this");
  });

  it("should verify HumanInputNodeExecutor throws GraphInterrupt when __resume__ is absent", async () => {
    const executor = new HumanInputNodeExecutor();
    const node: WorkflowHumanInputNode = {
      id: "human-1",
      kind: "human-input",
      label: "Confirm action",
      humanInput: { formKey: "confirmation" },
    };

    const stateWithoutResume = new Map<string, unknown>();
    stateWithoutResume.set("topic", "test");

    await expect(
      executor.execute({
        node,
        state: stateWithoutResume,
        config: {
          recursionLimit: 50,
          workingDirectory: "/tmp",
          modelProfileId: "test",
          checkpointPolicy: "none",
        },
        emitter: new (await import("../src/main/services/workflow-engine/event-emitter")).WorkflowEventEmitter(),
        signal: new AbortController().signal,
        runId: "test-run",
      }),
    ).rejects.toThrow("GraphInterrupt");
  });
});

// ════════════════════════════════════════════════════════════════════════
// 5. Multiple checkpoints in sequence (channel version tracking)
// ════════════════════════════════════════════════════════════════════════

describe("Multiple Checkpoints in Sequence — Channel Version Tracking", () => {
  function buildFourNodeDefinition(): WorkflowDefinition {
    const nodes: WorkflowNode[] = [
      { id: "start-1", kind: "start", label: "Start" },
      {
        id: "llm-1",
        kind: "llm",
        label: "Step A",
        llm: { prompt: "Step A: {{input}}", outputKey: "outputA" },
      } as WorkflowLlmNode,
      {
        id: "llm-2",
        kind: "llm",
        label: "Step B",
        llm: { prompt: "Step B: {{outputA}}", outputKey: "outputB" },
      } as WorkflowLlmNode,
      { id: "end-1", kind: "end", label: "Done" },
    ];

    const edges: WorkflowEdge[] = [
      { id: "e1", fromNodeId: "start-1", toNodeId: "llm-1", kind: "normal" },
      { id: "e2", fromNodeId: "llm-1", toNodeId: "llm-2", kind: "normal" },
      { id: "e3", fromNodeId: "llm-2", toNodeId: "end-1", kind: "normal" },
    ];

    const stateSchema: WorkflowStateSchemaField[] = [
      {
        key: "input",
        label: "Input",
        description: "Initial input",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: [],
        consumerNodeIds: ["llm-1"],
      },
      {
        key: "outputA",
        label: "Output A",
        description: "First LLM output",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["llm-1"],
        consumerNodeIds: ["llm-2"],
      },
      {
        key: "outputB",
        label: "Output B",
        description: "Second LLM output",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: ["llm-2"],
        consumerNodeIds: [],
      },
    ];

    return {
      ...definitionBase("wf-four-node", "Four Node Pipeline"),
      entryNodeId: "start-1",
      nodes,
      edges,
      stateSchema,
      nodeCount: nodes.length,
      edgeCount: edges.length,
    };
  }

  it("should increment channel versions correctly at each step", async () => {
    const def = buildFourNodeDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    const result = await runner.run({ input: "version tracking" });

    expect(result.status).toBe("succeeded");

    // Verify that state-updated events have incrementing versions
    const stateUpdates = events.filter((e) => e.type === "state-updated");

    // outputA should have version 1 (set once by llm-1)
    const outputAUpdate = stateUpdates.find(
      (e) => e.type === "state-updated" && (e as any).channelName === "outputA",
    );
    expect(outputAUpdate).toBeDefined();
    if (outputAUpdate && outputAUpdate.type === "state-updated") {
      expect((outputAUpdate as any).version).toBe(1);
    }

    // outputB should have version 1 (set once by llm-2)
    const outputBUpdate = stateUpdates.find(
      (e) => e.type === "state-updated" && (e as any).channelName === "outputB",
    );
    expect(outputBUpdate).toBeDefined();
    if (outputBUpdate && outputBUpdate.type === "state-updated") {
      expect((outputBUpdate as any).version).toBe(1);
    }
  });

  it("should have all output channels populated in the final state", async () => {
    const def = buildFourNodeDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });

    const result = await runner.run({ input: "all outputs" });

    expect(result.status).toBe("succeeded");
    expect(result.finalState.input).toBe("all outputs");
    expect(result.finalState.outputA).toBe("AI response: analysis complete. ");
    expect(result.finalState.outputB).toBe("AI response: analysis complete. ");
  });

  it("should have step count matching number of node groups executed", async () => {
    const def = buildFourNodeDefinition();
    const registry = buildRegistry();
    const runner = new PregelRunner(def, defaultRunConfig(), { executorRegistry: registry });
    const events = collectEvents(runner);

    const result = await runner.run({ input: "step count" });

    expect(result.status).toBe("succeeded");
    // 4 nodes in sequence: start, llm-1, llm-2, end -> at least 4 steps
    expect(result.totalSteps).toBeGreaterThanOrEqual(4);

    // Verify step-start events match
    const stepStarts = events.filter((e) => e.type === "step-start");
    expect(stepStarts.length).toBe(result.totalSteps);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 6. SqliteCheckpointer
// ════════════════════════════════════════════════════════════════════════

describe("SqliteCheckpointer", () => {
  let checkpointer: SqliteCheckpointer;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = join(tmpdir(), `test-checkpoint-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`);
    checkpointer = new SqliteCheckpointer(dbPath);
    await checkpointer.init();
  });

  afterEach(() => {
    checkpointer.close();
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // ── Run management ──

  describe("createRun / getRun", () => {
    it("should create a run and retrieve it by id", () => {
      checkpointer.createRun({
        id: "run-1",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: { recursionLimit: 50 },
      });

      const run = checkpointer.getRun("run-1");
      expect(run).not.toBeNull();
      expect(run!.id).toBe("run-1");
      expect(run!.workflowId).toBe("wf-1");
      expect(run!.workflowVersion).toBe(1);
      expect(run!.status).toBe("queued");
      expect(run!.startedAt).toBeDefined();
    });

    it("should return null for non-existent run", () => {
      const run = checkpointer.getRun("non-existent");
      expect(run).toBeNull();
    });
  });

  describe("updateRunStatus", () => {
    it("should update run status and set finishedAt for terminal statuses", () => {
      checkpointer.createRun({
        id: "run-2",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: null,
      });

      checkpointer.updateRunStatus("run-2", "running");
      let run = checkpointer.getRun("run-2");
      expect(run!.status).toBe("running");
      expect(run!.finishedAt).toBeUndefined();

      checkpointer.updateRunStatus("run-2", "succeeded", { totalSteps: 5 });
      run = checkpointer.getRun("run-2");
      expect(run!.status).toBe("succeeded");
      expect(run!.totalSteps).toBe(5);
      expect(run!.finishedAt).toBeDefined();
    });

    it("should record error message on failure", () => {
      checkpointer.createRun({
        id: "run-err",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: null,
      });

      checkpointer.updateRunStatus("run-err", "failed", { error: "something broke" });
      const run = checkpointer.getRun("run-err");
      expect(run!.status).toBe("failed");
      expect(run!.error).toBe("something broke");
    });
  });

  describe("listRuns", () => {
    it("should list runs optionally filtered by workflowId", () => {
      checkpointer.createRun({
        id: "run-a",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: null,
      });
      checkpointer.createRun({
        id: "run-b",
        workflowId: "wf-2",
        workflowVersion: 1,
        config: null,
      });
      checkpointer.createRun({
        id: "run-c",
        workflowId: "wf-1",
        workflowVersion: 2,
        config: null,
      });

      const allRuns = checkpointer.listRuns();
      expect(allRuns.length).toBe(3);

      const wf1Runs = checkpointer.listRuns("wf-1");
      expect(wf1Runs.length).toBe(2);
      expect(wf1Runs.every((r) => r.workflowId === "wf-1")).toBe(true);
    });
  });

  // ── Checkpoint management ──

  describe("saveCheckpoint / getLatestCheckpoint", () => {
    it("should save a checkpoint and retrieve the latest one", () => {
      checkpointer.createRun({
        id: "run-cp",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: null,
      });

      const channelData = new Map<string, { version: number; value: unknown }>();
      channelData.set("topic", { version: 1, value: "hello" });
      channelData.set("output", { version: 1, value: "world" });

      checkpointer.saveCheckpoint({
        runId: "run-cp",
        checkpointId: "cp-1",
        parentId: null,
        step: 0,
        status: "running",
        channelVersions: { topic: 1, output: 1 },
        versionsSeen: { "start-1": { topic: 1, output: 0 } },
        triggeredNodes: ["start-1"],
        durationMs: 10,
        channelData,
      });

      const latest = checkpointer.getLatestCheckpoint("run-cp");
      expect(latest).not.toBeNull();
      expect(latest!.checkpointId).toBe("cp-1");
      expect(latest!.step).toBe(0);
      expect(latest!.status).toBe("running");
      expect(latest!.channelVersions).toEqual({ topic: 1, output: 1 });
      expect(latest!.triggeredNodes).toEqual(["start-1"]);
    });

    it("should return the checkpoint with the highest step", () => {
      checkpointer.createRun({
        id: "run-multi-cp",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: null,
      });

      // Save step 0
      checkpointer.saveCheckpoint({
        runId: "run-multi-cp",
        checkpointId: "cp-0",
        parentId: null,
        step: 0,
        status: "running",
        channelVersions: { topic: 1 },
        versionsSeen: {},
        triggeredNodes: ["start-1"],
        durationMs: 5,
        channelData: new Map([["topic", { version: 1, value: "v0" }]]),
      });

      // Save step 1
      checkpointer.saveCheckpoint({
        runId: "run-multi-cp",
        checkpointId: "cp-1",
        parentId: "cp-0",
        step: 1,
        status: "running",
        channelVersions: { topic: 1, output: 1 },
        versionsSeen: {},
        triggeredNodes: ["llm-1"],
        durationMs: 50,
        channelData: new Map([["output", { version: 1, value: "result" }]]),
      });

      // Save step 2
      checkpointer.saveCheckpoint({
        runId: "run-multi-cp",
        checkpointId: "cp-2",
        parentId: "cp-1",
        step: 2,
        status: "succeeded",
        channelVersions: { topic: 1, output: 1 },
        versionsSeen: {},
        triggeredNodes: ["end-1"],
        durationMs: 2,
        channelData: new Map(),
      });

      const latest = checkpointer.getLatestCheckpoint("run-multi-cp");
      expect(latest!.checkpointId).toBe("cp-2");
      expect(latest!.step).toBe(2);
      expect(latest!.status).toBe("succeeded");
      expect(latest!.parentId).toBe("cp-1");
    });

    it("should return null when no checkpoints exist for a run", () => {
      checkpointer.createRun({
        id: "run-empty",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: null,
      });

      const latest = checkpointer.getLatestCheckpoint("run-empty");
      expect(latest).toBeNull();
    });

    it("should persist interrupt payload when present", () => {
      checkpointer.createRun({
        id: "run-interrupt",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: null,
      });

      const interruptPayload = {
        type: "input" as const,
        nodeId: "human-1",
        formKey: "userConfirmation",
        prompt: "Please confirm",
        currentState: { topic: "test" },
      };

      checkpointer.saveCheckpoint({
        runId: "run-interrupt",
        checkpointId: "cp-int",
        parentId: null,
        step: 2,
        status: "interrupted",
        channelVersions: { topic: 1 },
        versionsSeen: {},
        triggeredNodes: ["human-1"],
        durationMs: 0,
        interruptPayload,
        channelData: new Map([["topic", { version: 1, value: "test" }]]),
      });

      const latest = checkpointer.getLatestCheckpoint("run-interrupt");
      expect(latest!.interruptPayload).toBeDefined();
      expect(latest!.interruptPayload).toEqual(interruptPayload);
    });
  });

  describe("listCheckpoints", () => {
    it("should list checkpoints in descending step order", () => {
      checkpointer.createRun({
        id: "run-list",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: null,
      });

      for (let i = 0; i < 4; i++) {
        checkpointer.saveCheckpoint({
          runId: "run-list",
          checkpointId: `cp-${i}`,
          parentId: i > 0 ? `cp-${i - 1}` : null,
          step: i,
          status: i < 3 ? "running" : "succeeded",
          channelVersions: { counter: i + 1 },
          versionsSeen: {},
          triggeredNodes: [`node-${i}`],
          durationMs: i * 10,
          channelData: new Map([["counter", { version: i + 1, value: i }]]),
        });
      }

      const summaries = checkpointer.listCheckpoints("run-list");
      expect(summaries.length).toBe(4);
      // Should be ordered descending by step
      expect(summaries[0].step).toBe(3);
      expect(summaries[1].step).toBe(2);
      expect(summaries[2].step).toBe(1);
      expect(summaries[3].step).toBe(0);
    });

    it("should return empty array for a run with no checkpoints", () => {
      const summaries = checkpointer.listCheckpoints("non-existent");
      expect(summaries).toEqual([]);
    });
  });

  describe("restoreChannelData", () => {
    it("should restore channel values matching the requested versions", () => {
      checkpointer.createRun({
        id: "run-restore",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: null,
      });

      const channelData = new Map<string, { version: number; value: unknown }>();
      channelData.set("topic", { version: 1, value: "hello world" });
      channelData.set("output", { version: 2, value: { nested: "data" } });
      channelData.set("counter", { version: 3, value: 42 });

      checkpointer.saveCheckpoint({
        runId: "run-restore",
        checkpointId: "cp-r",
        parentId: null,
        step: 0,
        status: "running",
        channelVersions: { topic: 1, output: 2, counter: 3 },
        versionsSeen: {},
        triggeredNodes: [],
        durationMs: 0,
        channelData,
      });

      const restored = checkpointer.restoreChannelData("run-restore", {
        topic: 1,
        output: 2,
        counter: 3,
      });

      expect(restored.get("topic")).toBe("hello world");
      expect(restored.get("output")).toEqual({ nested: "data" });
      expect(restored.get("counter")).toBe(42);
    });

    it("should return empty map for missing versions", () => {
      const restored = checkpointer.restoreChannelData("non-existent", { foo: 99 });
      expect(restored.size).toBe(0);
    });

    it("should handle partial version match", () => {
      checkpointer.createRun({
        id: "run-partial",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: null,
      });

      const channelData = new Map<string, { version: number; value: unknown }>();
      channelData.set("exists", { version: 1, value: "found" });

      checkpointer.saveCheckpoint({
        runId: "run-partial",
        checkpointId: "cp-p",
        parentId: null,
        step: 0,
        status: "running",
        channelVersions: { exists: 1 },
        versionsSeen: {},
        triggeredNodes: [],
        durationMs: 0,
        channelData,
      });

      const restored = checkpointer.restoreChannelData("run-partial", {
        exists: 1,
        missing: 5,
      });

      expect(restored.get("exists")).toBe("found");
      expect(restored.has("missing")).toBe(false);
    });
  });

  // ── Cleanup ──

  describe("deleteRunData", () => {
    it("should delete all data for a run", () => {
      checkpointer.createRun({
        id: "run-del",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: null,
      });

      checkpointer.saveCheckpoint({
        runId: "run-del",
        checkpointId: "cp-del",
        parentId: null,
        step: 0,
        status: "running",
        channelVersions: { x: 1 },
        versionsSeen: {},
        triggeredNodes: [],
        durationMs: 0,
        channelData: new Map([["x", { version: 1, value: "val" }]]),
      });

      checkpointer.deleteRunData("run-del");

      expect(checkpointer.getRun("run-del")).toBeNull();
      expect(checkpointer.listCheckpoints("run-del")).toEqual([]);
      expect(checkpointer.restoreChannelData("run-del", { x: 1 }).size).toBe(0);
    });
  });

  describe("cleanup (keep last N checkpoints)", () => {
    it("should keep only the last N checkpoints and remove older ones", () => {
      checkpointer.createRun({
        id: "run-cleanup",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: null,
      });

      // Create 5 checkpoints
      for (let i = 0; i < 5; i++) {
        checkpointer.saveCheckpoint({
          runId: "run-cleanup",
          checkpointId: `cp-${i}`,
          parentId: i > 0 ? `cp-${i - 1}` : null,
          step: i,
          status: "running",
          channelVersions: { data: i + 1 },
          versionsSeen: {},
          triggeredNodes: [`node-${i}`],
          durationMs: 0,
          channelData: new Map([["data", { version: i + 1, value: `step-${i}` }]]),
        });
      }

      expect(checkpointer.listCheckpoints("run-cleanup").length).toBe(5);

      // Keep last 2
      checkpointer.cleanup("run-cleanup", 2);

      const remaining = checkpointer.listCheckpoints("run-cleanup");
      expect(remaining.length).toBe(2);
      // Should keep the two most recent (step 3 and step 4)
      expect(remaining[0].step).toBe(4);
      expect(remaining[1].step).toBe(3);
    });

    it("should not remove anything when fewer checkpoints than keepLastN", () => {
      checkpointer.createRun({
        id: "run-no-cleanup",
        workflowId: "wf-1",
        workflowVersion: 1,
        config: null,
      });

      checkpointer.saveCheckpoint({
        runId: "run-no-cleanup",
        checkpointId: "cp-only",
        parentId: null,
        step: 0,
        status: "running",
        channelVersions: { x: 1 },
        versionsSeen: {},
        triggeredNodes: [],
        durationMs: 0,
        channelData: new Map([["x", { version: 1, value: "only" }]]),
      });

      checkpointer.cleanup("run-no-cleanup", 5);
      expect(checkpointer.listCheckpoints("run-no-cleanup").length).toBe(1);
    });
  });
});
