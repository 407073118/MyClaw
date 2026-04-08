# Workflow Execution Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Pregel-based workflow execution engine that supports cycles, checkpointing, streaming, and human-in-the-loop, reusing existing Session infrastructure (callModel, BuiltinToolExecutor, McpServerManager, approval system).

**Architecture:** Hybrid Pregel — a lightweight Channel + superstep scheduler handles graph traversal and cycles, while NodeExecutor implementations delegate to existing callModel/ToolExecutor/MCP infrastructure. SQLite (sql.js, already in deps) stores checkpoints and run history. Events flow through an internal EventEmitter bridged to IPC `workflow:stream` channel.

**Tech Stack:** TypeScript, Electron IPC, sql.js (SQLite), vitest, existing model-client.ts / builtin-tool-executor.ts / mcp-server-manager.ts

**Key files to read before starting:**
- `desktop/shared/contracts/workflow.ts` — existing workflow types (270 lines)
- `desktop/shared/contracts/workflow-run.ts` — existing run types (23 lines)
- `desktop/src/main/ipc/workflows.ts` — existing IPC handlers (195 lines, contains stubs)
- `desktop/src/main/services/runtime-context.ts` — RuntimeContext shape
- `desktop/src/main/services/model-client.ts` — callModel function
- `desktop/src/main/services/builtin-tool-executor.ts` — tool executor
- `desktop/src/main/services/mcp-server-manager.ts` — MCP tool calls
- `desktop/shared/contracts/approval.ts` — approval types and shouldRequestApproval
- `desktop/shared/contracts/events.ts` — EventType enum, ToolRiskCategory

**Test command:** `cd F:/MyClaw/desktop && pnpm test`
**Single test:** `cd F:/MyClaw/desktop && npx vitest run tests/<file>.test.ts`

---

## Phase 1: Engine Core (Minimal Runnable Loop)

Goal: Start → LLM → Tool → Condition → End linear+branch flows execute end-to-end.

All new engine files go in `desktop/src/main/services/workflow-engine/`.

---

### Task 1: Contract Extensions — WorkflowRunConfig + WorkflowStreamEvent + GraphInterrupt

Extend the shared contracts with types the engine needs. All new fields on existing types are optional for backward compat.

**Files:**
- Modify: `desktop/shared/contracts/workflow.ts`
- Modify: `desktop/shared/contracts/workflow-run.ts`
- Create: `desktop/shared/contracts/workflow-stream.ts`
- Modify: `desktop/shared/contracts/index.ts`

**Step 1: Add WorkflowRunConfig and inputBindings/outputBindings to workflow.ts**

Append to bottom of `desktop/shared/contracts/workflow.ts`:

```typescript
// ── Engine Extensions (backward-compatible, all optional) ──

export type WorkflowRunConfig = {
  /** Max supersteps before forced stop (default 50) */
  recursionLimit: number;
  /** Working directory for tool execution */
  workingDirectory: string;
  /** Model profile ID for LLM nodes */
  modelProfileId: string;
  /** Checkpoint strategy */
  checkpointPolicy: "every-step" | "on-interrupt" | "none";
  /** Max nodes executing in parallel per superstep */
  maxParallelNodes?: number;
  /** Custom variables passed to node executors */
  variables?: Record<string, unknown>;
};
```

Also add optional fields to `WorkflowNodeBase` (line 188-193 area). Add after `policy?`:

```typescript
  /** Declare which channels this node reads from */
  inputBindings?: Record<string, string>;
  /** Declare which channels this node writes to */
  outputBindings?: Record<string, string>;
```

Add to `WorkflowDefinition.defaults` (line 263-269 area):

```typescript
    /** Allow cycles (back-edges) in the graph */
    allowCycles?: boolean;
```

**Step 2: Extend WorkflowRunSummary in workflow-run.ts**

Add fields to `WorkflowRunSummary` (after `finishedAt?`):

```typescript
  totalSteps?: number;
  error?: string;
```

Add checkpoint summary type at bottom of file:

```typescript
export type WorkflowCheckpointSummary = {
  checkpointId: string;
  step: number;
  status: "running" | "interrupted" | "succeeded" | "failed";
  triggeredNodes: string[];
  durationMs: number;
  createdAt: string;
  interruptPayload?: WorkflowInterruptPayload;
};

export type WorkflowInterruptPayload = {
  type: "input" | "approval" | "review";
  nodeId: string;
  formKey: string;
  prompt: string;
  currentState: Record<string, unknown>;
};
```

**Step 3: Create workflow-stream.ts**

Create `desktop/shared/contracts/workflow-stream.ts`:

```typescript
import type { WorkflowNodeKind } from "./workflow";
import type { WorkflowRunStatus, WorkflowInterruptPayload } from "./workflow-run";

export type WorkflowStreamEvent =
  | { type: "run-start"; runId: string; workflowId: string }
  | { type: "run-complete"; runId: string; status: WorkflowRunStatus;
      finalState: Record<string, unknown>; totalSteps: number; durationMs: number }
  | { type: "step-start"; runId: string; step: number; nodes: string[] }
  | { type: "step-complete"; runId: string; step: number;
      updatedChannels: string[]; durationMs: number }
  | { type: "node-start"; runId: string; nodeId: string; nodeKind: WorkflowNodeKind }
  | { type: "node-streaming"; runId: string; nodeId: string;
      chunk: { content?: string; reasoning?: string } }
  | { type: "node-complete"; runId: string; nodeId: string;
      outputs: Record<string, unknown>; durationMs: number }
  | { type: "node-error"; runId: string; nodeId: string;
      error: string; willRetry: boolean; attempt: number }
  | { type: "state-updated"; runId: string; channelName: string;
      value: unknown; version: number }
  | { type: "checkpoint-saved"; runId: string; checkpointId: string;
      step: number; status: string }
  | { type: "interrupt-requested"; runId: string; nodeId: string;
      payload: WorkflowInterruptPayload }
  | { type: "interrupt-resumed"; runId: string; nodeId: string;
      resumeValue: unknown };
```

**Step 4: Export from index.ts**

Add to `desktop/shared/contracts/index.ts`:

```typescript
export * from "./workflow-stream";
```

**Step 5: Run typecheck**

Run: `cd F:/MyClaw/desktop && npx tsc --noEmit -p tsconfig.main.json`
Expected: PASS (no errors — all new fields are optional)

**Step 6: Commit**

```bash
git add desktop/shared/contracts/workflow.ts desktop/shared/contracts/workflow-run.ts desktop/shared/contracts/workflow-stream.ts desktop/shared/contracts/index.ts
git commit -m "feat(workflow): extend contracts with WorkflowRunConfig, stream events, and engine-ready types"
```

---

### Task 2: Channel System — LastValue, Reducer, Ephemeral

Core state management primitives. Pure logic, no dependencies.

**Files:**
- Create: `desktop/src/main/services/workflow-engine/channels.ts`
- Create: `desktop/tests/workflow-engine-channels.test.ts`

**Step 1: Write failing tests**

Create `desktop/tests/workflow-engine-channels.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  LastValueChannel,
  ReducerChannel,
  EphemeralChannel,
  compileChannels,
} from "../src/main/services/workflow-engine/channels";
import type { WorkflowStateSchemaField } from "@shared/contracts";

describe("LastValueChannel", () => {
  it("stores last written value", () => {
    const ch = new LastValueChannel<string>("test", "");
    expect(ch.get()).toBe("");
    const changed = ch.update(["hello"]);
    expect(changed).toBe(true);
    expect(ch.get()).toBe("hello");
    expect(ch.version).toBe(1);
  });

  it("returns false when value unchanged", () => {
    const ch = new LastValueChannel<string>("test", "hello");
    ch.update(["hello"]);
    const changed = ch.update(["hello"]);
    expect(changed).toBe(false);
  });

  it("keeps last value when multiple updates", () => {
    const ch = new LastValueChannel<string>("test", "");
    ch.update(["a", "b", "c"]);
    expect(ch.get()).toBe("c");
  });

  it("checkpoints and restores", () => {
    const ch = new LastValueChannel<string>("test", "");
    ch.update(["saved"]);
    const cp = ch.checkpoint();
    ch.update(["overwritten"]);
    ch.fromCheckpoint(cp);
    expect(ch.get()).toBe("saved");
  });
});

describe("ReducerChannel", () => {
  it("appends arrays", () => {
    const ch = new ReducerChannel<string[]>(
      "messages",
      (cur, upd) => [...cur, ...upd],
      [],
    );
    ch.update([["hello"]]);
    ch.update([["world"]]);
    expect(ch.get()).toEqual(["hello", "world"]);
    expect(ch.version).toBe(2);
  });

  it("merges from multiple writers in one superstep", () => {
    const ch = new ReducerChannel<string[]>(
      "messages",
      (cur, upd) => [...cur, ...upd],
      [],
    );
    // Two nodes write in same superstep
    ch.update([["from-node-a"], ["from-node-b"]]);
    expect(ch.get()).toEqual(["from-node-a", "from-node-b"]);
  });

  it("checkpoints and restores", () => {
    const ch = new ReducerChannel<number>(
      "counter",
      (cur, upd) => cur + upd,
      0,
    );
    ch.update([5]);
    ch.update([3]);
    const cp = ch.checkpoint();
    ch.update([100]);
    ch.fromCheckpoint(cp);
    expect(ch.get()).toBe(8);
  });
});

describe("EphemeralChannel", () => {
  it("stores value then clears on reset", () => {
    const ch = new EphemeralChannel<string>("signal");
    ch.update(["go"]);
    expect(ch.get()).toBe("go");
    ch.reset();
    expect(ch.get()).toBeUndefined();
  });
});

describe("compileChannels", () => {
  it("creates channels from state schema", () => {
    const schema: WorkflowStateSchemaField[] = [
      {
        key: "result",
        label: "Result",
        description: "",
        valueType: "string",
        mergeStrategy: "replace",
        required: false,
        producerNodeIds: [],
        consumerNodeIds: [],
      },
      {
        key: "messages",
        label: "Messages",
        description: "",
        valueType: "array",
        mergeStrategy: "append",
        required: false,
        producerNodeIds: [],
        consumerNodeIds: [],
      },
    ];

    const channels = compileChannels(schema);
    expect(channels.has("result")).toBe(true);
    expect(channels.has("messages")).toBe(true);
    // Internal control channels
    expect(channels.has("__route__")).toBe(true);
    expect(channels.has("__interrupt__")).toBe(true);
    expect(channels.has("__resume__")).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/workflow-engine-channels.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement channels.ts**

Create `desktop/src/main/services/workflow-engine/channels.ts`:

```typescript
import type { WorkflowMergeStrategy, WorkflowStateSchemaField } from "@shared/contracts";

