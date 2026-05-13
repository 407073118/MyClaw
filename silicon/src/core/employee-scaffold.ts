import { access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { resolveEmployeeChildPath } from "./path-boundary.js";
import { writeUtf8FileAtomically } from "./safe-file.js";
import { resolveEmployeeTemplateForRuntime, writeEmployeeTemplateAssets } from "./template-registry.js";

export type SiliconLogger = {
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
};

export type ScaffoldEmployeeFolderInput = {
  runtimeRoot: string;
  employeeId: string;
  displayName: string;
  definitionId: string;
  overwrite?: boolean;
  logger?: SiliconLogger;
};

export type ScaffoldEmployeeFolderResult = {
  employeeDir: string;
};

const EMPLOYEE_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;

const EMPLOYEE_DIRECTORIES = [
  "soul",
  "heartbeat",
  "inbox",
  "todos",
  "schedules",
  "runs",
  "memory",
  "skills",
  "tools",
  "loadouts",
  "approvals",
  "locks",
  "artifacts",
  "reviews",
  "logs",
  "tests",
] as const;

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 创建硅基员工文件夹生命体，并记录完整中文日志。 */
export async function scaffoldEmployeeFolder(
  input: ScaffoldEmployeeFolderInput,
): Promise<ScaffoldEmployeeFolderResult> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始创建硅基员工文件夹生命体", {
    employeeId: input.employeeId,
    definitionId: input.definitionId,
    runtimeRoot: input.runtimeRoot,
  });

  if (!EMPLOYEE_ID_PATTERN.test(input.employeeId)) {
    logger.warn("硅基员工 ID 校验失败", { employeeId: input.employeeId });
    throw new Error(`Invalid employeeId: ${input.employeeId}`);
  }

  const employeeDir = join(input.runtimeRoot, "employees", input.employeeId);
  const exists = await access(employeeDir).then(
    () => true,
    () => false,
  );

  if (exists && !input.overwrite) {
    logger.warn("硅基员工目录已存在，拒绝覆盖", { employeeDir });
    throw new Error(`Employee folder already exists: ${employeeDir}`);
  }

  if (exists && input.overwrite) {
    logger.info("硅基员工目录已存在，按覆盖模式清理旧目录", { employeeDir });
    await rm(employeeDir, { recursive: true, force: true });
  }

  for (const directory of EMPLOYEE_DIRECTORIES) {
    await mkdir(join(employeeDir, directory), { recursive: true });
    logger.info("硅基员工子目录已创建", { employeeId: input.employeeId, directory });
  }

  const template = await resolveEmployeeTemplateForRuntime(input.runtimeRoot, input.definitionId, logger);
  const now = new Date().toISOString();
  const profile = {
    schemaVersion: 1,
    employeeId: input.employeeId,
    displayName: input.displayName,
    definitionId: template.definitionId,
    templateName: template.displayName,
    status: "idle",
    createdAt: now,
    updatedAt: now,
  };

  const soul = buildEmployeeSoul(input.displayName, template.displayName, template.description, template.responsibilities);
  const policy = buildDefaultPolicy();

  logger.info("写入硅基员工默认 soul 和 policy", {
    employeeId: input.employeeId,
    soulLength: soul.length,
    policyLength: policy.length,
  });

  await writeUtf8FileAtomically(resolveEmployeeChildPath(employeeDir, ["profile.json"], logger), `${JSON.stringify(profile, null, 2)}\n`, logger);
  await writeUtf8FileAtomically(resolveEmployeeChildPath(employeeDir, ["soul", "current.md"], logger), soul, logger);
  await writeUtf8FileAtomically(resolveEmployeeChildPath(employeeDir, ["soul", "changelog.md"], logger), "# Soul Changelog\n", logger);
  await writeUtf8FileAtomically(resolveEmployeeChildPath(employeeDir, ["policy.yaml"], logger), policy, logger);
  await writeEmployeeTemplateAssets(employeeDir, template, logger);
  await writeUtf8FileAtomically(
    resolveEmployeeChildPath(employeeDir, ["heartbeat", "state.json"], logger),
    `${JSON.stringify({ schemaVersion: 1, status: "alive", tickCount: 0, lastBeatAt: null, nextBeatAt: null }, null, 2)}\n`,
    logger,
  );
  await writeUtf8FileAtomically(resolveEmployeeChildPath(employeeDir, ["heartbeat", "events.jsonl"], logger), "", logger);
  await writeUtf8FileAtomically(resolveEmployeeChildPath(employeeDir, ["memory", "journal.jsonl"], logger), "", logger);
  await writeUtf8FileAtomically(resolveEmployeeChildPath(employeeDir, ["logs", "runtime.jsonl"], logger), "", logger);

  logger.info("硅基员工文件夹生命体创建完成", { employeeId: input.employeeId, employeeDir });
  return { employeeDir };
}

/** 构建员工 soul 文档，定义身份、职责、行为边界和汇报标准。 */
function buildEmployeeSoul(
  displayName: string,
  templateName: string,
  templateDescription: string,
  responsibilities: string[],
): string {
  return [
    `# ${displayName} Soul`,
    "",
    "# 身份",
    `你是硅基员工 ${displayName}，由 ${templateName} 模板创建。`,
    templateDescription,
    "",
    "# 职责",
    "你只处理已进入 inbox 或 todos 的明确任务，并以可审计产物作为交付。",
    ...responsibilities.map((item) => `- ${item}`),
    "",
    "# 工作原则",
    "先观察目标和上下文，再选择 skill 和 loadout；不确定时必须标注不确定或请求审批。",
    "",
    "# 行为边界",
    "不得越权访问其他员工目录，不得删除用户原始文件，不得绕过 policy、sandbox、approval。",
    "",
    "# 汇报标准",
    "完成时输出 artifact 和 review；失败时说明已尝试动作、失败原因、下一步建议。",
    "",
    "# 记忆规则",
    "只沉淀有来源、有置信度、可删除的长期记忆；审批历史不能自动升级为永久权限。",
    "",
    "# 测试标准",
    "员工模板、skill、policy、sandbox 必须通过 employee CI 后才能视为可发布。",
    "",
  ].join("\n");
}

/** 构建默认 policy 文本，定义低风险放行和高风险审批规则。 */
function buildDefaultPolicy(): string {
  return [
    "version: 1",
    "filesystem:",
    "  workspaceRead: allow",
    "  artifactWrite: allow",
    "  authorizedDirectoryWrite: approval_required",
    "  deleteFile: approval_required",
    "  crossEmployeeAccess: forbid",
    "process:",
    "  shellCommand: approval_required",
    "network:",
    "  externalNetwork: approval_required",
    "secret:",
    "  readMode: reference_only",
    "  writeToLogs: forbid",
    "  writeToMemory: forbid",
    "",
  ].join("\n");
}
