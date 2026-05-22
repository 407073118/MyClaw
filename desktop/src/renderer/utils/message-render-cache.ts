type MarkdownRenderer = (content: string) => string;

type A2UiExtraction = {
  content: string;
  ui?: unknown;
};

type CachedA2UiExtraction = {
  content: string;
  parsedUi?: unknown;
};

export type CachedMessageRenderInput = {
  id: string;
  role: string;
  content: string;
  reasoning?: string;
  ui?: unknown;
  isStreaming?: boolean;
  renderMarkdown: MarkdownRenderer;
};

export type CachedMessageRenderResult = {
  content: string;
  ui?: unknown;
  uiSubmitResult?: { id: string; pairs: string };
  renderedHtml: string;
  renderedReasoningHtml: string;
  _isStreaming?: boolean;
};

const MAX_CACHE_ENTRIES = 400;
const markdownCache = new Map<string, string>();
const a2uiCache = new Map<string, CachedA2UiExtraction>();
const MESSAGE_RENDER_CACHE_DEBUG_LOGGING = resolveMessageRenderCacheDebugLogging();

/** 读取消息渲染缓存调试日志开关，默认关闭以避免每条消息渲染都写 console。 */
function resolveMessageRenderCacheDebugLogging(): boolean {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    if (env?.MYCLAW_DEBUG_MESSAGE_RENDER_CACHE === "1") {
      return true;
    }
    return globalThis.localStorage?.getItem("MYCLAW_DEBUG_MESSAGE_RENDER_CACHE") === "1";
  } catch {
    return false;
  }
}

/** 输出消息渲染缓存调试日志，仅在显式开关开启时写入 console。 */
function logMessageRenderCacheDebug(message: string, detail: Record<string, unknown>): void {
  if (!MESSAGE_RENDER_CACHE_DEBUG_LOGGING) {
    return;
  }
  console.debug(message, detail);
}

/** 计算稳定短哈希，用内容本身命中跨消息缓存。 */
function contentHash(content: string): string {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = ((hash << 5) - hash + content.charCodeAt(index)) | 0;
  }
  return `${content.length}:${hash.toString(36)}`;
}

/** 写入有上限的缓存，避免长会话持续增长。 */
function setBoundedCacheValue(cache: Map<string, string>, key: string, value: string): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, value);
}

/** 写入有上限的 A2UI 缓存，避免重复 JSON 解析。 */
function setBoundedA2UiValue(key: string, value: CachedA2UiExtraction): void {
  if (a2uiCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = a2uiCache.keys().next().value;
    if (oldestKey) {
      a2uiCache.delete(oldestKey);
    }
  }
  a2uiCache.set(key, value);
}

/** 将缓存的 A2UI 解析结果按当前消息 materialize，避免不同消息串用同一个 ui.id。 */
function materializeA2UiValue(
  value: CachedA2UiExtraction,
  fallbackId: string,
  existingUi?: unknown,
): A2UiExtraction {
  if (existingUi) {
    return { content: value.content, ui: existingUi };
  }
  if (value.parsedUi && typeof value.parsedUi === "object" && !Array.isArray(value.parsedUi)) {
    const parsedUi = value.parsedUi as Record<string, unknown>;
    return {
      content: value.content,
      ui: {
        ...parsedUi,
        id: typeof parsedUi.id === "string" && parsedUi.id ? parsedUi.id : fallbackId,
      },
    };
  }
  return {
    content: value.content,
    ...(value.parsedUi ? { ui: value.parsedUi } : {}),
  };
}

/** 清空消息渲染缓存，测试和会话切换可用。 */
export function clearMessageRenderCache(): void {
  logMessageRenderCacheDebug("[message-render-cache] 清空消息渲染缓存", {
    markdownCount: markdownCache.size,
    a2uiCount: a2uiCache.size,
  });
  markdownCache.clear();
  a2uiCache.clear();
}

