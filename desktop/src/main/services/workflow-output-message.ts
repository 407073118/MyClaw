const PREFERRED_OUTPUT_KEYS = ["answer", "output", "result", "message", "content", "summary"] as const;

/** 将单个 workflow 输出值转成可展示文本，避免对话里出现 [object Object]。 */
function stringifyWorkflowOutputValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    console.warn("[workflow:output] 最终输出 JSON 序列化失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** 从 workflow outputs 中选择最适合回到对话的文本。 */
export function resolveWorkflowOutputText(outputs: unknown): string | null {
  if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) return null;
  const record = outputs as Record<string, unknown>;

  for (const key of PREFERRED_OUTPUT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const text = stringifyWorkflowOutputValue(record[key]);
      if (text) return text;
    }
  }

  for (const value of Object.values(record)) {
    const text = stringifyWorkflowOutputValue(value);
    if (text) return text;
  }
  return null;
}

/** 生成 workflow 完成后追加到对话里的 assistant 文案。 */
export function buildWorkflowOutputMessageContent(input: {
  workflowName: string;
  outputs: unknown;
}): string | null {
  const text = resolveWorkflowOutputText(input.outputs);
  if (!text) {
    console.info("[workflow:output] 工作流没有可回流到对话的最终输出", {
      workflowName: input.workflowName,
    });
    return null;
  }
  console.info("[workflow:output] 已解析工作流最终对话输出", {
    workflowName: input.workflowName,
    outputLength: text.length,
  });
  return text;
}
