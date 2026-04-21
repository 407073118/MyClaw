/**
 * docxParser：将 .docx 解析为 DocumentIR。
 *
 * 三段式流水线（由本文件按任务演进）：
 *   Task 1 (本提交)：mammoth → HTML，HTML 游走生成标题 / 段落 / 列表 / 表格骨架
 *   Task 2：ZIP 再读取 word/comments.xml + word/footnotes.xml，XXE 防御 + 16MiB 单项上限
 *   Task 3：解压 word/media/* 到 mediaDir，产出 MediaRef + ImageNode，并做 sha256 去重
 *
 * 安全约束：
 *   - 零 Python 依赖
 *   - 任何来自 docx 的 XML 必须通过 assertNoDoctype 守门（后续 Task 2 引入）
 *   - 单 ZIP entry 解压不得超过 16MiB（后续 Task 2 引入）
 *
 * 运行时约束：
 *   - 使用 require("mammoth") + require("jszip") 惰性加载，主进程启动不强制加载
 *   - jszip 作为显式顶层依赖声明，避免 pnpm 隔离 node_modules 下仅能解析到 mammoth 内部副本
 */

import type {
  DocumentIR,
  HeadingNode,
  ParagraphNode,
  TableNode,
  ListNode,
  InlineRun,
  OutlineItem,
  DocumentNode,
  Locator,
} from "@shared/contracts";
import type { DocumentParser, ParseInput } from "../parser-registry";

/** docx HTML 输出若出现 DOCTYPE，一律视为被篡改；直接拒绝。 */
const XXE_MARKER = "<!DOCTYPE";

/** 解码最小 HTML 实体集合（mammoth 输出基本只覆盖这几个）。 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

type HtmlToken =
  | { type: "open"; tag: string; attrs: string }
  | { type: "close"; tag: string }
  | { type: "void"; tag: string; attrs: string }
  | { type: "text"; text: string };

/** 粗粒度 HTML 词法分析器。只覆盖 mammoth 产出的常见标签，足够构建 IR 骨架。 */
function tokenizeHtml(html: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) {
      const text = html.slice(last, m.index);
      if (text.length > 0) tokens.push({ type: "text", text });
    }
    const isClose = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3] || "";
    const selfClosing = /\/\s*$/.test(attrs) || tag === "br" || tag === "img" || tag === "hr";
    if (isClose) {
      tokens.push({ type: "close", tag });
    } else if (selfClosing) {
      tokens.push({ type: "void", tag, attrs });
    } else {
      tokens.push({ type: "open", tag, attrs });
    }
    last = re.lastIndex;
  }
  if (last < html.length) {
    const text = html.slice(last);
    if (text.length > 0) tokens.push({ type: "text", text });
  }
  return tokens;
}

type InlineStyle = { bold: boolean; italic: boolean; code: boolean };

function emptyStyle(): InlineStyle {
  return { bold: false, italic: false, code: false };
}

function applyStyleTag(style: InlineStyle, tag: string, delta: 1 | -1): InlineStyle {
  const next = { ...style };
  const kind =
    tag === "strong" || tag === "b"
      ? "bold"
      : tag === "em" || tag === "i"
        ? "italic"
        : tag === "code" ? "code" : null;
  if (!kind) return next;
  // 对叠加不做计数，只记录 bool；多次打开多次关闭不会出错（mammoth 不会产生不平衡结构）。
  if (delta === 1) (next as any)[kind] = true;
  else (next as any)[kind] = false;
  return next;
}

/** 把纯文本片段按当前样式切成 InlineRun。空串不产出节点。 */
function pushRun(runs: InlineRun[], text: string, style: InlineStyle): void {
  if (!text) return;
  const run: InlineRun = { text };
  if (style.bold) run.bold = true;
  if (style.italic) run.italic = true;
  if (style.code) run.code = true;
  runs.push(run);
}

type BuildContext = {
  body: DocumentNode[];
  outline: OutlineItem[];
  lastHeading: string | undefined;
};

/** locator 工厂：body 内节点默认 heading = lastHeading。 */
function locatorFor(ctx: BuildContext): Locator {
  return ctx.lastHeading ? { heading: ctx.lastHeading } : {};
}

