/**
 * PPT HTML 模板引擎。
 *
 * 将主题样式 + slide 数据注入 Handlebars HTML 模板，
 * 输出可被 Playwright 渲染为截图的完整 HTML 页面。
 *
 * 支持两种模板加载模式：
 * - 文件模式：从 layoutsDir 读取 .html 文件（开发环境）
 * - 内联模式：直接接受 HTML 字符串（打包安全，.html 可能不在 asar 中）
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
import type { Theme } from "./types";

// ---------------------------------------------------------------------------
// Handlebars helpers
// ---------------------------------------------------------------------------

Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
Handlebars.registerHelper("gt", (a: unknown, b: unknown) => Number(a) > Number(b));
Handlebars.registerHelper("lt", (a: unknown, b: unknown) => Number(a) < Number(b));
Handlebars.registerHelper("math", (a: unknown, op: string, b: unknown) => {
  switch (op) {
    case "+": return Number(a) + Number(b);
    case "-": return Number(a) - Number(b);
    case "*": return Number(a) * Number(b);
    case "/": return Number(a) / Number(b);
    default: return 0;
  }
});

// ---------------------------------------------------------------------------
// HTML 页面包装
// ---------------------------------------------------------------------------

/** 将 HTML 模板片段包装为完整页面，注入主题 CSS 变量 */
function wrapFullPage(bodyHtml: string, theme: Theme): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1920px;
    height: 1080px;
    overflow: hidden;
    font-family: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  :root {
    ${theme.cssVariables}
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// TemplateEngine
// ---------------------------------------------------------------------------

export class TemplateEngine {
  private templateCache = new Map<string, HandlebarsTemplateDelegate>();
  private layoutsDir: string;

  constructor(layoutsDir: string) {
    this.layoutsDir = layoutsDir;
  }

  /**
   * 渲染一张 slide 的完整 HTML 页面。
   *
   * @param templateSource  版式类型名（如 "cover"）或内联 HTML 字符串
   * @param data            slide 内容数据
   * @param theme           主题定义
   * @param inline          为 true 时 templateSource 被视为 HTML 字符串而非文件名
   * @returns               完整 HTML 字符串（1920×1080 视口）
   */
  render(
    templateSource: string,
    data: Record<string, unknown>,
    theme: Theme,
    inline = false,
  ): string {
    const template = inline
      ? this.compileInline(templateSource)
      : this.getTemplate(templateSource);
    const bodyHtml = template({
      ...data,
      theme,
      colors: theme.colors,
      fonts: theme.fonts,
    });
    return wrapFullPage(bodyHtml, theme);
  }

  // ── 内部方法 ────────────────────────────────────────

  /**
   * 从文件系统加载并缓存 Handlebars 模板。
   * 缓存键为版式类型名（如 "cover"）。
   */
  private getTemplate(slideType: string): HandlebarsTemplateDelegate {
    const cached = this.templateCache.get(slideType);
    if (cached) return cached;

    const htmlPath = join(this.layoutsDir, `${slideType}.html`);
    const source = readFileSync(htmlPath, "utf8");
    const compiled = Handlebars.compile(source);
    this.templateCache.set(slideType, compiled);
    return compiled;
  }

  /**
   * 编译内联 HTML 字符串为 Handlebars 模板。
   * 使用字符串内容的前 64 字符哈希作为缓存键。
   */
  private compileInline(htmlSource: string): HandlebarsTemplateDelegate {
    const cacheKey = `__inline__${hashString(htmlSource)}`;
    const cached = this.templateCache.get(cacheKey);
    if (cached) return cached;

    const compiled = Handlebars.compile(htmlSource);
    this.templateCache.set(cacheKey, compiled);
    return compiled;
  }

  /** 清理模板缓存（开发热更新时使用）。 */
  clearCache(): void {
    this.templateCache.clear();
  }
}

/**
 * 简易字符串哈希，用于内联模板的缓存键。
 * 不需要加密强度，只需区分不同模板。
 */
function hashString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return hash.toString(36);
}
