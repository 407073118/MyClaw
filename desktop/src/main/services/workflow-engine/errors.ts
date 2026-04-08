import type { WorkflowInterruptPayload } from "@shared/contracts/workflow-run";

export type InterruptPayload = WorkflowInterruptPayload;

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
