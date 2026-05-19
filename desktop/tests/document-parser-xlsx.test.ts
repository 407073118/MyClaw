/**
 * Tests for xlsxParser (Phase 8 Plan 04 Task 1).
 *
 * Covers:
 *   1. Multi-sheet workbook produces body with one SheetNode per sheet, correct name/dims.
 *   2. Empty cells are represented as empty-string runs.
 *   3. Merged cells: anchor value expands into every covered cell.
 *   4. source.format derived from extension; sha256/bytes propagated from ParseInput.
 *   5. meta.pages undefined; outline has one item per sheet (level=1, locator.sheet).
 *   6. Parser consumes buffer only — never touches the filesystem via readFile/readFileSync.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";

import { parseXlsxBuffer, xlsxParser, xlsParser, xlsmParser } from "../src/main/services/document/parsers/xlsx-parser";
import type { SheetNode } from "@shared/contracts";

// We use the same xlsx package that the parser uses internally, just to author fixtures.
const XLSX = require("xlsx") as typeof import("xlsx");

/** Build an xlsx buffer with the given sheets. Optionally attach !merges on a specific sheet. */
function makeWorkbookBuffer(opts: {
  sheets: Array<{ name: string; aoa: unknown[][]; merges?: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> }>;
}): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of opts.sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(s.aoa as any[][]);
    if (s.merges) {
      (sheet as any)["!merges"] = s.merges;
    }
    XLSX.utils.book_append_sheet(wb, sheet, s.name);
  }
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

