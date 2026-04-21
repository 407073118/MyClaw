---
phase: 08-document-ir-document-read
plan: 05
subsystem: desktop/main/services/document/parsers + builtin-tool-executor
tags:
  - document-ir
  - docx-parser
  - mammoth
  - jszip
  - zero-python
  - xxe-defense
  - wave-3

dependency_graph:
  requires:
    - "08-01 DocumentIR contract + parser-registry"
    - "08-03 document.read facade + setDocCacheRoot wiring"
    - "08-04 ensureParsersRegistered() seam on BuiltinToolExecutor"
  provides:
    - "docxParser — DocumentParser implementation for format docx"
    - "parseDocxBuffer(input) — mammoth + jszip-backed DocumentIR builder"
    - "reusable utilities: assertNoDoctype, readZipEntryCapped, MAX_DOCX_ZIP_ENTRY_BYTES, guessMimeFromExt, extractDocxMedia"
  affects:
    - "08-07 pptx parser: can reuse jszip dep, assertNoDoctype, readZipEntryCapped, guessMimeFromExt, MAX_DOCX_ZIP_ENTRY_BYTES"
    - "08-09 fs_read gate: .docx is now live behind document.read; fs_read can hard-reject .docx and redirect"

tech_stack:
  added:
    - "mammoth ^1.8.0 (~500KB — docx → HTML convertor)"
    - "jszip ^3.10.1 (~100KB — EXPLICIT top-level dep, not just a mammoth transitive)"
  patterns:
    - "single-zip-load: one JSZip.loadAsync(buffer) reused for pre-scan, comments/footnotes, and media extraction — no duplicate zip parse"
    - "pre-scan-before-external-parser: DOCTYPE + 16MiB check runs BEFORE mammoth.convertToHtml so xmldom's 'entity not found' never masks our [E_DOC_XXE_BLOCKED] / [E_DOC_ZIP_ENTRY_TOO_LARGE] codes"
    - "stack-based HTML walker with style frames: decode mammoth's HTML without loading a full DOM library; inline styles (strong/b/em/i/code) tracked via InlineStyle flags on runs"
    - "sha256-content-addressed media dedup: identical image bytes → single on-disk file, N ImageNodes referencing via MediaRef.id"

key_files:
  created:
    - desktop/src/main/services/document/parsers/docx-parser.ts
    - desktop/tests/document-parser-docx.test.ts
  modified:
    - desktop/package.json
    - desktop/pnpm-lock.yaml
    - desktop/src/main/services/document/index.ts
    - desktop/src/main/services/builtin-tool-executor.ts
    - desktop/tests/document-xlsx-extract-alias.test.ts

decisions:
  - "jszip declared as EXPLICIT top-level dependency. pnpm's isolated node_modules would expose jszip only under node_modules/mammoth/node_modules/, so require('jszip') from our source would MODULE_NOT_FOUND. Must be declared at the desktop/package.json top level — 08-07 pptx reuses this same dep."
  - "Pre-scan comments.xml / footnotes.xml for DOCTYPE BEFORE invoking mammoth.convertToHtml. Mammoth internally uses xmldom, which raises a confusing 'entity not found' when it encounters undeclared XML entities — masking our business error code. Running assertNoDoctype first (via JSZip.loadAsync + TextDecoder) converts the failure into a clean [E_DOC_XXE_BLOCKED] with ASST-04 hint."
  - "Size cap (16MiB per entry) also runs in the pre-scan phase. This guards against the double-failure mode where mammoth tries to load a zip-bomb entry internally and hangs / OOMs before our own reader reaches it."
  - "HTML walker hand-rolled rather than bringing in cheerio/parse5. (a) Avoids a second parser family with its own XXE surface. (b) Keeps the parser zero-browser, zero-Python, zero-heavyweight. The walker only needs to recognize the ~15 tags mammoth actually emits — a full DOM is overkill."
  - "li / td content rolled up into a single InlineRun[] instead of nesting block children. Real-world docx tables / bulleted lists almost always have single-paragraph cells; a future revision can extend the contract if needed without breaking the Task 1–3 shape."
  - "MediaRef uses the contract's shape (id/mime/cachePath) rather than the plan's sketched (mediaId/path/bytes). The contract was locked in 08-01 — adopted it verbatim rather than introducing a second media shape."
  - "ImageNode.locator.heading tracks the LAST heading seen during the HTML walk. Images at the end of the document inherit the last heading; for most docx structures this is good enough to keep the outline-to-image mapping coherent."

