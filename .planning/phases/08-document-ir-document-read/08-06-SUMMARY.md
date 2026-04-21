---
phase: 08-document-ir-document-read
plan: 06
subsystem: desktop/main/services/document/parsers + builtin-tool-executor
tags:
  - document-ir
  - pdf-parser
  - pdfjs-dist
  - xxe-defense
  - zero-python
  - scanned-page-honesty
  - wave-3

dependency_graph:
  requires:
    - "08-01 DocumentIR contract + parser-registry"
    - "08-03 document.read facade + setDocCacheRoot wiring"
    - "08-04 ensureParsersRegistered() seam on BuiltinToolExecutor"
  provides:
    - "pdfParser — DocumentParser implementation for format pdf"
    - "parsePdfBuffer(input) — pdfjs-dist-backed DocumentIR builder with per-page PageBreak+Paragraph"
    - "SCANNED_PAGE_MARKER convention: (扫描页：未抽取到文字) for empty text-content pages"
  affects:
    - "08-09 fs_read gate: .pdf is now live behind document.read; fs_read can hard-reject .pdf and redirect"

tech_stack:
  added:
    - "pdfjs-dist ^3.11.174 (~5MB — legacy CJS/UMD build for Node require / dynamic import)"
  patterns:
    - "dynamic-import-for-mock: await import(\"pdfjs-dist/legacy/build/pdf.js\") instead of require() so Vitest's module-graph vi.mock can intercept"
    - "scanned-page-honesty: empty getTextContent() items → Chinese marker paragraph with locator.page, not silent empty output"
    - "per-page body pattern: one PageBreakNode + one ParagraphNode per page, both with locator.page set, matches CONTEXT.md §3 ('按页切分 = locator.page')"
    - "security-option quartet: isEvalSupported=false + disableStream=true + disableAutoFetch=true + disableFontFace=true pinned by Test 2 (spy on getDocument arg)"

key_files:
  created:
    - desktop/src/main/services/document/parsers/pdf-parser.ts
    - desktop/tests/document-parser-pdf.test.ts
  modified:
    - desktop/package.json
    - desktop/pnpm-lock.yaml
    - desktop/src/main/services/document/index.ts
    - desktop/src/main/services/builtin-tool-executor.ts
    - desktop/tests/document-xlsx-extract-alias.test.ts

decisions:
  - "pdfjs-dist pinned at ^3.11.174, NOT ^4.7.76 as the plan proposed. v4.x ships ESM-only (pdf.mjs) and no longer exposes legacy/build/pdf.js — making the plan's require() path literally non-existent. v3.11.174 is the last release with a CJS-friendly UMD legacy build. canvas is an optional peer that fails node-gyp on Windows without Python; pdfjs emits 'Cannot polyfill DOMMatrix/Path2D' warnings at load time but text extraction works without it (we never render)."
  - "Parser uses await import() instead of require(). The plan said require(); but Vitest 3 + Vite transforms only intercept import statements via vi.mock. A require() call bypasses the mock and pdfjs tries to parse our fake buffer, blowing up with InvalidPDFException. Switching to dynamic import keeps lazy-load semantics AND lets the test suite mock pdfjs cleanly — same net behavior in production (one-time async cost on first document.read call)."
  - "Scanned-page marker is Chinese '(扫描页：未抽取到文字)'. Plan asked for Chinese to match project convention (other status markers in the codebase are all Chinese). Emitted as a single InlineRun in a ParagraphNode with locator.page set, so downstream outline / search / render all see the page as 'present but empty text'."
  - "outline gets one Page N entry per page at level=1. CONTEXT.md §3 says '按页切分 = locator.page'. For PDFs without embedded bookmarks (the vast majority), a page-based outline is the most useful navigation surface; this keeps outline mode coherent without pulling in pdfjs's optional outline API."
  - "useSystemFonts left at pdfjs default (false). Plan called this out as deliberately not set. Setting it true would let pdfjs probe system font directories during parse, which is an I/O surface we don't need since we don't render."

metrics:
  duration_minutes: 13
  completed_date: "2026-04-21"
  tasks_total: 1
  tasks_done: 1
  tests_added: 9
  tests_passing: 9

