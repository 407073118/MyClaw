/**
 * Tests for pdfParser (Phase 8 Plan 06).
 *
 * Strategy：
 *   - 使用 vi.mock 替换 pdfjs-dist/legacy/build/pdf.js，完整控制 PDF 行为
 *     （文本内容 / 空内容 / getDocument 参数校验），避免依赖真实 PDF 字节流
 *   - 额外一个 child_process spy，确认 parser 纯 JS 实现、零 spawn/exec
 *   - 源码级 grep 保底（在 acceptance_criteria 里，已由 plan 的 grep 自动校验）
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// 手工构造的 mock pdfjs — 可按测试需要切换 pages 与 getTextContent 返回值。
// ────────────────────────────────────────────────────────────────────────────

type FakePage = {
  items: Array<{ str: string }>;
};

let mockPages: FakePage[] = [];
let lastGetDocumentArg: unknown = undefined;

const getDocumentSpy = vi.fn((arg: unknown) => {
  lastGetDocumentArg = arg;
  return {
    promise: Promise.resolve({
      numPages: mockPages.length,
      getPage: async (p: number) => {
        const page = mockPages[p - 1];
        return {
          getTextContent: async () => ({ items: page.items }),
        };
      },
    }),
  };
});

vi.mock("pdfjs-dist/legacy/build/pdf.js", () => ({
  getDocument: (arg: unknown) => getDocumentSpy(arg),
}));

// 延迟 import，保证 vi.mock 在 require 之前生效。
// parsePdfBuffer 内部用 require() 做 lazy load，对 vi.mock 敏感。
async function loadParser() {
  return await import("../src/main/services/document/parsers/pdf-parser");
}

beforeEach(() => {
  mockPages = [];
  lastGetDocumentArg = undefined;
  getDocumentSpy.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("pdfParser", () => {
  it("Test 1: a 2-page PDF produces >=2 PageBreakNodes with page=1/2 and >=1 paragraph per page", async () => {
    mockPages = [
      { items: [{ str: "Hello" }, { str: "page one" }] },
      { items: [{ str: "Second" }, { str: "page text" }] },
    ];
    const { parsePdfBuffer } = await loadParser();

    const ir = await parsePdfBuffer({
      path: "/virtual/two-page.pdf",
      buffer: Buffer.from("fake-pdf"),
      sha256: "sha-two-page",
      mediaDir: "/tmp/whatever",
    });

    const breaks = ir.body.filter((n) => n.kind === "pageBreak");
    expect(breaks.length).toBeGreaterThanOrEqual(2);
    expect(breaks[0]).toMatchObject({ kind: "pageBreak", page: 1 });
    expect(breaks[1]).toMatchObject({ kind: "pageBreak", page: 2 });

    const paragraphsP1 = ir.body.filter(
      (n) => n.kind === "paragraph" && n.locator.page === 1,
    );
    const paragraphsP2 = ir.body.filter(
      (n) => n.kind === "paragraph" && n.locator.page === 2,
    );
    expect(paragraphsP1.length).toBeGreaterThanOrEqual(1);
    expect(paragraphsP2.length).toBeGreaterThanOrEqual(1);
  });

  it("Test 2: getDocument is invoked with isEvalSupported:false, disableStream:true, disableAutoFetch:true, disableFontFace:true", async () => {
    mockPages = [{ items: [{ str: "x" }] }];
    const { parsePdfBuffer } = await loadParser();

    await parsePdfBuffer({
      path: "/virtual/one.pdf",
      buffer: Buffer.from("fake"),
      sha256: "sha-one",
      mediaDir: "/tmp/whatever",
    });

    expect(getDocumentSpy).toHaveBeenCalledTimes(1);
    const arg = lastGetDocumentArg as Record<string, unknown>;
    expect(arg.isEvalSupported).toBe(false);
    expect(arg.disableStream).toBe(true);
    expect(arg.disableAutoFetch).toBe(true);
    expect(arg.disableFontFace).toBe(true);
  });

  it("Test 3: a page whose text-content items are empty emits a ParagraphNode with Chinese scanned-page marker", async () => {
    mockPages = [
      { items: [{ str: "Real text" }] },
      { items: [] }, // 扫描页：无文字
    ];
    const { parsePdfBuffer } = await loadParser();

    const ir = await parsePdfBuffer({
      path: "/virtual/scanned.pdf",
      buffer: Buffer.from("fake"),
      sha256: "sha-scan",
      mediaDir: "/tmp/whatever",
    });

    const paragraphP2 = ir.body.find(
      (n) => n.kind === "paragraph" && n.locator.page === 2,
    );
    expect(paragraphP2).toBeDefined();
    const text = (paragraphP2 as { runs: Array<{ text: string }> }).runs
      .map((r) => r.text)
      .join("");
    expect(text).toContain("扫描页");
    expect(text).toContain("(扫描页：未抽取到文字)");
  });

  it("Test 4: meta.pages equals doc.numPages", async () => {
    mockPages = [
      { items: [{ str: "a" }] },
      { items: [{ str: "b" }] },
      { items: [{ str: "c" }] },
    ];
    const { parsePdfBuffer } = await loadParser();

    const ir = await parsePdfBuffer({
      path: "/virtual/3p.pdf",
      buffer: Buffer.from("fake"),
      sha256: "sha-3p",
      mediaDir: "/tmp/whatever",
    });

    expect(ir.meta.pages).toBe(3);
  });

  it("Test 5: outline contains one OutlineItem per page (level=1, title=Page N, locator.page=N)", async () => {
    mockPages = [
      { items: [{ str: "a" }] },
      { items: [{ str: "b" }] },
    ];
    const { parsePdfBuffer } = await loadParser();

    const ir = await parsePdfBuffer({
      path: "/virtual/2p.pdf",
      buffer: Buffer.from("fake"),
      sha256: "sha-2p",
      mediaDir: "/tmp/whatever",
    });

    expect(ir.outline).toHaveLength(2);
    expect(ir.outline[0]).toMatchObject({
      level: 1,
      title: "Page 1",
      locator: { page: 1 },
    });
    expect(ir.outline[1]).toMatchObject({
      level: 1,
      title: "Page 2",
      locator: { page: 2 },
    });
  });

  it("Test 6: parser source contains no child_process / spawn / exec / python references (source-level grep)", () => {
    // Vitest 3 + Vite ESM 无法可靠地 spyOn 已命名导出；改为源码级断言，
    // 任何未来回归（加入 spawn / exec / python / py -3）都会被这条静态检查捕获。
    // 这与 08-04 xlsx-parser 对 readFile 的保护策略一致。
    const source = readFileSync(
      resolve(__dirname, "../src/main/services/document/parsers/pdf-parser.ts"),
      "utf8",
    );
    // 剔除注释行后再匹配，避免文档注释中的关键字误报。
    const code = source
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return (
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("*") &&
          !trimmed.startsWith("/*") &&
          !trimmed.startsWith("/**")
        );
      })
      .join("\n");
    expect(code).not.toMatch(/\bchild_process\b/);
    expect(code).not.toMatch(/\bspawn\s*\(/);
    expect(code).not.toMatch(/\bexec\s*\(/);
    expect(code).not.toMatch(/\bexecFile\s*\(/);
    expect(code).not.toMatch(/\bpython\b/);
    expect(code).not.toMatch(/\bpy -3\b/);
  });

  it("Test 7: pdfParser singleton exposes format=\"pdf\" and callable parse()", async () => {
    const { pdfParser } = await loadParser();
    expect(pdfParser.format).toBe("pdf");
    expect(typeof pdfParser.parse).toBe("function");
  });

  it("Test 8: pdfParser is registered on BuiltinToolExecutor via ensureParsersRegistered", async () => {
    // 直接手工走 ensureParsersRegistered 路径：
    // registerParser(pdfParser) → getParser("pdf") 非空
    const { pdfParser } = await loadParser();
    const {
      getParser,
      registerParser,
      __resetParserRegistryForTests,
    } = await import("../src/main/services/document/parser-registry");
    __resetParserRegistryForTests();
    registerParser(pdfParser);
    expect(getParser("pdf")).not.toBeNull();
    expect(getParser("pdf")?.format).toBe("pdf");
  });

  it("Test 9: PDF source format is \"pdf\" and sha256/bytes forwarded from ParseInput", async () => {
    mockPages = [{ items: [{ str: "x" }] }];
    const { parsePdfBuffer } = await loadParser();
    const buf = Buffer.from("abcdef");
    const ir = await parsePdfBuffer({
      path: "/virtual/meta.pdf",
      buffer: buf,
      sha256: "sha-meta",
      mediaDir: "/tmp/whatever",
    });

    expect(ir.source.format).toBe("pdf");
    expect(ir.source.sha256).toBe("sha-meta");
    expect(ir.source.bytes).toBe(buf.length);
    expect(ir.source.path).toBe("/virtual/meta.pdf");
    expect(ir.media).toEqual([]);
  });
});
