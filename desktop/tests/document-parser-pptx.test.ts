/**
 * Tests for pptxParser (Phase 8 Plan 07).
 *
 * Single describe block covering 9 behaviors from the plan:
 *   1. 3-slide pptx → body has 3 SlideNodes in slide order
 *   2. Each SlideNode.body contains ParagraphNodes matching slide text
 *   3. notesSlide2.xml text appears as SlideNode.notes[0] on slide index 2
 *   4. Slide without notes → SlideNode.notes === undefined
 *   5. outline has one OutlineItem per slide (level=1, locator.slide=N)
 *   6. DOCTYPE in slide1.xml → [E_DOC_XXE_BLOCKED] with Chinese hint
 *   7. Parser does not fetch / spawn processes
 *   8. 17MiB ppt/slides/slide1.xml entry → [E_DOC_ZIP_ENTRY_TOO_LARGE] before XML decoded
 *   9. jszip is resolvable as a top-level dep from desktop/
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parsePptxBuffer,
  pptxParser,
} from "../src/main/services/document/parsers/pptx-parser";
import type { ParagraphNode, SlideNode } from "@shared/contracts";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const JSZip = require("jszip");

// ────────────────────────────────────────────────────────────────────────────
// Minimal pptx fixture builder.
// Produces a zip with the subset of OOXML that parsePptxBuffer actually inspects:
//   - [Content_Types].xml (not strictly required by our parser but present for realism)
//   - ppt/slides/slideN.xml per slide
//   - ppt/notesSlides/notesSlideN.xml per (optional) notes payload
// ────────────────────────────────────────────────────────────────────────────

type SlideSpec = {
  /** Plain text paragraphs rendered as <a:p><a:t>...</a:t></a:p> in the slide. */
  paragraphs: string[];
  /** Optional notes text paragraphs attached as ppt/notesSlides/notesSlideN.xml. */
  notes?: string[];
  /** If provided, replaces the generated slide XML body entirely (for XXE test). */
  rawSlideXml?: string;
  /** If provided, replaces the generated slide XML with a payload of exactly this byte length (for size-cap test). */
  paddedToBytes?: number;
};

