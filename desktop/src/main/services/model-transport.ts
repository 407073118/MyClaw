export type TransportRequestVariant = {
  id: string;
  fallbackReason?: string | null;
  body: Record<string, unknown>;
};

export type ExecuteRequestVariantsOptions = {
  url: string;
  headers: Record<string, string>;
  requestVariants: TransportRequestVariant[];
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelaysMs?: number[];
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  isRetryableError?: (err: unknown, response?: Response | null) => boolean;
};

export type ExecuteRequestVariantsResult = {
  response: Response;
  variant: TransportRequestVariant;
  variantIndex: number;
  attempt: number;
  retryCount: number;
  fallbackEvents: Array<{
    fromVariant: string;
    toVariant: string;
    reason: string;
  }>;
};

/** 传输层默认按 3 次重试配置工作，与当前 model-client 行为保持一致。 */
export const DEFAULT_MAX_RETRIES = 3;

/** 传输层默认使用指数退避：1s → 2s → 4s。 */
export const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000];

type AbortContext = {
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
};

class ModelHttpError extends Error {
  /** 构造带 HTTP 状态码与响应体摘要的模型 API 错误，避免被误判为底层 fetch 失败。 */
  constructor(message: string) {
    super(message);
    this.name = "ModelHttpError";
  }
}

/** 判断 transport 层错误是否适合重试。 */
export function isRetryableTransportError(err: unknown, response?: Response | null): boolean {
  if (err instanceof Error && err.name === "AbortError") {
    return false;
  }

  if (err instanceof TypeError) {
    return true;
  }

  if (err instanceof Error && err.name === "TimeoutError") {
    return true;
  }

  if (response) {
    return response.status === 429 || response.status >= 500;
  }

  return !!err;
}

/** 为请求构造组合中止信号，统一处理调用方取消和 transport 超时。 */
function createAbortContext(timeoutMs: number, callerSignal?: AbortSignal): AbortContext {
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    timeoutController.abort(new DOMException("Model request timed out", "TimeoutError"));
  }, timeoutMs);

  const cleanupCallbacks: Array<() => void> = [() => clearTimeout(timeoutHandle)];

  if (!callerSignal) {
    return {
      signal: timeoutController.signal,
      didTimeout: () => timeoutController.signal.aborted,
      cleanup: () => {
        for (const callback of cleanupCallbacks) {
          callback();
        }
      },
    };
  }

  const composite = new AbortController();
  const abortFromCaller = () => composite.abort(callerSignal.reason);
  const abortFromTimeout = () => composite.abort(timeoutController.signal.reason);

  if (callerSignal.aborted) {
    abortFromCaller();
  } else {
    callerSignal.addEventListener("abort", abortFromCaller, { once: true });
    cleanupCallbacks.push(() => callerSignal.removeEventListener("abort", abortFromCaller));
  }

  if (timeoutController.signal.aborted) {
    abortFromTimeout();
  } else {
    timeoutController.signal.addEventListener("abort", abortFromTimeout, { once: true });
    cleanupCallbacks.push(() => timeoutController.signal.removeEventListener("abort", abortFromTimeout));
  }

  return {
    signal: composite.signal,
    didTimeout: () => timeoutController.signal.aborted,
    cleanup: () => {
      for (const callback of cleanupCallbacks) {
        callback();
      }
    },
  };
}

/** 统一构造 HTTP 错误文本，便于上层直接记录最后一次失败原因。 */
async function createHttpError(response: Response): Promise<Error> {
  const detail = await response.text().catch(() => "(no body)");
  return new ModelHttpError(`Model API error ${response.status} ${response.statusText}: ${detail}`);
}

/** 把 fetch/SystemError cause 渲染成可读字符串，保留 code 优先于 message。 */
function formatCause(cause: unknown): string {
  if (cause == null) return "(no cause)";
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    const codeStr = typeof code === "string" || typeof code === "number" ? String(code) : "";
    return codeStr ? `${codeStr}: ${cause.message || cause.name}` : (cause.message || cause.name);
  }
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

