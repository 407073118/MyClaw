import { marked } from "marked";

/** 根据 Skill 文件名判断是否保留预览切换入口。 */
export function shouldShowSkillPreviewToggle(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".md");
}

/** 将 markdown 转成可渲染 HTML，并剥离高风险标签与事件属性。 */
export function renderSafeSkillMarkdown(markdown: string): string {
  const normalizedMarkdown = markdown.replace(/\]\(\s*javascript:[^)]+\)/gi, "]()");
  return sanitizePreviewHtml(marked.parse(normalizedMarkdown) as string);
}

/** 过滤预览 HTML 中的高风险标签、事件属性和脚本型链接。 */
export function sanitizePreviewHtml(html: string): string {
  let sanitized = html;

  sanitized = sanitized.replace(
    /<(script|style|iframe|object|embed|link|meta|base)(\s[^>]*)?>[\s\S]*?<\/\1>/gi,
    "",
  );
  sanitized = sanitized.replace(/<(script|style|iframe|object|embed|link|meta|base)(\s[^>]*)?\/>/gi, "");
  sanitized = sanitized.replace(/\son[a-z]+="[^"]*"/gi, "");
  sanitized = sanitized.replace(/\son[a-z]+='[^']*'/gi, "");
  sanitized = sanitized.replace(/\son[a-z]+=\{[^}]*\}/gi, "");
  sanitized = sanitized.replace(/\s(href|src)=("|\')\s*javascript:[^"\']*\2/gi, " $1=\"#\"");
  sanitized = sanitized.replace(/\ssrcdoc=("|\')[\s\S]*?\1/gi, "");
  sanitized = sanitized.replace(/javascript:/gi, "");

  return sanitized;
}
