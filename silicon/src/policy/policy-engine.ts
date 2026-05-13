import { readFile } from "node:fs/promises";

import type { SiliconLogger } from "../core/employee-scaffold.js";
import { resolveEmployeeChildPath } from "../core/path-boundary.js";

export type CapabilityId =
  | "filesystem.read"
  | "artifact.write"
  | "shell.execute"
  | "network.external"
  | "employee.cross_access";

export type PolicyDecision = "allow" | "approval_required" | "forbid";

export type CapabilityPolicyDecision = {
  capability: CapabilityId;
  decision: PolicyDecision;
  reason: string;
};

export type ParsedPolicy = {
  rules: Map<string, PolicyDecision>;
  errors: string[];
};

const noopLogger: SiliconLogger = {
  info: () => undefined,
  warn: () => undefined,
};

const POLICY_TABLE: Record<CapabilityId, CapabilityPolicyDecision> = {
  "filesystem.read": {
    capability: "filesystem.read",
    decision: "allow",
    reason: "读取员工边界内文件属于低风险观察动作。",
  },
  "artifact.write": {
    capability: "artifact.write",
    decision: "allow",
    reason: "写入员工 artifacts 目录属于可审计产物动作。",
  },
  "shell.execute": {
    capability: "shell.execute",
    decision: "approval_required",
    reason: "执行 shell 命令可能影响宿主环境，必须进入审批闭环。",
  },
  "network.external": {
    capability: "network.external",
    decision: "approval_required",
    reason: "访问外部网络会扩大系统边界，必须进入审批闭环。",
  },
  "employee.cross_access": {
    capability: "employee.cross_access",
    decision: "forbid",
    reason: "跨员工目录访问破坏身体和记忆边界，默认禁止。",
  },
};

const CAPABILITY_POLICY_KEYS: Record<CapabilityId, string> = {
  "filesystem.read": "workspaceRead",
  "artifact.write": "artifactWrite",
  "shell.execute": "shellCommand",
  "network.external": "externalNetwork",
  "employee.cross_access": "crossEmployeeAccess",
};

const CAPABILITY_IDS: readonly CapabilityId[] = [
  "filesystem.read",
  "artifact.write",
  "shell.execute",
  "network.external",
  "employee.cross_access",
];

const VALID_POLICY_DECISIONS: readonly PolicyDecision[] = ["allow", "approval_required", "forbid"];
const CAPABILITY_POLICY_KEY_SET = new Set(Object.values(CAPABILITY_POLICY_KEYS));

/** 评估员工能力调用的默认 policy 结果，并写入中文控制日志。 */
export function evaluateCapabilityPolicy(
  capability: CapabilityId,
  logger: SiliconLogger = noopLogger,
): CapabilityPolicyDecision {
  const decision = POLICY_TABLE[capability];
  logger.info("完成硅基员工能力 policy 裁决", {
    capability: decision.capability,
    decision: decision.decision,
    reason: decision.reason,
  });
  return decision;
}

/** 校验字符串是否为已登记能力 ID，未知能力必须 fail closed。 */
export function isCapabilityId(value: string): value is CapabilityId {
  return CAPABILITY_IDS.includes(value as CapabilityId);
}

/** 读取员工 policy.yaml 并基于文件内容执行能力裁决。 */
export async function evaluateEmployeeCapabilityPolicy(input: {
  employeeDir: string;
  capability: string;
  logger?: SiliconLogger;
}): Promise<CapabilityPolicyDecision> {
  const logger = input.logger ?? noopLogger;
  logger.info("开始基于员工 policy.yaml 裁决能力", {
    employeeDir: input.employeeDir,
    capability: input.capability,
  });
  if (!isCapabilityId(input.capability)) {
    logger.warn("能力 ID 未登记，按 fail closed 禁止执行", {
      employeeDir: input.employeeDir,
      capability: input.capability,
    });
    return {
      capability: "employee.cross_access",
      decision: "forbid",
      reason: `未知能力 ${input.capability} 未登记，已按 fail closed 禁止。`,
    };
  }

  const policyPath = resolveEmployeeChildPath(input.employeeDir, ["policy.yaml"], logger);
  const policyText = await readFile(policyPath, "utf8").catch((error: unknown) => {
    logger.warn("读取员工 policy.yaml 失败，按 fail closed 禁止执行", {
      employeeDir: input.employeeDir,
      policyPath,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return "";
  });
  const parsedPolicy = parsePolicyText(policyText, logger);
  if (parsedPolicy.errors.length > 0) {
    logger.warn("员工 policy.yaml 解析失败，按 fail closed 禁止能力执行", {
      employeeDir: input.employeeDir,
      capability: input.capability,
      errorCount: parsedPolicy.errors.length,
    });
    return {
      capability: input.capability,
      decision: "forbid",
      reason: `policy.yaml 解析失败，已按 fail closed 禁止：${parsedPolicy.errors.join("; ")}`,
    };
  }
  const key = CAPABILITY_POLICY_KEYS[input.capability];
  const decision = parsedPolicy.rules.get(key) ?? "forbid";
  const result: CapabilityPolicyDecision = {
    capability: input.capability,
    decision,
    reason: parsedPolicy.rules.has(key)
      ? `policy.yaml 规则 ${key}: ${decision}`
      : `policy.yaml 缺少规则 ${key}，已按 fail closed 禁止。`,
  };
  logger.info("员工 policy.yaml 能力裁决完成", {
    employeeDir: input.employeeDir,
    capability: result.capability,
    decision: result.decision,
    reason: result.reason,
  });
  return result;
}

/** 返回所有能力到 policy.yaml 键名的映射，供 CI 做完整规则校验。 */
export function listCapabilityPolicyKeys(): ReadonlyMap<CapabilityId, string> {
  return new Map(Object.entries(CAPABILITY_POLICY_KEYS) as Array<[CapabilityId, string]>);
}

/** 解析当前简化 YAML policy 文本，并把重复键和未知裁决显式返回给调用方。 */
export function parsePolicyText(policyText: string, logger: SiliconLogger = noopLogger): ParsedPolicy {
  logger.info("开始解析员工 policy.yaml 文本", { length: policyText.length });
  const policy = new Map<string, PolicyDecision>();
  const errors: string[] = [];
  const seenKeys = new Set<string>();
  for (const [lineIndex, line] of policyText.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes(":")) {
      continue;
    }
    const [key, ...valueParts] = trimmed.split(":");
    const normalizedKey = key.trim();
    const value = valueParts.join(":").trim();
    if (!value) {
      continue;
    }
    if (!CAPABILITY_POLICY_KEY_SET.has(normalizedKey)) {
      continue;
    }
    if (seenKeys.has(normalizedKey)) {
      errors.push(`第 ${lineIndex + 1} 行重复规则 ${normalizedKey}`);
      continue;
    }
    seenKeys.add(normalizedKey);
    if (VALID_POLICY_DECISIONS.includes(value as PolicyDecision)) {
      policy.set(normalizedKey, value as PolicyDecision);
    } else {
      errors.push(`第 ${lineIndex + 1} 行规则 ${normalizedKey} 使用未知裁决 ${value}`);
    }
  }
  logger.info("员工 policy.yaml 文本解析完成", { ruleCount: policy.size, errorCount: errors.length });
  return { rules: policy, errors };
}