export interface Channel<Value = unknown, Update = unknown> {
  readonly name: string;
  version: number;
  get(): Value | undefined;
  update(values: Update[]): boolean;
  checkpoint(): unknown;
  fromCheckpoint(data: unknown): void;
  reset(): void;
}

export class LastValueChannel<T> implements Channel<T, T> {
  version = 0;
  private value: T;

  constructor(
    public readonly name: string,
    private defaultValue: T,
  ) {
    this.value = defaultValue;
  }

  get(): T {
    return this.value;
  }

  update(values: T[]): boolean {
    if (values.length === 0) return false;
    const newValue = values[values.length - 1];
    if (this.value === newValue) return false;
    this.value = newValue;
    this.version++;
    return true;
  }

  checkpoint(): unknown {
    return { value: this.value, version: this.version };
  }

  fromCheckpoint(data: unknown): void {
    const cp = data as { value: T; version: number };
    this.value = cp.value;
    this.version = cp.version;
  }

  reset(): void {
    this.value = this.defaultValue;
    this.version = 0;
  }
}

export class ReducerChannel<T> implements Channel<T, T> {
  version = 0;
  private value: T;

  constructor(
    public readonly name: string,
    private reducer: (current: T, update: T) => T,
    private defaultValue: T,
  ) {
    this.value = defaultValue;
  }

  get(): T {
    return this.value;
  }

  update(values: T[]): boolean {
    if (values.length === 0) return false;
    const prev = this.value;
    for (const v of values) {
      this.value = this.reducer(this.value, v);
    }
    if (this.value === prev) return false;
    this.version++;
    return true;
  }

  checkpoint(): unknown {
    return { value: this.value, version: this.version };
  }

  fromCheckpoint(data: unknown): void {
    const cp = data as { value: T; version: number };
    this.value = cp.value;
    this.version = cp.version;
  }

  reset(): void {
    this.value = this.defaultValue;
    this.version = 0;
  }
}

export class EphemeralChannel<T> implements Channel<T, T> {
  version = 0;
  private value: T | undefined = undefined;

  constructor(public readonly name: string) {}

  get(): T | undefined {
    return this.value;
  }

  update(values: T[]): boolean {
    if (values.length === 0) return false;
    this.value = values[values.length - 1];
    this.version++;
    return true;
  }

  checkpoint(): unknown {
    return null; // ephemeral — not persisted
  }

  fromCheckpoint(): void {
    this.value = undefined;
  }

  reset(): void {
    this.value = undefined;
  }
}

// ── Merge strategy → reducer mapping ──

function appendReducer<T>(current: T[], update: T[]): T[] {
  return [...current, ...update];
}

function unionReducer<T>(current: T[], update: T[]): T[] {
  return [...new Set([...current, ...update])];
}

function objectMergeReducer(
  current: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  return { ...current, ...update };
}

function getDefaultForType(valueType: string): unknown {
  switch (valueType) {
    case "string": return "";
    case "number": return 0;
    case "boolean": return false;
    case "object": return {};
    case "array": return [];
    default: return null;
  }
}

export function compileChannels(
  schema: WorkflowStateSchemaField[],
): Map<string, Channel> {
  const channels = new Map<string, Channel>();

  for (const field of schema) {
    const defaultVal = getDefaultForType(field.valueType);

    switch (field.mergeStrategy) {
      case "replace":
        channels.set(field.key, new LastValueChannel(field.key, defaultVal));
        break;
      case "append":
        channels.set(field.key, new ReducerChannel(field.key, appendReducer as any, defaultVal));
        break;
      case "union":
        channels.set(field.key, new ReducerChannel(field.key, unionReducer as any, defaultVal));
        break;
      case "object-merge":
        channels.set(field.key, new ReducerChannel(field.key, objectMergeReducer as any, defaultVal));
        break;
      case "custom":
        // Custom reducers fall back to replace for now
        channels.set(field.key, new LastValueChannel(field.key, defaultVal));
        break;
    }
  }

  // Internal control channels
  channels.set("__route__", new EphemeralChannel("__route__"));
  channels.set("__interrupt__", new EphemeralChannel("__interrupt__"));
  channels.set("__resume__", new EphemeralChannel("__resume__"));
  channels.set("__done__", new EphemeralChannel("__done__"));

  return channels;
}
```

**Step 4: Run tests**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/workflow-engine-channels.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/services/workflow-engine/channels.ts desktop/tests/workflow-engine-channels.test.ts
git commit -m "feat(workflow): implement Channel system — LastValue, Reducer, Ephemeral with compileChannels"
```

---

### Task 3: GraphInterrupt + Errors

**Files:**
- Create: `desktop/src/main/services/workflow-engine/errors.ts`

**Step 1: Create errors.ts**

```typescript
export type InterruptPayload = {
  type: "input" | "approval" | "review";
  nodeId: string;
  formKey: string;
  prompt: string;
  currentState: Record<string, unknown>;
};

export class GraphInterrupt extends Error {
  constructor(public readonly payload: InterruptPayload) {
    super(`GraphInterrupt at node ${payload.nodeId}`);
    this.name = "GraphInterrupt";
  }
}

export function isGraphInterrupt(err: unknown): err is GraphInterrupt {
  return err instanceof GraphInterrupt;
}

export class RecursionLimitError extends Error {
  constructor(
    public readonly step: number,
    public readonly limit: number,
  ) {
    super(`Recursion limit ${limit} reached at step ${step}`);
    this.name = "RecursionLimitError";
  }
}
```

**Step 2: Commit**

```bash
git add desktop/src/main/services/workflow-engine/errors.ts
git commit -m "feat(workflow): add GraphInterrupt and RecursionLimitError"
```

---

### Task 4: WorkflowEventEmitter

**Files:**
- Create: `desktop/src/main/services/workflow-engine/event-emitter.ts`

**Step 1: Create event-emitter.ts**

```typescript
import type { WorkflowStreamEvent } from "@shared/contracts";

export type WorkflowEventListener = (event: WorkflowStreamEvent) => void;

export class WorkflowEventEmitter {
  private listeners: WorkflowEventListener[] = [];

  on(listener: WorkflowEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(event: WorkflowStreamEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[workflow-emitter] listener error", err);
      }
    }
  }
}
```

**Step 2: Commit**

```bash
git add desktop/src/main/services/workflow-engine/event-emitter.ts
git commit -m "feat(workflow): add WorkflowEventEmitter with listener isolation"
```

---

### Task 5: NodeExecutor Interface + Start/End/Condition Executors

Pure logic executors — no external dependencies.

**Files:**
- Create: `desktop/src/main/services/workflow-engine/node-executor.ts`
- Create: `desktop/src/main/services/workflow-engine/executors/start.ts`
- Create: `desktop/src/main/services/workflow-engine/executors/end.ts`
- Create: `desktop/src/main/services/workflow-engine/executors/condition.ts`
- Create: `desktop/tests/workflow-engine-executors.test.ts`

**Step 1: Write failing tests**

