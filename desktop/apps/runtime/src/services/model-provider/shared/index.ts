import type { ModelProfile } from "@myclaw-desktop/shared";

export * from "./http";
export * from "./json";
export * from "./text";

export const DEFAULT_MAX_TOOL_ROUNDS = 6;
export const ANTHROPIC_API_VERSION = "2023-06-01";
export const MODEL_REQUEST_BODY_RESERVED_FIELDS = Object.freeze([
  "model",
  "messages",
  "stream",
  "tools",
  "tool_choice",
  "max_tokens",
  "temperature",
  "system",
]);

/** 将 maxToolRounds 夹紧到安全范围，避免无限循环或过高轮次。 */
export function clampToolRounds(value: number | undefined): number {
  const raw = Number.isFinite(value) ? Number(value) : DEFAULT_MAX_TOOL_ROUNDS;
  if (raw < 1) {
    return 1;
  }
  if (raw > 16) {
    return 16;
  }
  return Math.floor(raw);
}

/** 校验模型配置里的 API Key，防止把占位符发到线上。 */
export function assertProfileHasApiKey(profile: ModelProfile) {
  if (!profile.apiKey || profile.apiKey === "replace-me") {
    throw new Error("Model profile is missing a valid API key.");
  }
}

/** 合并 profile.requestBody，统一构造请求体。 */
export function buildRequestBody<T extends Record<string, unknown>>(
  body: T,
  profile: ModelProfile,
  options?: {
    reservedFields?: readonly string[];
  },
): T & Record<string, unknown> {
  if (!profile.requestBody || typeof profile.requestBody !== "object" || Array.isArray(profile.requestBody)) {
    return body;
  }
  const reservedFields = new Set<string>([
    ...MODEL_REQUEST_BODY_RESERVED_FIELDS,
    ...Object.keys(body),
    ...(options?.reservedFields ?? []),
  ]);
  const requestBody = profile.requestBody as Record<string, unknown>;
  const safeExtras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(requestBody)) {
    if (reservedFields.has(key)) {
      continue;
    }
    safeExtras[key] = value;
  }
  return {
    ...body,
    ...safeExtras,
  };
}
