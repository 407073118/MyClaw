import type { WorkflowCheckpointSummary, WorkflowRunSummary } from "@shared/contracts";

export type WorkflowRunDetailPayload = {
  run: WorkflowRunSummary;
  checkpoints: WorkflowCheckpointSummary[];
};

/** 统一封装运行时数据读取，保持 renderer 侧调用入口一致。*/
export async function getWorkflowRun(
  runtimeBaseUrl: string,
  runId: string,
): Promise<WorkflowRunDetailPayload | null> {
  console.info("[runtime-client] 获取工作流运行详情", {
    runtimeBaseUrl,
    runId,
  });

  if (typeof window === "undefined" || !window.myClawAPI?.getWorkflowRunDetail) {
    throw new Error("workflow run detail API is unavailable");
  }

  return window.myClawAPI.getWorkflowRunDetail(runId) as Promise<WorkflowRunDetailPayload | null>;
}