metrics:
  duration_minutes: 17
  completed_date: "2026-04-21"
  tasks_total: 3
  tasks_done: 3
  tests_added: 14
  tests_passing: 14

requirements-completed: [TOOL-04]
---

# Phase 8 Plan 05: Docx Parser Wired Into document.read Summary

`docxParser` turns `.docx` into `DocumentIR` in three layered passes — mammoth HTML walk for skeleton, ZIP re-read for comments + footnotes (XXE-guarded, 16MiB capped), and media extraction with sha256 dedup. Registered on the executor via the 08-04 `ensureParsersRegistered()` seam. Zero Python. mammoth AND jszip declared as explicit top-level deps so pnpm's isolated layout resolves both.

## Performance

- Duration: ~17 min
- Started: 2026-04-21T13:39:42Z
- Completed: 2026-04-21T13:57:03Z
- Tasks: 3 (all TDD RED→GREEN)
- Files created: 2
- Files modified: 5
- Tests added: 14 (all green)
- Tests regression-run: 80 across 8 suites (8 phase-4 / 08-01 / 08-03 / 08-04 / 08-05 files) — all green

## What Was Built

### Task 1 — mammoth HTML skeleton + deps + registration

- `desktop/package.json`: `jszip ^3.10.1` and `mammoth ^1.8.0` inserted alphabetically under `dependencies`. Both verified resolvable from `F:/MyClaw/desktop/` via `require.resolve`. `pnpm install` ran cleanly; lockfile updated.
- `desktop/src/main/services/document/parsers/docx-parser.ts` (new): exports `parseDocxBuffer(input)` and `docxParser: DocumentParser` singleton.
  - Lazy `require("mammoth")` + `require("jszip")` with `[E_DOC_DEP_MISSING]` + Chinese hint on resolve failure.
  - `mammoth.convertToHtml({ buffer })` → HTML string; hand-rolled `tokenizeHtml` regex tokenizer produces `open/close/void/text` tokens over the ~15 tags mammoth emits.
  - `walkHtmlToIr` maintains a three-level state machine: current `BlockFrame` (heading | paragraph | li | td), a `listStack` for nested `<ul>/<ol>`, and a `tableStack` with `currentRow` for tables. Inline styles (`strong/b/em/i/code`) tracked on an `InlineStyle` frame applied at `pushRun` time.
  - `<p>` opening inside `<td>` or `<li>` is collapsed (not a new paragraph), so table cells / list items keep their text in the parent frame's runs.
  - `<br>` inside a block inserts `\n` into the current run list.
  - Outline is built inline: every `<h1>..<h6>` flush pushes an `OutlineItem { level, title, locator: { heading } }` and updates `ctx.lastHeading`. Every non-heading body node inherits `locator.heading = ctx.lastHeading`.
  - Defensive `[E_DOC_XXE_BLOCKED]` check on mammoth's HTML output (mammoth shouldn't emit a DOCTYPE; fail closed if it ever does).
  - `meta.words` = `floor(totalCharsInAllRuns / 5)` approximation.
- `desktop/src/main/services/document/index.ts`: re-exports the new module alongside xlsx-parser.
- `desktop/src/main/services/builtin-tool-executor.ts`:
  - `import { docxParser } from "./document/parsers/docx-parser";`
  - Extended `ensureParsersRegistered()` with `if (!getParser("docx")) registerParser(docxParser);` — follows the 08-04 idempotent-guard pattern exactly. NO new guard method created; the 08-04 seam absorbed the new parser with 2 lines.

### Task 2 — comments + footnotes merge with XXE + 16MiB cap

Extended `parseDocxBuffer` with a pre-scan step that runs BEFORE `mammoth.convertToHtml`:

- `JSZip.loadAsync(input.buffer)` (single zip load, reused for everything downstream).
- `MAX_DOCX_ZIP_ENTRY_BYTES = 16 * 1024 * 1024` constant at module scope.
- `assertNoDoctype(xml)`: string-level `<!DOCTYPE` check → throws `[E_DOC_XXE_BLOCKED]` with Chinese ASST-04 hint.
- Pre-scan loop for `word/comments.xml` and `word/footnotes.xml`:
  - If entry missing → `preScan[name] = null`.
  - Else read as `Uint8Array` first, check `byteLength > 16MiB` → throw `[E_DOC_ZIP_ENTRY_TOO_LARGE]` with Chinese hint.
  - Decode as UTF-8, run `assertNoDoctype`, stash text in `preScan[name]`.
