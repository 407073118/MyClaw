/**
 * document.read 门面：mode 路由 + 大小闸门 + maxChars 硬顶 + 审计日志 + 可操作错误提示 (ASST-04)。
 *
 * 职责：
 * 1. 从路径推断格式；未支持格式抛 `[E_DOC_FORMAT_UNSUPPORTED]`；`.doc` 老格式抛 `[E_DOC_LEGACY_DOC_UNSUPPORTED]`
 * 2. 50MB 闸门（`[E_DOC_TOO_LARGE]`）
 * 3. 读文件 -> sha256 -> doc-cache.getOrBuild(sha, builder) -> IR
 * 4. 按 mode 分发：stats / outline / read / search
 * 5. 每次成功调用发一条结构化日志：`{ sha256, mode, path, returnedBytes }`
 * 6. 所有 `[E_DOC_*]` 错误分支都附一句 `请…` 的下一步建议（ASST-04）
 *
 * 本门面不直接调用 PathAccessPolicy —— 调用方（builtin-tool-executor）在 dispatch 外层已做审批，
 * 传进来的 `resolvedPath` 是已批准的绝对路径。
 */

import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { DocumentFormat, DocumentIR, DocumentNode, Locator } from "@shared/contracts";
import { createLogger } from "../logger";
import type { DocCache } from "./doc-cache";
import { sha256OfBuffer } from "./doc-cache";
import { getParser, listRegisteredFormats } from "./parser-registry";
import { renderIrToMarkdown } from "./ir-to-markdown";

const log = createLogger("document-read");

/** 单文件大小硬顶：50MB。超出拒绝并指引先 mode=stats。 */
export const DOC_MAX_BYTES = 50 * 1024 * 1024;
/** maxChars 的硬顶，不可绕过。 */
export const DOC_MAX_CHARS_HARD_CAP = 32000;
/** maxChars 默认值。 */
export const DOC_DEFAULT_MAX_CHARS = 8000;
/** maxChars 下限；防止无意义小值。 */
const DOC_MIN_MAX_CHARS = 100;
/** search mode 的最大命中数。 */
const DOC_SEARCH_LIMIT = 20;

/** 所有支持的文档格式。document.read 能识别的扩展名列表。 */
const SUPPORTED_FORMATS_LIST = "xlsx/xls/xlsm/docx/pdf/pptx/md/txt/csv";

export type DocumentReadMode = "stats" | "outline" | "read" | "search";

export type DocumentReadArgs = {
  path: string;
  mode: DocumentReadMode;
  locator?: Locator;
  query?: string;
  maxChars?: number;
  format?: "markdown" | "json";
  includeImages?: "none" | "refs" | "inline";
};

export type DocumentReadDeps = {
  /** 由调用方构建的 doc-cache 实例。 */
  cache: DocCache;
  /** 调用方已通过 PathAccessPolicy 审批的绝对路径。 */
  resolvedPath: string;
  /** 可选会话 ID，仅用于日志关联。 */
  sessionId?: string | null;
};

export type DocumentReadResult =
  | { success: true; output: string }
  | { success: false; output: ""; error: string };

/** 把扩展名映射到 DocumentFormat；未知返回 null（`.doc` 也返回 null，由上层走专门的 LEGACY 分支）。 */
export function detectFormat(path: string): DocumentFormat | null {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case ".xlsx": return "xlsx";
    case ".xls": return "xls";
    case ".xlsm": return "xlsm";
    case ".docx": return "docx";
    case ".pdf": return "pdf";
    case ".pptx": return "pptx";
    case ".md": return "md";
    case ".txt": return "txt";
    case ".csv": return "csv";
    default: return null;
  }
}

/** 安全构造错误返回体。 */
function fail(error: string): DocumentReadResult {
  return { success: false, output: "", error };
}

/** 夹逼 maxChars 到 [DOC_MIN_MAX_CHARS, DOC_MAX_CHARS_HARD_CAP]。 */
function clampMaxChars(n: number | undefined): number {
  const raw = typeof n === "number" && Number.isFinite(n) ? n : DOC_DEFAULT_MAX_CHARS;
  return Math.min(Math.max(raw, DOC_MIN_MAX_CHARS), DOC_MAX_CHARS_HARD_CAP);
}

/** 把 InlineRun[] 拼成纯文本（忽略样式，供 search 做子串匹配）。 */
function runsToText(runs: Array<{ text: string }>): string {
  return runs.map((r) => r.text).join("");
}

/** 从节点提取其可搜索文本；不同 kind 抽取不同字段。 */
function nodePlainText(node: DocumentNode): string {
  switch (node.kind) {
    case "heading":
    case "paragraph":
    case "quote":
    case "comment":
    case "footnote":
      return runsToText(node.runs);
    case "list":
      return node.items.map((runs) => runsToText(runs)).join(" ");
    case "code":
      return node.text;
    case "table":
      return node.rows
        .map((row) => row.map((cell) => runsToText(cell)).join(" "))
        .join(" ");
    case "slide": {
      const body = node.body.map(nodePlainText).join(" ");
      const notes = (node.notes ?? []).map(nodePlainText).join(" ");
      return `${node.title ?? ""} ${body} ${notes}`.trim();
    }
    case "sheet":
      return `${node.name} ${nodePlainText(node.table)}`;
    case "image":
    case "pageBreak":
      return "";
    default: {
      const _exhaustive: never = node;
      void _exhaustive;
      return "";
    }
  }
}

