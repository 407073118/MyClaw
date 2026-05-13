import { readFile } from "node:fs/promises";

import type { SiliconLogger } from "../core/employee-scaffold.js";
import { resolveEmployeeChildPath } from "../core/path-boundary.js";
import type { EmployeeTask } from "../core/task-store.js";
import { resolveHarnessExecutorDecision, type HarnessExecutorMode } from "./executor-adapter.js";
import type { HarnessPlanStep, HarnessPlanStepStatus, HarnessRunPlan } from "./harness-plan.js";
import { executeTaskSkill, type SkillExecutionResult } from "./skill-executor.js";

export type HarnessExecutionStatus = "succeeded" | "blocked" | "failed";

export type HarnessStepExecution = {
  schemaVersion: 1;
  stepId: string;
  type: HarnessPlanStep["type"];
  status: HarnessPlanStepStatus;
  startedAt: string;
  finishedAt: string;
  message: string;
  evidence?: Record<string, unknown>;
};

export type HarnessExecutionResult = {
  schemaVersion: 1;
  status: HarnessExecutionStatus;
  artifactMarkdown: string;
  reviewMarkdown: string;
  stepExecutions: HarnessStepExecution[];
  skillResult: SkillExecutionResult;
  verifier: {
    artifactReady: boolean;
    reviewReady: boolean;
    memoryReady: boolean;
    executorMode: HarnessExecutorMode;
    blockedReason?: string;
  };
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 执行 harness plan 的控制步骤，并把真实完成、模拟产物和阻塞原因分开记录。 */
export async function runHarnessSteps(input: {
  employeeDir: string;
  task: EmployeeTask;
  plan: HarnessRunPlan;
  createdAt: string;
  logger?: SiliconLogger;
}): Promise<HarnessExecutionResult> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始执行硅基员工 harness step runner", {
    employeeDir: input.employeeDir,
    taskId: input.task.id,
    planId: input.plan.planId,
  });

  const executions: HarnessStepExecution[] = [];
  const skillResult = executeTaskSkill({ task: input.task, plan: input.plan, logger });
  const executorDecision = resolveHarnessExecutorDecision(input.task, logger);
  const blockedReason = executorDecision.canExecute ? undefined : executorDecision.reason;

  for (const step of input.plan.steps) {
    const status = decideStepStatus(step, blockedReason);
    executions.push(await executeHarnessStep({
      employeeDir: input.employeeDir,
      task: input.task,
      step,
      status,
      createdAt: input.createdAt,
      blockedReason,
      logger,
    }));
  }

  const status: HarnessExecutionStatus = blockedReason ? "blocked" : "succeeded";
  const artifactMarkdown = buildTaskArtifact(input.task, input.plan, skillResult, executions, status, blockedReason);
  const reviewMarkdown = buildRunReview(input.plan.runId, input.task, status, executions, blockedReason);
  const result: HarnessExecutionResult = {
    schemaVersion: 1,
    status,
    artifactMarkdown,
    reviewMarkdown,
    stepExecutions: executions,
    skillResult,
    verifier: {
      artifactReady: true,
      reviewReady: true,
      memoryReady: true,
      executorMode: executorDecision.mode,
      blockedReason,
    },
  };
  logger.info("硅基员工 harness step runner 已完成", {
    employeeDir: input.employeeDir,
    taskId: input.task.id,
    status: result.status,
    stepCount: executions.length,
  });
  return result;
}

/** 执行单个 harness 步骤，读上下文类步骤会验证文件存在并沉淀证据。 */
async function executeHarnessStep(input: {
  employeeDir: string;
  task: EmployeeTask;
  step: HarnessPlanStep;
  status: HarnessPlanStepStatus;
  createdAt: string;
  blockedReason?: string;
  logger: SiliconLogger;
}): Promise<HarnessStepExecution> {
  input.logger.info("开始执行 harness 步骤", {
    employeeDir: input.employeeDir,
    taskId: input.task.id,
    stepId: input.step.id,
    stepType: input.step.type,
    status: input.status,
  });
  const evidence = await collectStepEvidence(input.employeeDir, input.step, input.logger);
  const execution: HarnessStepExecution = {
    schemaVersion: 1,
    stepId: input.step.id,
    type: input.step.type,
    status: input.status,
    startedAt: input.createdAt,
    finishedAt: input.createdAt,
    message: buildStepMessage(input.step, input.status, input.blockedReason),
    evidence,
  };
  input.logger.info("harness 步骤执行记录已生成", {
    employeeDir: input.employeeDir,
    taskId: input.task.id,
    stepId: execution.stepId,
    status: execution.status,
  });
  return execution;
}

