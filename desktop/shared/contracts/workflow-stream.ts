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
