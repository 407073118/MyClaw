/**
 * 上下文工程 UI 辅助函数 — 格式化能力信息供 UI 层展示。
 */

import type { ContextLimitWarningPayload, ModelCapability, ModelCapabilitySource } from "@shared/contracts";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type CapabilitySummary = {
  contextWindow: string;
  maxInput: string;
  maxOutput: string;
  source: string;
  features: {
    tools: boolean;
    streaming: boolean;
    reasoning: boolean;
    vision: boolean;
    promptCaching: boolean;
  };
};

export type ContextLimitWarningViewModel = {
  primaryText: string;
  detailItems: string[];
  checkpointPreview: string | null;
};

// ---------------------------------------------------------------------------
// 格式化函数
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<ModelCapabilitySource, string> = {
  "default": "默认值",
  "registry": "内置注册表",
  "provider-catalog": "服务商目录",
  "provider-detail": "服务商详情",
  "provider-token-count": "Token 计数 API",
  "manual-override": "手动覆盖",
  "observed-response": "实际响应推断",
  "degraded-after-error": "降级（错误后）",
};

/**
 * 将能力来源转为中文标签。
 */
export function formatCapabilitySource(source: ModelCapabilitySource | string): string {
  return SOURCE_LABELS[source as ModelCapabilitySource] ?? source;
}

/**
 * 将 token 数格式化为可读字符串。
 */
export function formatTokenCount(value: number | undefined | null): string {
  if (value == null) return "—";
  if (value === 0) return "0";

  if (value >= 1_000_000) {
    return `${Math.floor(value / 1_000_000)}M`;
  }
  if (value >= 10_000) {
    return `${Math.floor(value / 1_000)}K`;
  }
  return value.toLocaleString("en-US");
}

/**
 * 从已解析的模型能力构建 UI 展示用的摘要。
 */
export function buildCapabilitySummary(capability: ModelCapability): CapabilitySummary {
  return {
    contextWindow: formatTokenCount(capability.contextWindowTokens),
    maxInput: formatTokenCount(capability.maxInputTokens),
    maxOutput: formatTokenCount(capability.maxOutputTokens),
    source: formatCapabilitySource(capability.source),
    features: {
      tools: capability.supportsTools ?? false,
      streaming: capability.supportsStreaming ?? false,
      reasoning: capability.supportsReasoning ?? false,
      vision: capability.supportsVision ?? false,
      promptCaching: capability.supportsPromptCaching ?? false,
    },
  };
}

/**
 * 将上下文压缩事件转换为 UI 可直接展示的解释文本。
 */
export function buildContextLimitWarningViewModel(payload: ContextLimitWarningPayload): ContextLimitWarningViewModel {
  const compactionCount = Math.max(0, payload.compactionCount ?? 0);
  const removedCount = Math.max(0, payload.removedCount ?? 0);
  const maskedToolOutputCount = Math.max(0, payload.maskedToolOutputCount ?? 0);
  const detailItems: string[] = [];

  if (payload.compactionReason) {
    detailItems.push(`原因：${payload.compactionReason}`);
  }
  if (removedCount > 0) {
    detailItems.push(`已移除 ${removedCount} 条历史消息`);
  }
  if (maskedToolOutputCount > 0) {
    detailItems.push(`已折叠 ${maskedToolOutputCount} 条旧工具输出`);
  }
  if (payload.checkpointId) {
    detailItems.push(`保留状态：${payload.checkpointId}`);
  }
  if (payload.budgetUsed != null && payload.budgetLimit != null) {
    detailItems.push(`预算：${formatTokenCount(payload.budgetUsed)} / ${formatTokenCount(payload.budgetLimit)}`);
  }

  return {
    primaryText: `当前对话较长，已压缩 ${compactionCount} 次。系统已保留结构化状态，但继续拉长可能降低回答稳定性。`,
    detailItems,
    checkpointPreview: payload.checkpointPreview ?? null,
  };
}
