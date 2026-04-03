/**
 * Token 估算器 — 基于字符的 token 计数估算。
 * 不依赖外部 tokenizer 库，按不同模式给出近似值。
 */

import type { TokenCountingMode } from "@shared/contracts";

/** 每条消息的固定开销（角色标记、格式等） */
const MESSAGE_OVERHEAD_TOKENS = 4;

/**
 * 估算单段文本的 token 数。
 * 根据 tokenCountingMode 选择不同的估算策略。
 */
export function estimateTokenCount(
  text: string,
  mode: TokenCountingMode = "character-fallback",
): number {
  if (!text) return 0;

  switch (mode) {
    case "openai-compatible-estimate":
      return estimateOpenAiTokens(text);

    case "anthropic-estimate":
      return estimateAnthropicTokens(text);

    case "local-heuristic":
      return estimateLocalTokens(text);

    case "provider-native":
      // 无法本地模拟 provider-native，降级到 openai 兼容估算
      return estimateOpenAiTokens(text);

    case "character-fallback":
    default:
      return estimateByCharacterFallback(text);
  }
}

/**
 * 估算一组消息的总 token 数，含每条消息的格式开销。
 */
export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string }>,
  mode: TokenCountingMode = "character-fallback",
): number {
  if (messages.length === 0) return 0;

  let total = 0;
  for (const msg of messages) {
    // 消息内容 token
    total += estimateTokenCount(msg.content, mode);
    // 角色和格式开销
    total += MESSAGE_OVERHEAD_TOKENS;
  }

  // 会话级别开销（起始/结束标记）
  total += 3;

  return total;
}

// ---------------------------------------------------------------------------
// 内部估算策略
// ---------------------------------------------------------------------------

/**
 * 通用字符回退估算：
 * - 英文/ASCII 按 ~4 字符 = 1 token
 * - 中日韩字符按 ~1.5 字符 = 1 token
 */
function estimateByCharacterFallback(text: string): number {
  let asciiChars = 0;
  let cjkChars = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (isCjkCodePoint(code)) {
      cjkChars++;
    } else {
      asciiChars++;
    }
  }

  const asciiTokens = asciiChars / 4;
  const cjkTokens = cjkChars / 1.5;

  return Math.ceil(asciiTokens + cjkTokens);
}

/**
 * OpenAI 兼容估算：接近 cl100k_base 行为。
 * 英文 ~4 字符/token，中文 ~2 字符/token。
 */
function estimateOpenAiTokens(text: string): number {
  let asciiChars = 0;
  let cjkChars = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (isCjkCodePoint(code)) {
      cjkChars++;
    } else {
      asciiChars++;
    }
  }

  return Math.ceil(asciiChars / 4 + cjkChars / 2);
}

/**
 * Anthropic 估算：与 OpenAI 类似但中文略宽松。
 */
function estimateAnthropicTokens(text: string): number {
  let asciiChars = 0;
  let cjkChars = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (isCjkCodePoint(code)) {
      cjkChars++;
    } else {
      asciiChars++;
    }
  }

  return Math.ceil(asciiChars / 4 + cjkChars / 1.8);
}

/**
 * 本地模型估算：通常 tokenizer 效率略低。
 */
function estimateLocalTokens(text: string): number {
  let asciiChars = 0;
  let cjkChars = 0;

  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (isCjkCodePoint(code)) {
      cjkChars++;
    } else {
      asciiChars++;
    }
  }

  return Math.ceil(asciiChars / 3.5 + cjkChars / 1.4);
}

/**
 * 判断字符是否属于 CJK 统一表意文字范围。
 */
function isCjkCodePoint(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||   // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) ||   // CJK Extension A
    (code >= 0x20000 && code <= 0x2a6df) || // CJK Extension B
    (code >= 0xf900 && code <= 0xfaff) ||   // CJK Compatibility Ideographs
    (code >= 0x3040 && code <= 0x309f) ||   // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) ||   // Katakana
    (code >= 0xac00 && code <= 0xd7af)      // Korean Hangul
  );
}
