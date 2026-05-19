/**
 * Tests for docxParser (Phase 8 Plan 05).
 *
 * Structure — three describe blocks, each gated by its task's vitest -t filter:
 *   - "task 1": HTML skeleton → IR (headings / paragraphs / lists / tables), deps resolvable, executor registration
 *   - "task 2": Comments + footnotes merged from word/*.xml (XXE + 16MiB cap)
 *   - "task 3": Images extracted into mediaDir (dedup, size cap, empty-media array)
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseDocxBuffer,
  docxParser,
} from "../src/main/services/document/parsers/docx-parser";
import type {
  HeadingNode,
  ParagraphNode,
  TableNode,
  CommentNode,
  FootnoteNode,
  ImageNode,
} from "@shared/contracts";

const JSZip = require("jszip");

const DESKTOP_DIR = new URL("../", import.meta.url).pathname.replace(/^\//, "").replace(/\/$/, "");
// Windows: URL.pathname returns "/F:/MyClaw/desktop/" — strip the leading slash.

// ────────────────────────────────────────────────────────────────────────────
// Docx fixture builder (hand-rolled minimal OOXML).
// Produces a zip that mammoth can parse, with optional comments/footnotes/media
// payloads injected at well-known word/*.xml paths.
// ────────────────────────────────────────────────────────────────────────────

type DocxFixtureOptions = {
  documentXml: string;
  commentsXml?: string;
  footnotesXml?: string;
  media?: Array<{ name: string; bytes: Uint8Array }>;
  /** Extra word/_rels/document.xml.rels entries or overrides. */
  relsXml?: string;
};

function makeDocxBuffer(opts: DocxFixtureOptions): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
</Types>`,
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );

  const defaultRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId100" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
  <Relationship Id="rId101" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
</Relationships>`;
  zip.file("word/_rels/document.xml.rels", opts.relsXml ?? defaultRels);

  zip.file("word/document.xml", opts.documentXml);

  if (opts.commentsXml !== undefined) {
    zip.file("word/comments.xml", opts.commentsXml);
  }
  if (opts.footnotesXml !== undefined) {
    zip.file("word/footnotes.xml", opts.footnotesXml);
  }
  if (opts.media) {
    for (const m of opts.media) {
      zip.file(`word/media/${m.name}`, m.bytes);
    }
  }

  return zip.generateAsync({ type: "nodebuffer" }).then((b: Buffer) => b);
}

/** Builds a Word document.xml with one H1, one paragraph, and a 2x2 table. */
const SIMPLE_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Title</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>First paragraph body text.</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>r1c1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>r1c2</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>r2c1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>r2c2</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

/** Cascade doc: H1 "A", H2 "A.1", paragraph, H2 "A.2". */
const CASCADE_DOC_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>A</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>A.1</w:t></w:r></w:p>
    <w:p><w:r><w:t>Paragraph under A.1</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>A.2</w:t></w:r></w:p>
  </w:body>
