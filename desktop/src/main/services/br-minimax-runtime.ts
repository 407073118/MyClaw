import type { ModelProfile } from "@shared/contracts";
import {
  BR_MINIMAX_MODEL,
  BR_MINIMAX_REQUEST_BODY,
  type BrMiniMaxRuntimeDiagnostics,
} from "@shared/br-minimax";

import { resolveModelEndpointUrl } from "./model-client";

type FetchLike = typeof fetch;

export type BrMiniMaxProbeResult = {
  ok: boolean;
  latencyMs: number;
  diagnostics: BrMiniMaxRuntimeDiagnostics;
  error?: string;
};

/** 为 BR MiniMax 运行时探测构建请求头。 */
function buildProbeHeaders(profile: ModelProfile): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${profile.apiKey}`,
    ...(profile.headers ?? {}),
  };
}

/** 为 BR MiniMax 运行时探测构建请求体。 */
function buildProbeBody(profile: ModelProfile, reasoningSplit: boolean): Record<string, unknown> {
  return {
    model: BR_MINIMAX_MODEL,
    messages: [{ role: "user", content: "ping" }],
    stream: false,
    max_tokens: 1,
    ...BR_MINIMAX_REQUEST_BODY,
    ...((profile.requestBody ?? {}) as Record<string, unknown>),
    ...(reasoningSplit ? { reasoning_split: true } : {}),
  };
}

/** 从探测响应中判断当前 thinking 实际走的是哪条路径。 */
function detectThinkingPath(payload: unknown): BrMiniMaxRuntimeDiagnostics["thinkingPath"] {
  const text = JSON.stringify(payload ?? {});
  if (text.includes("reasoning_details")) return "reasoning_split";
  if (text.includes("reasoning_content")) return "reasoning_content";
  return "unverified";
}

/** 安全解析 JSON，失败时返回空对象，避免探测流程因解析异常中断。 */
async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

/** 用一次真实请求探测 BR MiniMax 是否支持 reasoning_split，并给出当前 thinking 路径。 */
export async function probeBrMiniMaxRuntime(
  profile: ModelProfile,
  fetchImpl: FetchLike = fetch,
): Promise<BrMiniMaxProbeResult> {
  const url = resolveModelEndpointUrl(profile);
  const headers = buildProbeHeaders(profile);
  const startedAt = Date.now();

  console.info("[br-minimax:probe] 开始探测 reasoning_split 支持状态", {
    modelId: profile.id,
    baseUrl: profile.baseUrl,
    model: profile.model,
  });

  const primaryResponse = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(buildProbeBody(profile, true)),
  });

  const latencyMs = Date.now() - startedAt;
  const checkedAt = new Date().toISOString();

  if (primaryResponse.status === 401 || primaryResponse.status === 403) {
    console.warn("[br-minimax:probe] 探测失败，鉴权未通过", {
      modelId: profile.id,
      status: primaryResponse.status,
    });
    return {
      ok: false,
      latencyMs,
      error: `Authentication failed (HTTP ${primaryResponse.status})`,
      diagnostics: {
        reasoningSplitSupported: null,
        thinkingPath: "unverified",
        lastCheckedAt: checkedAt,
      },
    };
  }

  if (primaryResponse.ok) {
    const payload = await safeReadJson(primaryResponse);
    const detectedPath = detectThinkingPath(payload);
    const thinkingPath = detectedPath === "reasoning_content" ? "reasoning_content" : "reasoning_split";
    console.info("[br-minimax:probe] reasoning_split 探测成功", {
      modelId: profile.id,
      latencyMs,
      thinkingPath,
    });
    return {
      ok: true,
      latencyMs,
      diagnostics: {
        reasoningSplitSupported: thinkingPath === "reasoning_split",
        thinkingPath,
        lastCheckedAt: checkedAt,
      },
    };
  }

  if (primaryResponse.status !== 400) {
    console.warn("[br-minimax:probe] 主探测未得到可判定结果，保留未验证状态", {
      modelId: profile.id,
      status: primaryResponse.status,
      latencyMs,
    });
    return {
      ok: true,
      latencyMs,
      diagnostics: {
        reasoningSplitSupported: null,
        thinkingPath: "unverified",
        lastCheckedAt: checkedAt,
      },
    };
  }

  console.info("[br-minimax:probe] 主探测被 400 拒绝，切换兼容探测", {
    modelId: profile.id,
    latencyMs,
  });

  const fallbackResponse = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(buildProbeBody(profile, false)),
  });

  if (fallbackResponse.status === 401 || fallbackResponse.status === 403) {
    console.warn("[br-minimax:probe] 兼容探测失败，鉴权未通过", {
      modelId: profile.id,
      status: fallbackResponse.status,
    });
    return {
      ok: false,
      latencyMs,
      error: `Authentication failed (HTTP ${fallbackResponse.status})`,
      diagnostics: {
        reasoningSplitSupported: null,
        thinkingPath: "unverified",
        lastCheckedAt: checkedAt,
      },
    };
  }

  const payload = await safeReadJson(fallbackResponse);
  const detectedPath = detectThinkingPath(payload);
  const thinkingPath = detectedPath === "unverified" ? "reasoning_content" : detectedPath;
  console.info("[br-minimax:probe] 兼容探测完成", {
    modelId: profile.id,
    latencyMs,
    thinkingPath,
  });
  return {
    ok: true,
    latencyMs,
    diagnostics: {
      reasoningSplitSupported: false,
      thinkingPath,
      lastCheckedAt: checkedAt,
    },
  };
}
