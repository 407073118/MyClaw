import React, { useMemo } from "react";
import { marked } from "marked";

import { sanitizePreviewHtml } from "../utils/skill-preview";

type MarkdownViewProps = {
  source: string;
  className?: string;
};

/** 把 Markdown 文本渲染为安全 HTML 的轻量组件。
 *  复用 skill-preview 里成熟的 sanitizer，避免 LLM 输出注入 script / iframe / on-handler / javascript: 链接 触发 XSS。 */
export default function MarkdownView({ source, className }: MarkdownViewProps): React.JSX.Element | null {
  const html = useMemo(() => {
    if (!source) {
      return "";
    }
    try {
      const normalized = source.replace(/\]\(\s*javascript:[^)]+\)/gi, "]()");
      const parsed = marked.parse(normalized) as string;
      return sanitizePreviewHtml(parsed);
    } catch {
      return escapeAsParagraph(source);
    }
  }, [source]);

  if (!html) {
    return null;
  }

  return (
    <div
      className={className ?? "markdown-view"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** 解析失败时的兜底：把原文作为转义后的纯文本段落渲染。 */
function escapeAsParagraph(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${escaped}</p>`;
}
