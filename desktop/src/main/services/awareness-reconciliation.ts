import type { ExecutionRun, ScheduleJob } from "@shared/contracts";
import type { AwarenessStore } from "./awareness-store";

export type AwarenessReconciliationInput = {
  store: AwarenessStore;
  scheduleJobs: Array<Pick<ScheduleJob, "id" | "status" | "nextRunAt">>;
  latestExecutionRunsByScheduleJobId: Map<string, Pick<ExecutionRun, "status" | "startedAt">>;
  now: Date;
};

/** 根据权威运行态自动修复已恢复的问题信号，避免值守面板长期挂旧告警。 */
export async function reconcileAwarenessSignals(input: AwarenessReconciliationInput): Promise<number> {
  const activeSignals = await input.store.listSignals("active");
  let resolved = 0;

  for (const signal of activeSignals) {
    if (signal.sourceKind !== "schedule_job") continue;
    const job = input.scheduleJobs.find((item) => item.id === signal.sourceId);
    if (!job) continue;

    if (signal.fingerprint === `job:failed:${job.id}`) {
      const latestRun = input.latestExecutionRunsByScheduleJobId.get(job.id);
      if (latestRun?.status === "succeeded" || job.status === "scheduled" || job.status === "completed") {
        console.info("[awareness-reconciliation] 自动恢复定时任务失败信号", {
          signalId: signal.id,
          jobId: job.id,
        });
        await input.store.updateSignalStatus(signal.id, "resolved", {
          resolvedAt: input.now.toISOString(),
          resolvedBySourceState: true,
        });
        resolved++;
      }
    }

    if (signal.fingerprint === `job:stale:${job.id}` && job.nextRunAt && new Date(job.nextRunAt) > input.now) {
      console.info("[awareness-reconciliation] 自动恢复定时任务滞后信号", {
        signalId: signal.id,
        jobId: job.id,
      });
      await input.store.updateSignalStatus(signal.id, "resolved", {
        resolvedAt: input.now.toISOString(),
        resolvedBySourceState: true,
      });
      resolved++;
    }
  }

  return resolved;
}
