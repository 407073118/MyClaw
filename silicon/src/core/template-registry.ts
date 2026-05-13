import { mkdir, readFile } from "node:fs/promises";

import type { CapabilityId } from "../policy/policy-engine.js";
import { isCapabilityId } from "../policy/policy-engine.js";
import type { SiliconLogger } from "./employee-scaffold.js";
import { resolveEmployeeChildPath } from "./path-boundary.js";
import { writeUtf8FileAtomically } from "./safe-file.js";

export type EmployeeTemplateDefinition = {
  schemaVersion: 1;
  definitionId: string;
  displayName: string;
  description: string;
  defaultSkillId: string;
  defaultLoadoutId: string;
  capabilities: CapabilityId[];
  responsibilities: string[];
  successCriteria: string[];
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

const BUILTIN_TEMPLATES: EmployeeTemplateDefinition[] = [
  {
    schemaVersion: 1,
    definitionId: "document-organizer",
    displayName: "资料整理员工",
    description: "整理 inbox、产出摘要、沉淀可追溯复盘的文档型硅基员工。",
    defaultSkillId: "structured-summary",
    defaultLoadoutId: "default-document-flow",
    capabilities: ["filesystem.read", "artifact.write"],
    responsibilities: ["读取任务输入", "生成结构化摘要", "写入 artifact 和 review", "沉淀高置信记忆"],
    successCriteria: ["产物路径存在", "review 可读", "memory journal 有来源"],
  },
  {
    schemaVersion: 1,
    definitionId: "code-reviewer",
    displayName: "代码审查员工",
    description: "读取代码变更、输出风险列表和审查建议的代码型硅基员工。",
    defaultSkillId: "risk-review",
    defaultLoadoutId: "default-review-flow",
    capabilities: ["filesystem.read", "artifact.write"],
    responsibilities: ["识别变更范围", "按严重度列出风险", "输出审查复盘", "避免修改用户代码"],
    successCriteria: ["审查结论可追溯", "风险按严重度排序", "不越权写入源码"],
  },
  {
    schemaVersion: 1,
    definitionId: "ops-runner",
    displayName: "运维执行员工",
    description: "执行受控本地运维任务，默认所有高风险动作进入审批。",
    defaultSkillId: "controlled-ops",
    defaultLoadoutId: "default-ops-flow",
    capabilities: ["filesystem.read", "artifact.write", "shell.execute", "network.external"],
    responsibilities: ["观察运行状态", "申请高风险审批", "记录执行证据", "失败时给出恢复建议"],
    successCriteria: ["审批链路完整", "执行日志可回放", "不自动扩大权限"],
  },
];

/** 列出平台内置员工模板，并记录中文模板发现日志。 */
export function listEmployeeTemplates(logger: SiliconLogger = noopLogger): EmployeeTemplateDefinition[] {
  logger.info("列出 Silicon Runtime 内置员工模板", { count: BUILTIN_TEMPLATES.length });
  return BUILTIN_TEMPLATES.map((template) => ({ ...template }));
}

/** 按模板 ID 读取内置员工模板定义，找不到时直接报错。 */
export function resolveEmployeeTemplate(
  definitionId: string,
  logger: SiliconLogger = noopLogger,
): EmployeeTemplateDefinition {
  const template = BUILTIN_TEMPLATES.find((item) => item.definitionId === definitionId);
  if (!template) {
    logger.warn("未找到指定硅基员工内置模板", { requestedDefinitionId: definitionId });
    throw new Error(`Unknown employee template: ${definitionId}`);
  }
  logger.info("已解析硅基员工模板定义", {
    definitionId: template.definitionId,
    defaultSkillId: template.defaultSkillId,
    defaultLoadoutId: template.defaultLoadoutId,
  });
  return { ...template };
}

/** 优先从 runtime-root/templates 读取员工模板，缺失时回退到内置模板。 */
export async function resolveEmployeeTemplateForRuntime(
  runtimeRoot: string,
  definitionId: string,
  logger: SiliconLogger = noopLogger,
): Promise<EmployeeTemplateDefinition> {
  logger.info("开始从 runtime root 解析硅基员工模板", { runtimeRoot, definitionId });
  const templatePath = resolveEmployeeChildPath(runtimeRoot, ["templates", `${definitionId}.json`], logger);
  const raw = await readFile(templatePath, "utf8").catch(() => "");
  if (raw.trim()) {
    const template = JSON.parse(raw) as EmployeeTemplateDefinition;
    assertEmployeeTemplateDefinition(template, definitionId, logger);
    logger.info("已从 runtime root 读取硅基员工模板", {
      runtimeRoot,
      definitionId: template.definitionId,
    });
    return template;
  }
  return resolveEmployeeTemplate(definitionId, logger);
}

/** 将模板、默认 skill 和默认 loadout 写入员工文件夹边界。 */
export async function writeEmployeeTemplateAssets(
  employeeDir: string,
  template: EmployeeTemplateDefinition,
  logger: SiliconLogger = noopLogger,
): Promise<void> {
  logger.info("开始写入硅基员工模板资产", {
    employeeDir,
    definitionId: template.definitionId,
    defaultSkillId: template.defaultSkillId,
    defaultLoadoutId: template.defaultLoadoutId,
  });
  await writeUtf8FileAtomically(
    resolveEmployeeChildPath(employeeDir, ["definition.json"], logger),
    `${JSON.stringify(template, null, 2)}\n`,
    logger,
  );

  const skillDir = resolveEmployeeChildPath(employeeDir, ["skills", template.defaultSkillId], logger);
  await mkdir(skillDir, { recursive: true });
  await writeUtf8FileAtomically(
    resolveEmployeeChildPath(employeeDir, ["skills", template.defaultSkillId, "skill.json"], logger),
    `${JSON.stringify(buildSkillManifest(template), null, 2)}\n`,
    logger,
  );
  await writeUtf8FileAtomically(
    resolveEmployeeChildPath(employeeDir, ["skills", template.defaultSkillId, "SKILL.md"], logger),
    buildSkillManual(template),
    logger,
  );

  const loadout = buildDefaultLoadout(template);
  await writeUtf8FileAtomically(
    resolveEmployeeChildPath(employeeDir, ["loadouts", `${template.defaultLoadoutId}.json`], logger),
    `${JSON.stringify(loadout, null, 2)}\n`,
    logger,
  );
  await writeUtf8FileAtomically(
    resolveEmployeeChildPath(employeeDir, ["loadouts", "current.json"], logger),
    `${JSON.stringify(loadout, null, 2)}\n`,
    logger,
  );
  logger.info("硅基员工模板资产已写入", { employeeDir, definitionId: template.definitionId, skillDir });
}

/** 构建默认 skill 的结构化清单。 */
function buildSkillManifest(template: EmployeeTemplateDefinition): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: template.defaultSkillId,
    name: `${template.displayName} 默认技能`,
    version: "0.1.0",
    capabilities: template.capabilities,
    responsibilities: template.responsibilities,
    successCriteria: template.successCriteria,
  };
}

