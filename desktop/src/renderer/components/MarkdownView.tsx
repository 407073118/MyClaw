import React, { useCallback, useMemo } from "react";
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

  /** 拦截 Markdown 里的外部链接，避免当前 Electron 页面被网站替换导致用户回不到文件预览。 */
  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLAnchorElement>("a[href]")
      : null;
    if (!target) return;

    const href = target.getAttribute("href")?.trim() ?? "";
    if (!isExternalWebUrl(href)) return;

    event.preventDefault();
    console.info("[markdown-view] 外部网页链接改为新窗口打开", { href });
    window.open(href, "_blank", "noopener,noreferrer");
  }, []);

  if (!html) {
    return null;
  }

  return (
    <div
      className={className ?? "markdown-view"}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** 仅把 http/https 网页链接交给外部窗口，保留锚点与相对路径在预览内的默认语义。 */
function isExternalWebUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** 解析失败时的兜底：把原文作为转义后的纯文本段落渲染。 */
function escapeAsParagraph(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${escaped}</p>`;
}
