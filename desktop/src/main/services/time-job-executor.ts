import type { ScheduleJob } from "@shared/contracts";

import { createLogger } from "./logger";

const logger = createLogger("time-job-executor");

const ASSISTANT_PROMPT_OUTPUT_LIMIT = 500;

export type TimeJobExecutorDeps = {
  startWorkflowRun: (input: { workflowId: string; siliconPersonId?: string }) => Promise<void>;
  sendSiliconPersonMessage: (input: { siliconPersonId: string; content: string }) => Promise<void>;
  runAssistantPrompt: (input: { job: ScheduleJob; prompt: string }) => Promise<{ outputSummary: string }>;
};

export type TimeJobExecutionResult = {
  outputSummary?: string;
};

export type TimeJobExecutor = ReturnType<typeof createTimeJobExecutor>;

/** 创建定时任务执行器，把 schedule job 映射到具体的 workflow 或硅基员工动作。 */
export function createTimeJobExecutor(deps: TimeJobExecutorDeps) {
  return {
    /** 执行单条到期的计划任务，并输出统一的中文日志。 */
    async execute(job: ScheduleJob): Promise<TimeJobExecutionResult | void> {
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

        case "assistant_prompt": {
          const prompt = (job.description ?? job.title).trim();
          if (!prompt) {
            throw new Error("assistant_prompt 类型计划任务缺少 prompt 内容（description/title 都为空）");
          }
          const { outputSummary } = await deps.runAssistantPrompt({ job, prompt });
          const truncated = outputSummary.length > ASSISTANT_PROMPT_OUTPUT_LIMIT
            ? outputSummary.slice(0, ASSISTANT_PROMPT_OUTPUT_LIMIT) + "…"
            : outputSummary;
          logger.info("计划任务 assistant_prompt 已生成摘要", {
            jobId: job.id,
            promptLength: prompt.length,
            outputLength: outputSummary.length,
          });
          return { outputSummary: truncated };
        }

        default:
          logger.warn("计划任务命中未知 executor 类型，跳过执行", {
            jobId: job.id,
            executor: job.executor,
          });
          return;
      }
    },
  };
}
