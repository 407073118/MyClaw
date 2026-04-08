import { describe, it, expect } from "vitest";
import { StartNodeExecutor } from "../src/main/services/workflow-engine/executors/start";
import { EndNodeExecutor } from "../src/main/services/workflow-engine/executors/end";
import { ConditionNodeExecutor } from "../src/main/services/workflow-engine/executors/condition";
import { WorkflowEventEmitter } from "../src/main/services/workflow-engine/event-emitter";
import type { WorkflowConditionNode } from "@shared/contracts";

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
