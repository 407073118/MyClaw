/** 将未知输入规整为普通对象。 */
export function ensureRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input as Record<string, unknown>;
}

/** 解析 JSON object 字符串，失败时返回空对象。 */
export function parseJsonObject(input: string): Record<string, unknown> {
  if (!input.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(input) as unknown;
    return ensureRecord(parsed);
  } catch {
    return {};
  }
}