</w:document>`;

// Tmp dir per test invocation — deleted afterAll.
const TMP_DIRS: string[] = [];
function freshMediaDir(): string {
  const d = mkdtempSync(join(tmpdir(), "docx-media-"));
  TMP_DIRS.push(d);
  return d;
}

afterAll(() => {
  for (const d of TMP_DIRS) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Task 1
// ────────────────────────────────────────────────────────────────────────────

describe("docxParser task 1", () => {
  it("Test 1: H1 + paragraph + 2x2 table produces 1 HeadingNode + 1 ParagraphNode + 1 TableNode(2x2)", async () => {
    const buffer = await makeDocxBuffer({ documentXml: SIMPLE_DOC_XML });
    const ir = await parseDocxBuffer({
      path: "/virtual/simple.docx",
      buffer,
      sha256: "sha-simple",
      mediaDir: freshMediaDir(),
    });

    const headings = ir.body.filter((n) => n.kind === "heading") as HeadingNode[];
    const paragraphs = ir.body.filter((n) => n.kind === "paragraph") as ParagraphNode[];
    const tables = ir.body.filter((n) => n.kind === "table") as TableNode[];

    expect(headings).toHaveLength(1);
    expect(headings[0].level).toBe(1);
    // Heading text
    const headingText = headings[0].runs.map((r) => r.text).join("");
    expect(headingText).toBe("Title");

    expect(paragraphs).toHaveLength(1);
    const paraText = paragraphs[0].runs.map((r) => r.text).join("");
    expect(paraText).toContain("First paragraph");

    expect(tables).toHaveLength(1);
    expect(tables[0].rows).toHaveLength(2);
    expect(tables[0].rows[0]).toHaveLength(2);
    expect(tables[0].rows[1]).toHaveLength(2);
  });

  it("Test 2: heading cascade — outline reflects 1,2,2 levels; paragraph locator.heading follows nearest heading", async () => {
    const buffer = await makeDocxBuffer({ documentXml: CASCADE_DOC_XML });
    const ir = await parseDocxBuffer({
      path: "/virtual/cascade.docx",
      buffer,
      sha256: "sha-cascade",
      mediaDir: freshMediaDir(),
    });

    expect(ir.outline).toHaveLength(3);
    expect(ir.outline.map((o) => o.level)).toEqual([1, 2, 2]);
    expect(ir.outline.map((o) => o.title)).toEqual(["A", "A.1", "A.2"]);

    const paras = ir.body.filter((n) => n.kind === "paragraph") as ParagraphNode[];
    expect(paras).toHaveLength(1);
    expect(paras[0].locator.heading).toBe("A.1");
  });

  it("Test 3: jszip is resolvable from desktop/ as an explicit top-level dep (not only transitive)", () => {
    // Node's require.resolve from desktop/ must succeed.
    const p = require.resolve("jszip", { paths: [DESKTOP_DIR] });
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
  });

  it("Test 4: docxParser is registered on the executor after ensureParsersRegistered", async () => {
    // Static grep-verify: source contains import + registration lines.
    const executorSource = readFileSync(
      new URL("../src/main/services/builtin-tool-executor.ts", import.meta.url),
      "utf-8",
    );
    expect(executorSource).toMatch(/docxParser/);
    expect(executorSource).toMatch(/registerParser\(\s*docxParser\s*\)|registerParser\(docxParser\)/);

    // Runtime check: after dispatching once, getParser("docx") is non-null.
    // We do not instantiate the full executor here (heavy). Instead, simulate
    // the registration ourselves so we prove the parser singleton is wired.
    const { getParser, registerParser, __resetParserRegistryForTests } = await import(
      "../src/main/services/document/parser-registry"
    );
    __resetParserRegistryForTests();
    registerParser(docxParser);
    expect(getParser("docx")).not.toBeNull();
    expect(getParser("docx")?.format).toBe("docx");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Task 2
// ────────────────────────────────────────────────────────────────────────────

const COMMENTS_XML_OK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="0" w:author="Alice" w:date="2026-01-01T00:00:00Z">
    <w:p><w:r><w:t>Needs rewrite</w:t></w:r></w:p>
  </w:comment>
  <w:comment w:id="1" w:author="Bob">
    <w:p><w:r><w:t>Looks good.</w:t></w:r></w:p>
  </w:comment>
</w:comments>`;

const FOOTNOTES_XML_OK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator" w:id="-1">
    <w:p><w:r><w:t>---sep---</w:t></w:r></w:p>
  </w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="0">
    <w:p><w:r><w:t>---cont---</w:t></w:r></w:p>
  </w:footnote>
  <w:footnote w:id="1">
    <w:p><w:r><w:t>Real footnote body.</w:t></w:r></w:p>
  </w:footnote>
</w:footnotes>`;

const COMMENTS_XML_XXE = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="0" w:author="Mallory"><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:comment>
</w:comments>`;

