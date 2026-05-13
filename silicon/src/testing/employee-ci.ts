import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { SiliconLogger } from "../core/employee-scaffold.js";
import { readEmployeeLockMetadata } from "../core/lock-store.js";
import {
  assertApprovalRequest,
  assertEmployeeProfile,
  assertEmployeeTask,
  assertEmployeeTodo,
  assertHeartbeatEvent,
  assertHeartbeatState,
  assertMemoryJournalEntry,
  assertScheduledTask,
  parseJsonRecord,
} from "../core/schema-guards.js";
import { listCapabilityPolicyKeys, parsePolicyText, type PolicyDecision } from "../policy/policy-engine.js";

export type EmployeeCiCheck = {
  name: string;
  passed: boolean;
  message: string;
};

export type EmployeeCiResult = {
  passed: boolean;
  checks: EmployeeCiCheck[];
};

export type EmployeeRuntimeHealth = {
  checkedRecords: number;
  malformedRecords: number;
  staleLocks: number;
  errors: string[];
};

type RuntimeRecordGuard = (value: unknown) => void;

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

const REQUIRED_DIRECTORIES = [
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

const REQUIRED_FILES = [
  "soul/current.md",
  "soul/changelog.md",
  "profile.json",
  "policy.yaml",
  "heartbeat/state.json",
  "heartbeat/events.jsonl",
] as const;

/** 校验硅基员工文件夹生命体是否满足 MVP 门禁，并记录中文检查日志。 */
export async function validateEmployeeFolder(
  employeeDir: string,
  options?: { logger?: SiliconLogger },
): Promise<EmployeeCiResult> {
  const logger = options?.logger ?? noopLogger;
  const checks: EmployeeCiCheck[] = [];
  logger.info("开始执行硅基员工 CI 目录检查", { employeeDir });

  for (const directory of REQUIRED_DIRECTORIES) {
    const target = join(employeeDir, directory);
    const passed = await stat(target).then(
      (info) => info.isDirectory(),
      () => false,
    );
    checks.push({
      name: `directory:${directory}`,
      passed,
      message: passed ? `目录存在：${directory}` : `目录缺失：${directory}`,
    });
  }

  for (const file of REQUIRED_FILES) {
    const target = join(employeeDir, file);
    const passed = await stat(target).then(
      (info) => info.isFile(),
      () => false,
    );
    checks.push({
      name: `file:${file}`,
      passed,
      message: passed ? `文件存在：${file}` : `文件缺失：${file}`,
    });
  }

  checks.push(await checkProfile(employeeDir));
  checks.push(...await checkSoul(employeeDir));
  checks.push(...await checkPolicy(employeeDir));

  const passed = checks.every((check) => check.passed);
  logger.info("硅基员工 CI 目录检查完成", { employeeDir, passed, checkCount: checks.length });
  return { passed, checks };
}

/** 检查员工运行态记录和目录锁，用于 runtime doctor 汇总真实健康度。 */
export async function inspectEmployeeRuntimeHealth(
  employeeDir: string,
  options?: { logger?: SiliconLogger; now?: () => Date },
): Promise<EmployeeRuntimeHealth> {
  const logger = options?.logger ?? noopLogger;
  const health: EmployeeRuntimeHealth = {
    checkedRecords: 0,
    malformedRecords: 0,
    staleLocks: 0,
    errors: [],
  };
  logger.info("开始检查硅基员工运行态健康度", { employeeDir });

  await scanJsonFile(employeeDir, "profile.json", "profile", assertEmployeeProfile, health, logger);
  await scanJsonFile(employeeDir, join("heartbeat", "state.json"), "heartbeat-state", assertHeartbeatState, health, logger);
  await scanHeartbeatEvents(employeeDir, health, logger);
  await scanJsonDirectory(employeeDir, "inbox", "task", assertEmployeeTask, health, logger);
  await scanJsonDirectory(employeeDir, "todos", "todo", assertEmployeeTodo, health, logger);
  await scanJsonDirectory(employeeDir, "approvals", "approval", assertApprovalRequest, health, logger);
  await scanJsonDirectory(employeeDir, "schedules", "schedule", assertScheduledTask, health, logger);
  await scanMemoryJournal(employeeDir, health, logger);
  await scanLocks(employeeDir, health, options?.now?.() ?? new Date(), logger);

  logger.info("硅基员工运行态健康度检查完成", {
    employeeDir,
    checkedRecords: health.checkedRecords,
    malformedRecords: health.malformedRecords,
    staleLocks: health.staleLocks,
  });
  return health;
}

/** 校验 profile.json 的最小结构。 */
async function checkProfile(employeeDir: string): Promise<EmployeeCiCheck> {
  const profileText = await readFile(join(employeeDir, "profile.json"), "utf8").catch(() => "");
  let profilePassed = false;
  try {
    const profile = JSON.parse(profileText) as Record<string, unknown>;
    profilePassed = profile.schemaVersion === 1
      && typeof profile.employeeId === "string"
      && typeof profile.displayName === "string"
      && typeof profile.definitionId === "string"
      && typeof profile.status === "string";
  } catch {
    profilePassed = false;
  }
  return {
    name: "profile:parse",
    passed: profilePassed,
    message: profilePassed ? "profile.json 结构合法" : "profile.json 结构不合法",
  };
}

/** 校验 soul 文档包含员工运行所需核心章节。 */
async function checkSoul(employeeDir: string): Promise<EmployeeCiCheck[]> {
  const soul = await readFile(join(employeeDir, "soul", "current.md"), "utf8").catch(() => "");
  const requiredSoulHeadings = ["# 身份", "# 职责", "# 工作原则", "# 行为边界", "# 汇报标准", "# 记忆规则", "# 测试标准"];
  return requiredSoulHeadings.map((heading) => {
    const passed = soul.includes(heading);
    return {
      name: `soul:${heading}`,
      passed,
      message: passed ? `soul 包含章节：${heading}` : `soul 缺少章节：${heading}`,
    };
  });
}

/** 校验 policy 文档包含最小能力裁决规则。 */
async function checkPolicy(employeeDir: string): Promise<EmployeeCiCheck[]> {
  const policyText = await readFile(join(employeeDir, "policy.yaml"), "utf8").catch(() => "");
  const parsedPolicy = parsePolicyText(policyText);
  const checks: EmployeeCiCheck[] = [];
  checks.push({
    name: "policy:parse",
    passed: parsedPolicy.errors.length === 0,
    message: parsedPolicy.errors.length === 0
      ? "policy.yaml 解析合法"
      : `policy.yaml 解析失败：${parsedPolicy.errors.join("; ")}`,
  });
  const expectedPolicy: Record<string, PolicyDecision> = {
    workspaceRead: "allow",
    artifactWrite: "allow",
    shellCommand: "approval_required",
    externalNetwork: "approval_required",
    crossEmployeeAccess: "forbid",
  };
  for (const key of listCapabilityPolicyKeys().values()) {
    const expected = expectedPolicy[key];
    const actual = parsedPolicy.rules.get(key);
    const passed = actual === expected;
    const line = `${key}: ${expected}`;
    checks.push({
      name: `policy:${line}`,
      passed,
      message: passed ? `policy 包含规则：${line}` : `policy 规则不匹配：${key} actual=${actual ?? "missing"} expected=${expected}`,
    });
  }
  return checks;
}

/** 扫描单个 JSON 记录，并把坏记录累计到 doctor 健康度。 */
async function scanJsonFile(
  employeeDir: string,
  relativePath: string,
  recordType: string,
  guard: RuntimeRecordGuard,
  health: EmployeeRuntimeHealth,
  logger: SiliconLogger,
): Promise<void> {
  const target = join(employeeDir, relativePath);
  const raw = await readFile(target, "utf8").catch(() => null);
  if (raw === null) {
    return;
  }
  checkJsonRecord(raw, `${recordType}:${relativePath}`, guard, health, logger);
}

/** 扫描目录中的 JSON 记录，并把格式错误或结构错误统一归为坏记录。 */
async function scanJsonDirectory(
  employeeDir: string,
  relativeDir: string,
  recordType: string,
  guard: RuntimeRecordGuard,
  health: EmployeeRuntimeHealth,
  logger: SiliconLogger,
): Promise<void> {
  const directory = join(employeeDir, relativeDir);
  const entries = await readdir(directory).catch(() => []);
  for (const entry of entries.filter((item) => item.endsWith(".json")).sort()) {
    const raw = await readFile(join(directory, entry), "utf8").catch(() => null);
    if (raw !== null) {
      checkJsonRecord(raw, `${recordType}:${entry}`, guard, health, logger);
    }
  }
}

/** 扫描 memory journal 的 JSONL 记录，逐行定位坏记忆。 */
async function scanMemoryJournal(
  employeeDir: string,
  health: EmployeeRuntimeHealth,
  logger: SiliconLogger,
): Promise<void> {
  const raw = await readFile(join(employeeDir, "memory", "journal.jsonl"), "utf8").catch(() => "");
  const lines = raw.split(/\r?\n/);
  for (const [lineIndex, line] of lines.entries()) {
    if (line.trim().length === 0) {
      continue;
    }
    checkJsonRecord(line, `memory:${lineIndex + 1}`, assertMemoryJournalEntry, health, logger);
  }
}

/** 扫描 heartbeat events.jsonl，定位损坏的心跳事件日志。 */
async function scanHeartbeatEvents(
  employeeDir: string,
  health: EmployeeRuntimeHealth,
  logger: SiliconLogger,
): Promise<void> {
  const raw = await readFile(join(employeeDir, "heartbeat", "events.jsonl"), "utf8").catch(() => "");
  const lines = raw.split(/\r?\n/);
  for (const [lineIndex, line] of lines.entries()) {
    if (line.trim().length === 0) {
      continue;
    }
    checkJsonRecord(line, `heartbeat-event:${lineIndex + 1}`, assertHeartbeatEvent, health, logger);
  }
}

/** 扫描员工目录锁，统计过期锁和不可读锁元数据。 */
async function scanLocks(
  employeeDir: string,
  health: EmployeeRuntimeHealth,
  now: Date,
  logger: SiliconLogger,
): Promise<void> {
  const locksDir = join(employeeDir, "locks");
  const entries = await readdir(locksDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.filter((item) => item.isDirectory() && item.name.endsWith(".lock"))) {
    const lockDir = join(locksDir, entry.name);
    const metadata = await readEmployeeLockMetadata(lockDir).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      health.malformedRecords += 1;
      health.errors.push(`lock:${entry.name}:${message}`);
      logger.warn("硅基员工目录锁元数据不可读", { employeeDir, lockName: entry.name, errorMessage: message });
      return null;
    });
    if (!metadata) {
      continue;
    }
    const expiresAt = Date.parse(metadata.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      health.malformedRecords += 1;
      health.errors.push(`lock:${entry.name}:Invalid expiresAt`);
      continue;
    }
    if (expiresAt <= now.getTime()) {
      health.staleLocks += 1;
    }
  }
}

/** 对 JSON 文本做解析和 schema guard，并累计 doctor 诊断。 */
function checkJsonRecord(
  raw: string,
  label: string,
  guard: RuntimeRecordGuard,
  health: EmployeeRuntimeHealth,
  logger: SiliconLogger,
): void {
  health.checkedRecords += 1;
  try {
    const parsed = parseJsonRecord(raw, label);
    guard(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    health.malformedRecords += 1;
    health.errors.push(`${label}:${message}`);
    logger.warn("硅基员工运行态记录校验失败", { label, errorMessage: message });
  }
}
