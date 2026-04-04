/**
 * 上下文工程 UI 辅助函数 — 格式化能力信息供 UI 层展示。
 */

import type { ModelCapability, ModelCapabilitySource } from "@shared/contracts";

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
