import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeRequestVariants,
  type TransportRequestVariant,
} from "../src/main/services/model-transport";

/** 构造最小请求变体，便于聚焦传输层行为测试。 */
function createVariant(
  id: string,
  body: Record<string, unknown>,
  fallbackReason: string | null = null,
): TransportRequestVariant {
  return { id, body, fallbackReason };
}

describe("phase1 model transport", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("falls back to the next ordered variant after a 400 response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unsupported field", { status: 400 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const result = await executeRequestVariants({
      url: "https://api.example.com/v1/chat/completions",
      headers: { authorization: "Bearer test-key" },
      requestVariants: [
        createVariant("primary", { mode: "strict" }),
        createVariant("compatibility-fallback", { mode: "compat" }, "reasoning_split_unsupported"),
      ],
      fetchImpl: fetchMock,
    });

    expect(result.variant.id).toBe("compatibility-fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ mode: "strict" });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ mode: "compat" });
  });

  it("retries retryable network failures on the same variant before succeeding", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockRejectedValueOnce(new TypeError("still down"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleepMock = vi.fn().mockResolvedValue(undefined);

    const result = await executeRequestVariants({
      url: "https://api.example.com/v1/chat/completions",
      headers: { authorization: "Bearer test-key" },
      requestVariants: [createVariant("primary", { mode: "strict" })],
      fetchImpl: fetchMock,
      sleep: sleepMock,
      maxRetries: 3,
      retryDelaysMs: [10, 20, 40],
    });

    expect(result.variant.id).toBe("primary");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 10);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 20);
  });

  it("retries 5xx responses before failing over to neither retry nor fallback variants", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("server error", { status: 503, statusText: "Service Unavailable" }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleepMock = vi.fn().mockResolvedValue(undefined);

    const result = await executeRequestVariants({
      url: "https://api.example.com/v1/chat/completions",
      headers: { authorization: "Bearer test-key" },
      requestVariants: [
        createVariant("primary", { mode: "strict" }),
        createVariant("compatibility-fallback", { mode: "compat" }),
      ],
      fetchImpl: fetchMock,
      sleep: sleepMock,
      maxRetries: 1,
      retryDelaysMs: [15],
    });

    expect(result.variant.id).toBe("primary");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(15);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ mode: "strict" });
  });

  it("aborts an in-flight request when the transport timeout elapses", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn((_: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      }, { once: true });
    }));

    const pending = executeRequestVariants({
      url: "https://api.example.com/v1/chat/completions",
      headers: { authorization: "Bearer test-key" },
      requestVariants: [createVariant("primary", { mode: "strict" })],
      fetchImpl: fetchMock as unknown as typeof fetch,
      timeoutMs: 50,
    });
    const assertion = expect(pending).rejects.toThrow("Model request timed out after 50ms");

    await vi.advanceTimersByTimeAsync(50);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
