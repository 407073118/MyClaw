import { beforeEach, describe, expect, it } from "vitest";

import type { WorkflowStreamEvent } from "@shared/contracts/workflow-stream";
import { useWorkflowRunsStore } from "../src/renderer/stores/workflow-runs";

describe("workflow-runs store performance projection", () => {
  beforeEach(() => {
    useWorkflowRunsStore.setState({
      liveRuns: new Map(),
      runHistory: [],
    });
  });

  it("keeps only the default bounded workflow event window", () => {
    const store = useWorkflowRunsStore.getState();
    store.handleStreamEvent({ type: "run-start", runId: "run-1", workflowId: "wf-1" });

    for (let index = 0; index < 400; index += 1) {
      store.handleStreamEvent({
        type: "checkpoint-saved",
        runId: "run-1",
        checkpointId: `cp-${index}`,
        step: index,
        status: "running",
      });
    }

    const run = useWorkflowRunsStore.getState().getLiveRun("run-1");
    expect(run?.events).toHaveLength(300);
    expect(run?.events[0]?.type).toBe("checkpoint-saved");
  });

  it("coalesces streaming events and stores a summary for large state updates", () => {
    const store = useWorkflowRunsStore.getState();
    store.handleStreamEvent({ type: "run-start", runId: "run-2", workflowId: "wf-1" });

    for (let index = 0; index < 20; index += 1) {
      store.handleStreamEvent({
        type: "node-streaming",
        runId: "run-2",
        nodeId: "llm-1",
        chunk: { content: "chunk " },
      });
    }

    const largeValue = { text: "x".repeat(20_000), nested: { enabled: true } };
    const stateEvent: WorkflowStreamEvent = {
      type: "state-updated",
      runId: "run-2",
      channelName: "large",
      value: largeValue,
      version: 1,
    };
    store.handleStreamEvent(stateEvent);

    const run = useWorkflowRunsStore.getState().getLiveRun("run-2");
    const streamingEvents = run?.events.filter((event) => event.type === "node-streaming") ?? [];
    const summaryEvent = run?.events.find((event) => event.type === "state-updated");

    expect(streamingEvents).toHaveLength(1);
    expect(JSON.stringify(summaryEvent)).not.toContain("x".repeat(1000));
    expect(summaryEvent?.value).toEqual(expect.objectContaining({
      kind: "summary",
      valueType: "object",
    }));
    expect(run?.state.large).toBe(largeValue);
  });
});
