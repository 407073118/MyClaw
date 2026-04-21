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

import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
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
  CommentNode,
  FootnoteNode,
  ImageNode,
  MediaRef,
} from "@shared/contracts";
import type { DocumentParser, ParseInput } from "../parser-registry";

/** docx HTML 输出若出现 DOCTYPE，一律视为被篡改；直接拒绝。 */
const XXE_MARKER = "<!DOCTYPE";

/** 单个 ZIP entry 解压后最大允许字节数（zip-bomb 防御）。 */
const MAX_DOCX_ZIP_ENTRY_BYTES = 16 * 1024 * 1024; // 16 MiB

/**
 * 守门：docx 内部 XML 不得包含 DOCTYPE 声明。
 * 即便我们不使用完整 XML 解析器，依然在正文里用正则 + DOCTYPE 关键字直接拒绝，
 * 避免把潜在外部实体声明暴露给下游消费者（ASST-04 提示）。
 */
function assertNoDoctype(xml: string): void {
  if (xml.includes(XXE_MARKER)) {
    throw new Error(
      "[E_DOC_XXE_BLOCKED] docx 中检测到外部实体（DOCTYPE）声明。请确认文件未被篡改。",
    );
  }
}

/**
 * 带大小上限读取 ZIP entry：先拿字节，确认不超限，再转字符串。
 * 缺失 entry 返回 null，不视为错误。
 */
async function readZipEntryCapped(zip: any, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  const bytes: Uint8Array = await entry.async("uint8array");
  if (bytes.byteLength > MAX_DOCX_ZIP_ENTRY_BYTES) {
    throw new Error(
      `[E_DOC_ZIP_ENTRY_TOO_LARGE] docx 内部 ${path} 超过 16MiB 上限（实际 ${bytes.byteLength} 字节）。请检查文件是否异常。`,
    );
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** 从一段 XML 中提取所有 `<w:t>...</w:t>` 内文本并拼接。 */
function extractWtText(xml: string): string {
  const out: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(decodeHtmlEntities(m[1]));
  }
  return out.join("");
}

/** 从 attrs 里取某个属性的值（支持 w:id / w:author / w:type 等带冒号命名）。 */
function getAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`${name.replace(":", "\\:")}\\s*=\\s*"([^"]*)"`);
  const m = re.exec(attrs);
  return m ? m[1] : undefined;
}

/**
 * 解析 word/comments.xml 为 CommentNode 列表。
 * 每个 `<w:comment ...>` 块取 w:id / w:author / 内部所有 <w:t> 文本。
 */
function parseCommentsXml(xml: string): CommentNode[] {
  const results: CommentNode[] = [];
  const commentRe = /<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g;
  let m: RegExpExecArray | null;
  while ((m = commentRe.exec(xml)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const author = getAttr(attrs, "w:author");
    const text = extractWtText(inner);
    const node: CommentNode = {
      kind: "comment",
      runs: [{ text }],
      locator: {},
    };
    if (author) node.author = author;
    results.push(node);
  }
  return results;
}

/** 依扩展名猜测常见图片 MIME；未知扩展名回退到 application/octet-stream。 */
function guessMimeFromExt(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, "");
  switch (e) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "tif":
    case "tiff":
      return "image/tiff";
    default:
      return "application/octet-stream";
  }
}

/**
 * 解压 word/media/* 到 mediaDir，按 sha256(bytes) 去重：
 *   - 同 sha 复用同一磁盘文件，但仍为每个引用生成一个 ImageNode
 *   - 单 entry 超过 16MiB 视为异常（zip-bomb 防御）
 *   - ImageNode.locator.heading 记录最近一次标题文本（由 ctx.lastHeading 传入）
 */