Create `desktop/tests/workflow-engine-executors.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { StartNodeExecutor } from "../src/main/services/workflow-engine/executors/start";
import { EndNodeExecutor } from "../src/main/services/workflow-engine/executors/end";
import { ConditionNodeExecutor } from "../src/main/services/workflow-engine/executors/condition";
import { WorkflowEventEmitter } from "../src/main/services/workflow-engine/event-emitter";
import type { WorkflowStartNode, WorkflowEndNode, WorkflowConditionNode } from "@shared/contracts";

function makeCtx(node: any, state: Record<string, unknown> = {}) {
  return {
    node,
    state: new Map(Object.entries(state)),
    config: { recursionLimit: 50, workingDirectory: "/tmp", modelProfileId: "default", checkpointPolicy: "every-step" as const },
    emitter: new WorkflowEventEmitter(),
    signal: new AbortController().signal,
    runId: "test-run",
  };
}

describe("StartNodeExecutor", () => {
  it("produces no writes (passthrough)", async () => {
    const exec = new StartNodeExecutor();
    const result = await exec.execute(makeCtx({ id: "s1", kind: "start", label: "Start" }));
    expect(result.writes).toEqual([]);
  });
});

describe("EndNodeExecutor", () => {
  it("writes __done__ signal", async () => {
    const exec = new EndNodeExecutor();
    const result = await exec.execute(makeCtx({ id: "e1", kind: "end", label: "End" }));
    expect(result.writes).toEqual([{ channelName: "__done__", value: true }]);
  });
});

describe("ConditionNodeExecutor", () => {
  it("routes to trueNodeId when condition matches", async () => {
    const node: WorkflowConditionNode = {
      id: "c1", kind: "condition", label: "Check",
      condition: { operator: "equals", leftPath: "$.status", rightValue: "ready" },
      route: { trueNodeId: "n-yes", falseNodeId: "n-no" },
    };
    const exec = new ConditionNodeExecutor();
    const result = await exec.execute(makeCtx(node, { status: "ready" }));
    expect(result.writes).toEqual([{ channelName: "__route__", value: "n-yes" }]);
  });

  it("routes to falseNodeId when condition fails", async () => {
    const node: WorkflowConditionNode = {
      id: "c1", kind: "condition", label: "Check",
      condition: { operator: "equals", leftPath: "$.status", rightValue: "ready" },
      route: { trueNodeId: "n-yes", falseNodeId: "n-no" },
    };
    const exec = new ConditionNodeExecutor();
    const result = await exec.execute(makeCtx(node, { status: "pending" }));
    expect(result.writes).toEqual([{ channelName: "__route__", value: "n-no" }]);
  });

  it("handles exists operator", async () => {
    const node: WorkflowConditionNode = {
      id: "c1", kind: "condition", label: "Check",
      condition: { operator: "exists", leftPath: "$.data" },
      route: { trueNodeId: "n-yes", falseNodeId: "n-no" },
    };
    const exec = new ConditionNodeExecutor();
    const result = await exec.execute(makeCtx(node, { data: "something" }));
    expect(result.writes).toEqual([{ channelName: "__route__", value: "n-yes" }]);
  });
});
```

**Step 2: Run to verify failure**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/workflow-engine-executors.test.ts`

**Step 3: Create node-executor.ts interface**

```typescript
import type { WorkflowNode, WorkflowNodeKind, WorkflowRunConfig } from "@shared/contracts";
import type { WorkflowEventEmitter } from "./event-emitter";

export type NodeWrite = {
  channelName: string;
  value: unknown;
};

export type NodeExecutionContext = {
  node: WorkflowNode;
  state: ReadonlyMap<string, unknown>;
  config: WorkflowRunConfig;
  emitter: WorkflowEventEmitter;
  signal: AbortSignal;
  runId: string;
};

export type NodeExecutionResult = {
  writes: NodeWrite[];
  outputs: Record<string, unknown>;
  durationMs: number;
};

export interface NodeExecutor {
  readonly kind: WorkflowNodeKind;
  execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult>;
}

export class NodeExecutorRegistry {
  private executors = new Map<WorkflowNodeKind, NodeExecutor>();

  register(executor: NodeExecutor): void {
    this.executors.set(executor.kind, executor);
  }

  get(kind: WorkflowNodeKind): NodeExecutor {
    const exec = this.executors.get(kind);
    if (!exec) throw new Error(`[workflow] No executor registered for node kind: ${kind}`);
    return exec;
  }
}
```

**Step 4: Create executors/start.ts**

```typescript
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";

export class StartNodeExecutor implements NodeExecutor {
  readonly kind = "start" as const;

  async execute(_ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    return { writes: [], outputs: {}, durationMs: 0 };
  }
}
```

**Step 5: Create executors/end.ts**

```typescript
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";

export class EndNodeExecutor implements NodeExecutor {
  readonly kind = "end" as const;

  async execute(_ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    return {
      writes: [{ channelName: "__done__", value: true }],
      outputs: {},
      durationMs: 0,
    };
  }
}
```

**Step 6: Create executors/condition.ts**

```typescript
import type { WorkflowConditionNode, WorkflowTransitionConditionOperator } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";

/** Resolve a simple JSONPath like "$.status" or "$.data.count" from state map */
function resolveJsonPath(path: string, state: ReadonlyMap<string, unknown>): unknown {
  // Strip leading "$."
  const key = path.startsWith("$.") ? path.slice(2) : path;
  const parts = key.split(".");

  let current: unknown = state.get(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[parts[i]];
  }
  return current;
}

function evaluateCondition(
  operator: WorkflowTransitionConditionOperator,
  leftValue: unknown,
  rightValue: unknown,
): boolean {
  switch (operator) {
    case "equals": return leftValue === rightValue;
    case "not-equals": return leftValue !== rightValue;
    case "greater-than": return Number(leftValue) > Number(rightValue);
    case "greater-or-equal": return Number(leftValue) >= Number(rightValue);
    case "less-than": return Number(leftValue) < Number(rightValue);
    case "less-or-equal": return Number(leftValue) <= Number(rightValue);
    case "exists": return leftValue !== undefined && leftValue !== null;
    case "not-exists": return leftValue === undefined || leftValue === null;
    case "in": return Array.isArray(rightValue) && rightValue.includes(leftValue);
    case "not-in": return !Array.isArray(rightValue) || !rightValue.includes(leftValue);
    default: return false;
  }
}

export class ConditionNodeExecutor implements NodeExecutor {
  readonly kind = "condition" as const;

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const node = ctx.node as WorkflowConditionNode;

    if (!node.condition || !node.route) {
      return { writes: [], outputs: { error: "missing condition or route" }, durationMs: Date.now() - start };
    }

    const leftValue = resolveJsonPath(node.condition.leftPath, ctx.state);
    const result = evaluateCondition(node.condition.operator, leftValue, node.condition.rightValue);
    const targetNodeId = result ? node.route.trueNodeId : node.route.falseNodeId;

    return {
      writes: targetNodeId ? [{ channelName: "__route__", value: targetNodeId }] : [],
      outputs: { conditionResult: result, targetNodeId },
      durationMs: Date.now() - start,
    };
  }
}

export { resolveJsonPath, evaluateCondition };
```

**Step 7: Run tests**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/workflow-engine-executors.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add desktop/src/main/services/workflow-engine/node-executor.ts desktop/src/main/services/workflow-engine/executors/ desktop/tests/workflow-engine-executors.test.ts
git commit -m "feat(workflow): add NodeExecutor interface with Start, End, and Condition executors"
```

---

### Task 6: Graph Compiler — Definition → Subscriptions + Output Map

Converts a WorkflowDefinition into the subscription/output maps the PregelRunner needs.

**Files:**
- Create: `desktop/src/main/services/workflow-engine/graph-compiler.ts`
- Create: `desktop/tests/workflow-engine-compiler.test.ts`

**Step 1: Write failing tests**

Create `desktop/tests/workflow-engine-compiler.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { compileGraph } from "../src/main/services/workflow-engine/graph-compiler";
import type { WorkflowDefinition } from "@shared/contracts";

function makeLinearDef(): WorkflowDefinition {
  return {
    id: "w1", name: "test", description: "", status: "draft", source: "personal",
    version: 1, updatedAt: "", nodeCount: 3, edgeCount: 2, libraryRootId: "",
    entryNodeId: "start",
    nodes: [
      { id: "start", kind: "start", label: "Start" },
      { id: "llm1", kind: "llm", label: "LLM", llm: { prompt: "hello" } },
      { id: "end", kind: "end", label: "End" },
    ],
    edges: [
      { id: "e1", kind: "normal", fromNodeId: "start", toNodeId: "llm1" },
      { id: "e2", kind: "normal", fromNodeId: "llm1", toNodeId: "end" },
    ],
    stateSchema: [
      { key: "result", label: "Result", description: "", valueType: "string",
        mergeStrategy: "replace", required: false, producerNodeIds: ["llm1"], consumerNodeIds: ["end"] },
    ],
  };
}

describe("compileGraph", () => {
  it("builds node subscriptions from edges", () => {
    const compiled = compileGraph(makeLinearDef());
    // llm1 is downstream of start, so it subscribes to channels produced by start
    // But start has no producerNodeIds in schema, so llm1 subscribes to implicit "__started__"
    expect(compiled.nodeSubscriptions.has("llm1")).toBe(true);
    expect(compiled.nodeSubscriptions.has("end")).toBe(true);
  });

  it("identifies entry nodes", () => {
    const compiled = compileGraph(makeLinearDef());
    expect(compiled.entryNodeId).toBe("start");
  });

  it("builds adjacency list", () => {
    const compiled = compileGraph(makeLinearDef());
    expect(compiled.adjacency.get("start")).toContain("llm1");
    expect(compiled.adjacency.get("llm1")).toContain("end");
  });
});
```

**Step 2: Run to verify failure**

**Step 3: Implement graph-compiler.ts**

