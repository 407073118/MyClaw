const CODE_BLOCK_TOKEN_PREFIX = "__MYCLAW_SAFE_CODE_BLOCK__";

/** 对用户提供的 Markdown 文本做 HTML 转义，阻断原始标签注入。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 还原渲染流程中的代码块占位符，避免段落处理破坏结构。 */
function restoreCodeBlocks(value: string, codeBlocks: string[]): string {
  return value.replace(new RegExp(`${CODE_BLOCK_TOKEN_PREFIX}(\\d+)__`, "g"), (_match, index) => {
    const block = codeBlocks[Number(index)];
    return typeof block === "string" ? block : "";
  });
}

/** 将受限 Markdown 渲染为安全 HTML，仅输出受控标签。 */
export function renderSafeMarkdown(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  const codeBlocks: string[] = [];
  let markdown = escapeHtml(trimmed);

  markdown = markdown.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const token = `${CODE_BLOCK_TOKEN_PREFIX}${codeBlocks.length}__`;
    codeBlocks.push(`<pre><code>${code.trimEnd()}</code></pre>`);
    return token;
  });

  markdown = markdown.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  markdown = markdown.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  markdown = markdown.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  markdown = markdown.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  markdown = markdown.replace(/\*(.+?)\*/g, "<em>$1</em>");
  markdown = markdown.replace(/`([^`]+)`/g, "<code>$1</code>");
  markdown = markdown.replace(/^- (.+)$/gm, "<li>$1</li>");
  markdown = markdown.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
  markdown = markdown.replace(/\n\n/g, "</p><p>");
  markdown = markdown.replace(/\n/g, "<br>");
  markdown = `<p>${markdown}</p>`;
  markdown = markdown.replace(/<p>\s*<\/p>/g, "");
  markdown = markdown.replace(/<p>\s*(<h[1-3]>)/g, "$1");
  markdown = markdown.replace(/(<\/h[1-3]>)\s*<\/p>/g, "$1");
  markdown = markdown.replace(/<p>\s*(<pre>)/g, "$1");
  markdown = markdown.replace(/(<\/pre>)\s*<\/p>/g, "$1");
  markdown = markdown.replace(/<p>\s*(<ul>)/g, "$1");
  markdown = markdown.replace(/(<\/ul>)\s*<\/p>/g, "$1");

  return restoreCodeBlocks(markdown, codeBlocks);
}