async function extractDocxMedia(
  zip: any,
  mediaDir: string,
  lastHeading: string | undefined,
): Promise<{ images: ImageNode[]; media: MediaRef[] }> {
  const images: ImageNode[] = [];
  const media: MediaRef[] = [];
  const seen = new Map<string, { ext: string; cachePath: string }>();

  // zip.files 是一个 { path: JSZipObject } 对象；按路径筛 word/media/*
  const allPaths = Object.keys(zip.files);
  for (const entryName of allPaths) {
    if (!/^word\/media\//.test(entryName)) continue;
    const entry = zip.file(entryName);
    if (!entry || entry.dir) continue;
    const bytes: Uint8Array = await entry.async("uint8array");
    if (bytes.byteLength > MAX_DOCX_ZIP_ENTRY_BYTES) {
      throw new Error(
        `[E_DOC_ZIP_ENTRY_TOO_LARGE] docx 内部 ${entryName} 超过 16MiB 上限（实际 ${bytes.byteLength} 字节）。请确认文件未包含异常大的嵌入资源。`,
      );
    }
    const sha = createHash("sha256").update(bytes).digest("hex");
    const extMatch = entryName.match(/\.[^./]+$/);
    const ext = (extMatch ? extMatch[0] : "").toLowerCase();

    if (!seen.has(sha)) {
      const filename = `${sha}${ext}`;
      const cachePath = join(mediaDir, filename);
      await writeFile(cachePath, bytes);
      seen.set(sha, { ext, cachePath });
      media.push({
        id: sha,
        mime: guessMimeFromExt(ext),
        cachePath,
      });
    }
    const locator: Locator = lastHeading ? { heading: lastHeading } : {};
    images.push({ kind: "image", mediaId: sha, locator });
  }

  return { images, media };
}

/**
 * 解析 word/footnotes.xml 为 FootnoteNode 列表。
 * 跳过 w:type="separator" 和 w:type="continuationSeparator" 自动占位块。
 */
function parseFootnotesXml(xml: string): FootnoteNode[] {
  const results: FootnoteNode[] = [];
  const footRe = /<w:footnote\b([^>]*)>([\s\S]*?)<\/w:footnote>/g;
  let m: RegExpExecArray | null;
  while ((m = footRe.exec(xml)) !== null) {
    const attrs = m[1];
    const inner = m[2];
    const type = getAttr(attrs, "w:type");
    if (type === "separator" || type === "continuationSeparator") continue;
    const id = getAttr(attrs, "w:id") ?? "";
    const text = extractWtText(inner);
    results.push({
      kind: "footnote",
      refId: id,
      runs: [{ text }],
      locator: {},
    });
  }
  return results;
}

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

  // 在把 buffer 交给 mammoth 之前先做一次 ZIP 扫描：
  //   - 任何 word/*.xml entry 或 word/media/* entry 的解压尺寸若超过 16MiB，直接拒绝
  //   - 这样即便 mammoth 内部会自行读取 footnotes.xml / comments.xml 也不会吃到超大字符串
  let JSZip: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    JSZip = require("jszip");
  } catch {
    throw new Error(
      "[E_DOC_DEP_MISSING] jszip 未安装。请在 desktop/ 下执行 pnpm install 后重启桌面端。",
    );
  }
  const zip = await JSZip.loadAsync(input.buffer);
  // 预检查关键 entry：尺寸（zip-bomb 防御）+ DOCTYPE（XXE 防御）。
  // DOCTYPE 必须在 mammoth.convertToHtml 之前拦截 —— mammoth 内部会用 xmldom 读
  // comments.xml / footnotes.xml，遇到未声明实体会抛 "entity not found" 而非我们的业务错误码。
  // 预读一次 + 结构化错误，两问题一起解决。
  const preScan: Record<string, string | null> = {};
  for (const entryName of ["word/comments.xml", "word/footnotes.xml"]) {
    const e = zip.file(entryName);
    if (!e) {
      preScan[entryName] = null;
      continue;
    }
    const bytes: Uint8Array = await e.async("uint8array");
    if (bytes.byteLength > MAX_DOCX_ZIP_ENTRY_BYTES) {
      throw new Error(
        `[E_DOC_ZIP_ENTRY_TOO_LARGE] docx 内部 ${entryName} 超过 16MiB 上限（实际 ${bytes.byteLength} 字节）。请检查文件是否异常。`,
      );
    }
    const text = new TextDecoder("utf-8").decode(bytes);
    assertNoDoctype(text);
    preScan[entryName] = text;
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

  // ─── Task 2：复用上方预扫描得到的 word/comments.xml / word/footnotes.xml 文本 ───
  const commentsXml = preScan["word/comments.xml"];
  if (commentsXml) {
    const comments = parseCommentsXml(commentsXml);
    for (const c of comments) ctx.body.push(c);
  }

  const footnotesXml = preScan["word/footnotes.xml"];
  if (footnotesXml) {
    const footnotes = parseFootnotesXml(footnotesXml);
    for (const f of footnotes) ctx.body.push(f);
  }

  // ─── Task 3：解压 word/media/* 到 mediaDir，产出 ImageNode + MediaRef ───
  const { images, media } = await extractDocxMedia(zip, input.mediaDir, ctx.lastHeading);
  for (const img of images) ctx.body.push(img);

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
    media,
  };
}

/** docx parser 单例；由 executor.ensureParsersRegistered 注册。 */
export const docxParser: DocumentParser = {
  format: "docx",
  parse: parseDocxBuffer,
};
