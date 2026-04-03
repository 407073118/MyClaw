/**
 * 工具输出清理器 — 截断超大的工具输出以防止上下文溢出。
 */

/** 默认工具输出最大 token 估算值（约 4000 字符） */
export const DEFAULT_MAX_TOOL_OUTPUT_TOKENS = 4000;

/** 截断提示文本 */
const TRUNCATION_NOTICE = "\n\n[输出已截断] 原始输出过长，仅保留前部分内容。";

/**
 * 清理工具输出：如果超过 maxTokens 对应的字符数则截断。
 * 使用简单的字符估算（~4 字符/token）。
 */
export function sanitizeToolOutput(
  output: string,
  maxTokens: number = DEFAULT_MAX_TOOL_OUTPUT_TOKENS,
): string {
  if (!output) return output;

  // 粗略估算：每 token ~4 字符
  const maxChars = maxTokens * 4;

  if (output.length <= maxChars) {
    return output;
  }

  // 截断到最大字符数，并添加截断提示
  const truncated = output.slice(0, maxChars);
  return truncated + TRUNCATION_NOTICE;
}