- After mammoth + HTML walk:
  - `parseCommentsXml(xml)`: matches `<w:comment w:id="..." w:author="...">...</w:comment>`, extracts author + concatenated `<w:t>` text; pushes `CommentNode { kind:"comment", author?, runs, locator:{} }` to body.
  - `parseFootnotesXml(xml)`: matches `<w:footnote w:type? w:id>...</w:footnote>`, filters `w:type="separator"` and `w:type="continuationSeparator"`, extracts `<w:t>` text; pushes `FootnoteNode { kind:"footnote", refId, runs, locator:{} }`.
- `extractWtText` + `getAttr` helpers are regex-based; no DOM library pulled in (same reasoning as the Task 1 walker — zero second-order XML parser surface).

### Task 3 — media extraction with sha256 dedup

Extended `parseDocxBuffer` with a third phase after comments/footnotes merge:

- `extractDocxMedia(zip, mediaDir, lastHeading)`:
  - Iterates `Object.keys(zip.files)`, filters `^word/media/`.
  - Per entry: bytes → size check (reuses `MAX_DOCX_ZIP_ENTRY_BYTES`) → `sha256(bytes)` → filename `<sha><ext>` under `mediaDir` (created by doc-cache as `<root>/docCache/<docSha>/media/`).
  - `seen` map keyed by image-bytes sha: first occurrence writes the file + pushes `MediaRef { id, mime, cachePath }`; duplicates skip the write but still push `ImageNode { kind:"image", mediaId: sha, locator: { heading } }`.
  - `guessMimeFromExt` covers png/jpg/jpeg/gif/bmp/webp/svg/tif/tiff; unknown falls back to `application/octet-stream`.
- `parseDocxBuffer` appends all `images` to body (at end — after comments/footnotes) and sets `ir.media = media`.

## Test Coverage

### `document-parser-docx.test.ts` — 14 tests across 3 describe blocks

**task 1 — 4 tests**

1. `H1 + paragraph + 2x2 table` → 1 HeadingNode (level=1, text "Title") + 1 ParagraphNode + 1 TableNode with `rows.length === 2` and both rows 2-wide.
2. Heading cascade (H1 "A", H2 "A.1", paragraph, H2 "A.2") → outline has `[1,2,2]` levels and `["A","A.1","A.2"]` titles; the paragraph's `locator.heading === "A.1"`.
3. `require.resolve("jszip", { paths: [desktopDir] })` returns a non-empty string — jszip is a first-class top-level dep.
4. Executor source contains `import { docxParser } ...` + `registerParser(docxParser)`; runtime registry check (`registerParser(docxParser)` → `getParser("docx")` non-null).

**task 2 — 5 tests**

1. Two comments (Alice, Bob) → 2 CommentNodes with author + run text preserved.
2. Footnotes with `separator`, `continuationSeparator`, and real footnote #1 → only 1 FootnoteNode surfaces (refId="1", text "Real footnote body.").
3. `<!DOCTYPE foo [<!ENTITY xxe SYSTEM "...">]>` in comments.xml → throws `[E_DOC_XXE_BLOCKED]` with `请.*。` sentence (ASST-04).
4. 17MiB `word/footnotes.xml` → throws `[E_DOC_ZIP_ENTRY_TOO_LARGE]` before mammoth ever loads it.
5. Docx with no comments.xml / footnotes.xml → zero CommentNodes + zero FootnoteNodes (not empty arrays, simply absent nodes).

**task 3 — 5 tests**

1. Single 1×1 PNG → 1 ImageNode + 1 MediaRef; `media[0].cachePath.startsWith(mediaDir)` true; file exists on disk.
2. MediaRef file on disk has name `<sha>.png`; `readFileSync(cachePath)` bytes compare equal to the original PNG input (Buffer.compare === 0).
3. Two `<image>` entries with identical PNG bytes → 2 ImageNodes (same `mediaId`), 1 MediaRef, exactly 1 file in `mediaDir` (readdirSync length 1).
4. 17MiB "image" entry → throws `[E_DOC_ZIP_ENTRY_TOO_LARGE]`.
5. No `word/media/*` entries → `Array.isArray(ir.media)` and `ir.media.length === 0`.

### Regression