/**
 * 把 mammoth 产出的 HTML 游走成 IR 节点。
 * 仅处理骨架级标签：h1..h6 / p / ul / ol / li / table / tr / td|th / strong / b / em / i / code / br
 * <img> 在 Task 3 再处理（此处略过以避免占位图节点）。
 */
function walkHtmlToIr(html: string, ctx: BuildContext): void {
  const tokens = tokenizeHtml(html);

  // 解析状态机：我们需要知道当前是否在 p / h / li / td 内部，以便把文本收集到正确的 runs。
  type BlockFrame =
    | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; runs: InlineRun[] }
    | { kind: "paragraph"; runs: InlineRun[] }
    | { kind: "li"; runs: InlineRun[] }
    | { kind: "td"; runs: InlineRun[] };

  const listStack: Array<{ ordered: boolean; items: InlineRun[][] }> = [];
  let tableStack: Array<{ rows: InlineRun[][][] }> = [];
  let currentRow: InlineRun[][] | null = null;
  let currentBlock: BlockFrame | null = null;
  let style = emptyStyle();

  const flushBlock = (): void => {
    if (!currentBlock) return;
    if (currentBlock.kind === "heading") {
      const text = currentBlock.runs.map((r) => r.text).join("").trim();
      const headingNode: HeadingNode = {
        kind: "heading",
        level: currentBlock.level,
        runs: currentBlock.runs,
        // 标题节点自己的 locator.heading 记录自身，便于跳转时对齐
        locator: { heading: text },
      };
      ctx.body.push(headingNode);
      ctx.outline.push({ level: currentBlock.level, title: text, locator: { heading: text } });
      ctx.lastHeading = text;
    } else if (currentBlock.kind === "paragraph") {
      // 跳过空段落（mammoth 对空 <p> 会产出）
      const text = currentBlock.runs.map((r) => r.text).join("");
      if (text.trim().length > 0) {
        const node: ParagraphNode = {
          kind: "paragraph",
          runs: currentBlock.runs,
          locator: locatorFor(ctx),
        };
        ctx.body.push(node);
      }
    }
    currentBlock = null;
  };

  for (const t of tokens) {
    if (t.type === "text") {
      const decoded = decodeHtmlEntities(t.text);
      if (currentBlock) {
        pushRun(currentBlock.runs, decoded, style);
      }
      continue;
    }

    if (t.type === "void") {
      if (t.tag === "br" && currentBlock) {
        pushRun(currentBlock.runs, "\n", style);
      }
      // <img> 留给 Task 3
      continue;
    }

    if (t.type === "open") {
      // Headings
      const headingMatch = /^h([1-6])$/.exec(t.tag);
      if (headingMatch) {
        flushBlock();
        const level = parseInt(headingMatch[1], 10) as 1 | 2 | 3 | 4 | 5 | 6;
        currentBlock = { kind: "heading", level, runs: [] };
        continue;
      }
      if (t.tag === "p") {
        // li / td 内部的 <p> 折叠进上层 runs，不开新段落，也不 flush 上层块
        if (currentBlock && (currentBlock.kind === "li" || currentBlock.kind === "td")) {
          continue;
        }
        flushBlock();
        if (currentBlock === null && listStack.length === 0 && !currentRow) {
          currentBlock = { kind: "paragraph", runs: [] };
        }
        continue;
      }
      if (t.tag === "ul" || t.tag === "ol") {
        flushBlock();
        listStack.push({ ordered: t.tag === "ol", items: [] });
        continue;
      }
      if (t.tag === "li") {
        // 最近的列表
        currentBlock = { kind: "li", runs: [] };
        continue;
      }
      if (t.tag === "table") {
        flushBlock();
        tableStack.push({ rows: [] });
        continue;
      }
      if (t.tag === "tr") {
        currentRow = [];
        continue;
      }
      if (t.tag === "td" || t.tag === "th") {
        currentBlock = { kind: "td", runs: [] };
        continue;
      }
      // 行内样式
      if (t.tag === "strong" || t.tag === "b" || t.tag === "em" || t.tag === "i" || t.tag === "code") {
        style = applyStyleTag(style, t.tag, 1);
        continue;
      }
      // 其他标签忽略（如 a、span）
      continue;
    }

    if (t.type === "close") {
      const headingMatch = /^h([1-6])$/.exec(t.tag);
      if (headingMatch) {
        if (currentBlock && currentBlock.kind === "heading") flushBlock();
        continue;
      }
      if (t.tag === "p") {
        if (currentBlock && currentBlock.kind === "paragraph") flushBlock();
        continue;
      }
      if (t.tag === "li") {
        if (currentBlock && currentBlock.kind === "li") {
          const list = listStack[listStack.length - 1];
          if (list) list.items.push(currentBlock.runs);
          currentBlock = null;
        }
        continue;
      }
      if (t.tag === "ul" || t.tag === "ol") {
        const list = listStack.pop();
        if (list && list.items.length > 0) {
          const listNode: ListNode = {
            kind: "list",
            ordered: list.ordered,
            items: list.items,
            locator: locatorFor(ctx),
          };
          ctx.body.push(listNode);
        }
        continue;
      }
      if (t.tag === "td" || t.tag === "th") {
        if (currentBlock && currentBlock.kind === "td") {
          if (currentRow) currentRow.push(currentBlock.runs);
          currentBlock = null;
        }
        continue;
      }
      if (t.tag === "tr") {
        if (currentRow) {
          const tbl = tableStack[tableStack.length - 1];
          if (tbl) tbl.rows.push(currentRow);
          currentRow = null;
        }
        continue;
      }
      if (t.tag === "table") {
        const tbl = tableStack.pop();
        if (tbl && tbl.rows.length > 0) {
          const tableNode: TableNode = {
            kind: "table",
            rows: tbl.rows,
            locator: locatorFor(ctx),
          };
          ctx.body.push(tableNode);
        }
        continue;
      }
      if (t.tag === "strong" || t.tag === "b" || t.tag === "em" || t.tag === "i" || t.tag === "code") {
        style = applyStyleTag(style, t.tag, -1);
        continue;
      }
      continue;
    }
  }

  // 流结束：收尾当前 block（正常情况下 mammoth 会平衡标签）
  flushBlock();
}