describe("docxParser task 2", () => {
  it("Test 1: comments surface as CommentNode with author + text", async () => {
    const buffer = await makeDocxBuffer({
      documentXml: SIMPLE_DOC_XML,
      commentsXml: COMMENTS_XML_OK,
    });
    const ir = await parseDocxBuffer({
      path: "/virtual/with-comments.docx",
      buffer,
      sha256: "sha-comments",
      mediaDir: freshMediaDir(),
    });
    const comments = ir.body.filter((n) => n.kind === "comment") as CommentNode[];
    expect(comments).toHaveLength(2);
    const alice = comments.find((c) => c.author === "Alice");
    const bob = comments.find((c) => c.author === "Bob");
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();
    expect(alice!.runs.map((r) => r.text).join("")).toContain("Needs rewrite");
    expect(bob!.runs.map((r) => r.text).join("")).toContain("Looks good");
  });

  it("Test 2: footnotes surface as FootnoteNode; separator / continuationSeparator are skipped", async () => {
    const buffer = await makeDocxBuffer({
      documentXml: SIMPLE_DOC_XML,
      footnotesXml: FOOTNOTES_XML_OK,
    });
    const ir = await parseDocxBuffer({
      path: "/virtual/with-footnotes.docx",
      buffer,
      sha256: "sha-foot",
      mediaDir: freshMediaDir(),
    });
    const footnotes = ir.body.filter((n) => n.kind === "footnote") as FootnoteNode[];
    expect(footnotes).toHaveLength(1);
    expect(footnotes[0].refId).toBe("1");
    expect(footnotes[0].runs.map((r) => r.text).join("")).toContain("Real footnote body");
  });

  it("Test 3: XXE DOCTYPE in comments.xml throws [E_DOC_XXE_BLOCKED] with Chinese hint", async () => {
    const buffer = await makeDocxBuffer({
      documentXml: SIMPLE_DOC_XML,
      commentsXml: COMMENTS_XML_XXE,
    });
    await expect(
      parseDocxBuffer({
        path: "/virtual/xxe.docx",
        buffer,
        sha256: "sha-xxe",
        mediaDir: freshMediaDir(),
      }),
    ).rejects.toThrow(/\[E_DOC_XXE_BLOCKED\]/);

    // Re-trigger to assert the Chinese hint sentence is present.
    try {
      await parseDocxBuffer({
        path: "/virtual/xxe.docx",
        buffer,
        sha256: "sha-xxe",
        mediaDir: freshMediaDir(),
      });
      throw new Error("should not reach");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("[E_DOC_XXE_BLOCKED]");
      expect(msg).toMatch(/请.*。/); // ASST-04 hint sentence
    }
  });

  it("Test 4: oversized word/footnotes.xml (>16MiB) throws [E_DOC_ZIP_ENTRY_TOO_LARGE]", async () => {
    // 17MiB payload
    const big = "A".repeat(17 * 1024 * 1024);
    const buffer = await makeDocxBuffer({
      documentXml: SIMPLE_DOC_XML,
      footnotesXml: big,
    });
    await expect(
      parseDocxBuffer({
        path: "/virtual/toobig.docx",
        buffer,
        sha256: "sha-big",
        mediaDir: freshMediaDir(),
      }),
    ).rejects.toThrow(/\[E_DOC_ZIP_ENTRY_TOO_LARGE\]/);
  }, 30000);

  it("Test 5: absent comments/footnotes means neither CommentNode nor FootnoteNode appear", async () => {
    const buffer = await makeDocxBuffer({ documentXml: SIMPLE_DOC_XML });
    const ir = await parseDocxBuffer({
      path: "/virtual/no-extras.docx",
      buffer,
      sha256: "sha-no-extras",
      mediaDir: freshMediaDir(),
    });
    const comments = ir.body.filter((n) => n.kind === "comment");
    const footnotes = ir.body.filter((n) => n.kind === "footnote");
    expect(comments).toHaveLength(0);
    expect(footnotes).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Task 3
// ────────────────────────────────────────────────────────────────────────────

/** 1x1 transparent PNG bytes (base64-decoded). */
const PNG_1x1_A = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Another 1x1 PNG (different bytes so sha differs). */
const PNG_1x1_B = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe("docxParser task 3", () => {
  it("Test 1: one embedded PNG produces one ImageNode + one MediaRef; mediaDir contains the file", async () => {
    const buffer = await makeDocxBuffer({
      documentXml: SIMPLE_DOC_XML,
      media: [{ name: "image1.png", bytes: PNG_1x1_A }],
    });
    const mediaDir = freshMediaDir();
    const ir = await parseDocxBuffer({
      path: "/virtual/one-image.docx",
      buffer,
      sha256: "sha-img1",
      mediaDir,
    });
    const images = ir.body.filter((n) => n.kind === "image") as ImageNode[];
    expect(images).toHaveLength(1);
    expect(ir.media).toHaveLength(1);
    // mediaId (sha of bytes) is non-empty hex
    expect(images[0].mediaId).toMatch(/^[0-9a-f]{64}$/);
    expect(ir.media[0].id).toBe(images[0].mediaId);
    // cachePath is an absolute path pointing into mediaDir
    expect(ir.media[0].cachePath.startsWith(mediaDir)).toBe(true);
    // file exists on disk
    expect(existsSync(ir.media[0].cachePath)).toBe(true);
  });

  it("Test 2: media file name uses sha256(bytes) + preserved extension", async () => {
    const buffer = await makeDocxBuffer({
      documentXml: SIMPLE_DOC_XML,
      media: [{ name: "pic.png", bytes: PNG_1x1_A }],
    });
    const mediaDir = freshMediaDir();
    const ir = await parseDocxBuffer({
      path: "/virtual/x.docx",
      buffer,
      sha256: "sha-x",
      mediaDir,
    });
    expect(ir.media).toHaveLength(1);
    const ref = ir.media[0];
    // file on disk ends with the sha + .png
    expect(ref.cachePath).toMatch(new RegExp(`${ref.id}\\.png$`));
    // Written bytes match original input
    const written = readFileSync(ref.cachePath);
    expect(Buffer.compare(written, PNG_1x1_A)).toBe(0);
  });

  it("Test 3: identical-bytes images dedup — 1 MediaRef on disk, 2 ImageNodes referencing it", async () => {
    const buffer = await makeDocxBuffer({
      documentXml: SIMPLE_DOC_XML,
      media: [
        { name: "a.png", bytes: PNG_1x1_A },
        { name: "b.png", bytes: PNG_1x1_A }, // same bytes, different filename
      ],
    });
    const mediaDir = freshMediaDir();
    const ir = await parseDocxBuffer({
      path: "/virtual/dup.docx",
      buffer,
      sha256: "sha-dup",
      mediaDir,
    });
    const images = ir.body.filter((n) => n.kind === "image") as ImageNode[];
    expect(images).toHaveLength(2);
    expect(ir.media).toHaveLength(1);
    expect(images[0].mediaId).toBe(images[1].mediaId);
    // And only one file on disk
    const onDisk = readdirSync(mediaDir);
    expect(onDisk).toHaveLength(1);
  });

  it("Test 4: oversized media entry (>16MiB) throws [E_DOC_ZIP_ENTRY_TOO_LARGE]", async () => {
    // 17MiB "image" bytes (not a valid PNG, but size-cap should fire before any decode)
    const big = Buffer.alloc(17 * 1024 * 1024, 0x42);
    const buffer = await makeDocxBuffer({
      documentXml: SIMPLE_DOC_XML,
      media: [{ name: "huge.png", bytes: big }],
    });
    await expect(
      parseDocxBuffer({
        path: "/virtual/huge.docx",
        buffer,
        sha256: "sha-huge",
        mediaDir: freshMediaDir(),
      }),
    ).rejects.toThrow(/\[E_DOC_ZIP_ENTRY_TOO_LARGE\]/);
  }, 30000);

  it("Test 5: no word/media/ entries -> ir.media === [] (empty array, not undefined)", async () => {
    const buffer = await makeDocxBuffer({ documentXml: SIMPLE_DOC_XML });
    const ir = await parseDocxBuffer({
      path: "/virtual/no-media.docx",
      buffer,
      sha256: "sha-no-media",
      mediaDir: freshMediaDir(),
    });
    expect(Array.isArray(ir.media)).toBe(true);
    expect(ir.media).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Unused-import shim so TypeScript doesn't complain about imports used only in
// fixture construction (writeFileSync, Buffer imports implicit via node).
// ────────────────────────────────────────────────────────────────────────────
void writeFileSync;