/** Locator -> 人类可读后缀，供 outline 渲染与 search 结果定位。 */
function locatorSuffix(loc: Locator): string {
  const parts: string[] = [];
  if (typeof loc.page === "number") parts.push(`page=${loc.page}`);
  if (typeof loc.slide === "number") parts.push(`slide=${loc.slide}`);
  if (typeof loc.sheet === "string" && loc.sheet) parts.push(`sheet=${loc.sheet}`);
  if (typeof loc.heading === "string" && loc.heading) parts.push(`heading=${loc.heading}`);
  if (Array.isArray(loc.range) && loc.range.length === 2) {
    parts.push(`range=${loc.range[0]}..${loc.range[1]}`);
  }
  return parts.join(", ");
}

/** 判定节点是否为 HeadingNode。 */
function isHeading(n: DocumentNode): n is Extract<DocumentNode, { kind: "heading" }> {
  return n.kind === "heading";
}

/**
 * 按 locator 切 body：
 * - heading: 找到第一个 HeadingNode 其 runs 文本等于 heading，
 *            向下切直到遇到同级或更高级的下一个 heading（或到结尾）
 * - page / slide / sheet：按节点 locator 字段过滤
 * - range：直接 [start, endExclusive]
 * - 空 locator：原样返回
 */
function sliceByLocator(body: DocumentNode[], locator?: Locator): DocumentNode[] {
  if (!locator) return body;

  if (typeof locator.heading === "string" && locator.heading) {
    const target = locator.heading;
    let startIdx = -1;
    let anchorLevel = 6;
    for (let i = 0; i < body.length; i++) {
      const n = body[i];
      if (isHeading(n) && runsToText(n.runs) === target) {
        startIdx = i;
        anchorLevel = n.level;
        break;
      }
    }
    if (startIdx < 0) return [];
    let endIdx = body.length;
    for (let j = startIdx + 1; j < body.length; j++) {
      const n = body[j];
      if (isHeading(n) && n.level <= anchorLevel) {
        endIdx = j;
        break;
      }
    }
    return body.slice(startIdx, endIdx);
  }

  if (typeof locator.page === "number") {
    const p = locator.page;
    return body.filter((n) => n.locator.page === p);
  }

  if (typeof locator.slide === "number") {
    const s = locator.slide;
    return body.filter((n) => {
      if (n.kind === "slide") return n.index === s;
      return n.locator.slide === s;
    });
  }

  if (typeof locator.sheet === "string" && locator.sheet) {
    const name = locator.sheet;
    return body.filter((n) => {
      if (n.kind === "sheet") return n.name === name;
      return n.locator.sheet === name;
    });
  }

  if (Array.isArray(locator.range) && locator.range.length === 2) {
    const [start, end] = locator.range;
    return body.slice(Math.max(0, start), Math.min(body.length, end));
  }

  return body;
}

/** 遍历 body（含 slide.body / slide.notes）扫描 query 子串，返回带 locator 前缀的命中行。 */
function searchBody(
  body: DocumentNode[],
  query: string,
  limit: number,
): Array<{ loc: Locator; text: string }> {
  const q = query.toLowerCase();
  const hits: Array<{ loc: Locator; text: string }> = [];

  const visit = (node: DocumentNode): void => {
    if (hits.length >= limit) return;
    const text = nodePlainText(node);
    if (text.toLowerCase().includes(q)) {
      hits.push({ loc: node.locator, text });
    }
    if (node.kind === "slide") {
      for (const child of node.body) {
        if (hits.length >= limit) return;
        visit(child);
      }
      for (const child of node.notes ?? []) {
        if (hits.length >= limit) return;
        visit(child);
      }
    }
  };

  for (const node of body) {
    if (hits.length >= limit) break;
    visit(node);
  }
  return hits;
}

/** 把 outline 渲染成 `- Lv{level}: title (locator-suffix)` markdown 列表。 */
function renderOutline(outline: DocumentIR["outline"]): string {
  if (outline.length === 0) return "(无 outline)";
  return outline
    .map((item) => {
      const suffix = locatorSuffix(item.locator);
      return suffix
        ? `- Lv${item.level}: ${item.title} (${suffix})`
        : `- Lv${item.level}: ${item.title}`;
    })
    .join("\n");
}

