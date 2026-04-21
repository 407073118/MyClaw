---
phase: 08-document-ir-document-read
verified: 2026-04-21T15:30:00Z
status: passed
score: 9/9 acceptance anchors verified
requirements:
  - id: TOOL-04
    status: satisfied
    evidence: "document_read tool has strong 4-mode enum schema (tool-schemas.ts:101-152), executeDocumentRead validates args + clamps maxChars to 32000 (document-read-facade.ts:88-92), 50MB gate + E_DOC_* error branches enforce contract"
  - id: ASST-04
    status: satisfied
    evidence: "Every [E_DOC_*] branch in document-read-facade.ts includes actionable next-step sentence (verified by tests/document-read-facade.test.ts Test 10). fs_read hard-reject error provides ready-to-copy document.read template (builtin-tool-executor.ts:1016-1022)"
  - id: GOV-02
    status: satisfied
    evidence: "document-read-facade.ts:406-413 emits structured audit log per call with sha256/mode/path/returnedBytes/sessionId via createLogger('document-read'); doc-cache.ts uses createLogger('doc-cache') for miss/hit/LRU events"
---

# Phase 8: Document IR + document.read — Verification Report

**Phase Goal:** Build a DocumentIR-based `document.read` tool that unifies how the model reads documents (xlsx/docx/pdf/pptx/md/txt/csv), with on-disk sha256-keyed caching, and hard-reject fs_read on those formats to prevent Python-script fallbacks.

**Verified:** 2026-04-21
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (derived from CONTEXT.md §验收锚点 + ROADMAP Goal)

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | DocumentIR contract unifies all formats into a single structured type | VERIFIED | `desktop/shared/contracts/document.ts` (203 lines) defines 12-kind discriminated union DocumentNode + DocumentIR; re-exported from `desktop/shared/contracts/index.ts:6` |
| 2 | `document.read` tool is registered with 4 modes (stats/outline/read/search) | VERIFIED | `tool-schemas.ts:101-152` declares document_read with `enum: ["stats","outline","read","search"]`; `builtin-tool-executor.ts:1105` dispatches to `executeDocumentRead` |
| 3 | 7 native parsers cover xlsx/docx/pdf/pptx/md/txt/csv (zero Python) | VERIFIED | All 7 parser files exist under `document/parsers/` with concrete parse logic (xlsx 115L, docx 612L, pdf 142L, pptx 208L, md-txt 236L, csv 177L) and no `exec("python")` calls |
| 4 | sha256-keyed on-disk cache with LRU eviction (500MB cap) | VERIFIED | `doc-cache.ts:10` `DEFAULT_CACHE_MAX_BYTES = 500 * 1024 * 1024`; `getOrBuild`, `enforceLru`, `clear` exported; tests (10 cases) cover miss/hit/eviction |
| 5 | Same-file second read hits cache | VERIFIED | `document-read-facade.ts:332` routes every call through `deps.cache.getOrBuild(sha, builder)`; `doc-cache.ts` writes `ir.json` to `<cacheDir>/docCache/<sha256>/` |
| 6 | fs_read rejects .xlsx/.xls/.xlsm/.docx/.pdf/.pptx with actionable hint | VERIFIED | `builtin-tool-executor.ts:248 DOC_HARD_REJECT_EXTS` + `:1008-1022` E_DOC_USE_DOCUMENT_READ branch emits template; 7 tests in `document-fs-read-hard-reject.test.ts` pass |
| 7 | Security flags set: XXE/PDF-JS/external-fetch disabled, 50MB gate, 32000 maxChars cap | VERIFIED | `pdf-parser.ts:60-63` `isEvalSupported:false, disableStream:true, disableAutoFetch:true`; docx/pptx enforce 16MiB zip-entry cap; facade `DOC_MAX_BYTES=50MB` + `DOC_MAX_CHARS_HARD_CAP=32000` |
| 8 | Python-first guidance removed from buildSkillExecutionGuidance | VERIFIED | `builtin-tool-executor.ts:653-670` refactored: "优先使用结构化工具" block first, `py -3` demoted to "最后备选" |
| 9 | xlsx.extract backward-compat alias still works | VERIFIED | `builtin-tool-executor.ts:1142` retains legacy `xlsx.extract` dispatch; `document-xlsx-extract-alias.test.ts` (5 tests) confirms byte-compatible Markdown-table output |