/** 复用相同 Markdown 内容的 HTML，避免相同消息文本跨 id 重复解析。 */
export function renderCachedMarkdown(content: string, renderer: MarkdownRenderer): string {
  if (!content) return "";
  const key = contentHash(content);
  const cached = markdownCache.get(key);
  if (cached !== undefined) {
    logMessageRenderCacheDebug("[message-render-cache] 命中 Markdown 渲染缓存", { key });
    return cached;
  }
  logMessageRenderCacheDebug("[message-render-cache] 写入 Markdown 渲染缓存", { key });
  const rendered = renderer(content);
  setBoundedCacheValue(markdownCache, key, rendered);
  return rendered;
}

/** 转义流式文本，流式阶段跳过 Markdown 全量解析。 */
export function escapeStreamingHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

/** 判断字符串是否已经像 HTML，避免把预渲染 HTML 再交给 MarkdownView。 */
export function looksLikeRenderedHtml(source: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(source.trim());
}

/** 缓存 A2UI 代码块解析结果，避免同内容消息重复 JSON.parse。 */
function extractA2Ui(content: string, fallbackId: string, existingUi?: unknown): A2UiExtraction {
  const key = contentHash(content);
  const cached = a2uiCache.get(key);
  if (cached) {
    logMessageRenderCacheDebug("[message-render-cache] 命中 A2UI 提取缓存", { key });
    return materializeA2UiValue(cached, fallbackId, existingUi);
  }

  const a2uiMatch = content.match(/```a2ui\s*([\s\S]*?)\s*```/);
  if (!a2uiMatch) {
    return { content, ui: existingUi };
  }

  try {
    const parsed = JSON.parse(a2uiMatch[1]);
    const replacedContent = content.replace(a2uiMatch[0], "").trim();
    const value = { content: replacedContent || parsed.text || "", parsedUi: parsed.ui };
    logMessageRenderCacheDebug("[message-render-cache] 写入 A2UI 提取缓存", { key, hasUi: Boolean(parsed.ui) });
    setBoundedA2UiValue(key, value);
    return materializeA2UiValue(value, fallbackId, existingUi);
  } catch {
    logMessageRenderCacheDebug("[message-render-cache] A2UI 提取失败，回退普通 Markdown", { key });
    const value = { content };
    setBoundedA2UiValue(key, value);
    return materializeA2UiValue(value, fallbackId, existingUi);
  }
}

/** 为 ChatPage 生成稳定的消息渲染结果，集中缓存 Markdown、reasoning 与 A2UI 处理。 */
export function renderMessageForDisplay(input: CachedMessageRenderInput): CachedMessageRenderResult {
  const a2uiSubmitMatch = input.content.match(/^\[A2UI_FORM:([a-zA-Z0-9_-]+)\]\s*(.*)$/);
  if (a2uiSubmitMatch && input.role === "user") {
    logMessageRenderCacheDebug("[message-render-cache] 识别 A2UI 表单提交消息", { messageId: input.id });
    return {
      content: "",
      uiSubmitResult: { id: a2uiSubmitMatch[1], pairs: a2uiSubmitMatch[2] },
      renderedHtml: "",
      renderedReasoningHtml: "",
      _isStreaming: input.isStreaming,
    };
  }

  if (input.isStreaming) {
    logMessageRenderCacheDebug("[message-render-cache] 流式消息使用轻量 HTML 转义", { messageId: input.id });
    return {
      content: input.content,
      ui: input.ui,
      renderedHtml: escapeStreamingHtml(input.content),
      renderedReasoningHtml: input.reasoning ? escapeStreamingHtml(input.reasoning) : "",
      _isStreaming: true,
    };
  }

  const extracted = extractA2Ui(input.content, input.id, input.ui);
  const renderedHtml = renderCachedMarkdown(extracted.content, input.renderMarkdown);
  const renderedReasoningHtml = input.reasoning ? renderCachedMarkdown(input.reasoning, input.renderMarkdown) : "";

  return {
    content: extracted.content,
    ui: extracted.ui,
    renderedHtml,
    renderedReasoningHtml,
    _isStreaming: false,
  };
}
