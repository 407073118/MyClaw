export const CONTENT_FIELDS = ["text", "content", "value", "output_text", "refusal"] as const;
export const REASONING_ROOT_FIELDS = ["reasoning_content", "thinking", "summary", "reasoning_details"] as const;
export const REASONING_TEXT_FIELDS = ["thinking", "summary", "text", "content", "value"] as const;

/** 拼接片段文本并去掉空白，统一空串返回 null。 */
export function joinTextParts(parts: string[]): string | null {
  const joined = parts.join("").trim();
  return joined || null;
}

/** 从未知结构里递归抽取文本字段。 */
export function pickTextFromUnknown(
  value: unknown,
  fields: readonly string[],
  depth = 0,
): string | null {
  if (depth > 6) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() ? value : null;
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const text = pickTextFromUnknown(item, fields, depth + 1);
      if (text) {
        parts.push(text);
      }
    }
    return joinTextParts(parts);
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const field of fields) {
    const text = pickTextFromUnknown(record[field], fields, depth + 1);
    if (text) {
      parts.push(text);
    }
  }

  return joinTextParts(parts);
}

/** 兼容流式快照或增量语义，统一折算成新增 delta。 */
export function extractIncrementalText(nextValue: string, previousSnapshot: string): {
  delta: string;
  snapshot: string;
} {
  const trimmedNextValue = nextValue.trim();
  if (!trimmedNextValue) {
    return {
      delta: "",
      snapshot: previousSnapshot,
    };
  }

  if (!previousSnapshot) {
    return {
      delta: trimmedNextValue,
      snapshot: trimmedNextValue,
    };
  }

  if (trimmedNextValue.startsWith(previousSnapshot)) {
    return {
      delta: trimmedNextValue.slice(previousSnapshot.length),
      snapshot: trimmedNextValue,
    };
  }

  return {
    delta: trimmedNextValue,
    snapshot: previousSnapshot + trimmedNextValue,
  };
}
