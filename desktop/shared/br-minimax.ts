import type { ContextBudgetPolicy, JsonValue, ModelProfile } from "./contracts";

export const BR_MINIMAX_PROVIDER_FLAVOR = "br-minimax" as const;
export const BR_MINIMAX_DEFAULT_NAME = "BR MiniMax";
export const BR_MINIMAX_BASE_URL = "http://api-cybotforge-pre.brapp.com";
export const BR_MINIMAX_MODEL = "minimax-m2-5";
export const BR_MINIMAX_RUNTIME_RAW_KEY = "brMiniMaxRuntime";

export type BrMiniMaxThinkingPath =
  | "reasoning_split"
  | "reasoning_content"
  | "disabled"
  | "unverified";

export type BrMiniMaxRuntimeDiagnostics = {
  reasoningSplitSupported: boolean | null;
  thinkingPath: BrMiniMaxThinkingPath;
  lastCheckedAt: string | null;
};

export const BR_MINIMAX_REQUEST_BODY = {
  temperature: 1.0,
  top_p: 0.95,
  top_k: 40,
  chat_template_kwargs: {
    enable_thinking: true,
  },
} as const satisfies Record<string, JsonValue>;

export const BR_MINIMAX_BUDGET_POLICY: Readonly<Required<ContextBudgetPolicy>> = {
  outputReserveTokens: 8192,
  systemReserveTokens: 2048,
  toolReserveTokens: 8192,
  memoryReserveTokens: 4096,
  safetyMarginTokens: 2048,
  compactTriggerRatio: 0.88,
  minRecentTurnsToKeep: 16,
  recentToolOutputTurnsToKeep: 10,
  suggestNewChatAfterCompactions: 2,
  maxSummaryBlocks: 6,
  enableLongTermMemory: true,
  enableContextCheckpoint: true,
};

type BrMiniMaxCreateInput = {
  apiKey: string;
  id?: string;
};

const DEFAULT_BR_MINIMAX_RUNTIME_DIAGNOSTICS: BrMiniMaxRuntimeDiagnostics = {
  reasoningSplitSupported: null,
  thinkingPath: "unverified",
  lastCheckedAt: null,
};

/** 从任意值中安全读取对象记录，避免运行时访问异常。 */
function readObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** 读取 profile 上保存的 BR MiniMax 运行时诊断。 */
export function readBrMiniMaxRuntimeDiagnostics(
  profile: Pick<ModelProfile, "discoveredCapabilities"> | null | undefined,
): BrMiniMaxRuntimeDiagnostics {
  const raw = readObjectRecord(profile?.discoveredCapabilities?.raw);
  const runtime = readObjectRecord(raw?.[BR_MINIMAX_RUNTIME_RAW_KEY]);
  if (!runtime) return DEFAULT_BR_MINIMAX_RUNTIME_DIAGNOSTICS;

  const reasoningSplitSupported = typeof runtime.reasoningSplitSupported === "boolean"
    ? runtime.reasoningSplitSupported
    : null;
  const thinkingPath = runtime.thinkingPath === "reasoning_split"
    || runtime.thinkingPath === "reasoning_content"
    || runtime.thinkingPath === "disabled"
    || runtime.thinkingPath === "unverified"
    ? runtime.thinkingPath
    : "unverified";
  const lastCheckedAt = typeof runtime.lastCheckedAt === "string"
    ? runtime.lastCheckedAt
    : null;

  return {
    reasoningSplitSupported,
    thinkingPath,
    lastCheckedAt,
  };
}

/** 将 BR MiniMax 运行时诊断写回 profile，保留其他已发现能力字段。 */
export function withBrMiniMaxRuntimeDiagnostics(
  profile: ModelProfile,
  diagnostics: BrMiniMaxRuntimeDiagnostics,
): ModelProfile {
  return {
    ...profile,
    discoveredCapabilities: {
      ...(profile.discoveredCapabilities ?? {}),
      source: profile.discoveredCapabilities?.source ?? "provider-detail",
      lastValidatedAt: diagnostics.lastCheckedAt,
      raw: {
        ...(profile.discoveredCapabilities?.raw ?? {}),
        [BR_MINIMAX_RUNTIME_RAW_KEY]: {
          reasoningSplitSupported: diagnostics.reasoningSplitSupported,
          thinkingPath: diagnostics.thinkingPath,
          lastCheckedAt: diagnostics.lastCheckedAt,
        },
      },
    },
  };
}

/** 判断当前 profile 是否为企业私有部署的 BR MiniMax 托管类型。 */
export function isBrMiniMaxProfile(
  profile: Pick<ModelProfile, "providerFlavor" | "baseUrl" | "model"> | null | undefined,
): boolean {
  if (!profile) return false;
  if (profile.providerFlavor === BR_MINIMAX_PROVIDER_FLAVOR) return true;

  const baseUrl = profile.baseUrl.trim().toLowerCase();
  const model = profile.model.trim().toLowerCase();
  return baseUrl.includes("cybotforge") || model === BR_MINIMAX_MODEL;
}

/** 构建 BR MiniMax 托管 profile，除 apiKey 外全部使用受管控默认值。 */
export function createBrMiniMaxProfile(input: { apiKey: string }): Omit<ModelProfile, "id">;
export function createBrMiniMaxProfile(input: { id: string; apiKey: string }): ModelProfile;
export function createBrMiniMaxProfile(input: BrMiniMaxCreateInput): Omit<ModelProfile, "id"> | ModelProfile {
  const profile = {
    name: BR_MINIMAX_DEFAULT_NAME,
    provider: "openai-compatible" as const,
    providerFlavor: BR_MINIMAX_PROVIDER_FLAVOR,
    vendorFamily: "minimax" as const,
    deploymentProfile: "br-private",
    baseUrl: BR_MINIMAX_BASE_URL,
    baseUrlMode: "provider-root" as const,
    apiKey: input.apiKey,
    model: BR_MINIMAX_MODEL,
    headers: {},
    requestBody: { ...BR_MINIMAX_REQUEST_BODY },
    budgetPolicy: { ...BR_MINIMAX_BUDGET_POLICY },
  };

  if (!input.id) {
    return profile;
  }

  return {
    id: input.id,
    ...profile,
  };
}