```typescript
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "@shared/contracts";

export type CompiledGraph = {
  entryNodeId: string;
  /** nodeId → downstream nodeIds (from edges) */
  adjacency: Map<string, string[]>;
  /** nodeId → channel names this node subscribes to (triggers execution) */
  nodeSubscriptions: Map<string, string[]>;
  /** nodeId → channel names this node writes to */
  nodeOutputs: Map<string, string[]>;
  /** All node definitions indexed by ID */
  nodeMap: Map<string, WorkflowNode>;
  /** All edges */
  edges: WorkflowEdge[];
};

export function compileGraph(def: WorkflowDefinition): CompiledGraph {
  const nodeMap = new Map(def.nodes.map((n) => [n.id, n]));

  // Build adjacency from edges
  const adjacency = new Map<string, string[]>();
  for (const node of def.nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of def.edges) {
    const list = adjacency.get(edge.fromNodeId);
    if (list && !list.includes(edge.toNodeId)) {
      list.push(edge.toNodeId);
    }
  }

  // Build output map from stateSchema.producerNodeIds
  const nodeOutputs = new Map<string, string[]>();
  for (const node of def.nodes) {
    nodeOutputs.set(node.id, []);
  }
  for (const field of def.stateSchema) {
    for (const producerId of field.producerNodeIds) {
      const outputs = nodeOutputs.get(producerId);
      if (outputs && !outputs.includes(field.key)) {
        outputs.push(field.key);
      }
    }
  }

  // Also derive outputs from node outputBindings if present
  for (const node of def.nodes) {
    if (node.outputBindings) {
      const outputs = nodeOutputs.get(node.id) ?? [];
      for (const channelName of Object.values(node.outputBindings)) {
        if (!outputs.includes(channelName)) outputs.push(channelName);
      }
      nodeOutputs.set(node.id, outputs);
    }
    // Legacy: derive from outputKey
    if ("llm" in node && node.llm?.outputKey) {
      const outputs = nodeOutputs.get(node.id) ?? [];
      if (!outputs.includes(node.llm.outputKey)) outputs.push(node.llm.outputKey);
      nodeOutputs.set(node.id, outputs);
    }
    if ("tool" in node && node.tool?.outputKey) {
      const outputs = nodeOutputs.get(node.id) ?? [];
      if (!outputs.includes(node.tool.outputKey)) outputs.push(node.tool.outputKey);
      nodeOutputs.set(node.id, outputs);
    }
  }

  // Build subscriptions: a node subscribes to channels produced by its upstream nodes
  const nodeSubscriptions = new Map<string, string[]>();
  for (const node of def.nodes) {
    const channels = new Set<string>();

    // Find upstream nodes via edges
    const upstreamNodeIds = def.edges
      .filter((e) => e.toNodeId === node.id)
      .map((e) => e.fromNodeId);

    for (const upId of upstreamNodeIds) {
      const upOutputs = nodeOutputs.get(upId) ?? [];
      for (const ch of upOutputs) channels.add(ch);
    }

    // Also subscribe to channels declared in consumerNodeIds
    for (const field of def.stateSchema) {
      if (field.consumerNodeIds.includes(node.id)) {
        channels.add(field.key);
      }
    }

    // Also subscribe to channels from inputBindings
    if (node.inputBindings) {
      for (const channelName of Object.values(node.inputBindings)) {
        channels.add(channelName);
      }
    }

    nodeSubscriptions.set(node.id, [...channels]);
  }

  return {
    entryNodeId: def.entryNodeId,
    adjacency,
    nodeSubscriptions,
    nodeOutputs,
    nodeMap,
    edges: def.edges,
  };
}
```

**Step 4: Run tests**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/workflow-engine-compiler.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/services/workflow-engine/graph-compiler.ts desktop/tests/workflow-engine-compiler.test.ts
git commit -m "feat(workflow): add graph compiler — Definition to subscriptions/adjacency/outputs"
```

---

### Task 7: PregelRunner — The Superstep Loop

The core engine. Depends on Tasks 2-6.

**Files:**
- Create: `desktop/src/main/services/workflow-engine/pregel-runner.ts`
- Create: `desktop/tests/workflow-engine-pregel.test.ts`

**Step 1: Write failing tests**

Create `desktop/tests/workflow-engine-pregel.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { PregelRunner } from "../src/main/services/workflow-engine/pregel-runner";
import { NodeExecutorRegistry } from "../src/main/services/workflow-engine/node-executor";
import { StartNodeExecutor } from "../src/main/services/workflow-engine/executors/start";
import { EndNodeExecutor } from "../src/main/services/workflow-engine/executors/end";
import { ConditionNodeExecutor } from "../src/main/services/workflow-engine/executors/condition";
import type { WorkflowDefinition, WorkflowRunConfig } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../src/main/services/workflow-engine/node-executor";

// Stub LLM executor — writes a fixed value to output channel
class StubLlmExecutor implements NodeExecutor {
  readonly kind = "llm" as const;
  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const node = ctx.node as any;
    const outputKey = node.llm?.outputKey ?? "lastLlmOutput";
    return {
      writes: [{ channelName: outputKey, value: "stub-llm-response" }],
      outputs: { content: "stub-llm-response" },
      durationMs: 1,
    };
  }
}

function makeRegistry(): NodeExecutorRegistry {
  const reg = new NodeExecutorRegistry();
  reg.register(new StartNodeExecutor());
  reg.register(new EndNodeExecutor());
  reg.register(new ConditionNodeExecutor());
  reg.register(new StubLlmExecutor());
  return reg;
}

const defaultConfig: WorkflowRunConfig = {
  recursionLimit: 50,
  workingDirectory: "/tmp",
  modelProfileId: "test",
  checkpointPolicy: "none",
};

function makeLinearWorkflow(): WorkflowDefinition {
  return {
    id: "w1", name: "linear", description: "", status: "active", source: "personal",
    version: 1, updatedAt: "", nodeCount: 3, edgeCount: 2, libraryRootId: "",
    entryNodeId: "start",
    nodes: [
      { id: "start", kind: "start", label: "Start" },
      { id: "llm1", kind: "llm", label: "LLM", llm: { prompt: "hello", outputKey: "result" } },
      { id: "end", kind: "end", label: "End" },
    ],
    edges: [
      { id: "e1", kind: "normal", fromNodeId: "start", toNodeId: "llm1" },
      { id: "e2", kind: "normal", fromNodeId: "llm1", toNodeId: "end" },
    ],
    stateSchema: [
      { key: "result", label: "Result", description: "", valueType: "string",
        mergeStrategy: "replace", required: false,
        producerNodeIds: ["llm1"], consumerNodeIds: ["end"] },
    ],
  };
}

function makeBranchingWorkflow(): WorkflowDefinition {
  return {
    id: "w2", name: "branch", description: "", status: "active", source: "personal",
    version: 1, updatedAt: "", nodeCount: 5, edgeCount: 4, libraryRootId: "",
    entryNodeId: "start",
    nodes: [
      { id: "start", kind: "start", label: "Start" },
      { id: "cond", kind: "condition", label: "Check",
        condition: { operator: "equals", leftPath: "$.flag", rightValue: "yes" },
        route: { trueNodeId: "llm-yes", falseNodeId: "llm-no" } },
      { id: "llm-yes", kind: "llm", label: "Yes Path", llm: { prompt: "yes", outputKey: "result" } },
      { id: "llm-no", kind: "llm", label: "No Path", llm: { prompt: "no", outputKey: "result" } },
      { id: "end", kind: "end", label: "End" },
    ],
    edges: [
      { id: "e1", kind: "normal", fromNodeId: "start", toNodeId: "cond" },
      { id: "e2", kind: "conditional", fromNodeId: "cond", toNodeId: "llm-yes",
        condition: { operator: "equals", leftPath: "$.flag", rightValue: "yes" } },
      { id: "e3", kind: "conditional", fromNodeId: "cond", toNodeId: "llm-no",
        condition: { operator: "not-equals", leftPath: "$.flag", rightValue: "yes" } },
      { id: "e4", kind: "normal", fromNodeId: "llm-yes", toNodeId: "end" },
      { id: "e5", kind: "normal", fromNodeId: "llm-no", toNodeId: "end" },
    ],
    stateSchema: [
      { key: "flag", label: "Flag", description: "", valueType: "string",
        mergeStrategy: "replace", required: true,
        producerNodeIds: [], consumerNodeIds: ["cond"] },
      { key: "result", label: "Result", description: "", valueType: "string",
        mergeStrategy: "replace", required: false,
        producerNodeIds: ["llm-yes", "llm-no"], consumerNodeIds: ["end"] },
    ],
  };
}

