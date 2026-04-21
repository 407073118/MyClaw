/**
 * IR → Markdown 纯渲染器。
 *
 * 输入：DocumentIR + 渲染选项
 * 输出：确定性 Markdown 字符串（GFM 子集）
 *
 * 设计原则：
 * - 纯函数，无 I/O，无状态，可单测、可缓存
 * - 覆盖全部 12 种 DocumentNode.kind（穷尽 switch）
 * - 表格遵循 GFM，管道符、换行会被转义
 * - 截断策略：超 maxChars 则切片并追加 `...（已截断）`
 * - 图片 ref 模式：`![alt](media:<id>)`，inline 模式由调用方自行替换为 data-uri
 */

import type {
  DocumentIR,
  DocumentNode,
  InlineRun,
  MediaRef,
  ListNode,
  TableNode,
  SlideNode,
  SheetNode,
} from "@shared/contracts";

export type RenderOptions = {
  /** 超出则截断并追加截断标记。不设或 <=0 表示不截断。 */
  maxChars?: number;
  /**
   * 图片渲染模式：
   * - "none"：完全跳过 ImageNode
   * - "refs"（默认）：输出 `![alt](media:<id>)`，引用由调用方解析
   * - "inline"：同 refs 但语义上允许调用方替换为 data-uri
   */
  includeImages?: "none" | "refs" | "inline";
};

const TRUNCATED_SUFFIX = "\n\n...（已截断）";

/** 主入口。返回渲染后的 Markdown 文本。 */
export function renderIrToMarkdown(ir: DocumentIR, opts: RenderOptions = {}): string {
  const includeImages = opts.includeImages ?? "refs";
  const mediaIndex = buildMediaIndex(ir.media);

  const parts: string[] = [];
  for (const node of ir.body) {
    const rendered = renderNode(node, { includeImages, mediaIndex });
    if (rendered.length > 0) {
      parts.push(rendered);
    }
  }

  // 保留片段间的 `\n\n` 分隔；只去掉结尾超过 2 个的多余换行，归一到恰好以 `\n\n` 结尾
  const joined = parts.join("");
  const full = joined.replace(/\n+$/u, "\n\n");

  if (typeof opts.maxChars === "number" && opts.maxChars > 0 && full.length > opts.maxChars) {
    return full.slice(0, opts.maxChars) + TRUNCATED_SUFFIX;
  }
  return full;
}

// ─────────────────────────────────────────────────────────
// 内部：渲染上下文与辅助
// ─────────────────────────────────────────────────────────

type RenderContext = {
  includeImages: "none" | "refs" | "inline";
  mediaIndex: Map<string, MediaRef>;
};

function buildMediaIndex(media: MediaRef[]): Map<string, MediaRef> {
  const map = new Map<string, MediaRef>();
  for (const m of media) {
    map.set(m.id, m);
  }
  return map;
}

/** 分发到各 kind 的渲染函数；穷尽 switch 保证未来新增 kind 必须更新此处。 */
function renderNode(node: DocumentNode, ctx: RenderContext): string {
  switch (node.kind) {
    case "heading":
      return renderHeading(node.level, node.runs);
    case "paragraph":
      return renderParagraph(node.runs);
    case "list":
      return renderList(node);
    case "table":
      return renderTable(node);
    case "image":
      return renderImage(node.mediaId, ctx);
    case "code":
      return renderCode(node.lang, node.text);
    case "quote":
      return renderQuote(node.runs);
    case "slide":
      return renderSlide(node, ctx);
    case "sheet":
      return renderSheet(node);
    case "comment":
      return renderComment(node.author, node.runs);
    case "footnote":
      return renderFootnote(node.refId, node.runs);
    case "pageBreak":
      return renderPageBreak(node.page);
    default: {
      // 类型穷尽守护：新增 kind 未补分支时此处会出现编译错误
      const _exhaustive: never = node;
      void _exhaustive;
      return "";
    }
  }
}

