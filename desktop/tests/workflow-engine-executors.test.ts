import { describe, it, expect, vi } from "vitest";
import { StartNodeExecutor } from "../src/main/services/workflow-engine/executors/start";
import { EndNodeExecutor } from "../src/main/services/workflow-engine/executors/end";
import { ConditionNodeExecutor } from "../src/main/services/workflow-engine/executors/condition";
import { LlmNodeExecutor } from "../src/main/services/workflow-engine/executors/llm";
import { WorkflowEventEmitter } from "../src/main/services/workflow-engine/event-emitter";
import type { WorkflowConditionNode, WorkflowLlmNode } from "@shared/contracts";

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

describe("LlmNodeExecutor", () => {
  it("passes workflow llm experience overrides through to the model caller", async () => {
    const modelCaller = vi.fn(async () => ({ content: "done" }));
    const exec = new LlmNodeExecutor(modelCaller, () => ({ id: "profile-1" }));
    const node: WorkflowLlmNode = {
      id: "llm-1",
      kind: "llm",
      label: "Think",
      llm: {
        prompt: "hello {{topic}}",
        providerFamily: "anthropic-native",
        protocolTarget: "anthropic-messages",
        experienceProfileId: "claude-best",
      },
    };

    await exec.execute(makeCtx(node, { topic: "world" }));

    expect(modelCaller).toHaveBeenCalledWith(expect.objectContaining({
      profile: { id: "profile-1" },
      messages: [{ role: "user", content: "hello world" }],
      providerFamily: "anthropic-native",
      protocolTarget: "anthropic-messages",
      experienceProfileId: "claude-best",
      workflowRunId: "test-run",
    }));
  });

  it("uses the final model content when no streaming deltas are emitted", async () => {
    const modelCaller = vi.fn(async () => ({ content: "final reply" }));
    const exec = new LlmNodeExecutor(modelCaller, () => ({ id: "profile-1" }));
    const node: WorkflowLlmNode = {
      id: "llm-2",
      kind: "llm",
      label: "Summarize",
      llm: {
        prompt: "summarize {{topic}}",
      },
    };

    const result = await exec.execute(makeCtx(node, { topic: "status" }));

    expect(result.writes).toEqual([{ channelName: "lastLlmOutput", value: "final reply" }]);
    expect(result.outputs).toEqual({ content: "final reply" });
  });
});