- `document-parser-xlsx.test.ts` — 7/7 passing.
- `document-xlsx-extract-alias.test.ts` — 5/5 passing. Test 5's expected registry set updated from `["xls","xlsm","xlsx"]` to `["docx","xls","xlsm","xlsx"]` (Rule 1 deviation; set grows as Wave 3 parsers land).
- `document-read-facade.test.ts` — 13/13 passing.
- `document-read-wiring.test.ts` — 7/7 passing.
- `document-ir-contract.test.ts` — 2/2 passing.
- `document-ir-to-markdown.test.ts` — 9/9 passing.
- `phase4-tool-executor.test.ts` — 23/23 passing.

**Combined command:** `pnpm exec vitest run tests/document-parser-xlsx.test.ts tests/document-xlsx-extract-alias.test.ts tests/document-read-facade.test.ts tests/document-read-wiring.test.ts tests/phase4-tool-executor.test.ts tests/document-parser-docx.test.ts tests/document-ir-contract.test.ts tests/document-ir-to-markdown.test.ts` → 80/80 passing.

## Task Commits

| Task | Phase | Hash      | Message                                                                                 |
|------|-------|-----------|-----------------------------------------------------------------------------------------|
| 1    | RED   | `9840525` | `test(08-05): add failing tests for docxParser task 1 (HTML skeleton + deps)`           |
| 1    | GREEN | `507f821` | `feat(08-05): implement docxParser HTML skeleton + register on executor`                |
| 2    | RED   | `f388be2` | `test(08-05): add failing tests for docx comments/footnotes/XXE/16MiB cap (task 2)`     |
| 2    | GREEN | `9640431` | `feat(08-05): merge docx comments/footnotes with XXE guard + 16MiB cap (task 2)`        |
| 3    | RED   | `347dbe9` | `test(08-05): add failing tests for docx media extraction + dedup + size cap (task 3)`  |
| 3    | GREEN | `5ac48c7` | `feat(08-05): extract docx media to mediaDir with dedup + 16MiB cap (task 3)`           |

## Deviations from Plan

### [Rule 1 — Bug] Pre-scan comments/footnotes BEFORE mammoth runs

- **Found during:** Task 2 first GREEN run (Test 3 failed).
- **Issue:** The plan ordered the steps as `mammoth.convertToHtml → HTML walk → ZIP re-read`. But mammoth internally loads `word/comments.xml` and `word/footnotes.xml` via `xmldom` to resolve footnote/comment references. When `comments.xml` contained `<!DOCTYPE foo [<!ENTITY xxe ...>]>` with an undeclared entity, xmldom raised `error: [xmldom error]\tentity not found:&xxe;` — NOT our clean `[E_DOC_XXE_BLOCKED]`.
- **Fix:** Swapped the order. `JSZip.loadAsync(input.buffer)` and a pre-scan of `word/comments.xml` / `word/footnotes.xml` (size cap + `assertNoDoctype`) run BEFORE `mammoth.convertToHtml`. The pre-scanned text is stashed in a `preScan` dict and reused later — single zip load, single decode, clean error codes.
- **Files modified:** `desktop/src/main/services/document/parsers/docx-parser.ts`.
- **Commit:** `9640431` (Task 2 GREEN).
- **Trace:** Plan's `[E_DOC_XXE_BLOCKED]` / `[E_DOC_ZIP_ENTRY_TOO_LARGE]` truths still hold — actually hold MORE strongly, because they now fire in all cases where the plan's write-order would have let xmldom fail first.

### [Rule 1 — Bug] `<p>` inside `<td>` / `<li>` flushed the outer block prematurely