function buildSlideXml(paragraphs: string[]): string {
  const pNodes = paragraphs
    .map(
      (t) => `    <p:sp>
      <p:txBody>
        <a:p><a:r><a:t>${escapeXml(t)}</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
${pNodes}
  </p:spTree></p:cSld>
</p:sld>`;
}

function buildNotesXml(paragraphs: string[]): string {
  const pNodes = paragraphs
    .map(
      (t) => `    <p:sp>
      <p:txBody>
        <a:p><a:r><a:t>${escapeXml(t)}</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
${pNodes}
  </p:spTree></p:cSld>
</p:notes>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function makePptxBuffer(
  slides: SlideSpec[],
  opts: { compress?: boolean } = {},
): Promise<Buffer> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`,
  );

  for (let i = 0; i < slides.length; i++) {
    const n = i + 1;
    const spec = slides[i];
    let xml: string;
    if (spec.rawSlideXml !== undefined) {
      xml = spec.rawSlideXml;
    } else {
      xml = buildSlideXml(spec.paragraphs);
    }
    if (spec.paddedToBytes !== undefined) {
      // Single-shot padding: allocate a comment filler of the required byte
      // length directly (vs incremental concat, which copies the full string
      // on every iteration and is O(n^2) for large paddings).
      const needed = spec.paddedToBytes - Buffer.byteLength(xml, "utf8");
      if (needed > 0) {
        // XML comment is inert; parser never descends into it.
        const filler = "<!-- " + "x".repeat(needed - 9) + " -->";
        xml = xml + filler;
      }
    }
    zip.file(`ppt/slides/slide${n}.xml`, xml);
    if (spec.notes && spec.notes.length > 0) {
      zip.file(`ppt/notesSlides/notesSlide${n}.xml`, buildNotesXml(spec.notes));
    }
  }

  const compress = opts.compress ?? true;
  // For oversized test fixtures we disable compression to keep the builder fast
  // (JSZip's pure-JS DEFLATE on a 17MiB payload takes minutes); STORE is fine
  // because the parser's 16MiB cap checks UNCOMPRESSED size post-inflation.
  return zip
    .generateAsync({
      type: "nodebuffer",
      compression: compress ? "DEFLATE" : "STORE",
    })
    .then((b: Buffer) => b);
}

function makeParseInput(buffer: Buffer, mediaDir: string): {
  path: string;
  buffer: Buffer;
  sha256: string;
  mediaDir: string;
} {
  return {
    path: "/fixtures/test.pptx",
    buffer,
    sha256: "0".repeat(64),
    mediaDir,
  };
}

describe("pptxParser (Phase 8 Plan 07)", () => {
  let tmpRoot = "";
  let mediaDir = "";

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "myclaw-pptx-"));
    mediaDir = join(tmpRoot, "media");
    // mediaDir does not need to exist for pptx — current plan doesn't extract media
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("Test 1: 3-slide pptx → body has 3 SlideNodes in slide order", async () => {
    const buf = await makePptxBuffer([
      { paragraphs: ["Alpha title"] },
      { paragraphs: ["Beta title"] },
      { paragraphs: ["Gamma title"] },
    ]);
    const ir = await parsePptxBuffer(makeParseInput(buf, mediaDir));
    expect(ir.body.length).toBe(3);
    const slides = ir.body as SlideNode[];
    expect(slides.map((s) => s.kind)).toEqual(["slide", "slide", "slide"]);
    expect(slides.map((s) => s.index)).toEqual([1, 2, 3]);
    expect(slides.map((s) => s.title)).toEqual(["Alpha title", "Beta title", "Gamma title"]);
  });

  it("Test 2: Each SlideNode.body contains ParagraphNodes with the slide's text", async () => {
    const buf = await makePptxBuffer([
      { paragraphs: ["Hello", "World"] },
      { paragraphs: ["Single line"] },
    ]);
    const ir = await parsePptxBuffer(makeParseInput(buf, mediaDir));
    const slide1 = ir.body[0] as SlideNode;
    expect(slide1.body.length).toBe(2);
    const p1 = slide1.body[0] as ParagraphNode;
    expect(p1.kind).toBe("paragraph");
    expect(p1.runs[0].text).toBe("Hello");
    expect(p1.locator.slide).toBe(1);
    const p2 = slide1.body[1] as ParagraphNode;
    expect(p2.runs[0].text).toBe("World");

    const slide2 = ir.body[1] as SlideNode;
    expect(slide2.body.length).toBe(1);
    expect((slide2.body[0] as ParagraphNode).runs[0].text).toBe("Single line");
  });

  it("Test 3: notesSlide2.xml content appears on slide index 2 as SlideNode.notes", async () => {
    const buf = await makePptxBuffer([
      { paragraphs: ["First"] },
      { paragraphs: ["Second"], notes: ["Talk slowly"] },
      { paragraphs: ["Third"] },
    ]);
    const ir = await parsePptxBuffer(makeParseInput(buf, mediaDir));
    const slide2 = ir.body[1] as SlideNode;
    expect(slide2.notes).toBeDefined();
    expect(slide2.notes!.length).toBe(1);
    const note = slide2.notes![0] as ParagraphNode;
    expect(note.kind).toBe("paragraph");
    expect(note.runs[0].text).toBe("Talk slowly");
    expect(note.locator.slide).toBe(2);
  });

  it("Test 4: Slides without notes → SlideNode.notes is undefined (not empty array)", async () => {
    const buf = await makePptxBuffer([
      { paragraphs: ["Has notes"], notes: ["Note one"] },
      { paragraphs: ["No notes here"] },
    ]);
    const ir = await parsePptxBuffer(makeParseInput(buf, mediaDir));
    const slide2 = ir.body[1] as SlideNode;
    expect(slide2.notes).toBeUndefined();
  });

  it("Test 5: outline has one OutlineItem per slide (level=1, locator.slide=N)", async () => {
    const buf = await makePptxBuffer([
      { paragraphs: ["Intro"] },
      { paragraphs: ["Body"] },
      { paragraphs: [""] }, // empty text → expect Slide 3 fallback title
    ]);
    const ir = await parsePptxBuffer(makeParseInput(buf, mediaDir));
    expect(ir.outline.length).toBe(3);
    expect(ir.outline.map((o) => o.level)).toEqual([1, 1, 1]);
    expect(ir.outline.map((o) => o.locator.slide)).toEqual([1, 2, 3]);
    expect(ir.outline[0].title).toBe("Intro");
    expect(ir.outline[1].title).toBe("Body");
    // Slide with empty text → "Slide 3" fallback
    expect(ir.outline[2].title).toBe("Slide 3");
  });

  it("Test 6: DOCTYPE in slide1.xml → [E_DOC_XXE_BLOCKED] with Chinese hint", async () => {
    const malicious = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>&xxe;</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
    const buf = await makePptxBuffer([{ paragraphs: [], rawSlideXml: malicious }]);
    await expect(parsePptxBuffer(makeParseInput(buf, mediaDir))).rejects.toThrow(
      /\[E_DOC_XXE_BLOCKED\][\s\S]*请/,
    );
  });

  it("Test 7: Parser does not invoke fetch or spawn processes", async () => {
    // Source-level assertion: the parser must not reference outbound-HTTP or
    // child-process APIs. Combined with the positive parse below, this gives
    // us a strong "no side-channel" guarantee without relying on ESM-hostile
    // spyOn of node:child_process (which is non-configurable under Vitest).
    const { readFileSync } = await import("node:fs");
    const parserSource = readFileSync(
      new URL("../src/main/services/document/parsers/pptx-parser.ts", import.meta.url),
      "utf8",
    );
    expect(parserSource).not.toMatch(/\bfetch\s*\(/);
    expect(parserSource).not.toMatch(/child_process/);
    // Disallow child_process.spawn / top-level spawn calls; we accept pregex.exec(xml)
    // on RegExp objects because that is a pure in-process string match.
    expect(parserSource).not.toMatch(/\bspawn\s*\(/);
    expect(parserSource).not.toMatch(/\brequire\s*\(\s*['\"]child_process['\"]\s*\)/);
    // Reject python invocation patterns (python3 foo, py -3 bar) while still
    // permitting doc comments that state "零 Python 依赖" / "no python".
    expect(parserSource).not.toMatch(/python\s*[\w.-]*\.\s*(spawn|exec)/i);
    expect(parserSource).not.toMatch(/['"]python(?:3|2)?['"]/);
    expect(parserSource).not.toMatch(/['"]py['"]\s*,\s*\[[^\]]*-3/);
    expect(parserSource).not.toMatch(/\bpy\s+-3\b/);

    // Plus a positive run: fetch spy must never fire during a real parse.
    const buf = await makePptxBuffer([
      { paragraphs: ["Safe"], notes: ["Safe notes"] },
    ]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("unexpected fetch");
    });
    await parsePptxBuffer(makeParseInput(buf, mediaDir));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it(
    "Test 8: slide1.xml > 16MiB → [E_DOC_ZIP_ENTRY_TOO_LARGE] before XML decoded",
    async () => {
      // 17 MiB padding puts slide1.xml above the 16 MiB cap.
      // Use STORE compression: JSZip's pure-JS DEFLATE on 17MiB is O(minutes);
      // the parser only checks uncompressed byteLength so the compression
      // method does not affect the behavior under test.
      const SEVENTEEN_MB = 17 * 1024 * 1024;
      const buf = await makePptxBuffer(
        [{ paragraphs: ["header"], paddedToBytes: SEVENTEEN_MB }],
        { compress: false },
      );
      await expect(parsePptxBuffer(makeParseInput(buf, mediaDir))).rejects.toThrow(
        /\[E_DOC_ZIP_ENTRY_TOO_LARGE\][\s\S]*16MiB/,
      );
    },
    30000,
  );

  it("Test 9: jszip is resolvable as a top-level dep from desktop/", () => {
    // Resolving from desktop/ confirms 08-05 declared jszip at the top level.
    // If jszip were only a mammoth transitive, pnpm's isolated layout would make this throw.
    const resolved = require.resolve("jszip", { paths: [process.cwd()] });
    expect(typeof resolved).toBe("string");
    expect(resolved.length).toBeGreaterThan(0);
  });

  it("Test 10 (bonus): pptxParser is a DocumentParser for format pptx", () => {
    expect(pptxParser.format).toBe("pptx");
    expect(typeof pptxParser.parse).toBe("function");
  });
});
