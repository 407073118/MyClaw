import { describe, it, expect } from "vitest";
import type {
  DocumentIR,
  HeadingNode,
  ParagraphNode,
  TableNode,
  SlideNode,
  ImageNode,
  SheetNode,
  ListNode,
  CodeNode,
  QuoteNode,
  CommentNode,
  FootnoteNode,
  PageBreakNode,
  InlineRun,
  Locator,
  DocumentSource,
  DocumentMeta,
} from "@shared/contracts";
import { renderIrToMarkdown } from "../src/main/services/document/ir-to-markdown";

// ─────────────────────────────────────────────────────────
// 辅助：构造最小的 DocumentIR
// ─────────────────────────────────────────────────────────

const emptyLocator: Locator = {};

function makeSource(): DocumentSource {
  return { path: "/tmp/x.docx", format: "docx", bytes: 0, sha256: "0" };
}

function makeMeta(): DocumentMeta {
  return {};
}

function makeIR(body: DocumentIR["body"]): DocumentIR {
  return {
    source: makeSource(),
    meta: makeMeta(),
    outline: [],
    body,
    media: [],
  };
}

function runs(text: string, extra: Partial<InlineRun> = {}): InlineRun[] {
  return [{ text, ...extra }];
}

describe("renderIrToMarkdown", () => {
  it("Test 1: heading level=2 渲染为 `## Hello\\n\\n`", () => {
    const heading: HeadingNode = {
      kind: "heading",
      level: 2,
      runs: runs("Hello"),
      locator: emptyLocator,
    };
    const md = renderIrToMarkdown(makeIR([heading]));
    expect(md).toContain("## Hello");
    // 前导部分必须以 `## Hello\n\n` 开头
    expect(md.startsWith("## Hello\n\n")).toBe(true);
  });

  it("Test 2: TableNode 渲染为 GFM 表格（包含 `| --- | --- |` 分隔行）", () => {
    const table: TableNode = {
      kind: "table",
      rows: [
        [runs("a"), runs("b")],
        [runs("1"), runs("2")],
      ],
      locator: emptyLocator,
    };
    const md = renderIrToMarkdown(makeIR([table]));
    expect(md).toContain("| a | b |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("Test 3: SlideNode(index=3) 渲染 `## Slide 3: Intro` + body + `**Notes:**`", () => {
    const bodyPara: ParagraphNode = {
      kind: "paragraph",
      runs: runs("hi"),
      locator: emptyLocator,
    };
    const notesPara: ParagraphNode = {
      kind: "paragraph",
      runs: runs("talk slowly"),
      locator: emptyLocator,
    };
    const slide: SlideNode = {
      kind: "slide",
      index: 3,
      title: "Intro",
      body: [bodyPara],
      notes: [notesPara],
      locator: { slide: 3 },
    };
    const md = renderIrToMarkdown(makeIR([slide]));
    expect(md).toContain("## Slide 3: Intro");
    expect(md).toContain("hi");
    expect(md).toContain("**Notes:**");
    expect(md).toContain("talk slowly");
  });

  it("Test 4: maxChars 截断并追加 `...（已截断）`", () => {
    const longText = "A".repeat(200);
    const para: ParagraphNode = {
      kind: "paragraph",
      runs: runs(longText),
      locator: emptyLocator,
    };
    const md = renderIrToMarkdown(makeIR([para]), { maxChars: 50 });
    expect(md.length).toBeLessThanOrEqual(50 + "\n\n...（已截断）".length + 5);
    expect(md.endsWith("...（已截断）")).toBe(true);
  });

  it("Test 5: includeImages 控制图片渲染（none / refs / inline）", () => {
    const image: ImageNode = {
      kind: "image",
      mediaId: "img-a",
      locator: emptyLocator,
    };
    const ir: DocumentIR = {
      source: makeSource(),
      meta: makeMeta(),
      outline: [],
      body: [image],
      media: [{ id: "img-a", mime: "image/png", cachePath: "/tmp/img.png", alt: "demo" }],
    };

    const mdRefs = renderIrToMarkdown(ir, { includeImages: "refs" });
    expect(mdRefs).toContain("![demo](media:img-a)");

    const mdNone = renderIrToMarkdown(ir, { includeImages: "none" });
    expect(mdNone).not.toContain("img-a");

    const mdInline = renderIrToMarkdown(ir, { includeImages: "inline" });
    expect(mdInline).toContain("media:img-a");
  });

  it("Test 6（覆盖）: 12 种 kind 均可渲染不抛错", () => {
    const loc: Locator = {};
    const r = runs("x");
    const table: TableNode = { kind: "table", rows: [[r]], locator: loc };
    const nodes = [
      { kind: "heading", level: 1, runs: r, locator: loc } as HeadingNode,
      { kind: "paragraph", runs: r, locator: loc } as ParagraphNode,
      { kind: "list", ordered: false, items: [r], locator: loc } as ListNode,
      table,
      { kind: "image", mediaId: "mx", locator: loc } as ImageNode,
      { kind: "code", lang: "ts", text: "const x = 1;", locator: loc } as CodeNode,
      { kind: "quote", runs: r, locator: loc } as QuoteNode,
      { kind: "slide", index: 1, body: [], locator: loc } as SlideNode,
      {
        kind: "sheet",
        name: "S",
        dims: { rows: 1, cols: 1 },
        table,
        locator: loc,
      } as SheetNode,
      { kind: "comment", runs: r, locator: loc } as CommentNode,
      { kind: "footnote", refId: "fn1", runs: r, locator: loc } as FootnoteNode,
      { kind: "pageBreak", page: 2, locator: loc } as PageBreakNode,
    ];
    const md = renderIrToMarkdown(makeIR(nodes));
    expect(typeof md).toBe("string");
    expect(md.length).toBeGreaterThan(0);
  });

  it("Test 7: InlineRun 行内样式：bold/italic/code 正确包裹", () => {
    const para: ParagraphNode = {
      kind: "paragraph",
      runs: [
        { text: "a", bold: true },
        { text: "b", italic: true },
        { text: "c", code: true },
      ],
      locator: emptyLocator,
    };
    const md = renderIrToMarkdown(makeIR([para]));
    expect(md).toContain("**a**");
    expect(md).toContain("*b*");
    expect(md).toContain("`c`");
  });

  it("Test 8: 表格单元格中的 | 字符被转义", () => {
    const table: TableNode = {
      kind: "table",
      rows: [[[{ text: "pipe | inside" }]]],
      locator: emptyLocator,
    };
    const md = renderIrToMarkdown(makeIR([table]));
    expect(md).toContain("pipe \\| inside");
  });
});

describe("parser-registry", () => {
  it("registerParser / getParser / listRegisteredFormats 三个函数存在且可用", async () => {
    const {
      registerParser,
      getParser,
      listRegisteredFormats,
      __resetParserRegistryForTests,
    } = await import("../src/main/services/document/parser-registry");

    __resetParserRegistryForTests();
    expect(listRegisteredFormats()).toEqual([]);

    const fake = {
      format: "md" as const,
      async parse() {
        return {} as never;
      },
    };
    registerParser(fake);

    expect(listRegisteredFormats()).toContain("md");
    expect(getParser("md")).toBe(fake);
    expect(getParser("pdf")).toBeNull();

    __resetParserRegistryForTests();
    expect(listRegisteredFormats()).toEqual([]);
  });
});
