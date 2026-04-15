import type {
  CapabilityExecutionRoute,
  ModelProfile,
  ProtocolTarget,
} from "@shared/contracts";

export type BackgroundModePolicy = {
  enabled: boolean;
  reason: string;
  pollAfterMs: number;
};

type ResolveBackgroundModePolicyInput = {
  profile: Pick<ModelProfile, "model" | "responsesApiConfig">;
  protocolTarget: ProtocolTarget;
  capabilityRoutes?: CapabilityExecutionRoute[] | null;
  sessionId?: string | null;
  workflowRunId?: string | null;
};

const DEFAULT_BACKGROUND_POLL_INTERVAL_MS = 2000;
const MIN_BACKGROUND_POLL_INTERVAL_MS = 1000;
const MAX_BACKGROUND_POLL_INTERVAL_MS = 30000;

/** 规范化后台轮询间隔，避免 profile 配置把客户端拖入极端轮询频率。 */
function normalizePollAfterMs(rawValue: number | undefined): number {
  if (!Number.isFinite(rawValue)) {
    return DEFAULT_BACKGROUND_POLL_INTERVAL_MS;
  }

  return Math.min(
    MAX_BACKGROUND_POLL_INTERVAL_MS,
    Math.max(MIN_BACKGROUND_POLL_INTERVAL_MS, Math.trunc(rawValue as number)),
  );
}

/** 判断当前模型是否属于深度研究模型；OpenAI 官方建议这类请求优先走后台模式。 */
function isDeepResearchModel(model: string): boolean {
  return /deep-research/i.test(model);
}

/** 解析 OpenAI 原生后台模式策略，区分普通前台会话、深度研究和 workflow 前台执行。 */
export function resolveBackgroundModePolicy(
  input: ResolveBackgroundModePolicyInput,
): BackgroundModePolicy {
  const pollAfterMs = normalizePollAfterMs(input.profile.responsesApiConfig?.backgroundPollIntervalMs);

  if (input.protocolTarget !== "openai-responses") {
    return { enabled: false, reason: "protocol_not_supported", pollAfterMs };
  }

  const nativeResearchRoute = input.capabilityRoutes?.some((route) =>
    route.capabilityId === "research-task"
    && route.routeType === "vendor-native"
    && route.nativeToolName === "background_response",
  ) ?? false;
  if (!nativeResearchRoute) {
    return { enabled: false, reason: "native_background_unavailable", pollAfterMs };
  }

  if (input.workflowRunId) {
    return { enabled: false, reason: "workflow_foreground_only", pollAfterMs };
  }

  if (!input.sessionId) {
    return { enabled: false, reason: "session_scope_required", pollAfterMs };
  }

  if (input.profile.responsesApiConfig?.disableResponseStorage) {
    return { enabled: false, reason: "response_storage_disabled", pollAfterMs };
  }

  const strategy = input.profile.responsesApiConfig?.backgroundMode ?? "auto";
  if (strategy === "off") {
    return { enabled: false, reason: "profile_disabled", pollAfterMs };
  }

  if (strategy === "always") {
    return { enabled: true, reason: "profile_always", pollAfterMs };
  }

  if (isDeepResearchModel(input.profile.model)) {
    return { enabled: true, reason: "deep_research_model", pollAfterMs };
  }

  return { enabled: false, reason: "interactive_default", pollAfterMs };
}
