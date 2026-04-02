/**
 * Token 预算管理器 — 根据模型能力和预算策略计算每次请求的安全 token 预算。
 */

import type {
  ModelCapability,
  ContextBudgetPolicy,
  JsonValue,
} from "@shared/contracts";
import { DEFAULT_CONTEXT_BUDGET_POLICY } from "@shared/contracts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 预算快照：每次请求前计算，用于指导上下文组装和压缩决策。 */
export type BudgetSnapshot = {
  /** 有效上下文窗口大小 */
  effectiveContextWindow: number;
  /** 有效最大输入 token 数 */
  effectiveMaxInput: number;
  /** 有效最大输出 token 数 */
  effectiveMaxOutput: number;
  /** 安全输入预算 = maxInput - 各项预留 */
  safeInputBudget: number;
  /** 触发压缩的 token 阈值 */
  compactTriggerTokens: number;
  /** 各项预留明细 */
  reserves: {
    output: number;
    system: number;
    tool: number;
    memory: number;
    safety: number;
  };
  /** 使用的预算策略 */
  policy: Required<ContextBudgetPolicy>;
};

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/** 取多个可空数值中的最小非空值 */
function minNonNull(...values: Array<number | undefined | null>): number | undefined {
  let result: number | undefined;
  for (const v of values) {
    if (v != null && Number.isFinite(v) && v > 0) {
      result = result === undefined ? v : Math.min(result, v);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 核心计算
// ---------------------------------------------------------------------------

/**
 * 构建预算快照，明确各项 token 预留和安全输入空间。
 *
 * 计算公式：
 *   effectiveContextWindow = min(contextWindowTokens, maxInputTokens + maxOutputTokens) ?? 32768
 *   effectiveMaxInput = min(maxInputTokens, contextWindowTokens) ?? effectiveContextWindow
 *   effectiveMaxOutput = maxOutputTokens ?? 4096
 *   safeInputBudget = effectiveMaxInput - systemReserve - toolReserve - memoryReserve - outputReserve - safetyMargin
 */
export function buildBudgetSnapshot(
  capability: ModelCapability,
  policy?: ContextBudgetPolicy,
): BudgetSnapshot {
  const p: Required<ContextBudgetPolicy> = {
    ...DEFAULT_CONTEXT_BUDGET_POLICY,
    ...(policy ?? {}),
  };

  // 计算有效上下文窗口
  const contextWithOutput = capability.maxInputTokens && capability.maxOutputTokens
    ? capability.maxInputTokens + capability.maxOutputTokens
    : undefined;
  const effectiveContextWindow = minNonNull(
    capability.contextWindowTokens,
    contextWithOutput,
  ) ?? 32768;

  // 计算有效最大输入
  const effectiveMaxInput = minNonNull(
    capability.maxInputTokens,
    capability.contextWindowTokens,
  ) ?? effectiveContextWindow;

  // 计算有效最大输出（不超过能力限制）
  const effectiveMaxOutput = capability.maxOutputTokens ?? 4096;

  // 计算安全输入预算
  const totalReserve =
    p.systemReserveTokens +
    p.toolReserveTokens +
    p.memoryReserveTokens +
    p.outputReserveTokens +
    p.safetyMarginTokens;

  const safeInputBudget = Math.max(0, effectiveMaxInput - totalReserve);

  // 计算压缩触发阈值
  const compactTriggerTokens = Math.floor(safeInputBudget * p.compactTriggerRatio);

  return {
    effectiveContextWindow,
    effectiveMaxInput,
    effectiveMaxOutput,
    safeInputBudget,
    compactTriggerTokens,
    reserves: {
      output: p.outputReserveTokens,
      system: p.systemReserveTokens,
      tool: p.toolReserveTokens,
      memory: p.memoryReserveTokens,
      safety: p.safetyMarginTokens,
    },
    policy: p,
  };
}

// ---------------------------------------------------------------------------
// requestBody 输出限制归一化
// ---------------------------------------------------------------------------

/**
 * 从 requestBody 中提取归一化的最大输出 token 数。
 * 优先使用 max_completion_tokens，其次 max_tokens。
 */
export function normalizeOutputLimit(
  requestBody?: Record<string, JsonValue> | null,
): number | null {
  if (!requestBody) return null;

  // max_completion_tokens 优先（OpenAI 新接口）
  const maxCompletionTokens = requestBody["max_completion_tokens"];
  if (maxCompletionTokens != null) {
    const parsed = Number(maxCompletionTokens);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  // max_tokens 兜底
  const maxTokens = requestBody["max_tokens"];
  if (maxTokens != null) {
    const parsed = Number(maxTokens);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  return null;
}