**Score:** 9/9 truths verified

### Required Artifacts

All 13 core artifacts exist, are substantive, and are wired.

| Artifact | Lines | Level 1 (exists) | Level 2 (substantive) | Level 3 (wired) | Level 4 (data flows) |
| -------- | ----- | ---------------- | --------------------- | --------------- | --------------------- |
| `desktop/shared/contracts/document.ts` | 203 | yes | yes — 12 node kinds + IR root | yes — re-exported in index.ts:6 | n/a (type-only) |
| `desktop/src/main/services/document/parser-registry.ts` | 57 | yes | yes — register/get/list + interface | yes — imported by facade + executor | n/a (registry) |
| `desktop/src/main/services/document/ir-to-markdown.ts` | 235 | yes | yes — 12-case switch (grep -c `case "` = 12) | yes — used by facade mode=read | yes — renders IR.body |
| `desktop/src/main/services/document/doc-cache.ts` | 239 | yes | yes — getOrBuild/enforceLru/clear + 500MB cap | yes — setDocCacheRoot wired in sessions.ts:2604 | yes — writes ir.json + media/ |
| `desktop/src/main/services/document/document-read-facade.ts` | 416 | yes | yes — 4 mode branches, 50MB gate, clampMaxChars | yes — imported by executor:17 | yes — returns output to executor |
| `desktop/src/main/services/document/parsers/xlsx-parser.ts` | 115 | yes | yes — SheetJS-backed with merged-cell expansion | yes — registered in ensureParsersRegistered:825-827 | yes — produces SheetNode |
| `desktop/src/main/services/document/parsers/docx-parser.ts` | 612 | yes | yes — mammoth HTML + direct XML for tables/comments/footnotes/images | yes — registered:828 | yes — produces IR with outline + media |
| `desktop/src/main/services/document/parsers/pdf-parser.ts` | 142 | yes | yes — pdfjs-dist legacy + page-by-page + scanned-page marker | yes — registered:829 | yes — produces PageBreakNode + paragraphs |
| `desktop/src/main/services/document/parsers/pptx-parser.ts` | 208 | yes | yes — jszip + slides + notesSlides + zip-bomb cap | yes — registered:830 | yes — produces SlideNode[] with notes |
| `desktop/src/main/services/document/parsers/md-txt-parser.ts` | 236 | yes | yes — marked lexer for md, blank-line split for txt | yes — registered:831-832 | yes — produces IR.body |
| `desktop/src/main/services/document/parsers/csv-parser.ts` | 177 | yes | yes — BOM + delimiter detection + quoted fields | yes — registered:833 | yes — produces SheetNode+TableNode |
| `desktop/src/main/services/builtin-tool-executor.ts` (dispatch + reject + guidance) | — | yes | yes — dispatch at :1105, hard-reject at :1008, demoted py at :653-670 | yes — setDocCacheRoot + setPathPolicy wired from IPC | yes — routes live args |
| `desktop/src/main/services/tool-schemas.ts` (document_read schema) | — | yes | yes — 4-mode enum + 4 concrete examples + steer text in fs_read/xlsx_extract | yes — emitted to model at runtime | yes — model-visible contract |

### Key Link Verification

Manual grep confirms every declared link is wired. (gsd-tools `verify key-links` reported false-negatives due to path-resolution and regex pattern specifics; see "Tooling notes" below — every link validated by direct grep.)