describe("PregelRunner", () => {
  it("executes a linear workflow to completion", async () => {
    const runner = new PregelRunner(makeLinearWorkflow(), defaultConfig, {
      executorRegistry: makeRegistry(),
    });
    const result = await runner.run();
    expect(result.status).toBe("succeeded");
    expect(result.state.result).toBe("stub-llm-response");
    expect(result.totalSteps).toBeGreaterThan(0);
  });

  it("executes branching workflow correctly", async () => {
    const runner = new PregelRunner(makeBranchingWorkflow(), defaultConfig, {
      executorRegistry: makeRegistry(),
    });
    const result = await runner.run({ flag: "yes" });
    expect(result.status).toBe("succeeded");
    expect(result.state.result).toBe("stub-llm-response");
  });

  it("respects recursion limit", async () => {
    // Create a cycle that never terminates
    const cycleDef = makeLinearWorkflow();
    cycleDef.defaults = { allowCycles: true };
    // Add back-edge from end to start
    cycleDef.edges.push({ id: "e-cycle", kind: "normal", fromNodeId: "llm1", toNodeId: "start" });

    const runner = new PregelRunner(cycleDef, { ...defaultConfig, recursionLimit: 5 }, {
      executorRegistry: makeRegistry(),
    });
    const result = await runner.run();
    expect(result.status).toBe("failed");
    expect(result.totalSteps).toBe(5);
  });

  it("collects events during execution", async () => {
    const events: any[] = [];
    const runner = new PregelRunner(makeLinearWorkflow(), defaultConfig, {
      executorRegistry: makeRegistry(),
    });
    runner.emitter.on((e) => events.push(e));
    await runner.run();
    const types = events.map((e) => e.type);
    expect(types).toContain("run-start");
    expect(types).toContain("node-start");
    expect(types).toContain("node-complete");
    expect(types).toContain("run-complete");
  });
});
```

**Step 2: Run to verify failure**

**Step 3: Implement pregel-runner.ts**

Create `desktop/src/main/services/workflow-engine/pregel-runner.ts`:

```typescript
import { randomUUID } from "node:crypto";

import type { WorkflowDefinition, WorkflowRunConfig, WorkflowRunStatus, WorkflowNode } from "@shared/contracts";
import type { Channel } from "./channels";
import { compileChannels } from "./channels";
import { compileGraph, type CompiledGraph } from "./graph-compiler";
import type { NodeExecutorRegistry, NodeWrite } from "./node-executor";
import { WorkflowEventEmitter } from "./event-emitter";
import { isGraphInterrupt } from "./errors";

export type PregelRunnerDeps = {
  executorRegistry: NodeExecutorRegistry;
  checkpointer?: null; // Phase 1: no checkpointer yet
};

export type WorkflowRunResult = {
  runId: string;
  status: WorkflowRunStatus;
  state: Record<string, unknown>;
  totalSteps: number;
  durationMs: number;
};

export class PregelRunner {
  readonly runId: string;
  readonly emitter = new WorkflowEventEmitter();

  private channels: Map<string, Channel>;
  private graph: CompiledGraph;
  private executorRegistry: NodeExecutorRegistry;
  private versionsSeenByNode = new Map<string, Map<string, number>>();

  private step = 0;
  private status: WorkflowRunStatus = "running";
  private abortController = new AbortController();

  constructor(
    private definition: WorkflowDefinition,
    private config: WorkflowRunConfig,
    deps: PregelRunnerDeps,
  ) {
    this.runId = randomUUID();
    this.channels = compileChannels(definition.stateSchema);
    this.graph = compileGraph(definition);
    this.executorRegistry = deps.executorRegistry;

    // Initialize versionsSeenByNode — all start at -1
    for (const [nodeId] of this.graph.nodeMap) {
      this.versionsSeenByNode.set(nodeId, new Map());
    }
  }

  async run(input?: Record<string, unknown>): Promise<WorkflowRunResult> {
    const runStart = Date.now();

    // Write initial input to channels
    if (input) {
      for (const [key, value] of Object.entries(input)) {
        const channel = this.channels.get(key);
        if (channel) channel.update([value]);
      }
    }

    this.emitter.emit({ type: "run-start", runId: this.runId, workflowId: this.definition.id });

    // Seed: mark entry node as ready by ensuring it will be picked in first plan
    this.seedEntryNode();

    while (this.step < this.config.recursionLimit) {
      if (this.abortController.signal.aborted) {
        this.status = "canceled";
        break;
      }

      // Check if __done__ was written
      const done = this.channels.get("__done__");
      if (done && done.get()) {
        this.status = "succeeded";
        break;
      }

      // ── Plan Phase ──
      const nodesToRun = this.planNextNodes();
      if (nodesToRun.length === 0) {
        this.status = "succeeded";
        break;
      }

      this.step++;
      this.emitter.emit({ type: "step-start", runId: this.runId, step: this.step, nodes: nodesToRun });

      // ── Execute Phase ──
      const stepStart = Date.now();
      const writeBuffer: NodeWrite[] = [];
      const maxParallel = this.config.maxParallelNodes ?? 10;

      // Execute in batches
      for (let i = 0; i < nodesToRun.length; i += maxParallel) {
        const batch = nodesToRun.slice(i, i + maxParallel);
        const results = await Promise.allSettled(
          batch.map((nodeId) => this.executeNode(nodeId)),
        );

        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          const nodeId = batch[j];

          if (result.status === "fulfilled") {
            writeBuffer.push(...result.value.writes);
            this.emitter.emit({
              type: "node-complete",
              runId: this.runId,
              nodeId,
              outputs: result.value.outputs,
              durationMs: result.value.durationMs,
            });
          } else if (isGraphInterrupt(result.reason)) {
            this.status = "waiting-input";
            this.emitter.emit({
              type: "interrupt-requested",
              runId: this.runId,
              nodeId,
              payload: result.reason.payload,
            });
            return this.buildResult(runStart);
          } else {
            this.emitter.emit({
              type: "node-error",
              runId: this.runId,
              nodeId,
              error: result.reason?.message ?? String(result.reason),
              willRetry: false,
              attempt: 1,
            });
            this.status = "failed";
            return this.buildResult(runStart);
          }
        }
      }

      // ── Update Phase ──
      const updatedChannels = this.applyWrites(writeBuffer);

      // Mark executed nodes as having seen current channel versions
      for (const nodeId of nodesToRun) {
        const seen = this.versionsSeenByNode.get(nodeId)!;
        const subs = this.graph.nodeSubscriptions.get(nodeId) ?? [];
        for (const chName of subs) {
          const ch = this.channels.get(chName);
          if (ch) seen.set(chName, ch.version);
        }
      }

      // Reset ephemeral channels
      for (const [, ch] of this.channels) {
        if ("reset" in ch && ch.constructor.name === "EphemeralChannel") {
          // We need to check for EphemeralChannel without importing to avoid circular
          // Actually we can just check the name or add a flag
        }
      }
      this.resetEphemeralChannels();

      this.emitter.emit({
        type: "step-complete",
        runId: this.runId,
        step: this.step,
        updatedChannels: [...updatedChannels],
        durationMs: Date.now() - stepStart,
      });
    }

    // Recursion limit hit
    if (this.step >= this.config.recursionLimit && this.status === "running") {
      this.status = "failed";
    }

    this.emitter.emit({
      type: "run-complete",
      runId: this.runId,
      status: this.status,
      finalState: this.getCurrentState(),
      totalSteps: this.step,
      durationMs: Date.now() - runStart,
    });

