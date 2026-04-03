/**
 * Runtime client types and API functions for workflow runs.
 * Mirrors the relevant portions of the desktop runtime-client service.
 */

export type WorkflowRunCheckpointStatus =
  | "node-start"
  | "node-complete"
  | "node-error"
  | "retry-scheduled"
  | "waiting-human-input"
  | "run-complete";

export type WorkflowRunCheckpoint = {
  id: string;
  runId: string;
  createdAt: string;
  nodeId: string;
  status: WorkflowRunCheckpointStatus;
  state: Record<string, unknown>;
  attempts: Record<string, number>;
  error?: string;
  retryAt?: string;
};

export type WorkflowRunDetail = {
  id: string;
  workflowId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  currentNodeIds?: string[];
  state?: Record<string, unknown>;
};

export type GetWorkflowRunPayload = {
  run: WorkflowRunDetail;
  checkpoints: WorkflowRunCheckpoint[];
  result?: unknown;
};

/** 获取单次工作流运行详情，包含 checkpoints。 */
export async function getWorkflowRun(baseUrl: string, runId: string): Promise<GetWorkflowRunPayload> {
  const url = `${baseUrl}/workflow-runs/${encodeURIComponent(runId)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch workflow run: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<GetWorkflowRunPayload>;
}