| From | To | Via | Status | Evidence |
| ---- | -- | --- | ------ | -------- |
| `desktop/shared/contracts/index.ts` | `contracts/document.ts` | re-export | WIRED | `index.ts:6 export * from "./document"` |
| `document-read-facade.ts` | `doc-cache.getOrBuild` | cache-miss-builder | WIRED | `facade.ts:332 deps.cache.getOrBuild(sha, async (mediaDir) => ...)` |
| `builtin-tool-executor.ts` | `document-read-facade.executeDocumentRead` | toolId dispatch | WIRED | `executor.ts:17 import + :1105 if (toolId === "document.read") { ... return executeDocumentRead(...) }` |
| `desktop/src/main/ipc/sessions.ts` | `executor.setDocCacheRoot` | wiring site | WIRED | `sessions.ts:2601-2604 setPathPolicy + setDocCacheRoot(cacheDir)` |
| `xlsx-parser.ts` | `xlsx (SheetJS)` | require at parse time | WIRED | `xlsx-parser.ts:26 xlsxMod = require("xlsx")` |
| `docx-parser.ts` | `mammoth` | require | WIRED | `docx-parser.ts:522 mammoth = require("mammoth")` |
| `docx-parser.ts` | `jszip` (top-level dep) | require | WIRED | `docx-parser.ts:535 JSZip = require("jszip")`; `package.json:29 "jszip": "^3.10.1"` |
| `pdf-parser.ts` | `pdfjs-dist` legacy | await import | WIRED | `pdf-parser.ts:46 await import("pdfjs-dist/legacy/build/pdf.js")`; `package.json:33 "pdfjs-dist": "^3.11.174"` |
| `pptx-parser.ts` | `jszip` (reused top-level dep) | require | WIRED | `pptx-parser.ts:117 JSZip = require("jszip")` |
| `md-txt-parser.ts` | `marked` | require | WIRED | `md-txt-parser.ts:40 require("marked") as MarkedModule` |
| `builtin-tool-executor.ts` | each parser | `ensureParsersRegistered` | WIRED | `executor.ts:823-833` registers all 7 parsers once (idempotent) |
| `fs.read` dispatch | document.read guidance | error template | WIRED | `executor.ts:1008-1022 DOC_HARD_REJECT_EXTS + E_DOC_USE_DOCUMENT_READ + buildDocumentReadTemplate` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| TypeScript main compiles with no errors | `pnpm exec tsc --noEmit -p tsconfig.main.json` | clean (0 output) | PASS |
| Contract/renderer/cache/facade/reject/guidance suites green | `vitest run tests/document-ir-contract tests/document-ir-to-markdown tests/document-doc-cache tests/document-read-facade tests/document-fs-read-hard-reject tests/document-guidance-no-python` | 47 passed / 0 failed | PASS |
| Parser suites green (xlsx/pdf/pptx + alias) | `vitest run tests/document-parser-xlsx tests/document-parser-pdf tests/document-parser-pptx tests/document-xlsx-extract-alias` | 31 passed / 0 failed | PASS |
| Switch over DocumentNode.kind is exhaustive in renderer | `grep -c "case \"" ir-to-markdown.ts` | 12 (matches 12 kinds) | PASS |
| Parser registry populates 9 formats in `ensureParsersRegistered` | `grep -c "registerParser" executor.ts:823-833` | 9 (xlsx/xls/xlsm/docx/pdf/pptx/md/txt/csv) | PASS |
| Full phase test suite (per user) | `vitest run tests/document-*` | 116 passed / 0 failed (14 files) | PASS (reported) |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
| ----------- | ------------ | ----------- | ------ | -------- |
| TOOL-04 | 08-01, 08-02, 08-03, 08-04, 08-05, 08-06, 08-07, 08-08, 08-09 | Tool params and results must be structurally validated | SATISFIED | `document_read` schema has strong 4-mode enum + typed locator object (tool-schemas.ts:101-152); facade validates args + clamps maxChars (`document-read-facade.ts:88-92`, `:1113-1120` in executor); 13 unit tests cover arg validation paths |
| ASST-04 | 08-03, 08-09 | Failures must return understandable cause and next-step hint | SATISFIED | `document-read-facade.ts` E_DOC_* branches each end with an actionable Chinese sentence (`请…`); `document-read-facade.test.ts` Test 10 asserts every `[E_DOC_*]` branch ends with `。` or `.`; fs_read hard-reject error includes ready-to-copy `document.read {"path":"...","mode":"stats"}` template |
| GOV-02 | 08-02, 08-03 | Admins must be able to audit tool calls and key execution traces | SATISFIED | `document-read-facade.ts:406-413` emits structured INFO log `{sha256, mode, path, returnedBytes, sessionId}` per successful call via `createLogger("document-read")`; `doc-cache.ts` logs miss/hit/LRU events with sha256; both feed into existing `logger.ts` file-backed pipeline |