    return this.buildResult(runStart);
  }

  abort(): void {
    this.abortController.abort();
  }

  getCurrentState(): Record<string, unknown> {
    const state: Record<string, unknown> = {};
    for (const [name, ch] of this.channels) {
      if (!name.startsWith("__")) {
        state[name] = ch.get();
      }
    }
    return state;
  }

  // ── Private ──

  private seedEntryNode(): void {
    // For the first superstep, we need the entry node to run.
    // We do this by setting a special seed version so planNextNodes picks it up.
    const entryId = this.graph.entryNodeId;
    if (!entryId) return;

    // Find what the entry node subscribes to. If nothing, we use adjacency-based scheduling.
    const subs = this.graph.nodeSubscriptions.get(entryId) ?? [];
    if (subs.length === 0) {
      // Entry node has no subscriptions — mark it as "unseen" by giving it a seed
      // We'll handle this in planNextNodes
    }
  }

  private planNextNodes(): string[] {
    const ready: string[] = [];

    // Special case: step 0, entry node always runs
    if (this.step === 0) {
      return [this.graph.entryNodeId];
    }

    // Check __route__ for dynamic routing
    const routeCh = this.channels.get("__route__");
    const routeTarget = routeCh?.get() as string | undefined;

    for (const [nodeId] of this.graph.nodeMap) {
      // Skip entry node after step 0 (unless cycle)
      const seenVersions = this.versionsSeenByNode.get(nodeId)!;
      const subscribedChannels = this.graph.nodeSubscriptions.get(nodeId) ?? [];

      // Adjacency-based: check if any upstream node produced new channel data
      let hasNewData = false;

      if (subscribedChannels.length > 0) {
        hasNewData = subscribedChannels.some((chName) => {
          const ch = this.channels.get(chName);
          if (!ch) return false;
          const lastSeen = seenVersions.get(chName) ?? -1;
          return ch.version > lastSeen;
        });
      } else {
        // No explicit subscriptions — use adjacency: run if upstream ran last step
        const upstreamIds = this.graph.edges
          .filter((e) => e.toNodeId === nodeId)
          .map((e) => e.fromNodeId);

        // Check if any upstream node was executed in the previous step
        // We approximate this by checking if upstream node's output channels were updated
        for (const upId of upstreamIds) {
          const upOutputs = this.graph.nodeOutputs.get(upId) ?? [];
          if (upOutputs.length === 0) {
            // Upstream has no declared outputs — check if it was recently seen
            const upSeen = this.versionsSeenByNode.get(upId);
            if (upSeen && upSeen.size > 0) {
              // Check if this node hasn't been processed after upstream ran
              const lastSeen = seenVersions.get("__adjacency_" + upId) ?? -1;
              if (lastSeen < this.step - 1) {
                hasNewData = true;
                break;
              }
            }
          } else {
            for (const chName of upOutputs) {
              const ch = this.channels.get(chName);
              if (!ch) continue;
              const lastSeen = seenVersions.get(chName) ?? -1;
              if (ch.version > lastSeen) {
                hasNewData = true;
                break;
              }
            }
          }
          if (hasNewData) break;
        }
      }

      // Dynamic routing override
      if (routeTarget && nodeId === routeTarget) {
        hasNewData = true;
      }

      if (hasNewData) {
        ready.push(nodeId);
      }
    }

    return ready;
  }

  private async executeNode(nodeId: string) {
    const node = this.graph.nodeMap.get(nodeId);
    if (!node) throw new Error(`[workflow] Node not found: ${nodeId}`);

    const executor = this.executorRegistry.get(node.kind);

    this.emitter.emit({
      type: "node-start",
      runId: this.runId,
      nodeId,
      nodeKind: node.kind,
    });

    const stateSnapshot = new Map<string, unknown>();
    for (const [name, ch] of this.channels) {
      if (!name.startsWith("__")) {
        stateSnapshot.set(name, ch.get());
      }
    }

    return executor.execute({
      node,
      state: stateSnapshot,
      config: this.config,
      emitter: this.emitter,
      signal: this.abortController.signal,
      runId: this.runId,
    });
  }

  private applyWrites(writes: NodeWrite[]): Set<string> {
    const updatedChannels = new Set<string>();

    // Group writes by channel
    const grouped = new Map<string, unknown[]>();
    for (const w of writes) {
      if (!grouped.has(w.channelName)) grouped.set(w.channelName, []);
      grouped.get(w.channelName)!.push(w.value);
    }

    for (const [channelName, values] of grouped) {
      const channel = this.channels.get(channelName);
      if (!channel) {
        // Auto-create LastValue channel for undeclared outputs
        const { LastValueChannel } = require("./channels");
        const newCh = new LastValueChannel(channelName, null);
        this.channels.set(channelName, newCh);
        newCh.update(values);
        updatedChannels.add(channelName);
        continue;
      }
      const changed = channel.update(values);
      if (changed) updatedChannels.add(channelName);
    }

    return updatedChannels;
  }

  private resetEphemeralChannels(): void {
    // Reset known ephemeral channels
    const ephemeralNames = ["__route__", "__interrupt__", "__resume__"];
    for (const name of ephemeralNames) {
      const ch = this.channels.get(name);
      if (ch) ch.reset();
    }
  }

  private buildResult(runStart: number): WorkflowRunResult {
    return {
      runId: this.runId,
      status: this.status,
      state: this.getCurrentState(),
      totalSteps: this.step,
      durationMs: Date.now() - runStart,
    };
  }
}
```

**Step 4: Run tests**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/workflow-engine-pregel.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/services/workflow-engine/pregel-runner.ts desktop/tests/workflow-engine-pregel.test.ts
git commit -m "feat(workflow): implement PregelRunner — superstep loop with channel-driven scheduling"
```

---

### Task 8: LLM Node Executor (stub for Phase 1, real in integration)

Phase 1 creates the executor with a pluggable model caller. Unit tests use a stub; real integration comes when wiring to IPC.

**Files:**
- Create: `desktop/src/main/services/workflow-engine/executors/llm.ts`
- Modify: `desktop/tests/workflow-engine-executors.test.ts` (add LLM tests)

**Step 1: Create executors/llm.ts**

```typescript
import type { WorkflowLlmNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";

/** Function signature matching callModel in model-client.ts */
export type ModelCaller = (options: {
  profile: unknown;
  messages: Array<{ role: string; content: string }>;
  tools: unknown[];
  onDelta?: (delta: { content?: string; reasoning?: string }) => void;
  signal?: AbortSignal;
}) => Promise<{ content: string; usage?: unknown }>;

export type ModelProfileResolver = (id?: string) => unknown;

export class LlmNodeExecutor implements NodeExecutor {
  readonly kind = "llm" as const;

  constructor(
    private modelCaller: ModelCaller,
    private profileResolver: ModelProfileResolver,
  ) {}

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const node = ctx.node as WorkflowLlmNode;

    // Resolve prompt — substitute {{channelName}} placeholders from state
    const prompt = this.resolvePrompt(node.llm.prompt, ctx.state);

    const messages: Array<{ role: string; content: string }> = [
      { role: "user", content: prompt },
    ];

    const profileId = (node as any).llm?.model ?? ctx.config.modelProfileId;
    const profile = this.profileResolver(profileId);

    let content = "";
    await this.modelCaller({
      profile,
      messages,
      tools: [],
      onDelta: (delta) => {
        if (delta.content) {
          content += delta.content;
          ctx.emitter.emit({
            type: "node-streaming",
            runId: ctx.runId,
            nodeId: node.id,
            chunk: delta,
          });
        }
      },
      signal: ctx.signal,
    });

    const outputKey = node.llm.outputKey
      ?? (node.outputBindings ? Object.values(node.outputBindings)[0] : null)
      ?? "lastLlmOutput";

    return {
      writes: [{ channelName: outputKey, value: content }],
      outputs: { content },
      durationMs: Date.now() - start,
    };
  }

  private resolvePrompt(template: string, state: ReadonlyMap<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
      const val = state.get(key);
      if (val === undefined || val === null) return "";
      return typeof val === "string" ? val : JSON.stringify(val);
    });
  }
}
```

**Step 2: Commit**

```bash
git add desktop/src/main/services/workflow-engine/executors/llm.ts
git commit -m "feat(workflow): add LlmNodeExecutor with pluggable ModelCaller and prompt interpolation"
```

---

### Task 9: Tool Node Executor

**Files:**
- Create: `desktop/src/main/services/workflow-engine/executors/tool.ts`

**Step 1: Create executors/tool.ts**

```typescript
import type { WorkflowToolNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";

/** Minimal interface matching BuiltinToolExecutor.execute() */
export type ToolExecutorFn = (
  toolId: string,
  label: string,
  workingDir: string,
) => Promise<{ success: boolean; output: string; error?: string }>;

/** Minimal interface matching McpServerManager.callTool() */
export type McpToolCallerFn = (
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<string>;

export function parseMcpToolId(toolId: string): { serverId: string; toolName: string } {
  // Format: mcp__serverName__toolName
  const parts = toolId.split("__");
  return { serverId: parts[1] ?? "", toolName: parts[2] ?? "" };
}

export class ToolNodeExecutor implements NodeExecutor {
  readonly kind = "tool" as const;

  constructor(
    private toolExecutor: ToolExecutorFn,
    private mcpCaller: McpToolCallerFn | null,
  ) {}

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const start = Date.now();
    const node = ctx.node as WorkflowToolNode;
    const { toolId } = node.tool;

    // Resolve args from state using argsTemplate or inputBindings
    const args = this.resolveArgs(node, ctx.state);
    let output: string;

    if (toolId.startsWith("mcp__") && this.mcpCaller) {
      const { serverId, toolName } = parseMcpToolId(toolId);
      output = await this.mcpCaller(serverId, toolName, args);
    } else {
      const label = `${toolId}(${JSON.stringify(args).slice(0, 100)})`;
      const result = await this.toolExecutor(toolId, label, ctx.config.workingDirectory);
      output = result.success ? result.output : `[错误] ${result.error ?? "unknown"}`;
    }

    const outputKey = node.tool.outputKey
      ?? (node.outputBindings ? Object.values(node.outputBindings)[0] : null)
      ?? "lastToolOutput";

    return {
      writes: [{ channelName: outputKey, value: output }],
      outputs: { toolId, output: output.slice(0, 500) },
      durationMs: Date.now() - start,
    };
  }

  private resolveArgs(node: WorkflowToolNode, state: ReadonlyMap<string, unknown>): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    if (node.inputBindings) {
      for (const [paramName, channelName] of Object.entries(node.inputBindings)) {
        args[paramName] = state.get(channelName);
      }
    }
    return args;
  }
}
```

**Step 2: Commit**

```bash
git add desktop/src/main/services/workflow-engine/executors/tool.ts
git commit -m "feat(workflow): add ToolNodeExecutor with builtin + MCP support"
```

---

### Task 10: HumanInput + Join Executors

**Files:**
- Create: `desktop/src/main/services/workflow-engine/executors/human-input.ts`
- Create: `desktop/src/main/services/workflow-engine/executors/join.ts`

**Step 1: Create human-input.ts**

```typescript
import type { WorkflowHumanInputNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";
import { GraphInterrupt } from "../errors";

export class HumanInputNodeExecutor implements NodeExecutor {
  readonly kind = "human-input" as const;

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const node = ctx.node as WorkflowHumanInputNode;
    const formKey = node.humanInput.formKey;

    // Check for resume value (second execution after interrupt)
    const resumeValue = ctx.state.get("__resume__");
    if (resumeValue !== undefined) {
      return {
        writes: [{ channelName: formKey, value: resumeValue }],
        outputs: { humanInput: resumeValue },
        durationMs: 0,
      };
    }

    // First execution — interrupt and wait
    throw new GraphInterrupt({
      type: "input",
      nodeId: node.id,
      formKey,
      prompt: node.label,
      currentState: Object.fromEntries(ctx.state),
    });
  }
}
```