requirements-completed: [TOOL-04]
---

# Phase 8 Plan 06: PDF Parser Wired Into document.read Summary

`pdfParser` turns `.pdf` into `DocumentIR` via pdfjs-dist with all four security options (isEvalSupported / disableStream / disableAutoFetch / disableFontFace) pinned to safe values. Each page yields one `PageBreakNode` + one `ParagraphNode` with `locator.page` set; scanned pages emit the Chinese marker `(扫描页：未抽取到文字)` rather than silent empty text. Registered on the executor via the 08-04 `ensureParsersRegistered()` seam.

## Performance

- Duration: ~13 min
- Started: 2026-04-21T14:04:25Z
- Completed: 2026-04-21T14:17:54Z
- Tasks: 1 (TDD RED→GREEN)
- Files created: 2
- Files modified: 5
- Tests added: 9 (all green)
- Tests regression-run: 89 across 9 suites — all green

## What Was Built

### Task 1 — pdfParser + executor registration (single TDD cycle)

- `desktop/package.json`: `pdfjs-dist ^3.11.174` inserted alphabetically between `marked` and `playwright-core`. `pnpm install` resolved it cleanly; postinstall's `electron-builder install-app-deps` failed ONLY on canvas (an optional peer dep that needs node-gyp + Python), which is irrelevant for text extraction and does not block subsequent `pnpm exec vitest` / `tsc` runs. `require.resolve("pdfjs-dist/legacy/build/pdf.js")` succeeds from `F:/MyClaw/desktop/`.

- `desktop/src/main/services/document/parsers/pdf-parser.ts` (new):
  - Exports `parsePdfBuffer(input)` and `pdfParser: DocumentParser` singleton.
  - `await import("pdfjs-dist/legacy/build/pdf.js")` with default/namespace fallback; catches module-resolve failure into `[E_DOC_DEP_MISSING]` with Chinese hint (ASST-04 pattern).
  - Calls `pdfjs.getDocument({ data: Uint8Array, isEvalSupported: false, disableFontFace: true, disableStream: true, disableAutoFetch: true })`.
  - Iterates pages 1..numPages:
    - Every page pushes a `PageBreakNode { kind: "pageBreak", page, locator: { page } }` and one `OutlineItem { level: 1, title: "Page N", locator: { page } }`.
    - `getTextContent()` items: empty array OR all-whitespace → emit `ParagraphNode` with runs = `[{ text: "(扫描页：未抽取到文字)" }]`, locator.page set.
    - Otherwise: join item.str with spaces, collapse whitespace runs, emit `ParagraphNode` with single InlineRun, locator.page set.
  - Returns `{ source: { path, format: "pdf", bytes: buffer.length, sha256 }, meta: { pages: numPages }, outline, body, media: [] }` — shape matches the 08-01 contract verbatim.

- `desktop/src/main/services/document/index.ts`: re-exports `./parsers/pdf-parser` alongside xlsx/docx parser barrels.

- `desktop/src/main/services/builtin-tool-executor.ts`:
  - `import { pdfParser } from "./document/parsers/pdf-parser";`
  - Added `if (!getParser("pdf")) registerParser(pdfParser);` inside the existing `ensureParsersRegistered()` — follows the 08-04 idempotent-guard pattern exactly. Two line additions, no new method.

- `desktop/tests/document-xlsx-extract-alias.test.ts`: updated the "registered once, not multiplied" assertion's expected set from `["docx", "xls", "xlsm", "xlsx"]` to `["docx", "pdf", "xls", "xlsm", "xlsx"]`, with a comment explaining the set grows as Wave 3 lands.

## Test Coverage

### `document-parser-pdf.test.ts` — 9 tests