/** 构建默认 skill 培训手册文本。 */
function buildSkillManual(template: EmployeeTemplateDefinition): string {
  return [
    `# ${template.displayName} 默认 Skill`,
    "",
    "## 使用场景",
    template.description,
    "",
    "## 标准动作",
    ...template.responsibilities.map((item) => `- ${item}`),
    "",
    "## 交付门槛",
    ...template.successCriteria.map((item) => `- ${item}`),
    "",
    "## 边界",
    "任何不在 policy 允许范围内的动作必须进入 approval，不允许通过提示词绕过。",
    "",
  ].join("\n");
}

/** 构建默认 loadout，定义 harness 执行时应加载的 skill 和控制参数。 */
function buildDefaultLoadout(template: EmployeeTemplateDefinition): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: template.defaultLoadoutId,
    skillIds: [template.defaultSkillId],
    maxRunSteps: 6,
    maxArtifacts: 3,
    memoryWrite: "journal_only",
    approvalMode: "policy_driven",
    verifier: {
      requireArtifact: true,
      requireReview: true,
      requireLedger: true,
    },
  };
}

/** 校验员工模板定义的最小持久化契约。 */
function assertEmployeeTemplateDefinition(
  template: EmployeeTemplateDefinition,
  expectedDefinitionId: string,
  logger: SiliconLogger,
): void {
  const valid = template.schemaVersion === 1
    && template.definitionId === expectedDefinitionId
    && typeof template.displayName === "string"
    && typeof template.description === "string"
    && typeof template.defaultSkillId === "string"
    && typeof template.defaultLoadoutId === "string"
    && Array.isArray(template.capabilities)
    && template.capabilities.every(isCapabilityId)
    && Array.isArray(template.responsibilities)
    && Array.isArray(template.successCriteria);
  if (!valid) {
    logger.warn("硅基员工模板定义校验失败", { expectedDefinitionId, template });
    throw new Error(`Invalid employee template: ${expectedDefinitionId}`);
  }
}