**Step 2: Create join.ts**

```typescript
import type { WorkflowJoinNode } from "@shared/contracts";
import type { NodeExecutor, NodeExecutionContext, NodeExecutionResult } from "../node-executor";

export class JoinNodeExecutor implements NodeExecutor {
  readonly kind = "join" as const;

  async execute(ctx: NodeExecutionContext): Promise<NodeExecutionResult> {
    const node = ctx.node as WorkflowJoinNode;

    // In Pregel model, join node is triggered when subscribed channels update.
    // For "all" mode, it should only produce output when all upstream channels are set.
    // For "any" mode, first trigger is enough.

    if (node.join.mode === "any") {
      return {
        writes: [{ channelName: "__route__", value: "continue" }],
        outputs: { joinCompleted: true, mode: "any" },
        durationMs: 0,
      };
    }

    // "all" mode: check if all upstream nodes have written
    const allArrived = node.join.upstreamNodeIds.every((upId) => {
      // Check if any channel produced by upstream has a value
      // We rely on the graph compiler having set up subscriptions correctly
      return true; // In Pregel, if this node was scheduled, all subscribed channels updated
    });

    if (!allArrived) {
      return { writes: [], outputs: { waiting: true }, durationMs: 0 };
    }

    return {
      writes: [{ channelName: "__route__", value: "continue" }],
      outputs: { joinCompleted: true, mode: "all" },
      durationMs: 0,
    };
  }
}
```

**Step 3: Commit**

```bash
git add desktop/src/main/services/workflow-engine/executors/human-input.ts desktop/src/main/services/workflow-engine/executors/join.ts
git commit -m "feat(workflow): add HumanInput (interrupt/resume) and Join node executors"
```

---

### Task 11: Barrel Export + IPC Wiring

Wire the engine to IPC handlers, replacing stubs.

**Files:**
- Create: `desktop/src/main/services/workflow-engine/index.ts`
- Modify: `desktop/src/main/ipc/workflows.ts`
- Modify: `desktop/src/main/services/runtime-context.ts`

**Step 1: Create barrel export index.ts**

```typescript
export { PregelRunner, type WorkflowRunResult, type PregelRunnerDeps } from "./pregel-runner";
export { compileChannels, LastValueChannel, ReducerChannel, EphemeralChannel } from "./channels";
export { compileGraph } from "./graph-compiler";
export { WorkflowEventEmitter } from "./event-emitter";
export { GraphInterrupt, isGraphInterrupt, RecursionLimitError } from "./errors";
export {
  type NodeExecutor,
  type NodeExecutionContext,
  type NodeExecutionResult,
  type NodeWrite,
  NodeExecutorRegistry,
} from "./node-executor";

// Executors
export { StartNodeExecutor } from "./executors/start";
export { EndNodeExecutor } from "./executors/end";
export { ConditionNodeExecutor } from "./executors/condition";
export { LlmNodeExecutor } from "./executors/llm";
export { ToolNodeExecutor } from "./executors/tool";
export { HumanInputNodeExecutor } from "./executors/human-input";
export { JoinNodeExecutor } from "./executors/join";
```

**Step 2: Add activeRuns to RuntimeContext**

In `desktop/src/main/services/runtime-context.ts`, add import and field. Add to the `state` block:

```typescript
  activeWorkflowRuns: Map<string, import("./workflow-engine").PregelRunner>;
```

**Step 3: Rewrite workflow IPC handlers**

Replace the stub `workflow:start-run`, `workflow:resume-run`, and `workflow:list-runs` handlers in `desktop/src/main/ipc/workflows.ts`. Keep all existing CRUD handlers. Add:

- `workflow:start-run` — creates PregelRunner, runs in background, returns immediately
- `workflow:interrupt-resume` — resumes from checkpoint (new handler)
- `workflow:cancel-run` — aborts active run (new handler)
- `workflow:delete` — removes workflow from state and disk (new handler)
- `workflow:get-run-detail` — returns live or historical run detail (new handler)
- `workflow:list-runs` — reads from state (replace stub with real data)

The handler should:
1. Create a `NodeExecutorRegistry` with all registered executors
2. For LlmNodeExecutor: pass `callModel` from `desktop/src/main/services/model-client.ts`
3. For ToolNodeExecutor: pass `ctx.toolExecutor` and `ctx.services.mcpManager`
4. Bridge `runner.emitter.on(event => broadcastToRenderers("workflow:stream", event))`
5. Store runner in `ctx.state.activeWorkflowRuns`
6. Run `runner.run()` with `.then()` — do NOT await (non-blocking)

**Key imports to use:**
```typescript
import { PregelRunner, NodeExecutorRegistry, StartNodeExecutor, EndNodeExecutor,
  ConditionNodeExecutor, LlmNodeExecutor, ToolNodeExecutor, HumanInputNodeExecutor,
  JoinNodeExecutor } from "../services/workflow-engine";
import { callModel } from "../services/model-client";
```

Read `desktop/src/main/services/model-client.ts` for the exact `callModel` signature before wiring.

**Step 4: Update preload bridge**

Add new methods to `desktop/src/preload/index.ts` in the workflow section:

```typescript
deleteWorkflow: (workflowId: string) =>
  ipcRenderer.invoke("workflow:delete", workflowId),
resumeWorkflowRun: (runId: string, resumeValue: unknown) =>
  ipcRenderer.invoke("workflow:interrupt-resume", { runId, resumeValue }),
cancelWorkflowRun: (runId: string) =>
  ipcRenderer.invoke("workflow:cancel-run", runId),
getWorkflowRunDetail: (runId: string) =>
  ipcRenderer.invoke("workflow:get-run-detail", runId),
onWorkflowStream: (callback: (event: any) => void) => {
  const handler = (_: unknown, event: any) => callback(event);
  ipcRenderer.on("workflow:stream", handler);
  return () => ipcRenderer.removeListener("workflow:stream", handler);
},
```

**Step 5: Commit**

```bash
git add desktop/src/main/services/workflow-engine/index.ts desktop/src/main/ipc/workflows.ts desktop/src/main/services/runtime-context.ts desktop/src/preload/index.ts
git commit -m "feat(workflow): wire PregelRunner to IPC — replace stubs with real execution"
```

---

### Task 12: Integration Test — Full Flow

End-to-end test: create workflow → start run → verify completion via events.

