import { readFile } from "node:fs/promises";

import type { SiliconLogger } from "../core/employee-scaffold.js";
import { resolveEmployeeChildPath } from "../core/path-boundary.js";
import { writeUtf8FileAtomically } from "../core/safe-file.js";
import type { EmployeeTask } from "../core/task-store.js";

export type HarnessPlanStepType =
  | "observe_task"
  | "load_soul"
  | "load_policy"
  | "load_skill"
  | "produce_artifact"
  | "write_review"
  | "write_memory";

export type HarnessPlanStepStatus = "planned" | "running" | "succeeded" | "failed" | "blocked" | "simulated";

export type HarnessPlanStep = {
  id: string;
  type: HarnessPlanStepType;
  status: HarnessPlanStepStatus;
  description: string;
};

export type HarnessRunContext = {
  runId: string;
  taskId: string;
  createdAt: string;
  soulPath: string;
  policyPath: string;
  loadoutPath: string;
  memoryPath: string;
  requestedCapability: string;
  selectedSkillIds: string[];
};

export type HarnessRunPlan = {
  schemaVersion: 1;
  planId: string;
  runId: string;
  taskId: string;
  status: "planned" | "running" | "succeeded" | "failed" | "blocked";
  createdAt: string;
  loadoutId: string;
  skillIds: string[];
  steps: HarnessPlanStep[];
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 为任务构建 harness 运行上下文和计划，明确每次心跳要加载的员工资源。 */
export async function buildHarnessRunPlan(input: {
  employeeDir: string;
  runId: string;
  task: EmployeeTask;
  createdAt: string;
  logger?: SiliconLogger;
}): Promise<{ context: HarnessRunContext; plan: HarnessRunPlan }> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始构建硅基员工 harness 运行计划", {
    employeeDir: input.employeeDir,
    runId: input.runId,
    taskId: input.task.id,
  });
  const loadout = await readCurrentLoadout(input.employeeDir, logger);
  const skillIds = Array.isArray(loadout.skillIds) ? loadout.skillIds.map(String) : [];
  const loadoutId = typeof loadout.id === "string" ? loadout.id : "unknown-loadout";

  const context: HarnessRunContext = {
    runId: input.runId,
    taskId: input.task.id,
    createdAt: input.createdAt,
    soulPath: "soul/current.md",
    policyPath: "policy.yaml",
    loadoutPath: "loadouts/current.json",
    memoryPath: "memory/journal.jsonl",
    requestedCapability: input.task.requestedCapability ?? "artifact.write",
    selectedSkillIds: skillIds,
  };
  const plan: HarnessRunPlan = {
    schemaVersion: 1,
    planId: `plan-${input.runId}`,
    runId: input.runId,
    taskId: input.task.id,
    status: "planned",
    createdAt: input.createdAt,
    loadoutId,
    skillIds,
    steps: buildDefaultPlanSteps(skillIds),
  };
  logger.info("硅基员工 harness 运行计划已构建", {
    employeeDir: input.employeeDir,
    runId: input.runId,
    planId: plan.planId,
    stepCount: plan.steps.length,
    skillIds,
  });
  return { context, plan };
}

/** 将 harness 运行上下文和计划写入 run 目录，作为后续回放入口。 */
export async function writeHarnessRunFiles(input: {
  runDir: string;
  context: HarnessRunContext;
  plan: HarnessRunPlan;
  logger?: SiliconLogger;
}): Promise<void> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始写入硅基员工 harness 运行文件", {
    runDir: input.runDir,
    runId: input.plan.runId,
    planId: input.plan.planId,
  });
  await writeUtf8FileAtomically(resolveEmployeeChildPath(input.runDir, ["context.json"], logger), `${JSON.stringify(input.context, null, 2)}\n`, logger);
  await writeUtf8FileAtomically(resolveEmployeeChildPath(input.runDir, ["plan.json"], logger), `${JSON.stringify(input.plan, null, 2)}\n`, logger);
  logger.info("硅基员工 harness 运行文件已写入", { runDir: input.runDir, runId: input.plan.runId });
}

/** 读取当前 loadout，读取失败时返回保守默认 loadout。 */
async function readCurrentLoadout(employeeDir: string, logger: SiliconLogger): Promise<Record<string, unknown>> {
  const loadoutPath = resolveEmployeeChildPath(employeeDir, ["loadouts", "current.json"], logger);
  const raw = await readFile(loadoutPath, "utf8").catch((error: unknown) => {
    logger.warn("读取当前 loadout 失败，使用保守默认 loadout", {
      employeeDir,
      loadoutPath,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return "";
  });
  if (!raw.trim()) {
    return { id: "fallback-loadout", skillIds: [] };
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

/** 根据 skill 选择结果构建默认控制步骤。 */
function buildDefaultPlanSteps(skillIds: string[]): HarnessPlanStep[] {
  return [
    { id: "step-001", type: "observe_task", status: "planned", description: "观察 inbox task 和 todo 投影。" },
    { id: "step-002", type: "load_soul", status: "planned", description: "加载员工 soul，确认身份、职责和边界。" },
    { id: "step-003", type: "load_policy", status: "planned", description: "加载 policy，确认能力裁决和审批要求。" },
    {
      id: "step-004",
      type: "load_skill",
      status: "planned",
      description: skillIds.length > 0 ? `加载技能：${skillIds.join(", ")}` : "没有可用技能，使用最小产物生成器。",
    },
    { id: "step-005", type: "produce_artifact", status: "planned", description: "生成可审计 artifact。" },
    { id: "step-006", type: "write_review", status: "planned", description: "写入本次 run review。" },
    { id: "step-007", type: "write_memory", status: "planned", description: "将高置信事实追加到 memory journal。" },
  ];
}