/** 统计近似字数：所有 InlineRun.text 长度合计 / 5，向下取整。 */
function approximateWords(body: DocumentNode[]): number {
  let chars = 0;
  for (const n of body) {
    if ("runs" in n && Array.isArray((n as any).runs)) {
      for (const r of (n as any).runs as InlineRun[]) chars += r.text.length;
    } else if (n.kind === "list") {
      for (const it of n.items) for (const r of it) chars += r.text.length;
    } else if (n.kind === "table") {
      for (const row of n.rows) for (const cell of row) for (const r of cell) chars += r.text.length;
    }
  }
  return Math.floor(chars / 5);
}

/**
 * 将 .docx Buffer 解析为 DocumentIR（Task 1 骨架 —— 标题 / 段落 / 列表 / 表格）。
 *
 * 后续 Task 2 将在此函数末尾追加 comments / footnotes 合并逻辑，
 * Task 3 追加 word/media/* 提取逻辑。
 */
export async function parseDocxBuffer(input: ParseInput): Promise<DocumentIR> {
  let mammoth: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mammoth = require("mammoth");
  } catch {
    throw new Error(
      "[E_DOC_DEP_MISSING] mammoth 未安装。请在 desktop/ 下执行 pnpm install 后重启桌面端。",
    );
  }

  const result = await mammoth.convertToHtml({ buffer: input.buffer });
  const html: string = String(result?.value ?? "");

  // 防御性检测：mammoth 正常不会产出 DOCTYPE；若产出一律拒绝。
  if (html.includes(XXE_MARKER)) {
    throw new Error(
      "[E_DOC_XXE_BLOCKED] docx 中检测到 DOCTYPE 声明。请确认文件未被篡改。",
    );
  }

  const ctx: BuildContext = { body: [], outline: [], lastHeading: undefined };
  walkHtmlToIr(html, ctx);

  return {
    source: {
      path: input.path,
      format: "docx",
      bytes: input.buffer.length,
      sha256: input.sha256,
    },
    meta: { words: approximateWords(ctx.body) },
    outline: ctx.outline,
    body: ctx.body,
    media: [],
  };
}

/** docx parser 单例；由 executor.ensureParsersRegistered 注册。 */
export const docxParser: DocumentParser = {
  format: "docx",
  parse: parseDocxBuffer,
};
