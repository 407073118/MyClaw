import type { ScheduleJob } from "@shared/contracts";

import { createLogger } from "./logger";

const logger = createLogger("time-job-executor");

export type TimeJobExecutorDeps = {
  startWorkflowRun: (input: { workflowId: string; siliconPersonId?: string }) => Promise<void>;
  sendSiliconPersonMessage: (input: { siliconPersonId: string; content: string }) => Promise<void>;
};

export type TimeJobExecutor = ReturnType<typeof createTimeJobExecutor>;

/** 创建定时任务执行器，把 schedule job 映射到具体的 workflow 或硅基员工动作。 */
export function createTimeJobExecutor(deps: TimeJobExecutorDeps) {
  return {
    /** 执行单条到期的计划任务，并输出统一的中文日志。 */
    async execute(job: ScheduleJob): Promise<void> {
      logger.info("开始执行计划任务", {
        jobId: job.id,
        title: job.title,
        executor: job.executor,
        ownerScope: job.ownerScope,
        ownerId: job.ownerId ?? null,
      });

      switch (job.executor) {
        case "workflow": {
          if (!job.executorTargetId) {
            throw new Error("workflow 类型计划任务缺少 executorTargetId");
          }
          await deps.startWorkflowRun({
            workflowId: job.executorTargetId,
            siliconPersonId: job.ownerScope === "silicon_person" ? job.ownerId : undefined,
          });
          logger.info("计划任务已触发工作流运行", {
            jobId: job.id,
            workflowId: job.executorTargetId,
            siliconPersonId: job.ownerId ?? null,
          });
          return;
        }

        case "silicon_person": {
          const siliconPersonId = job.executorTargetId ?? job.ownerId;
          if (!siliconPersonId) {
            throw new Error("silicon_person 类型计划任务缺少目标员工 ID");
          }
          const content = (job.description ?? job.title).trim();
          await deps.sendSiliconPersonMessage({
            siliconPersonId,
            content,
          });
          logger.info("计划任务已向硅基员工派发消息", {
            jobId: job.id,
            siliconPersonId,
          });
          return;
        }

        case "assistant_prompt":
        default:
          logger.info("计划任务命中 assistant_prompt，当前以空操作完成", {
            jobId: job.id,
            title: job.title,
          });
      }
    },
  };
}