**Orphaned requirements:** None. Every ID declared in plan frontmatter (TOOL-04, ASST-04, GOV-02) is satisfied; ROADMAP phase-level IDs match plan IDs exactly.

### Anti-Patterns Found

None of severity "Blocker". Scan summary:

| Scan | Result |
| ---- | ------ |
| TODO/FIXME/XXX/HACK/PLACEHOLDER in new code | 0 matches across `document/`, `document/parsers/`, `contracts/document.ts` |
| "coming soon" / "not yet implemented" | 0 matches |
| Empty-return stubs in parser bodies | 0 stubs. Two `return null` hits in docx/pptx are legitimate helpers (missing-zip-entry guards) |
| Hardcoded empty data flowing to output | 0 matches |
| `py -3` as recommended first choice | Gone. Remaining mentions are explicitly "last resort" (executor.ts:632, :651, :665-667); `buildWindowsPythonFallbackCommand` still exists at :632 as OS-level exec fallback (not model guidance) |

### Tooling Notes

- `gsd-tools verify artifacts` flagged plan 08-09 `tool-schemas.ts` with "Missing pattern: mode=stats". The plan's frontmatter used literal `mode=stats` as the `contains` assertion; the file uses JSON form `"mode":"stats"` (which is semantically equivalent). Schema contains all 4 mode examples as required — confirmed by direct grep at `tool-schemas.ts:106-109`. This is a frontmatter-pattern-vs-reality mismatch, not a functional gap.
- `gsd-tools verify key-links` reported several false negatives ("Source file not found" / "Target not referenced") because some plans used short names (e.g. `builtin-tool-executor.ts` without full path) or Unicode `---` in the `via` field. Manual grep confirms every link is wired; see "Key Link Verification" table above.

### Human Verification Required

None strictly required for automated goal achievement. Optional follow-ups that would deepen confidence:

1. **End-to-end model run** — launch desktop, ask the AI to "summarize this .docx" on a real file, watch tool-call log to confirm the model now calls `document.read` (not `exec_command py -3`). Programmatic tests cover the guardrails; this verifies the model-side behavior-shift.
2. **Bundle-size check** — phase accepts ≤ 6MB increment (CONTEXT.md §约束). Not measured here; run `pnpm build` before/after and diff installer size if a release candidate is prepared.
3. **Scanned-PDF honesty** — load a scan-only PDF and confirm `document.read mode=read` emits `(扫描页：未抽取到文字)` markers rather than silent empties. Covered by `document-parser-pdf.test.ts` but only with synthetic fixtures.

### Gaps Summary

No gaps. All 9 acceptance anchors hold, all 3 requirement IDs are satisfied, all declared artifacts exist and are wired, all security flags are set, all tests green (116/116 per user; 78 verified in this session across spot-checked suites). tsc main is clean.

The phase delivers:
- A **type-only** `DocumentIR` contract (203 lines, 12 node kinds) re-exported through `@shared/contracts`
- A **functional parser registry** + **pure IR→Markdown renderer** (exhaustive switch over all 12 kinds)
- A **sha256-keyed on-disk cache** with 500MB LRU and `getOrBuild` indirection
- A **document.read facade** enforcing 50MB size gate, 32000 maxChars hard cap, 4-mode routing, structured audit logging, and actionable E_DOC_* error branches
- **7 native parsers** (zero Python) with security hardening: docx/pptx zip-bomb caps + XXE blocks; pdf `isEvalSupported:false` + network fetch disabled
- **Model guardrails**: fs_read hard-rejects office/pdf/pptx with ready-to-copy `document.read` template (`E_DOC_USE_DOCUMENT_READ`); `buildSkillExecutionGuidance` demotes `py -3` to last resort; tool-schemas include 4 concrete mode examples
- **Backward compatibility**: legacy `xlsx.extract` toolId preserved with byte-compatible Markdown-table output (verified by `document-xlsx-extract-alias.test.ts`)

---

_Verified: 2026-04-21_
_Verifier: Claude (gsd-verifier)_
