/** 规范化模型服务 baseUrl，统一移除末尾斜杠。 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** 从不同厂商的模型目录响应中提取模型 id，并做去重排序。 */
export function readModelIds(payload: unknown): string[] {
  const entries = resolveModelEntries(payload);
  const modelIds = new Set<string>();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const modelId = "id" in entry && typeof entry.id === "string" ? entry.id.trim() : "";
    if (modelId) {
      modelIds.add(modelId);
    }
  }

  return Array.from(modelIds).sort((left, right) => left.localeCompare(right));
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

/** 兼容 `data`、`models` 与数组三种目录载荷格式。 */
function resolveModelEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  if ("data" in payload && Array.isArray(payload.data)) {
    return payload.data;
  }

  if ("models" in payload && Array.isArray(payload.models)) {
    return payload.models;
  }

  return [];
}
