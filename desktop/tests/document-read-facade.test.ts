/**
 * document.read facade — 10 个场景覆盖 stats / outline / read / search + 所有错误分支。
 *
 * 每个用例都自己注册 fake parser，避免依赖 Wave 3 真实解析器。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync, truncateSync, openSync, closeSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import type { DocumentIR } from "@shared/contracts";
import {
  __resetParserRegistryForTests,
  registerParser,
} from "../src/main/services/document/parser-registry";
import { createDocCache } from "../src/main/services/document/doc-cache";
import {
  DOC_DEFAULT_MAX_CHARS,
  DOC_MAX_BYTES,
  DOC_MAX_CHARS_HARD_CAP,
  detectFormat,
  executeDocumentRead,
} from "../src/main/services/document/document-read-facade";

/** 构造一个包含常见节点的 fake md IR。 */
function makeFakeMdIr(path: string, bytes: number, sha256: string): DocumentIR {
  return {
    source: { path, format: "md", bytes, sha256 },
    meta: { title: "Test Doc", author: "tester", pages: 1, words: 42 },
    outline: [
      { level: 1, title: "Intro", locator: { heading: "Intro" } },
      { level: 2, title: "Details", locator: { heading: "Details" } },
      { level: 1, title: "Outro", locator: { heading: "Outro" } },
    ],
    body: [
      {
        kind: "heading",
        level: 1,
        runs: [{ text: "Intro" }],
        locator: { heading: "Intro" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "hello world from intro" }],
        locator: { heading: "Intro" },
      },
      {
        kind: "heading",
        level: 2,
        runs: [{ text: "Details" }],
        locator: { heading: "Details" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "a detail paragraph mentioning hello as well" }],
        locator: { heading: "Details" },
      },
      {
        kind: "heading",
        level: 1,
        runs: [{ text: "Outro" }],
        locator: { heading: "Outro" },
      },
      {
        kind: "paragraph",
        runs: [{ text: "final paragraph, goodbye" }],
        locator: { heading: "Outro" },
      },
    ],
    media: [],
  };
}

