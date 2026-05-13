import type { SiliconLogger } from "../core/employee-scaffold.js";
import type { EmployeeTask } from "../core/task-store.js";
import type { HarnessRunPlan } from "./harness-plan.js";

export type SkillExecutionResult = {
  selectedSkillId: string;
  summary: string;
  sections: Array<{
    heading: string;
    content: string[];
  }>;
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 执行当前 harness plan 选择的默认 skill，生成可审计产物结构。 */
export function executeTaskSkill(input: {
  task: EmployeeTask;
  plan: HarnessRunPlan;
  logger?: SiliconLogger;
}): SkillExecutionResult {
  const logger = input.logger ?? noopLogger;
  const selectedSkillId = input.plan.skillIds[0] ?? "minimal-artifact";
  logger.info("开始执行硅基员工 skill", {
    taskId: input.task.id,
    selectedSkillId,
    planId: input.plan.planId,
  });

  const result = buildSkillResult(selectedSkillId, input.task);
  logger.info("硅基员工 skill 执行完成", {
    taskId: input.task.id,
    selectedSkillId: result.selectedSkillId,
    sectionCount: result.sections.length,
  });
  return result;
}

/** 根据 skill ID 生成对应领域的产物结构。 */
function buildSkillResult(selectedSkillId: string, task: EmployeeTask): SkillExecutionResult {
  if (selectedSkillId === "risk-review") {
    return {
      selectedSkillId,
      summary: "已按代码审查员工 SOP 输出风险审查骨架。",
      sections: [
        { heading: "审查范围", content: [task.instruction] },
        { heading: "主要风险", content: ["当前最小闭环未接入真实 diff 解析，因此只能产出审查框架和待执行证据清单。"] },
        { heading: "建议动作", content: ["接入文件读取工具、diff 解析器和审查规则集后，再提升为真实审查执行。"] },
      ],
    };
  }

  if (selectedSkillId === "controlled-ops") {
    return {
      selectedSkillId,
      summary: "已按运维执行员工 SOP 输出受控执行骨架。",
      sections: [
        { heading: "执行目标", content: [task.instruction] },
        { heading: "控制状态", content: ["高风险 shell 和 network 能力必须先走 approval；当前 artifact 只记录计划，不直接执行宿主命令。"] },
        { heading: "恢复建议", content: ["审批通过后由工具执行层接管，并把命令、输出、退出码写入 run ledger。"] },
      ],
    };
  }

  return {
    selectedSkillId,
    summary: "已按资料整理员工 SOP 输出结构化摘要骨架。",
    sections: [
      { heading: "资料目标", content: [task.instruction] },
      { heading: "整理摘要", content: ["当前最小闭环已形成可审计报告结构，后续由文件读取和模型执行层填充真实摘要。"] },
      { heading: "下一步", content: ["接入输入文件索引、引用来源和摘要质量校验。"] },
    ],
  };
}