- **Found during:** Task 1 first GREEN run (Test 1 failed — TableNode.rows.length === 0).
- **Issue:** mammoth emits `<table><tr><td><p>cellText</p></td>...`. The initial walker called `flushBlock()` unconditionally on any `<p>` open — which killed the `td` block mid-flight and left the table with no rows.
- **Fix:** Added a guard: `if (currentBlock && (currentBlock.kind === "li" || currentBlock.kind === "td")) continue;` — `<p>` inside a td/li is a no-op (text collapses into the parent frame's runs).
- **Files modified:** `desktop/src/main/services/document/parsers/docx-parser.ts`.
- **Commit:** `507f821` (Task 1 GREEN).

### [Rule 2 — Missing critical functionality] 16MiB cap extended to `word/media/*`

- **Found during:** Task 3 action-writing.
- **Issue:** Plan's Task 2 applied the 16MiB cap only to `word/comments.xml` / `word/footnotes.xml`. Task 3 truth in the plan's `must_haves.truths` list explicitly requires the cap on "each zip entry" — which includes media. Without this, a malicious docx could embed a 500MB image and the parser would `writeFile` it verbatim into the user's cache directory.
- **Fix:** Inside `extractDocxMedia`, check `bytes.byteLength > MAX_DOCX_ZIP_ENTRY_BYTES` BEFORE sha computation or disk write → throw `[E_DOC_ZIP_ENTRY_TOO_LARGE]` with Chinese hint mentioning "嵌入资源".
- **Files modified:** `desktop/src/main/services/document/parsers/docx-parser.ts`.
- **Commit:** `5ac48c7` (Task 3 GREEN).
- **Trace:** Plan acceptance `"Per-entry 16MiB cap ALSO applies to media entries"` is now covered by Test 4 of task 3.

### [Rule 1 — Bug] MediaRef shape mismatch between plan sketch and 08-01 contract

- **Found during:** Task 3 action-writing.
- **Issue:** The plan's `extractDocxMedia` pseudocode emitted `{ mediaId, path, mime, bytes }`. The real `MediaRef` type (locked in 08-01 at `desktop/shared/contracts/document.ts:72-80`) is `{ id, mime, cachePath, alt?, width?, height? }`. Using the pseudocode verbatim would have produced a compile error.
- **Fix:** Emit `{ id: sha, mime, cachePath: absolutePath }` — matches the 08-01 contract exactly. Test 1 of task 3 assertions align with this shape (`ir.media[0].cachePath`, `ir.media[0].id`).
- **Files modified:** `desktop/src/main/services/document/parsers/docx-parser.ts` (code + doc comments).
- **Commit:** `5ac48c7` (Task 3 GREEN).

### [Rule 3 — Blocking issue] Sibling test's over-specific registry assertion

- **Found during:** Full regression run after Task 3 GREEN.
- **Issue:** `document-xlsx-extract-alias.test.ts` Test 5 asserted exactly `expect(formats).toEqual(["xls", "xlsm", "xlsx"])`. With docx now registered, the actual set is `["docx", "xls", "xlsm", "xlsx"]` — the test failed. This is a test-maintenance issue caused by the preceding 08-04 plan writing a closed-world assertion against an open-world registry.
- **Fix:** Updated to `expect(formats).toEqual(["docx", "xls", "xlsm", "xlsx"])` with a comment noting the set grows as Wave 3 parsers land.
- **Files modified:** `desktop/tests/document-xlsx-extract-alias.test.ts` (one line + explanatory comment).
- **Commit:** `5ac48c7` (rolled into Task 3 GREEN since the failure surfaced only after all three task commits were in place).

No architectural changes required. All deviations applied per GSD Rules 1–3.

## Deferred Issues (out of scope)

- Pre-existing TS errors in `desktop/src/main/services/document/doc-cache.ts` (5 `TS2322` / `TS2345` at lines 58/65/122/131/133 — `Dirent<NonSharedBuffer>` vs `Dirent<string>`). Already logged in `deferred-items.md` by the 08-01 agent and confirmed still present by 08-03 and 08-04 agents. Not caused or worsened by this plan.
- docx tables with merged cells: mammoth flattens merged cells with `colspan`/`rowspan` attrs. The current walker ignores these attrs, so a merged cell renders as one cell at its top-left position. A future revision can honor spans; not in scope for this plan (plan's Task 1 truths don't mention merges).
- Image placement fidelity: ImageNodes are appended at the END of body after comments/footnotes rather than at their precise inline position in the document. Walk-time image placement requires threading zip state into the HTML walker or re-correlating `<img src="word/media/...">` references from mammoth back to the zip. Deferred — plan explicitly allows "append at end with locator.heading = lastHeading."

## Next Phase Readiness

### Ready for 08-06 (PDF parser)

- Independent parser; depends only on 08-01 contract and 08-03 facade. Add `parsers/pdf-parser.ts` + one line in `ensureParsersRegistered()`. No shared deps with docx/pptx.

### Ready for 08-07 (PPTX parser) — unlocks reuse

Four pieces of docx-parser machinery are directly reusable in pptx:

1. `MAX_DOCX_ZIP_ENTRY_BYTES` constant — rename or alias under a pptx constant, same 16MiB value.
2. `assertNoDoctype(xml)` — pptx has the same XXE exposure surface (ppt/comments/*.xml, ppt/notesSlides/*.xml).
3. `readZipEntryCapped(zip, path)` — identical signature, identical semantics.
4. `guessMimeFromExt(ext)` — ppt/media/ uses the same image extensions.
5. `jszip` top-level dep — 08-07 can `require("jszip")` directly; this plan already declared it.

Recommended: 08-07 either imports these from docx-parser or extracts them to `parsers/zip-utils.ts`. Either way, no new top-level deps in 08-07.

### Ready for 08-08 (md/txt/csv parsers)

Independent; docx parser does not influence md/txt/csv at all.

### Ready for 08-09 (fs_read gate + python-first guidance cleanup)

- `.docx` is now fully served by `document.read`. `fs_read` can hard-reject `.docx` and point at `document.read` — facade's existing `[E_DOC_FORMAT_UNSUPPORTED]` message already lists docx as a supported format.

## Self-Check: PASSED

Files verified:

- FOUND: `desktop/src/main/services/document/parsers/docx-parser.ts`
- FOUND: `desktop/tests/document-parser-docx.test.ts`
- FOUND: `desktop/package.json` (modified — mammoth + jszip added)
- FOUND: `desktop/pnpm-lock.yaml` (modified — pnpm install)
- FOUND: `desktop/src/main/services/document/index.ts` (modified — re-export docx-parser)
- FOUND: `desktop/src/main/services/builtin-tool-executor.ts` (modified — import + 1-line registration)
- FOUND: `desktop/tests/document-xlsx-extract-alias.test.ts` (modified — registry assertion updated)

Commits verified:

- FOUND: `9840525` (Task 1 RED)
- FOUND: `507f821` (Task 1 GREEN)
- FOUND: `f388be2` (Task 2 RED)
- FOUND: `9640431` (Task 2 GREEN)
- FOUND: `347dbe9` (Task 3 RED)
- FOUND: `5ac48c7` (Task 3 GREEN)

Acceptance criteria verified via grep / exit code:

- `grep -cE '"(mammoth|jszip)"' desktop/package.json` → 2 (both present)
- `node -e "require.resolve('jszip', { paths: ['F:/MyClaw/desktop'] })"` exits 0 → jszip resolvable from desktop/
- `grep -nE 'parseDocxBuffer|docxParser' docx-parser.ts` → exports both, line 518 (`parseDocxBuffer`) and line 609 (`docxParser` singleton)
- `grep -cE 'require\("mammoth"\)' docx-parser.ts` → 2 (1 doc-comment + 1 actual require)
- `grep -cE 'require\("jszip"\)' docx-parser.ts` → 2 (1 doc-comment + 1 actual require)
- `grep -cE 'python\|py -3\|child_process' docx-parser.ts` → 0 (zero-Python enforced)
- `grep -cE 'docxParser' builtin-tool-executor.ts` → 2 (import + registration)
- `grep -cE 'MAX_DOCX_ZIP_ENTRY_BYTES' docx-parser.ts` → 4 (definition + 3 check sites: readZipEntryCapped, pre-scan loop, extractDocxMedia)
- `grep -cE 'E_DOC_ZIP_ENTRY_TOO_LARGE' docx-parser.ts` → 3 (all three zip-entry consumer sites)
- `grep -cE 'E_DOC_XXE_BLOCKED|DOCTYPE' docx-parser.ts` → 4 matches (XXE_MARKER const + assertNoDoctype throw + defensive post-mammoth HTML check + doc comment)
- `grep -cE 'word/comments\.xml|word/footnotes\.xml' docx-parser.ts` → 2 (pre-scan loop path array) — plus `preScan["word/..."]` lookups for consumption
- `grep -cE 'word/media/|extractDocxMedia|MediaRef' docx-parser.ts` → ≥ 2 (regex filter + helper definition + import)

Test suites — combined `pnpm exec vitest run` across 8 files:

- `document-parser-docx.test.ts` — 14/14 passing (task 1: 4, task 2: 5, task 3: 5)
- `document-parser-xlsx.test.ts` — 7/7 passing
- `document-xlsx-extract-alias.test.ts` — 5/5 passing (after registry assertion update)
- `document-read-facade.test.ts` — 13/13 passing
- `document-read-wiring.test.ts` — 7/7 passing
- `document-ir-contract.test.ts` — 2/2 passing
- `document-ir-to-markdown.test.ts` — 9/9 passing
- `phase4-tool-executor.test.ts` — 23/23 passing
- **Total: 80/80 passing**

Typecheck:

- `pnpm exec tsc --noEmit -p tsconfig.main.json` → only the 5 pre-existing `doc-cache.ts` errors remain (logged in `deferred-items.md`). No new errors introduced by this plan.

---
*Phase: 08-document-ir-document-read*
*Completed: 2026-04-21*
