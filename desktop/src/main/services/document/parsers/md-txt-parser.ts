/**
 * md-txt-parser — Markdown 与 纯文本 Parser（Phase 8 Plan 08）。
 *
 * 职责：
 * - mdParser：使用 marked 的 lexer 将 markdown tokens 转成 DocumentIR。
 *   覆盖 heading / paragraph / list / table / code / blockquote 六大基础块；
 *   outline 由所有 heading token 构成；每个非 heading 节点的 locator.heading
 *   指向最近一个 heading 文本，方便下游按段落检索 / 跳转。
 * - txtParser：按空行（一个或多个 \n）切段，每段一个 ParagraphNode。
 *   UTF-8 BOM 自动剥离；单换行保留在段落内部。
 *
 * 依赖：marked ^17（desktop/package.json 已声明，无需本 plan 改动）。
 * 本模块纯计算，零 I/O；遵循 08-05/08-06/08-07 parser 的惰性 require 模式，
 * 防止启动时强制加载 marked。
 */

import type {
  CodeNode,
  DocumentIR,
  DocumentNode,
  HeadingNode,
  InlineRun,
  ListNode,
  OutlineItem,
  ParagraphNode,
  QuoteNode,
  TableNode,
} from "@shared/contracts";
import type { DocumentParser, ParseInput } from "../parser-registry";

type MarkedModule = {
  lexer?: (src: string) => unknown[];
  marked?: { lexer: (src: string) => unknown[] };
};

/** 惰性加载 marked；缺失时抛 [E_DOC_DEP_MISSING] 并给出下一步提示。 */
function loadMarked(): MarkedModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("marked") as MarkedModule;
  } catch (err) {
    throw new Error(
      "[E_DOC_DEP_MISSING] 无法加载 marked 依赖，请确认 desktop/package.json 中 marked 已声明。原始错误：" +
        String((err as Error)?.message ?? err),
    );
  }
}

/** 从 marked 的 inline token 子树里抽出平铺文本，忽略行内样式（MVP）。 */
function tokenText(tk: unknown): string {
  const v = tk as { text?: unknown; raw?: unknown };
  if (typeof v?.text === "string") return v.text;
  if (typeof v?.raw === "string") return v.raw;
  return "";
}

/** marked 的 table cell 既可能是 {text, tokens} 对象，也可能是裸字符串；统一转成 string。 */
function cellText(cell: unknown): string {
  if (typeof cell === "string") return cell;
  const v = cell as { text?: unknown };
  if (typeof v?.text === "string") return v.text;
  return "";
}

/**
 * 解析 markdown 文本为 DocumentIR。
 *
 * 当前覆盖 token 类型：heading / paragraph / list / table / code / blockquote。
 * 其它（space / html / hr / def）无语义价值，跳过。
 */
export async function parseMarkdownBuffer(input: ParseInput): Promise<DocumentIR> {
  const marked = loadMarked();
  const lexer =
    typeof marked.lexer === "function"
      ? marked.lexer
      : typeof marked.marked?.lexer === "function"
        ? marked.marked.lexer
        : null;
  if (!lexer) {
    throw new Error("[E_DOC_DEP_MISSING] marked 模块未导出 lexer 函数。");
  }

  let text = input.buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const tokens = lexer(text);
  const body: DocumentNode[] = [];
  const outline: OutlineItem[] = [];
  let lastHeading: string | undefined;

  for (const raw of tokens) {
    const tk = raw as { type?: string } & Record<string, unknown>;
    switch (tk.type) {
      case "heading": {
        const rawLevel = typeof tk.depth === "number" ? tk.depth : 1;
        const level = Math.min(6, Math.max(1, rawLevel)) as 1 | 2 | 3 | 4 | 5 | 6;
        const hText = typeof tk.text === "string" ? tk.text : "";
        const node: HeadingNode = {
          kind: "heading",
          level,
          runs: [{ text: hText }],
          locator: { heading: hText },
        };
        body.push(node);
        outline.push({ level, title: hText, locator: { heading: hText } });
        lastHeading = hText;
        break;
      }
      case "paragraph": {
        const pText = typeof tk.text === "string" ? tk.text : "";
        const node: ParagraphNode = {
          kind: "paragraph",
          runs: [{ text: pText }],
          locator: { heading: lastHeading },
        };
        body.push(node);
        break;
      }
      case "list": {
        const items = Array.isArray(tk.items) ? (tk.items as unknown[]) : [];
        const listItems: InlineRun[][] = items.map((it) => [
          { text: tokenText(it) },
        ]);
        const node: ListNode = {
          kind: "list",
          ordered: Boolean(tk.ordered),
          items: listItems,
          locator: { heading: lastHeading },
        };
        body.push(node);
        break;
      }
      case "code": {
        const lang = typeof tk.lang === "string" && tk.lang.length > 0 ? tk.lang : undefined;
        const codeText = typeof tk.text === "string" ? tk.text : "";
        const node: CodeNode = {
          kind: "code",
          lang,
          text: codeText,
          locator: { heading: lastHeading },
        };
        body.push(node);
        break;
      }
      case "table": {
        const header = Array.isArray(tk.header) ? (tk.header as unknown[]) : [];
        const rowsRaw = Array.isArray(tk.rows) ? (tk.rows as unknown[]) : [];
        const headerRow: InlineRun[][] = header.map((c) => [{ text: cellText(c) }]);
        const dataRows: InlineRun[][][] = rowsRaw.map((row) => {
          const cells = Array.isArray(row) ? (row as unknown[]) : [];
          return cells.map((c) => [{ text: cellText(c) }]);
        });
        const rows: InlineRun[][][] = [headerRow, ...dataRows];
        const node: TableNode = {
          kind: "table",
          rows,
          locator: { heading: lastHeading },
        };
        body.push(node);
        break;
      }
      case "blockquote": {
        const qText = typeof tk.text === "string" ? tk.text : "";
        const node: QuoteNode = {
          kind: "quote",
          runs: [{ text: qText }],
          locator: { heading: lastHeading },
        };
        body.push(node);
        break;
      }
      // space / html / hr / def — no semantic value in IR
    }
  }

  return {
    source: {
      path: input.path,
      format: "md",
      bytes: input.buffer.length,
      sha256: input.sha256,
    },
    meta: { words: Math.round(text.length / 5) },
    outline,
    body,
    media: [],
  };
}

/**
 * 解析纯文本为 DocumentIR。
 *
 * 规则：
 * - UTF-8 BOM 剥离
 * - 按 >=2 个连续换行切段
 * - 每段 trim 后非空则生成一个 ParagraphNode；单个 \n 不切段，保留在段内
 * - 空输入 / 全空白输入 → body 为空数组（非错误）
 */
export async function parsePlainTextBuffer(input: ParseInput): Promise<DocumentIR> {
  let text = input.buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const body: ParagraphNode[] = blocks.map((b) => ({
    kind: "paragraph",
    runs: [{ text: b }],
    locator: {},
  }));

  return {
    source: {
      path: input.path,
      format: "txt",
      bytes: input.buffer.length,
      sha256: input.sha256,
    },
    meta: { words: Math.round(text.length / 5) },
    outline: [],
    body,
    media: [],
  };
}

export const mdParser: DocumentParser = {
  format: "md",
  parse: parseMarkdownBuffer,
};

export const txtParser: DocumentParser = {
  format: "txt",
  parse: parsePlainTextBuffer,
};
