/** 规范化模型服务 baseUrl，统一移除末尾斜杠。 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** 读取 provider 错误详情，优先返回结构化 message。 */
export async function readProviderErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string } | string; message?: string };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
    if (typeof payload.error === "object" && payload.error && typeof payload.error.message === "string") {
      return payload.error.message.trim();
    }
  } catch {
    // 忽略 JSON 解析异常，回退到 statusText。
  }

  return response.statusText || "Unknown provider error";
}