/** 为上下文加载步骤读取最小证据，避免 harness 在缺文件时静默成功。 */
async function collectStepEvidence(
  employeeDir: string,
  step: HarnessPlanStep,
  logger: SiliconLogger,
): Promise<Record<string, unknown> | undefined> {
  const relativePath = getStepEvidencePath(step);
  if (!relativePath) {
    return undefined;
  }
  const absolutePath = resolveEmployeeChildPath(employeeDir, relativePath.split("/"), logger);
  const raw = await readFile(absolutePath, "utf8").catch((error: unknown) => {
    logger.warn("读取 harness 步骤证据失败", {
      employeeDir,
      stepId: step.id,
      relativePath,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return "";
  });
  return {
    path: relativePath,
    readable: raw.length > 0,
    byteLength: Buffer.byteLength(raw, "utf8"),
  };
}

/** 根据步骤类型选择需要验证的员工文件路径。 */
function getStepEvidencePath(step: HarnessPlanStep): string | undefined {
  if (step.type === "load_soul") {
    return "soul/current.md";
  }
  if (step.type === "load_policy") {
    return "policy.yaml";
  }
  if (step.type === "load_skill") {
    return "loadouts/current.json";
  }
  return undefined;
}

/** 判断某个步骤在当前 capability 下应该标记为何种状态。 */
function decideStepStatus(step: HarnessPlanStep, blockedReason: string | undefined): HarnessPlanStepStatus {
  if (!blockedReason) {
    return step.type === "produce_artifact" ? "simulated" : "succeeded";
  }
  if (step.type === "produce_artifact") {
    return "blocked";
  }
  if (step.type === "write_memory") {
    return "succeeded";
  }
  if (step.type === "write_review") {
    return "succeeded";
  }
  return "succeeded";
}

/** 构建单个步骤的人类可读执行消息。 */
function buildStepMessage(
  step: HarnessPlanStep,
  status: HarnessPlanStepStatus,
  blockedReason: string | undefined,
): string {
  if (status === "blocked" && blockedReason) {
    return `${step.description} 阻塞原因：${blockedReason}`;
  }
  return `${step.description} 状态：${status}`;
}

/** 构建任务产物，包含计划、技能结果、步骤状态和阻塞原因。 */
function buildTaskArtifact(
  task: EmployeeTask,
  plan: HarnessRunPlan,
  skillResult: SkillExecutionResult,
  steps: HarnessStepExecution[],
  status: HarnessExecutionStatus,
  blockedReason: string | undefined,
): string {
  return [
    `# ${task.title}`,
    "",
    "## 输入指令",
    task.instruction,
    "",
    "## Harness",
    `计划：${plan.planId}`,
    `Loadout：${plan.loadoutId}`,
    `Skills：${plan.skillIds.length > 0 ? plan.skillIds.join(", ") : "none"}`,
    `Selected Skill：${skillResult.selectedSkillId}`,
    `执行状态：${status}`,
    blockedReason ? `阻塞原因：${blockedReason}` : "",
    "",
    "## 输出摘要",
    skillResult.summary,
    "",
    "## Step Ledger",
    ...steps.map((step) => `- ${step.stepId} ${step.type} ${step.status}：${step.message}`),
    "",
    ...skillResult.sections.flatMap((section) => [`## ${section.heading}`, ...section.content, ""]),
  ].filter((line) => line !== "").join("\n");
}

/** 构建 run review，作为后续记忆沉淀和人工复盘入口。 */
function buildRunReview(
  runId: string,
  task: EmployeeTask,
  status: HarnessExecutionStatus,
  steps: HarnessStepExecution[],
  blockedReason: string | undefined,
): string {
  return [
    `# Run Review: ${runId}`,
    "",
    `任务：${task.title}`,
    `状态：${status}`,
    blockedReason ? `阻塞原因：${blockedReason}` : "结论：heartbeat 已完成最小闭环，产物、复盘和 ledger 均已落盘。",
    "",
    "## 控制论闭环",
    "观测：读取 inbox task、soul、policy、loadout 和 memory 边界。",
    "决策：依据 policy 与 approval 状态决定执行、等待或阻塞。",
    "行动：生成 artifact、review，并由 heartbeat 写入 task/todo/memory 状态。",
    "反馈：state.json、events.jsonl、steps.jsonl 和 memory journal 形成下一轮输入。",
    "",
    "## Step Summary",
    ...steps.map((step) => `- ${step.stepId} ${step.type} ${step.status}`),
    "",
  ].join("\n");
}
