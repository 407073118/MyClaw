import type { WorkflowNode, WorkflowNodeKind } from "@shared/contracts";
import type { WorkflowEventEmitter } from "./event-emitter";

export type WorkflowRunConfigLite = {
  recursionLimit: number;
  workingDirectory: string;
  modelProfileId: string;
  checkpointPolicy: string;
  maxParallelNodes?: number;
  variables?: Record<string, unknown>;
};

export type NodeWrite = {
  channelName: string;
  value: unknown;
};

export type NodeExecutionContext = {
  node: WorkflowNode;
  state: ReadonlyMap<string, unknown>;
  config: WorkflowRunConfigLite;
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