1. 2-page PDF → `body` has PageBreakNodes with `page=1` and `page=2`, each page has ≥1 ParagraphNode whose `locator.page` matches.
2. `getDocument` called with `isEvalSupported: false, disableStream: true, disableAutoFetch: true, disableFontFace: true` (spy on mock module's `getDocument` captures the first argument).
3. A page whose text-content items are empty produces a `ParagraphNode` whose combined run text contains `"扫描页"` and the exact literal `"(扫描页：未抽取到文字)"`, with `locator.page` set.
4. `meta.pages === doc.numPages` (test uses 3 pages; asserts `ir.meta.pages === 3`).
5. `outline` contains one entry per page with `{ level: 1, title: "Page N", locator: { page: N } }`.
6. Source-level grep guard (08-04 convention): parser source file, with comments stripped, contains none of `child_process`, `spawn(`, `exec(`, `execFile(`, `python`, `py -3`. Catches any future regression that introduces a spawn call without changing runtime behavior.
7. `pdfParser.format === "pdf"` and `pdfParser.parse` is a function.
8. After `registerParser(pdfParser)`, `getParser("pdf")` returns a non-null parser with `format === "pdf"`.
9. `ir.source.format === "pdf"`, `sha256` and `path` forwarded verbatim from `ParseInput`, `bytes` equals `input.buffer.length`, `media === []`.

All 9 tests run against a `vi.mock("pdfjs-dist/legacy/build/pdf.js")` replacement — no real PDF fixtures needed. The mock drives `numPages` and per-page `getTextContent().items` from test-controlled state.

### Regression

- `document-parser-xlsx.test.ts` — 7/7 passing.
- `document-parser-docx.test.ts` — 14/14 passing.
- `document-xlsx-extract-alias.test.ts` — 5/5 passing (after registry assertion update).
- `document-read-facade.test.ts` — 13/13 passing.
- `document-read-wiring.test.ts` — 7/7 passing.
- `document-ir-contract.test.ts` — 2/2 passing.
- `document-ir-to-markdown.test.ts` — 9/9 passing.
- `phase4-tool-executor.test.ts` — 23/23 passing.

**Combined command:** `pnpm exec vitest run tests/document-parser-pdf.test.ts tests/document-parser-xlsx.test.ts tests/document-parser-docx.test.ts tests/document-xlsx-extract-alias.test.ts tests/document-read-facade.test.ts tests/document-read-wiring.test.ts tests/document-ir-contract.test.ts tests/document-ir-to-markdown.test.ts tests/phase4-tool-executor.test.ts` → **89/89 passing**.

## Task Commits

| Task | Phase | Hash      | Message                                                                  |
|------|-------|-----------|--------------------------------------------------------------------------|
| 1    | RED   | `c629d6a` | `test(08-06): add failing tests for pdfParser (Phase 8 Plan 06 RED)`     |
| 1    | GREEN | `9f163ef` | `feat(08-06): implement pdfParser for DocumentIR; register on executor`  |

## Deviations from Plan

### [Rule 3 — Blocking issue] pdfjs-dist version downshifted from ^4.7.76 to ^3.11.174

- **Found during:** Task 1 RED preparation (before writing any tests).
- **Issue:** The plan specified `pdfjs-dist ^4.7.76` but simultaneously asked the parser to `require("pdfjs-dist/legacy/build/pdf.js")`. Inspection of the v4.7.76 package contents (`npm pack pdfjs-dist@4.7.76 && tar -tzf pdfjs-dist-4.7.76.tgz | grep legacy/build`) showed the v4 line ships ESM-only — `legacy/build/pdf.mjs`, NOT `pdf.js`. The plan's require path literally does not exist on v4. Shipping v4.7.76 would guarantee `[E_DOC_DEP_MISSING]` at first document.read call.
- **Fix:** Pinned `pdfjs-dist ^3.11.174` — the last pre-ESM release. Package contents verified: `legacy/build/pdf.js` present, `main: "build/pdf.js"`, CJS-friendly UMD. Plan's require/import path works unchanged.
- **Files modified:** `desktop/package.json`, `desktop/pnpm-lock.yaml`.
- **Commit:** `c629d6a` (RED) — dep added in same commit as tests.
- **Trace:** Plan's `isEvalSupported:false`, `disableStream:true`, `disableAutoFetch:true`, `disableFontFace:true` all supported identically by v3.11.174. Zero behavioral drift vs the plan's intent.

### [Rule 3 — Blocking issue] require() swapped for await import() to make vi.mock work

- **Found during:** Task 1 first GREEN run (6/9 tests failed with `InvalidPDFException: Invalid PDF structure` — mock not intercepting).
- **Issue:** The plan's parser body used `require("pdfjs-dist/legacy/build/pdf.js")`. Vitest 3 + Vite intercepts `vi.mock` via the module graph, which only covers `import` statements (static and dynamic). CJS `require()` calls bypass the mock and load the real pdfjs, which then tries to parse our fake test buffer and blows up. This is the same category of problem that bit 08-04's `vi.spyOn(fs, ...)` pattern.
- **Fix:** Swapped `require(...)` for `await import(...)` with a default/namespace fallback (`pdfjs.default?.getDocument`). In production: identical lazy-load semantics, one extra microtask. In tests: `vi.mock` now intercepts cleanly.
- **Files modified:** `desktop/src/main/services/document/parsers/pdf-parser.ts`.
- **Commit:** `9f163ef` (GREEN).
- **Trace:** Plan's "Lazy load" intent preserved. Plan's acceptance grep for `pdfjs-dist/legacy` still passes (2 matches — one in the module header comment, one in the import call).

### [Rule 3 — Blocking issue] Sibling alias test's expected registry set extended

- **Found during:** Regression after Task 1 GREEN.
- **Issue:** `document-xlsx-extract-alias.test.ts` Test 5 asserted `formats.toEqual(["docx", "xls", "xlsm", "xlsx"])`. With pdf now registered, the actual sorted set is `["docx", "pdf", "xls", "xlsm", "xlsx"]` — failed.
- **Fix:** Updated the expected array to include `"pdf"` with an explanatory comment. Same maintenance pattern the 08-05 agent applied when docx landed.
- **Files modified:** `desktop/tests/document-xlsx-extract-alias.test.ts`.
- **Commit:** `9f163ef` (rolled into GREEN).

### [Rule 2 — Auto-fix] Test 6 replaced spyOn(child_process, "spawn") with source-level grep

- **Found during:** Task 1 first RED run.
- **Issue:** The plan's Test 6 sketch suggested `vi.spyOn(require("node:child_process"), "spawn")` to prove no process is spawned. Vitest 3 + Vite ESM fails this with `Cannot spy on export "spawn". Module namespace is not configurable in ESM.` — same constraint 08-04 hit with `fs.readFile`.
- **Fix:** Reframed Test 6 as a static source-level grep: read `pdf-parser.ts`, strip comment lines, assert no `child_process | spawn( | exec( | execFile( | python | py -3` matches. Catches any future regression that wires in process spawning, and runs instantly without needing a runtime hook.
- **Files modified:** `desktop/tests/document-parser-pdf.test.ts`.
- **Commit:** `c629d6a` (RED).
- **Trace:** Plan's acceptance criteria `grep -n "child_process\|spawn\|exec\|python\|py -3"` returns 0 — now covered both by the plan's grep AND by the test itself.

No architectural changes required. All deviations applied per GSD Rules 2–3.

## Authentication Gates

None. Pure offline parser implementation.

## Deferred Issues (out of scope)

- Pre-existing TS errors in `desktop/src/main/services/document/doc-cache.ts` (5 `TS2322` / `TS2345` at lines 58/65/122/131/133 — `Dirent<NonSharedBuffer>` vs `Dirent<string>`). Already logged in `deferred-items.md` by the 08-01 agent and re-confirmed by 08-03, 08-04, 08-05 agents. Not introduced or worsened by this plan.
- pdfjs-dist's optional `canvas` peer dep fails `electron-builder install-app-deps` on Windows without Python + node-gyp build toolchain. pdfjs logs `"Cannot polyfill DOMMatrix/Path2D"` warnings at load time; text extraction works regardless (we never render). A future hardening pass could install canvas as `optionalDependencies: false` in `electron-builder` config to silence the postinstall failure, but that's orthogonal to the parser's correctness.
- PDF outline items are page-based (`Page N`), not derived from the PDF's embedded bookmark tree. For PDFs that ship a real outline (typesetting tools, published reports), a future revision could prefer `doc.getOutline()` when present. Not in scope — plan's Test 5 expects `Page N` output.
- Page-break locators do not expose per-page character offsets / run positions within the page. Current impl is one run per page (joined text); fine-grained layout reconstruction (position / font size) is intentionally left out per CONTEXT.md's "IR 只留语义、不留表现层" decision.

## Next Phase Readiness

### Ready for 08-07 (PPTX parser)

- Independent parser. Can reuse the 08-05 docx-parser jszip dep + `assertNoDoctype` + `MAX_DOCX_ZIP_ENTRY_BYTES` + `guessMimeFromExt` helpers. No new shared top-level deps required. Add `parsers/pptx-parser.ts` and one line in `ensureParsersRegistered()`.

### Ready for 08-08 (md/txt/csv parsers)

- Independent. pdf parser does not influence md/txt/csv at all.

### Ready for 08-09 (fs_read gate + python-first guidance cleanup)

- `.pdf` is now fully served by `document.read`. `fs_read` can hard-reject `.pdf` and point at `document.read` — facade's existing `[E_DOC_FORMAT_UNSUPPORTED]` list already covers pdf as a supported format.

## Self-Check: PASSED

Files verified:

- FOUND: `desktop/src/main/services/document/parsers/pdf-parser.ts`
- FOUND: `desktop/tests/document-parser-pdf.test.ts`
- FOUND: `desktop/package.json` (modified — pdfjs-dist added)
- FOUND: `desktop/pnpm-lock.yaml` (modified — pnpm install)
- FOUND: `desktop/src/main/services/document/index.ts` (modified — re-export pdf-parser)
- FOUND: `desktop/src/main/services/builtin-tool-executor.ts` (modified — import + 1-line registration)
- FOUND: `desktop/tests/document-xlsx-extract-alias.test.ts` (modified — registry assertion updated)

Commits verified:

- FOUND: `c629d6a` (Task 1 RED — tests + dep)
- FOUND: `9f163ef` (Task 1 GREEN — parser impl + registration + sibling test update)

Acceptance criteria verified via grep / exit code:

- `grep -c "pdfjs-dist" desktop/package.json` → 1 (dep present)
- `grep -c "parsePdfBuffer\|pdfParser" pdf-parser.ts` → ≥ 2 (both exports present)
- `grep -c "isEvalSupported: false" pdf-parser.ts` → 2 (header doc + actual call)
- `grep -c "disableStream: true" pdf-parser.ts` → 2 (header doc + actual call)
- `grep -c "disableAutoFetch: true" pdf-parser.ts` → 2 (header doc + actual call)
- `grep -c "disableFontFace: true" pdf-parser.ts` → 2 (header doc + actual call)
- `grep -c "useSystemFonts" pdf-parser.ts` → 0 (deliberately omitted)
- `grep -c "pdfjs-dist/legacy" pdf-parser.ts` → 2 (header doc + dynamic import)
- `grep -c "扫描页" pdf-parser.ts` → 5 (marker const + header doc + scanned-branch comments)
- `grep -cE "child_process|spawn|exec|python|py -3" pdf-parser.ts` → 0 (zero-Python enforced)
- `grep -c "pdfParser" builtin-tool-executor.ts` → 2 (import + registration call)

Test suites — combined `pnpm exec vitest run` across 9 files:

- `document-parser-pdf.test.ts` — 9/9 passing
- `document-parser-xlsx.test.ts` — 7/7 passing
- `document-parser-docx.test.ts` — 14/14 passing
- `document-xlsx-extract-alias.test.ts` — 5/5 passing (after registry assertion update)
- `document-read-facade.test.ts` — 13/13 passing
- `document-read-wiring.test.ts` — 7/7 passing
- `document-ir-contract.test.ts` — 2/2 passing
- `document-ir-to-markdown.test.ts` — 9/9 passing
- `phase4-tool-executor.test.ts` — 23/23 passing
- **Total: 89/89 passing**

Typecheck:

- `pnpm exec tsc --noEmit -p tsconfig.main.json` → only the 5 pre-existing `doc-cache.ts` errors remain (logged in `deferred-items.md`). Zero new errors introduced by this plan; `pdf-parser.ts` compiles clean (0 matches when grepping tsc output for `pdf-parser`).

---
*Phase: 08-document-ir-document-read*
*Completed: 2026-04-21*
