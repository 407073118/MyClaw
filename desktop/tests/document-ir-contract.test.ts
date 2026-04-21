import { describe, it, expect } from "vitest";
import type {
  DocumentIR,
  DocumentNode,
  DocumentSource,
  DocumentMeta,
  Locator,
  OutlineItem,
  MediaRef,
  InlineRun,
  HeadingNode,
  ParagraphNode,
  ListNode,
  TableNode,
  ImageNode,
  CodeNode,
  QuoteNode,
  SlideNode,
  SheetNode,
  CommentNode,
  FootnoteNode,
  PageBreakNode,
} from "@shared/contracts";

// ─────────────────────────────────────────────────────────
// 说明：DocumentIR 契约测试
// 目的：锁定 DocumentIR 的结构和 DocumentNode 的 12 种 kind
// 方法：TypeScript 编译期可验证；运行期断言样例对象形状
// ─────────────────────────────────────────────────────────

describe("DocumentIR 契约", () => {
  it("DocumentIR 字面量应包含 source/meta/outline/body/media 五个顶层字段", () => {
    const src: DocumentSource = {
      path: "C:\\docs\\sample.docx",
      format: "docx",
      bytes: 1024,
      sha256: "abc123",
    };
    const meta: DocumentMeta = {
      title: "Sample",
      author: "Tester",
      modifiedAt: "2026-04-21T00:00:00Z",
      pages: 1,
      words: 10,
    };
    const locator: Locator = { heading: "Intro", range: [0, 1] };
    const outline: OutlineItem[] = [{ level: 1, title: "Intro", locator }];

    const heading: HeadingNode = {
      kind: "heading",
      level: 1,
      runs: [{ text: "Intro", bold: true }],
      locator,
    };
    const paragraph: ParagraphNode = {
      kind: "paragraph",
      runs: [{ text: "Hello" }],
      locator,
    };
    const table: TableNode = {
      kind: "table",
      rows: [[[{ text: "a" }], [{ text: "b" }]]],
      locator,
    };
    const slide: SlideNode = {
      kind: "slide",
      index: 1,
      title: "Slide Title",
      body: [paragraph],
      notes: [paragraph],
      locator: { slide: 1 },
    };
    const sheet: SheetNode = {
      kind: "sheet",
      name: "Sheet1",
      dims: { rows: 1, cols: 2 },
      table,
      locator: { sheet: "Sheet1" },
    };

    const media: MediaRef[] = [
      { id: "img1", mime: "image/png", cachePath: "/tmp/media/img1.png", alt: "a", width: 100, height: 50 },
    ];

    const ir: DocumentIR = {
      source: src,
      meta,
      outline,
      body: [heading, paragraph, table, slide, sheet],
      media,
    };

    expect(ir.body.length).toBe(5);
    expect(ir.source.format).toBe("docx");
    expect(ir.outline[0].level).toBe(1);
    expect(ir.media[0].id).toBe("img1");
  });

  it("DocumentNode 判别联合应覆盖全部 12 种 kind（TypeScript 穷尽性 + 运行期断言）", () => {
    const loc: Locator = {};
    const runs: InlineRun[] = [{ text: "x" }];

    const headingNode: HeadingNode = { kind: "heading", level: 2, runs, locator: loc };
    const paragraphNode: ParagraphNode = { kind: "paragraph", runs, locator: loc };
    const listNode: ListNode = { kind: "list", ordered: false, items: [runs], locator: loc };
    const tableNode: TableNode = { kind: "table", rows: [[runs]], locator: loc };
    const imageNode: ImageNode = { kind: "image", mediaId: "m1", locator: loc };
    const codeNode: CodeNode = { kind: "code", lang: "ts", text: "const x = 1;", locator: loc };
    const quoteNode: QuoteNode = { kind: "quote", runs, locator: loc };
    const slideNode: SlideNode = { kind: "slide", index: 0, body: [], locator: loc };
    const sheetNode: SheetNode = {
      kind: "sheet",
      name: "S",
      dims: { rows: 0, cols: 0 },
      table: { kind: "table", rows: [], locator: loc },
      locator: loc,
    };
    const commentNode: CommentNode = { kind: "comment", runs, locator: loc };
    const footnoteNode: FootnoteNode = { kind: "footnote", refId: "fn1", runs, locator: loc };
    const pageBreakNode: PageBreakNode = { kind: "pageBreak", page: 2, locator: loc };

    const all: DocumentNode[] = [
      headingNode,
      paragraphNode,
      listNode,
      tableNode,
      imageNode,
      codeNode,
      quoteNode,
      slideNode,
      sheetNode,
      commentNode,
      footnoteNode,
      pageBreakNode,
    ];

    const seen = new Set<string>();
    for (const node of all) {
      // 穷尽性检查：若将来漏一个 kind，default 分支会出现类型错误
      switch (node.kind) {
        case "heading":
        case "paragraph":
        case "list":
        case "table":
        case "image":
        case "code":
        case "quote":
        case "slide":
        case "sheet":
        case "comment":
        case "footnote":
        case "pageBreak":
          seen.add(node.kind);
          break;
        default: {
          const _exhaustive: never = node;
          throw new Error(`unhandled kind: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }

    expect(seen.size).toBe(12);
  });
});