/** 主入口：按 mode 路由 + 大小闸门 + 审计日志。 */
export async function executeDocumentRead(
  args: DocumentReadArgs,
  deps: DocumentReadDeps,
): Promise<DocumentReadResult> {
  const resolved = deps.resolvedPath;
  const ext = extname(resolved).toLowerCase();

  // 1. 格式识别（先过 .doc 老格式分支，再通用 detect）
  if (ext === ".doc") {
    return fail(
      "[E_DOC_LEGACY_DOC_UNSUPPORTED] .doc 老格式未支持。请在 Word 中\"另存为 .docx\"后再读取。",
    );
  }
  const format = detectFormat(resolved);
  if (!format) {
    return fail(
      `[E_DOC_FORMAT_UNSUPPORTED] 暂不支持 ${ext || "(无扩展名)"}。请检查扩展名，或先在原程序中另存为 .${SUPPORTED_FORMATS_LIST} 之一再重试。`,
    );
  }

  // 2. 50MB 大小闸门 —— 用 stat 而不是 readFile，避免把超大文件吞进内存。
  let bytes: number;
  try {
    const st = await stat(resolved);
    bytes = st.size;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(
      `[E_DOC_READ_FAILED] 无法读取文件元信息：${msg}。请确认路径存在且当前用户有读取权限。`,
    );
  }
  if (bytes > DOC_MAX_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    return fail(
      `[E_DOC_TOO_LARGE] 文件超过 50MB 上限（实际 ${mb}MB）。请先用 mode=stats 查看文档概况，再按段/页切片读取。`,
    );
  }

  // 3. mode=search 前置参数校验（早返回，避免无谓解析）
  if (args.mode === "search" && (typeof args.query !== "string" || !args.query.trim())) {
    return fail(
      "[E_DOC_QUERY_REQUIRED] mode=search 需要 query 参数。请传入要搜索的关键词后重试。",
    );
  }

  // 4. parser 可用性校验（在真正读文件前检查，省 I/O）
  const parser = getParser(format);
  if (!parser) {
    const registered = listRegisteredFormats().join(", ") || "(none)";
    return fail(
      `[E_DOC_FORMAT_UNSUPPORTED] 格式 ${format} 尚未注册解析器（已注册: ${registered}；支持列表: ${SUPPORTED_FORMATS_LIST}）。请检查扩展名，或先在原程序中另存为 .${SUPPORTED_FORMATS_LIST} 之一再重试。`,
    );
  }

  // 5. 读 buffer + 算 sha256 + 走缓存
  let buffer: Buffer;
  try {
    buffer = await readFile(resolved);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(
      `[E_DOC_READ_FAILED] 文件读取失败：${msg}。请确认路径存在且当前用户有读取权限。`,
    );
  }
  const sha = sha256OfBuffer(buffer);

  let ir: DocumentIR;
  try {
    ir = await deps.cache.getOrBuild(sha, async (mediaDir) => {
      return parser.parse({ path: resolved, buffer, sha256: sha, mediaDir });
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(
      `[E_DOC_PARSE_FAILED] 解析失败：${msg}。请确认文件未损坏，或先用 mode=stats 查看元信息后再决定读取策略。`,
    );
  }

  // 6. 按 mode 分发
  const maxChars = clampMaxChars(args.maxChars);
  const includeImages = args.includeImages ?? "refs";

  let output = "";
  switch (args.mode) {
    case "stats": {
      output = JSON.stringify({
        format: ir.source.format,
        bytes: ir.source.bytes || bytes,
        sha256: ir.source.sha256 || sha,
        meta: ir.meta,
        outlineCount: ir.outline.length,
        bodyCount: ir.body.length,
      });
      break;
    }
    case "outline": {
      output = renderOutline(ir.outline);
      break;
    }
    case "read": {
      const sliced = sliceByLocator(ir.body, args.locator);
      if (args.locator && sliced.length === 0) {
        return fail(
          "[E_DOC_LOCATOR_EMPTY] 给定 locator 未命中任何节点。请先用 mode=outline 确认可用锚点后重试。",
        );
      }
      const subIr: DocumentIR = { ...ir, body: sliced };
      if (args.format === "json") {
        const json = JSON.stringify(subIr);
        output = json.length > maxChars ? json.slice(0, maxChars) + "\n\n...（已截断）" : json;
      } else {
        output = renderIrToMarkdown(subIr, { maxChars, includeImages });
      }
      break;
    }
    case "search": {
      const hits = searchBody(ir.body, args.query as string, DOC_SEARCH_LIMIT);
      if (hits.length === 0) {
        output = `(无匹配) query="${args.query}"`;
      } else {
        output = hits
          .map((h) => {
            const suffix = locatorSuffix(h.loc);
            const snippet = h.text.length > 200 ? h.text.slice(0, 200) + "…" : h.text;
            return suffix ? `[${suffix}] ${snippet}` : snippet;
          })
          .join("\n");
        if (output.length > maxChars) {
          output = output.slice(0, maxChars) + "\n\n...（已截断）";
        }
      }
      break;
    }
    default: {
      const _exhaustive: never = args.mode;
      void _exhaustive;
      return fail(
        `[E_DOC_INVALID_MODE] 未知 mode=${String(args.mode)}。请使用 stats|outline|read|search 之一。`,
      );
    }
  }

  // 7. 审计日志（info）— 结构化字段 sha256/mode/path/returnedBytes
  log.info("read done", {
    sha256: sha,
    mode: args.mode,
    path: resolved,
    returnedBytes: output.length,
    sessionId: deps.sessionId ?? null,
  });

  return { success: true, output };
}