describe("document-read-facade", () => {
  let tmpRoot = "";
  let filePath = "";
  let fileBuffer: Buffer;
  let fileSha: string;

  beforeEach(async () => {
    __resetParserRegistryForTests();
    tmpRoot = mkdtempSync(join(tmpdir(), "myclaw-docread-"));
    filePath = join(tmpRoot, "fixture.md");
    const content = "# Intro\n\nhello world\n\n## Details\n\nhello again\n";
    await writeFile(filePath, content, "utf-8");
    fileBuffer = Buffer.from(content, "utf-8");
    fileSha = createHash("sha256").update(fileBuffer).digest("hex");
  });

  afterEach(() => {
    if (tmpRoot && existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
    __resetParserRegistryForTests();
    vi.restoreAllMocks();
  });

  it("exports documented constants (50MB, 32000 hard cap, 8000 default)", () => {
    expect(DOC_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(DOC_MAX_CHARS_HARD_CAP).toBe(32000);
    expect(DOC_DEFAULT_MAX_CHARS).toBe(8000);
  });

  it("detectFormat maps known extensions and returns null for legacy .doc", () => {
    expect(detectFormat("a.md")).toBe("md");
    expect(detectFormat("a.MD")).toBe("md");
    expect(detectFormat("a.xlsx")).toBe("xlsx");
    expect(detectFormat("a.docx")).toBe("docx");
    expect(detectFormat("a.pdf")).toBe("pdf");
    expect(detectFormat("a.pptx")).toBe("pptx");
    expect(detectFormat("a.csv")).toBe("csv");
    expect(detectFormat("a.json")).toBe("json");
    expect(detectFormat("a.txt")).toBe("txt");
    expect(detectFormat("a.doc")).toBeNull();
    expect(detectFormat("a.bin")).toBeNull();
  });

  it("Test JSON: mode=read with locator.pointer returns the selected JSON subtree", async () => {
    const jsonPath = join(tmpRoot, "package.json");
    const jsonContent = JSON.stringify({
      scripts: { build: "vite build", test: "vitest run" },
      dependencies: { react: "18.3.1" },
    }, null, 2);
    await writeFile(jsonPath, jsonContent, "utf-8");
    registerParser({
      format: "json",
      parse: async (input) => {
        const { parseJsonBuffer } = await import("../src/main/services/document/parsers/json-parser");
        return parseJsonBuffer(input);
      },
    });
    const cache = createDocCache({ rootDir: join(tmpRoot, "json-cache") });

    const res = await executeDocumentRead(
      { path: jsonPath, mode: "read", locator: { pointer: "/scripts" }, maxChars: 2000 },
      { cache, resolvedPath: jsonPath },
    );

    expect(res.success).toBe(true);
    expect(res.output).toContain("```json");
    expect(res.output).toContain("\"build\": \"vite build\"");
    expect(res.output).toContain("\"test\": \"vitest run\"");
    expect(res.output).not.toContain("\"react\"");
  });

  it("Test 1: mode=stats returns JSON with meta/outlineCount/bodyCount/format/bytes/sha256", async () => {
    registerParser({
      format: "md",
      parse: async (input) => makeFakeMdIr(input.path, fileBuffer.length, input.sha256),
    });
    const cache = createDocCache({ rootDir: tmpRoot });
    const res = await executeDocumentRead(
      { path: filePath, mode: "stats" },
      { cache, resolvedPath: filePath },
    );
    expect(res.success).toBe(true);
    const parsed = JSON.parse(res.output);
    expect(parsed.format).toBe("md");
    expect(parsed.bytes).toBe(fileBuffer.length);
    expect(parsed.sha256).toBe(fileSha);
    expect(parsed.outlineCount).toBe(3);
    expect(parsed.bodyCount).toBe(6);
    expect(parsed.meta.title).toBe("Test Doc");
  });

  it("Test 2: mode=outline renders markdown list with locator suffixes", async () => {
    registerParser({
      format: "md",
      parse: async (input) => makeFakeMdIr(input.path, fileBuffer.length, input.sha256),
    });
    const cache = createDocCache({ rootDir: tmpRoot });
    const res = await executeDocumentRead(
      { path: filePath, mode: "outline" },
      { cache, resolvedPath: filePath },
    );
    expect(res.success).toBe(true);
    expect(res.output).toContain("- Lv1: Intro");
    expect(res.output).toContain("- Lv2: Details");
    expect(res.output).toContain("- Lv1: Outro");
    expect(res.output).toContain("heading=Intro");
  });

  it("Test 3: mode=read with locator heading slices body until next same-or-higher heading", async () => {
    registerParser({
      format: "md",
      parse: async (input) => makeFakeMdIr(input.path, fileBuffer.length, input.sha256),
    });
    const cache = createDocCache({ rootDir: tmpRoot });
    const res = await executeDocumentRead(
      { path: filePath, mode: "read", locator: { heading: "Intro" } },
      { cache, resolvedPath: filePath },
    );
    expect(res.success).toBe(true);
    // Intro section should include Intro heading, intro paragraph, Details subheading,
    // and Details paragraph. Should NOT include the next Lv1 heading "Outro" nor its body.
    expect(res.output).toContain("# Intro");
    expect(res.output).toContain("hello world from intro");
    expect(res.output).toContain("## Details");
    expect(res.output).toContain("a detail paragraph");
    expect(res.output).not.toContain("Outro");
    expect(res.output).not.toContain("final paragraph");
  });

  it("Test 4: mode=read with no locator renders full body (respecting maxChars default 8000)", async () => {
    registerParser({
      format: "md",
      parse: async (input) => makeFakeMdIr(input.path, fileBuffer.length, input.sha256),
    });
    const cache = createDocCache({ rootDir: tmpRoot });
    const res = await executeDocumentRead(
      { path: filePath, mode: "read" },
      { cache, resolvedPath: filePath },
    );
    expect(res.success).toBe(true);
    expect(res.output).toContain("# Intro");
    expect(res.output).toContain("## Details");
    expect(res.output).toContain("# Outro");
    expect(res.output).toContain("final paragraph, goodbye");
    expect(res.output.length).toBeLessThanOrEqual(DOC_MAX_CHARS_HARD_CAP + 64);
  });

  it("Test 5: mode=search returns matched paragraphs with locator prefix", async () => {
    registerParser({
      format: "md",
      parse: async (input) => makeFakeMdIr(input.path, fileBuffer.length, input.sha256),
    });
    const cache = createDocCache({ rootDir: tmpRoot });
    const res = await executeDocumentRead(
      { path: filePath, mode: "search", query: "hello" },
      { cache, resolvedPath: filePath },
    );
    expect(res.success).toBe(true);
    // Both "hello world from intro" and "hello as well" should match.
    expect(res.output).toContain("hello world from intro");
    expect(res.output).toContain("hello as well");
    expect(res.output).toMatch(/heading=Intro|heading=Details/);
  });

  it("Test 6: file size > 50MB returns [E_DOC_TOO_LARGE] with mode=stats hint", async () => {
    registerParser({
      format: "md",
      parse: async (input) => makeFakeMdIr(input.path, fileBuffer.length, input.sha256),
    });
    const bigPath = join(tmpRoot, "big.md");
    const fd = openSync(bigPath, "w");
    closeSync(fd);
    // Create a sparse 51MB file.
    truncateSync(bigPath, 51 * 1024 * 1024);
    const cache = createDocCache({ rootDir: tmpRoot });
    const res = await executeDocumentRead(
      { path: bigPath, mode: "read" },
      { cache, resolvedPath: bigPath },
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("[E_DOC_TOO_LARGE]");
    expect(res.error).toContain("mode=stats");
    expect(res.error).toMatch(/。|\./); // actionable sentence ender
  });

  it("Test 7: maxChars=999999 is clamped to 32000 hard cap", async () => {
    // Build a parser that returns lots of paragraphs.
    registerParser({
      format: "md",
      parse: async (input) => {
        const fake = makeFakeMdIr(input.path, fileBuffer.length, input.sha256);
        // Balloon body to > 32000 chars worth.
        const filler = "x".repeat(200);
        for (let i = 0; i < 300; i++) {
          fake.body.push({
            kind: "paragraph",
            runs: [{ text: `filler-${i}-${filler}` }],
            locator: { heading: "Outro" },
          });
        }
        return fake;
      },
    });
    const cache = createDocCache({ rootDir: tmpRoot });
    const res = await executeDocumentRead(
      { path: filePath, mode: "read", maxChars: 999999 },
      { cache, resolvedPath: filePath },
    );
    expect(res.success).toBe(true);
    // After clamp to 32000 + truncation marker, total length is roughly <= 32000 + 32 chars.
    expect(res.output.length).toBeLessThanOrEqual(DOC_MAX_CHARS_HARD_CAP + 64);
    expect(res.output).toContain("已截断");
  });

  it("Test 8: no registered parser returns [E_DOC_FORMAT_UNSUPPORTED] with format list + hint", async () => {
    // Do NOT register any parser.
    const cache = createDocCache({ rootDir: tmpRoot });
    const res = await executeDocumentRead(
      { path: filePath, mode: "stats" },
      { cache, resolvedPath: filePath },
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("[E_DOC_FORMAT_UNSUPPORTED]");
    // Should mention supported formats.
    expect(res.error).toMatch(/xlsx/);
    expect(res.error).toMatch(/docx/);
    expect(res.error).toMatch(/pdf/);
    expect(res.error).toMatch(/pptx/);
    expect(res.error).toMatch(/请[^。]+。/);
  });

  it("Test 8b: legacy .doc returns [E_DOC_LEGACY_DOC_UNSUPPORTED] with save-as hint", async () => {
    const docPath = join(tmpRoot, "old.doc");
    writeFileSync(docPath, "old word doc bytes", "utf-8");
    const cache = createDocCache({ rootDir: tmpRoot });
    const res = await executeDocumentRead(
      { path: docPath, mode: "stats" },
      { cache, resolvedPath: docPath },
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("[E_DOC_LEGACY_DOC_UNSUPPORTED]");
    expect(res.error).toContain(".docx");
    expect(res.error).toMatch(/请[^。]+。/);
  });

  it("Test 9: successful call emits structured log with sha256 + mode + returnedBytes + path", async () => {
    registerParser({
      format: "md",
      parse: async (input) => makeFakeMdIr(input.path, fileBuffer.length, input.sha256),
    });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const cache = createDocCache({ rootDir: tmpRoot });
    const res = await executeDocumentRead(
      { path: filePath, mode: "stats" },
      { cache, resolvedPath: filePath },
    );
    expect(res.success).toBe(true);
    // Logger writes through console.info with JSON context. Find the line tagged [document-read].
    const matchingCalls = infoSpy.mock.calls
      .map((args) => args.join(" "))
      .filter((line) => line.includes("[document-read]"));
    expect(matchingCalls.length).toBeGreaterThan(0);
    const combined = matchingCalls.join("\n");
    expect(combined).toContain(fileSha);
    expect(combined).toContain("stats");
    expect(combined).toContain("returnedBytes");
  });

  it("Test 10 (ASST-04): every [E_DOC_*] branch returns an actionable sentence ending in 。 or .", async () => {
    const cache = createDocCache({ rootDir: tmpRoot });

    // Branch 1: format unsupported (no parser registered)
    const r1 = await executeDocumentRead(
      { path: filePath, mode: "stats" },
      { cache, resolvedPath: filePath },
    );
    expect(r1.success).toBe(false);
    expect(r1.error).toMatch(/\[E_DOC_FORMAT_UNSUPPORTED\].*(?:。|\.)/);

    // Branch 2: legacy .doc
    const docPath = join(tmpRoot, "x.doc");
    writeFileSync(docPath, "bytes", "utf-8");
    const r2 = await executeDocumentRead(
      { path: docPath, mode: "stats" },
      { cache, resolvedPath: docPath },
    );
    expect(r2.error).toMatch(/\[E_DOC_LEGACY_DOC_UNSUPPORTED\].*(?:。|\.)/);

    // Branch 3: too large
    const bigPath = join(tmpRoot, "huge.md");
    const fd = openSync(bigPath, "w");
    closeSync(fd);
    truncateSync(bigPath, 51 * 1024 * 1024);
    const r3 = await executeDocumentRead(
      { path: bigPath, mode: "read" },
      { cache, resolvedPath: bigPath },
    );
    expect(r3.error).toMatch(/\[E_DOC_TOO_LARGE\].*(?:。|\.)/);

    // Branch 4: parse failed — register a parser that throws.
    __resetParserRegistryForTests();
    registerParser({
      format: "md",
      parse: async () => {
        throw new Error("corrupt zip");
      },
    });
    // fresh cache root to bypass first test's cached ir
    const cache2 = createDocCache({ rootDir: join(tmpRoot, "c2") });
    const r4 = await executeDocumentRead(
      { path: filePath, mode: "stats" },
      { cache: cache2, resolvedPath: filePath },
    );
    expect(r4.error).toMatch(/\[E_DOC_PARSE_FAILED\].*(?:。|\.)/);

    // Branch 5: locator empty
    __resetParserRegistryForTests();
    registerParser({
      format: "md",
      parse: async (input) => makeFakeMdIr(input.path, fileBuffer.length, input.sha256),
    });
    const cache3 = createDocCache({ rootDir: join(tmpRoot, "c3") });
    const r5 = await executeDocumentRead(
      { path: filePath, mode: "read", locator: { heading: "NoSuchHeading" } },
      { cache: cache3, resolvedPath: filePath },
    );
    expect(r5.error).toMatch(/\[E_DOC_LOCATOR_EMPTY\].*(?:。|\.)/);

    // Branch 6: query required for search
    const cache4 = createDocCache({ rootDir: join(tmpRoot, "c4") });
    const r6 = await executeDocumentRead(
      { path: filePath, mode: "search" },
      { cache: cache4, resolvedPath: filePath },
    );
    expect(r6.error).toMatch(/\[E_DOC_QUERY_REQUIRED\].*(?:。|\.)/);
  });
});