**Files:**
- Create: `desktop/tests/workflow-engine-integration.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, it, expect } from "vitest";
import { PregelRunner } from "../src/main/services/workflow-engine/pregel-runner";
import { NodeExecutorRegistry } from "../src/main/services/workflow-engine/node-executor";
import { StartNodeExecutor } from "../src/main/services/workflow-engine/executors/start";
import { EndNodeExecutor } from "../src/main/services/workflow-engine/executors/end";
import { ConditionNodeExecutor } from "../src/main/services/workflow-engine/executors/condition";
import { LlmNodeExecutor } from "../src/main/services/workflow-engine/executors/llm";
import { ToolNodeExecutor } from "../src/main/services/workflow-engine/executors/tool";
import { HumanInputNodeExecutor } from "../src/main/services/workflow-engine/executors/human-input";
import { JoinNodeExecutor } from "../src/main/services/workflow-engine/executors/join";
import type { WorkflowDefinition, WorkflowRunConfig, WorkflowStreamEvent } from "@shared/contracts";

// Stub model caller
const stubModelCaller = async (opts: any) => {
  let content = "AI analysis: The data looks good.";
  if (opts.onDelta) {
    for (const word of content.split(" ")) {
      opts.onDelta({ content: word + " " });
    }
  }
  return { content };
};

// Stub tool executor
const stubToolExecutor = async (toolId: string, label: string, _workingDir: string) => {
  return { success: true, output: `Tool ${toolId} executed: ${label}` };
};

function makeRegistry(): NodeExecutorRegistry {
  const reg = new NodeExecutorRegistry();
  reg.register(new StartNodeExecutor());
  reg.register(new EndNodeExecutor());
  reg.register(new ConditionNodeExecutor());
  reg.register(new LlmNodeExecutor(stubModelCaller, () => ({})));
  reg.register(new ToolNodeExecutor(stubToolExecutor, null));
  reg.register(new HumanInputNodeExecutor());
  reg.register(new JoinNodeExecutor());
  return reg;
}

const config: WorkflowRunConfig = {
  recursionLimit: 50,
  workingDirectory: "/tmp",
  modelProfileId: "test",
  checkpointPolicy: "none",
};

describe("Workflow Engine Integration", () => {
  it("executes LLM → Tool → End pipeline", async () => {
    const def: WorkflowDefinition = {
      id: "w-int-1", name: "LLM Pipeline", description: "", status: "active",
      source: "personal", version: 1, updatedAt: "", nodeCount: 4, edgeCount: 3, libraryRootId: "",
      entryNodeId: "start",
      nodes: [
        { id: "start", kind: "start", label: "Start" },
        { id: "analyze", kind: "llm", label: "Analyze", llm: { prompt: "Analyze: {{input}}", outputKey: "analysis" } },
        { id: "save", kind: "tool", label: "Save", tool: { toolId: "fs.write", outputKey: "saveResult" } },
        { id: "end", kind: "end", label: "End" },
      ],
      edges: [
        { id: "e1", kind: "normal", fromNodeId: "start", toNodeId: "analyze" },
        { id: "e2", kind: "normal", fromNodeId: "analyze", toNodeId: "save" },
        { id: "e3", kind: "normal", fromNodeId: "save", toNodeId: "end" },
      ],
      stateSchema: [
        { key: "input", label: "Input", description: "", valueType: "string",
          mergeStrategy: "replace", required: true, producerNodeIds: [], consumerNodeIds: ["analyze"] },
        { key: "analysis", label: "Analysis", description: "", valueType: "string",
          mergeStrategy: "replace", required: false, producerNodeIds: ["analyze"], consumerNodeIds: ["save"] },
        { key: "saveResult", label: "Save Result", description: "", valueType: "string",
          mergeStrategy: "replace", required: false, producerNodeIds: ["save"], consumerNodeIds: ["end"] },
      ],
    };

    const events: WorkflowStreamEvent[] = [];
    const runner = new PregelRunner(def, config, { executorRegistry: makeRegistry() });
    runner.emitter.on((e) => events.push(e));

    const result = await runner.run({ input: "Test data to analyze" });

    expect(result.status).toBe("succeeded");
    expect(result.state.analysis).toContain("AI analysis");
    expect(result.state.saveResult).toContain("fs.write");

    // Verify event sequence
    const nodeStarts = events.filter((e) => e.type === "node-start").map((e) => (e as any).nodeId);
    expect(nodeStarts).toContain("start");
    expect(nodeStarts).toContain("analyze");
    expect(nodeStarts).toContain("save");
    expect(nodeStarts).toContain("end");

    // Verify streaming events from LLM
    const streamEvents = events.filter((e) => e.type === "node-streaming");
    expect(streamEvents.length).toBeGreaterThan(0);
  });

  it("handles condition branching", async () => {
    const def: WorkflowDefinition = {
      id: "w-int-2", name: "Branch", description: "", status: "active",
      source: "personal", version: 1, updatedAt: "", nodeCount: 5, edgeCount: 4, libraryRootId: "",
      entryNodeId: "start",
      nodes: [
        { id: "start", kind: "start", label: "Start" },
        { id: "check", kind: "condition", label: "Is Urgent?",
          condition: { operator: "equals", leftPath: "$.priority", rightValue: "high" },
          route: { trueNodeId: "urgent-llm", falseNodeId: "normal-llm" } },
        { id: "urgent-llm", kind: "llm", label: "Urgent", llm: { prompt: "URGENT: {{input}}", outputKey: "result" } },
        { id: "normal-llm", kind: "llm", label: "Normal", llm: { prompt: "Normal: {{input}}", outputKey: "result" } },
        { id: "end", kind: "end", label: "End" },
      ],
      edges: [
        { id: "e1", kind: "normal", fromNodeId: "start", toNodeId: "check" },
        { id: "e2", kind: "conditional", fromNodeId: "check", toNodeId: "urgent-llm",
          condition: { operator: "equals", leftPath: "$.priority", rightValue: "high" } },
        { id: "e3", kind: "conditional", fromNodeId: "check", toNodeId: "normal-llm",
          condition: { operator: "not-equals", leftPath: "$.priority", rightValue: "high" } },
        { id: "e4", kind: "normal", fromNodeId: "urgent-llm", toNodeId: "end" },
        { id: "e5", kind: "normal", fromNodeId: "normal-llm", toNodeId: "end" },
      ],
      stateSchema: [
        { key: "priority", label: "Priority", description: "", valueType: "string",
          mergeStrategy: "replace", required: true, producerNodeIds: [], consumerNodeIds: ["check"] },
        { key: "input", label: "Input", description: "", valueType: "string",
          mergeStrategy: "replace", required: true, producerNodeIds: [], consumerNodeIds: ["urgent-llm", "normal-llm"] },
        { key: "result", label: "Result", description: "", valueType: "string",
          mergeStrategy: "replace", required: false, producerNodeIds: ["urgent-llm", "normal-llm"], consumerNodeIds: ["end"] },
      ],
    };

    const runner = new PregelRunner(def, config, { executorRegistry: makeRegistry() });
    const result = await runner.run({ priority: "high", input: "Fix production bug" });

    expect(result.status).toBe("succeeded");
    expect(result.state.result).toBeDefined();
  });

  it("interrupts at human-input node", async () => {
    const def: WorkflowDefinition = {
      id: "w-int-3", name: "Human Review", description: "", status: "active",
      source: "personal", version: 1, updatedAt: "", nodeCount: 4, edgeCount: 3, libraryRootId: "",
      entryNodeId: "start",
      nodes: [
        { id: "start", kind: "start", label: "Start" },
        { id: "llm1", kind: "llm", label: "Draft", llm: { prompt: "Draft: {{input}}", outputKey: "draft" } },
        { id: "review", kind: "human-input", label: "请审核草稿", humanInput: { formKey: "approval" } },
        { id: "end", kind: "end", label: "End" },
      ],
      edges: [
        { id: "e1", kind: "normal", fromNodeId: "start", toNodeId: "llm1" },
        { id: "e2", kind: "normal", fromNodeId: "llm1", toNodeId: "review" },
        { id: "e3", kind: "normal", fromNodeId: "review", toNodeId: "end" },
      ],
      stateSchema: [
        { key: "input", label: "", description: "", valueType: "string",
          mergeStrategy: "replace", required: true, producerNodeIds: [], consumerNodeIds: ["llm1"] },
        { key: "draft", label: "", description: "", valueType: "string",
          mergeStrategy: "replace", required: false, producerNodeIds: ["llm1"], consumerNodeIds: ["review"] },
        { key: "approval", label: "", description: "", valueType: "string",
          mergeStrategy: "replace", required: false, producerNodeIds: ["review"], consumerNodeIds: ["end"] },
      ],
    };

    const events: WorkflowStreamEvent[] = [];
    const runner = new PregelRunner(def, config, { executorRegistry: makeRegistry() });
    runner.emitter.on((e) => events.push(e));

    const result = await runner.run({ input: "Write a report" });

    expect(result.status).toBe("waiting-input");

    const interrupt = events.find((e) => e.type === "interrupt-requested");
    expect(interrupt).toBeDefined();
    expect((interrupt as any).nodeId).toBe("review");
  });
});
```

**Step 2: Run tests**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/workflow-engine-integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add desktop/tests/workflow-engine-integration.test.ts
git commit -m "test(workflow): add integration tests — linear, branching, and interrupt flows"
```

---

## Task Dependency Graph (for parallel execution)

```
Task 1 (contracts) ──┐
                      ├── Task 5 (executors) ──┐
Task 2 (channels)  ──┤                         ├── Task 7 (PregelRunner)
Task 3 (errors)    ──┤                         │
Task 4 (emitter)   ──┘                         │
                      Task 6 (compiler) ────────┘
                                                │
                      Task 8 (LLM exec) ────────┤
                      Task 9 (Tool exec) ───────┤
                      Task 10 (HI + Join) ──────┤
                                                │
                                                ├── Task 11 (IPC wiring)
                                                └── Task 12 (integration test)
```

**Parallel waves:**
- **Wave 1** (parallel): Tasks 1, 2, 3, 4
- **Wave 2** (parallel): Tasks 5, 6
- **Wave 3** (sequential): Task 7
- **Wave 4** (parallel): Tasks 8, 9, 10
- **Wave 5** (sequential): Task 11
- **Wave 6** (sequential): Task 12

---

## Files Created/Modified Summary

**New files (13):**
```
desktop/shared/contracts/workflow-stream.ts
desktop/src/main/services/workflow-engine/channels.ts
desktop/src/main/services/workflow-engine/errors.ts
desktop/src/main/services/workflow-engine/event-emitter.ts
desktop/src/main/services/workflow-engine/node-executor.ts
desktop/src/main/services/workflow-engine/graph-compiler.ts
desktop/src/main/services/workflow-engine/pregel-runner.ts
desktop/src/main/services/workflow-engine/executors/start.ts
desktop/src/main/services/workflow-engine/executors/end.ts
desktop/src/main/services/workflow-engine/executors/condition.ts
desktop/src/main/services/workflow-engine/executors/llm.ts
desktop/src/main/services/workflow-engine/executors/tool.ts
desktop/src/main/services/workflow-engine/executors/human-input.ts
desktop/src/main/services/workflow-engine/executors/join.ts
desktop/src/main/services/workflow-engine/index.ts
```

**Modified files (5):**
```
desktop/shared/contracts/workflow.ts — add WorkflowRunConfig, inputBindings, outputBindings
desktop/shared/contracts/workflow-run.ts — add checkpoint types
desktop/shared/contracts/index.ts — export workflow-stream
desktop/src/main/ipc/workflows.ts — replace stubs with real engine
desktop/src/main/services/runtime-context.ts — add activeWorkflowRuns
desktop/src/preload/index.ts — add new workflow bridge methods
```

**Test files (4):**
```
desktop/tests/workflow-engine-channels.test.ts
desktop/tests/workflow-engine-executors.test.ts
desktop/tests/workflow-engine-compiler.test.ts
desktop/tests/workflow-engine-pregel.test.ts
desktop/tests/workflow-engine-integration.test.ts
```
