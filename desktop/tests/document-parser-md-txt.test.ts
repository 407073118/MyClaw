/**
 * Tests for mdParser + txtParser (Phase 8 Plan 08).
 *
 * Behaviors under test (from plan):
 *   md.1  Basic markdown (heading, paragraph, heading, list) → correct DocumentNode sequence
 *   md.2  Fenced code block → CodeNode with lang preserved
 *   md.3  GFM table → TableNode with header row + data rows
 *   md.4  outline has one entry per heading with locator.heading == heading text
 *   txt.1 Double-newline separated blocks → ParagraphNode per block; single \n stays inside paragraph
 *   txt.2 Empty input → body.length === 0 (not an error)
 */

import { describe, expect, it } from "vitest";
import {
  parseMarkdownBuffer,
  parsePlainTextBuffer,
  mdParser,
  txtParser,
} from "../src/main/services/document/parsers/md-txt-parser";
import type {
  CodeNode,
  HeadingNode,
  ListNode,
  ParagraphNode,
  TableNode,
} from "@shared/contracts";

function makeInput(text: string, path: string, format: "md" | "txt") {
  const buffer = Buffer.from(text, "utf8");
  return {
    path,
    buffer,
    sha256: "0".repeat(64),
    mediaDir: "/tmp/unused",
  };
}

describe("mdParser (Phase 8 Plan 08)", () => {
  it("Test md.1: basic markdown parses to heading/paragraph/heading/list", async () => {
    const src = "# Title\n\nbody\n\n## Sub\n\n- a\n- b";
    const ir = await parseMarkdownBuffer(makeInput(src, "/fixtures/a.md", "md"));

    expect(ir.source.format).toBe("md");
    expect(ir.body.length).toBe(4);

    const h1 = ir.body[0] as HeadingNode;
    expect(h1.kind).toBe("heading");
    expect(h1.level).toBe(1);
    expect(h1.runs[0].text).toBe("Title");
    expect(h1.locator.heading).toBe("Title");

    const p = ir.body[1] as ParagraphNode;
    expect(p.kind).toBe("paragraph");
    expect(p.runs[0].text).toBe("body");
    expect(p.locator.heading).toBe("Title");

    const h2 = ir.body[2] as HeadingNode;
    expect(h2.kind).toBe("heading");
    expect(h2.level).toBe(2);
    expect(h2.runs[0].text).toBe("Sub");

    const list = ir.body[3] as ListNode;
    expect(list.kind).toBe("list");
    expect(list.ordered).toBe(false);
    expect(list.items.length).toBe(2);
    expect(list.items[0][0].text).toBe("a");
    expect(list.items[1][0].text).toBe("b");
    expect(list.locator.heading).toBe("Sub");
  });

  it("Test md.2: fenced code block preserves language", async () => {
    const src = "```ts\nconst x = 1;\n```\n";
    const ir = await parseMarkdownBuffer(makeInput(src, "/fixtures/b.md", "md"));
    expect(ir.body.length).toBe(1);
    const code = ir.body[0] as CodeNode;
    expect(code.kind).toBe("code");
    expect(code.lang).toBe("ts");
    expect(code.text).toContain("const x = 1;");
  });

  it("Test md.3: GFM table parses to TableNode with header + body rows", async () => {
    const src = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    const ir = await parseMarkdownBuffer(makeInput(src, "/fixtures/c.md", "md"));
    expect(ir.body.length).toBe(1);
    const table = ir.body[0] as TableNode;
    expect(table.kind).toBe("table");
    // First row = header, second row = data
    expect(table.rows.length).toBe(2);
    expect(table.rows[0][0][0].text).toBe("a");
    expect(table.rows[0][1][0].text).toBe("b");
    expect(table.rows[1][0][0].text).toBe("1");
    expect(table.rows[1][1][0].text).toBe("2");
  });

  it("Test md.4: outline has one entry per heading with locator.heading set", async () => {
    const src = "# One\n\ntext\n\n## Two\n\n### Three\n\nmore\n";
    const ir = await parseMarkdownBuffer(makeInput(src, "/fixtures/d.md", "md"));
    expect(ir.outline.length).toBe(3);
    expect(ir.outline.map((o) => o.level)).toEqual([1, 2, 3]);
    expect(ir.outline.map((o) => o.title)).toEqual(["One", "Two", "Three"]);
    expect(ir.outline.map((o) => o.locator.heading)).toEqual(["One", "Two", "Three"]);
  });

  it("Test md.bonus: mdParser exposes DocumentParser shape", () => {
    expect(mdParser.format).toBe("md");
    expect(typeof mdParser.parse).toBe("function");
  });
});

describe("txtParser (Phase 8 Plan 08)", () => {
  it("Test txt.1: blank-line separated blocks → 3 paragraphs; single \\n stays inside one", async () => {
    const src = "a\nsecond\n\nb\n\nc\n";
    const ir = await parsePlainTextBuffer(makeInput(src, "/fixtures/a.txt", "txt"));
    expect(ir.source.format).toBe("txt");
    expect(ir.body.length).toBe(3);
    const p0 = ir.body[0] as ParagraphNode;
    expect(p0.kind).toBe("paragraph");
    // Single newline preserved within the paragraph text
    expect(p0.runs[0].text).toContain("a");
    expect(p0.runs[0].text).toContain("second");
    expect((ir.body[1] as ParagraphNode).runs[0].text).toBe("b");
    expect((ir.body[2] as ParagraphNode).runs[0].text).toBe("c");
  });

  it("Test txt.2: empty input → body.length === 0 (not an error)", async () => {
    const ir = await parsePlainTextBuffer(makeInput("", "/fixtures/empty.txt", "txt"));
    expect(ir.body.length).toBe(0);
    expect(ir.outline.length).toBe(0);
    expect(ir.source.format).toBe("txt");
  });

  it("Test txt.bonus: UTF-8 BOM is stripped from paragraph text", async () => {
    const bom = "﻿";
    const ir = await parsePlainTextBuffer(makeInput(bom + "hello\n\nworld", "/fixtures/bom.txt", "txt"));
    expect(ir.body.length).toBe(2);
    const p0 = ir.body[0] as ParagraphNode;
    expect(p0.runs[0].text).toBe("hello");
    expect(p0.runs[0].text.startsWith("﻿")).toBe(false);
  });

  it("Test txt.bonus2: txtParser exposes DocumentParser shape", () => {
    expect(txtParser.format).toBe("txt");
    expect(typeof txtParser.parse).toBe("function");
  });
});
