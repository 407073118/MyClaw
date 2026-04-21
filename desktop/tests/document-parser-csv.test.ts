/**
 * Tests for csvParser (Phase 8 Plan 08 Task 2).
 *
 * Behaviors:
 *   1. Basic comma CSV → SheetNode(name=csv, dims=3x3) with TableNode of 3 rows × 3 cols
 *   2. Tab-delimited input auto-detects \t
 *   3. UTF-8 BOM stripped before parsing (first cell does NOT start with ﻿)
 *   4. Quoted fields containing delimiter: "a,b",c → two cells ["a,b", "c"]
 *   5. detectDelimiter picks ";" for semicolon data, "|" for pipe data
 *   6. Escaped double-quote: "he said ""hi""" round-trips to he said "hi"
 */

import { describe, expect, it } from "vitest";
import {
  csvParser,
  detectDelimiter,
  parseCsvBuffer,
  parseCsvText,
} from "../src/main/services/document/parsers/csv-parser";
import type { SheetNode } from "@shared/contracts";

function makeInput(text: string, path = "/fixtures/a.csv") {
  const buffer = Buffer.from(text, "utf8");
  return {
    path,
    buffer,
    sha256: "0".repeat(64),
    mediaDir: "/tmp/unused",
  };
}

describe("csvParser (Phase 8 Plan 08 Task 2)", () => {
  it("Test 1: basic comma CSV → SheetNode with 3x3 TableNode", async () => {
    const src = "a,b,c\n1,2,3\n4,5,6\n";
    const ir = await parseCsvBuffer(makeInput(src));
    expect(ir.source.format).toBe("csv");
    expect(ir.body.length).toBe(1);
    const sheet = ir.body[0] as SheetNode;
    expect(sheet.kind).toBe("sheet");
    expect(sheet.name).toBe("csv");
    expect(sheet.dims.rows).toBe(3);
    expect(sheet.dims.cols).toBe(3);
    expect(sheet.table.rows.length).toBe(3);
    expect(sheet.table.rows[0][0][0].text).toBe("a");
    expect(sheet.table.rows[0][1][0].text).toBe("b");
    expect(sheet.table.rows[0][2][0].text).toBe("c");
    expect(sheet.table.rows[2][0][0].text).toBe("4");
    expect(sheet.table.rows[2][2][0].text).toBe("6");
  });

  it("Test 2: tab-delimited input auto-detected", async () => {
    const src = "a\tb\n1\t2\n";
    const ir = await parseCsvBuffer(makeInput(src));
    const sheet = ir.body[0] as SheetNode;
    expect(sheet.dims.rows).toBe(2);
    expect(sheet.dims.cols).toBe(2);
    expect(sheet.table.rows[0][0][0].text).toBe("a");
    expect(sheet.table.rows[0][1][0].text).toBe("b");
    expect(sheet.table.rows[1][0][0].text).toBe("1");
    expect(sheet.table.rows[1][1][0].text).toBe("2");
  });

  it("Test 3: UTF-8 BOM is stripped before parsing", async () => {
    const BOM = "﻿";
    const src = BOM + "a,b\n1,2\n";
    const ir = await parseCsvBuffer(makeInput(src));
    const sheet = ir.body[0] as SheetNode;
    // first cell must be plain "a", not BOM + "a"
    expect(sheet.table.rows[0][0][0].text).toBe("a");
    expect(sheet.table.rows[0][0][0].text.startsWith(BOM)).toBe(false);
  });

  it("Test 4: quoted field containing delimiter → single cell", async () => {
    const src = '"a,b",c\n';
    const rows = parseCsvText(src, ",");
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual(["a,b", "c"]);

    const ir = await parseCsvBuffer(makeInput(src));
    const sheet = ir.body[0] as SheetNode;
    expect(sheet.table.rows[0][0][0].text).toBe("a,b");
    expect(sheet.table.rows[0][1][0].text).toBe("c");
  });

  it("Test 5: detectDelimiter picks ';' and '|' correctly", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a|b\n1|2")).toBe("|");
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("x\ty\n1\t2")).toBe("\t");
  });

  it("Test 6: escaped double-quote inside quoted field round-trips", async () => {
    const src = '"he said ""hi"""\n';
    const rows = parseCsvText(src, ",");
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual(['he said "hi"']);
  });

  it("Test bonus: outline has one entry for the sheet", async () => {
    const ir = await parseCsvBuffer(makeInput("a,b\n1,2\n"));
    expect(ir.outline.length).toBe(1);
    expect(ir.outline[0].title).toBe("csv");
    expect(ir.outline[0].locator.sheet).toBe("csv");
  });

  it("Test bonus: csvParser is a DocumentParser for format csv", () => {
    expect(csvParser.format).toBe("csv");
    expect(typeof csvParser.parse).toBe("function");
  });
});