describe("xlsxParser", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("Test 1: 2-sheet workbook parses to IR with one SheetNode per sheet, correct name and dims", async () => {
    const buffer = makeWorkbookBuffer({
      sheets: [
        { name: "Sheet1", aoa: [["h1", "h2"], ["a", "b"], ["c", "d"]] },
        { name: "Sheet2", aoa: [["x"], ["y"], ["z"]] },
      ],
    });
    const ir = await parseXlsxBuffer({
      path: "/virtual/two.xlsx",
      buffer,
      sha256: "abc123",
      mediaDir: "/virtual/media",
    });
    expect(ir.body).toHaveLength(2);
    const s1 = ir.body[0] as SheetNode;
    const s2 = ir.body[1] as SheetNode;
    expect(s1.kind).toBe("sheet");
    expect(s1.name).toBe("Sheet1");
    expect(s1.dims).toEqual({ rows: 3, cols: 2 });
    expect(s2.kind).toBe("sheet");
    expect(s2.name).toBe("Sheet2");
    expect(s2.dims).toEqual({ rows: 3, cols: 1 });
  });

  it("Test 2: empty cells are represented as empty-string runs", async () => {
    const buffer = makeWorkbookBuffer({
      sheets: [{ name: "S", aoa: [["a", "b", "c"], ["x", "", "z"]] }],
    });
    const ir = await parseXlsxBuffer({
      path: "/virtual/empty.xlsx",
      buffer,
      sha256: "sha",
      mediaDir: "/virtual/media",
    });
    const sheet = ir.body[0] as SheetNode;
    // second row, middle cell is empty string
    expect(sheet.table.rows[1][1]).toEqual([{ text: "" }]);
  });

  it("Test 3: merged cells — anchor value appears in all covered cells", async () => {
    // A1:B1 merged with "Q1" anchor, second row has distinct a/b values.
    const buffer = makeWorkbookBuffer({
      sheets: [
        {
          name: "Merged",
          aoa: [["Q1", ""], ["a", "b"]],
          merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }],
        },
      ],
    });
    const ir = await parseXlsxBuffer({
      path: "/virtual/merged.xlsx",
      buffer,
      sha256: "sha",
      mediaDir: "/virtual/media",
    });
    const sheet = ir.body[0] as SheetNode;
    // Both A1 and B1 should hold "Q1" after merge expansion.
    expect(sheet.table.rows[0][0]).toEqual([{ text: "Q1" }]);
    expect(sheet.table.rows[0][1]).toEqual([{ text: "Q1" }]);
    // Row 2 left untouched.
    expect(sheet.table.rows[1][0]).toEqual([{ text: "a" }]);
    expect(sheet.table.rows[1][1]).toEqual([{ text: "b" }]);
  });

  it("Test 4: source.format from extname; sha256 and bytes forwarded", async () => {
    const buffer = makeWorkbookBuffer({ sheets: [{ name: "S", aoa: [["a"]] }] });
    const ir = await parseXlsxBuffer({
      path: "/virtual/workbook.xlsx",
      buffer,
      sha256: "deadbeef",
      mediaDir: "/virtual/media",
    });
    expect(ir.source.format).toBe("xlsx");
    expect(ir.source.sha256).toBe("deadbeef");
    expect(ir.source.bytes).toBe(buffer.length);
    expect(ir.source.path).toBe("/virtual/workbook.xlsx");

    const ir2 = await parseXlsxBuffer({
      path: "/virtual/workbook.xls",
      buffer,
      sha256: "s",
      mediaDir: "/virtual/media",
    });
    expect(ir2.source.format).toBe("xls");

    const ir3 = await parseXlsxBuffer({
      path: "/virtual/workbook.xlsm",
      buffer,
      sha256: "s",
      mediaDir: "/virtual/media",
    });
    expect(ir3.source.format).toBe("xlsm");
  });

  it("Test 5: meta.pages undefined for xlsx; outline has one item per sheet with locator.sheet", async () => {
    const buffer = makeWorkbookBuffer({
      sheets: [
        { name: "Alpha", aoa: [["a"]] },
        { name: "Beta", aoa: [["b"]] },
      ],
    });
    const ir = await parseXlsxBuffer({
      path: "/virtual/x.xlsx",
      buffer,
      sha256: "s",
      mediaDir: "/virtual/media",
    });
    expect(ir.meta.pages).toBeUndefined();
    expect(ir.outline).toHaveLength(2);
    expect(ir.outline[0]).toEqual({ level: 1, title: "Alpha", locator: { sheet: "Alpha" } });
    expect(ir.outline[1]).toEqual({ level: 1, title: "Beta", locator: { sheet: "Beta" } });
  });

  it("Test 6: parser does NOT open the file path — buffer is the only source", async () => {
    // Strategy: hand the parser a path that does not exist on disk. If the parser
    // ever touched fs (readFile/readFileSync), it would raise ENOENT. Since it
    // consumes ParseInput.buffer exclusively, the parse must succeed.
    const nonexistentPath = "/absolutely/does/not/exist/on/disk.xlsx";
    const buffer = makeWorkbookBuffer({ sheets: [{ name: "S", aoa: [["a", "b"]] }] });

    // Source-level guard: parser file contains no readFile* calls. Cross-check the
    // file's static source, then execute the parser to confirm runtime behavior.
    const parserSource = readFileSync(
      new URL("../src/main/services/document/parsers/xlsx-parser.ts", import.meta.url),
      "utf-8",
    );
    expect(parserSource).not.toMatch(/readFile(Sync)?\s*\(/);

    const ir = await parseXlsxBuffer({
      path: nonexistentPath,
      buffer,
      sha256: "s",
      mediaDir: "/virtual/media",
    });
    expect(ir.source.path).toBe(nonexistentPath);
    expect(ir.body).toHaveLength(1);
  });

  it("Test 7: parsers export: xlsxParser / xlsParser / xlsmParser with correct format tags", () => {
    expect(xlsxParser.format).toBe("xlsx");
    expect(xlsParser.format).toBe("xls");
    expect(xlsmParser.format).toBe("xlsm");
    expect(typeof xlsxParser.parse).toBe("function");
    expect(typeof xlsParser.parse).toBe("function");
    expect(typeof xlsmParser.parse).toBe("function");
  });
});