/** 读取指定 attempt 的退避时长；超出配置时复用最后一档。 */
function resolveRetryDelay(retryDelaysMs: number[], attempt: number): number {
  if (retryDelaysMs.length === 0) {
    return 0;
  }
  return retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)] ?? 0;
}

/** 顺序执行请求变体，支持 400 fallback、重试和统一超时。 */
export async function executeRequestVariants(
  options: ExecuteRequestVariantsOptions,
): Promise<ExecuteRequestVariantsResult> {
  const {
    url,
    headers,
    requestVariants,
    signal,
    timeoutMs = 120_000,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    fetchImpl = fetch,
    sleep = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    isRetryableError = isRetryableTransportError,
  } = options;

  if (requestVariants.length === 0) {
    throw new Error("At least one request variant is required");
  }

  const abortContext = createAbortContext(timeoutMs, signal);
  let lastError: Error | null = null;

  try {
    const fallbackEvents: ExecuteRequestVariantsResult["fallbackEvents"] = [];
    for (let variantIndex = 0; variantIndex < requestVariants.length; variantIndex++) {
      const variant = requestVariants[variantIndex]!;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetchImpl(url, {
            method: "POST",
            headers,
            body: JSON.stringify(variant.body),
            signal: abortContext.signal,
          });

          if (!response.ok) {
            const shouldFallback = response.status === 400 && variantIndex < requestVariants.length - 1;
            if (shouldFallback) {
              lastError = await createHttpError(response);
              const nextVariant = requestVariants[variantIndex + 1];
              if (nextVariant) {
                fallbackEvents.push({
                  fromVariant: variant.id,
                  toVariant: nextVariant.id,
                  reason: variant.fallbackReason ?? "http-400",
                });
              }
              break;
            }

            if (isRetryableError(null, response) && attempt < maxRetries) {
              lastError = await createHttpError(response);
              await sleep(resolveRetryDelay(retryDelaysMs, attempt));
              continue;
            }

            throw await createHttpError(response);
          }

          return {
            response,
            variant,
            variantIndex,
            attempt,
            retryCount: attempt,
            fallbackEvents,
          };
        } catch (err) {
          if (err instanceof ModelHttpError) {
            throw err;
          }

          if (err instanceof Error && err.name === "AbortError") {
            if (abortContext.didTimeout()) {
              throw new Error(`Model request timed out after ${timeoutMs}ms`);
            }
            throw err;
          }

          if (isRetryableError(err) && attempt < maxRetries) {
            const baseErr = err instanceof Error ? err : new Error(String(err));
            const causeText = formatCause((err as { cause?: unknown })?.cause);
            // 使用 ES2022 Error cause 选项，并把 cause 摘要拼到 message，方便日志和 toast 同时看到
            lastError = new Error(
              `${baseErr.message} (cause: ${causeText})`,
              { cause: (err as { cause?: unknown })?.cause },
            );
            console.warn("[model-transport] fetch 失败，准备重试", {
              variantId: variant.id,
              attempt,
              cause: causeText,
            });
            await sleep(resolveRetryDelay(retryDelaysMs, attempt));
            continue;
          }

          // 不可重试或重试耗尽：同样保留 cause，避免 native fetch 的 TypeError("fetch failed") 把底层 SystemError code 吞掉
          if (err instanceof Error) {
            const causeText = formatCause((err as { cause?: unknown }).cause);
            if (causeText !== "(no cause)") {
              throw new Error(
                `${err.message} (cause: ${causeText})`,
                { cause: (err as { cause?: unknown }).cause },
              );
            }
          }
          throw err;
        }
      }
    }

    throw lastError ?? new Error("Model request failed after retries");
  } finally {
    abortContext.cleanup();
  }
}