function renderRuns(runs: InlineRun[]): string {
  return runs
    .map((r) => {
      let t = r.text;
      if (r.code) t = "`" + t + "`";
      if (r.italic) t = "*" + t + "*";
      if (r.bold) t = "**" + t + "**";
      return t;
    })
    .join("");
}

function renderHeading(level: number, runs: InlineRun[]): string {
  const hashes = "#".repeat(Math.max(1, Math.min(6, level)));
  return `${hashes} ${renderRuns(runs)}\n\n`;
}

function renderParagraph(runs: InlineRun[]): string {
  return `${renderRuns(runs)}\n\n`;
}

function renderList(node: ListNode): string {
  const lines: string[] = [];
  for (let i = 0; i < node.items.length; i++) {
    const marker = node.ordered ? `${i + 1}.` : "-";
    lines.push(`${marker} ${renderRuns(node.items[i])}`);
  }
  return lines.join("\n") + "\n\n";
}

function escapeCell(text: string): string {
  // GFM 表格单元格：管道符需转义；换行替换为空格以保持单行
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderTable(node: TableNode): string {
  if (node.rows.length === 0) {
    return "";
  }
  // 列数取首行
  const colCount = node.rows[0].length;
  if (colCount === 0) {
    return "";
  }

  const out: string[] = [];

  // 表头：使用首行
  const headerCells = node.rows[0].map((cell) => escapeCell(renderRuns(cell)));
  out.push("| " + headerCells.join(" | ") + " |");

  // 分隔行
  out.push("| " + Array.from({ length: colCount }, () => "---").join(" | ") + " |");

  // 数据行：第 2 行起
  for (let i = 1; i < node.rows.length; i++) {
    const row = node.rows[i];
    const cells: string[] = [];
    for (let c = 0; c < colCount; c++) {
      const cell = row[c] ?? [];
      cells.push(escapeCell(renderRuns(cell)));
    }
    out.push("| " + cells.join(" | ") + " |");
  }

  return out.join("\n") + "\n\n";
}

function renderImage(mediaId: string, ctx: RenderContext): string {
  if (ctx.includeImages === "none") {
    return "";
  }
  const ref = ctx.mediaIndex.get(mediaId);
  const alt = ref?.alt ?? "";
  // refs 与 inline 都输出 `media:<id>` 占位，inline 的替换由调用方负责
  return `![${alt}](media:${mediaId})\n\n`;
}

function renderCode(lang: string | undefined, text: string): string {
  const fence = "```";
  return `${fence}${lang ?? ""}\n${text}\n${fence}\n\n`;
}

function renderQuote(runs: InlineRun[]): string {
  return `> ${renderRuns(runs)}\n\n`;
}

function renderSlide(node: SlideNode, ctx: RenderContext): string {
  const title = node.title ?? "";
  const out: string[] = [];
  out.push(`## Slide ${node.index}: ${title}\n\n`);
  for (const child of node.body) {
    out.push(renderNode(child, ctx));
  }
  if (node.notes && node.notes.length > 0) {
    out.push("**Notes:**\n\n");
    for (const child of node.notes) {
      out.push(renderNode(child, ctx));
    }
  }
  return out.join("");
}

function renderSheet(node: SheetNode): string {
  const header = `### Sheet: ${node.name}\n\n`;
  return header + renderTable(node.table);
}

function renderComment(author: string | undefined, runs: InlineRun[]): string {
  const prefix = author ? `> [!comment ${author}]` : "> [!comment]";
  return `${prefix}\n> ${renderRuns(runs)}\n\n`;
}

function renderFootnote(refId: string, runs: InlineRun[]): string {
  return `[^${refId}]: ${renderRuns(runs)}\n\n`;
}

function renderPageBreak(page: number): string {
  return `\n---\n<!-- page ${page} -->\n\n`;
}
