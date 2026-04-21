---
phase: 08-document-ir-document-read
plan: 09
subsystem: desktop/main/services/builtin-tool-executor + tool-schemas
tags:
  - document-ir
  - fs-read-gate
  - model-guidance
  - de-python
  - tool-steering
  - wave-4
  - phase-closer

dependency_graph:
  requires:
    - "08-03 document.read facade + tool-schemas document_read entry"
    - "08-04 executor ensureParsersRegistered() seam + xlsx parser wiring"
    - "08-05 docx parser (covered by [E_DOC_USE_DOCUMENT_READ] .docx branch)"
    - "08-06 pdf parser (covered by [E_DOC_USE_DOCUMENT_READ] .pdf branch)"
    - "08-07 pptx parser (covered by [E_DOC_USE_DOCUMENT_READ] .pptx branch)"
    - "08-08 md / txt / csv parsers (md stays readable via fs_read; csv gets soft tip)"
  provides:
    - "DOC_HARD_REJECT_EXTS set — the canonical list of office/pdf/pptx extensions routed to document.read"
    - "buildDocumentReadTemplate(filePath, ext) — produces a ready-to-paste JSON invocation template (mode=stats baseline)"
    - "extractLowerExt(p) — shared lower-case ext helper"
    - "[E_DOC_USE_DOCUMENT_READ] error code + template — fs_read's hard-reject surface for xlsx/xls/xlsm/docx/pdf/pptx"
    - "[E_DOC_LEGACY_DOC_UNSUPPORTED] error code — dedicated .doc 'save as .docx' guidance"
    - "exported buildSkillExecutionGuidance(skillPath) — now node-first / document.read-first"
    - "exported buildWindowsPythonFallbackCommand(cmd) — preserved intact as last-resort exec fallback"
    - "fs_read description steering both document_read AND xlsx_extract"
    - "xlsx_extract description marked LEGACY and steering to document_read"
    - "document_read description with 4 concrete mode examples (stats / outline / read-with-locator / search)"
  affects:
    - "Phase 08 complete — Wave 4 closer. Model-guidance side is closed: Python fallback demoted; fs_read can no longer silently succeed on office/pdf/pptx paths."
    - "Future phases: any new DocumentFormat added under 08-01 should (a) register a parser, (b) be added to DOC_HARD_REJECT_EXTS if binary, (c) get a suggestedTool: 'document.read' entry in BINARY_EXT_MAP."

tech_stack:
  added: []
  patterns:
    - "error-code-first-line: [E_DOC_USE_DOCUMENT_READ] is always the first segment of the error payload; downstream log ingesters can filter on it without regex-parsing free-form Chinese text"
    - "ready-to-paste-template: buildDocumentReadTemplate returns a JSON.stringify'd object literal — the model can copy the sequence directly into its next tool call, no translation needed"
    - "demote-not-delete: py -3 guidance is preserved but moved to the LAST bullet, below explicit node-first alternatives. buildWindowsPythonFallbackCommand kept intact (Test 5 enforces this) so legitimate python-only skills still work"
    - "legacy-alias-signal: xlsx_extract schema description prepends 'LEGACY alias —' to make the migration direction unambiguous without breaking the existing tool surface"
    - "dual-steering: fs_read description names BOTH document_read AND xlsx_extract, covering model behaviors that already cache 'xlsx → xlsx_extract' as a habit"

key_files:
  created:
    - desktop/tests/document-fs-read-hard-reject.test.ts
    - desktop/tests/document-guidance-no-python.test.ts
  modified:
    - desktop/src/main/services/builtin-tool-executor.ts
    - desktop/src/main/services/tool-schemas.ts

decisions:
  - "Hard-reject set is tight (xlsx/xls/xlsm/docx/pdf/pptx) — md/txt are NOT in it because a README.md read via fs_read is a legitimate workflow. csv is also NOT hard-rejected, but gets a soft tip appended after content (preserves existing CSV inspection patterns while nudging toward document.read)."
  - "buildDocumentReadTemplate defaults to mode=stats for ALL rejected formats, not mode=outline for docx. Rationale: stats is universally safe (reports bytes + counts), and steers the model toward a two-step interaction (stats → outline/read) rather than risking a maxChars blow-up on first contact with a 200-page PDF."
  - ".doc gets its own error code [E_DOC_LEGACY_DOC_UNSUPPORTED] rather than sharing [E_DOC_USE_DOCUMENT_READ]. The model-facing action is different (ask user to re-save) and the error-log grouping should reflect that."
  - "buildSkillExecutionGuidance and buildWindowsPythonFallbackCommand are now named exports. Tests import them directly rather than reconstructing behavior via skill.invoke round-trips. Matches Test 2 plan guidance (option a — the simpler path)."
  - "xlsx_extract description keeps its full parameter schema intact; only the description text changes. This preserves backward compatibility for model prompts that already target xlsx_extract while signaling the migration path."
  - "document_read description is now a multi-line JSON.stringify template with 4 numbered examples. The 4 examples mirror the 4 modes 1:1, so the model can pattern-match 'need stats? → example 1' without having to remember the schema enum order."

metrics:
  duration_minutes: 7
  completed_date: "2026-04-21"
  tasks_total: 2
  tasks_done: 2
  tests_added: 13
  tests_passing: 13

requirements-completed: [TOOL-04, ASST-04]
---

# Phase 8 Plan 09: fs_read Gate + De-Python Guidance Summary

The final Wave 4 plan closes the model-guidance side of Phase 08 — `fs_read` on office / pdf / pptx paths now returns `[E_DOC_USE_DOCUMENT_READ]` with a ready-to-paste JSON invocation template (no free-form prose the model has to translate), `.doc` legacy paths get a dedicated save-as-docx hint, skill execution guidance puts node / `document.read` first and demotes `py -3` to a last-resort fallback bullet, and `fs_read` / `xlsx_extract` / `document_read` schema descriptions all point the model at `document_read` as the preferred document-handling surface.

## Performance

- Duration: ~7 min
- Started: 2026-04-21T14:58:04Z
- Completed: 2026-04-21T15:05:57Z
- Tasks: 2 (both TDD RED → GREEN)
- Files created: 2 (both test suites)
- Files modified: 2 (executor + schemas — no contract / shared / cache touches)
- Tests added: 13 (7 hard-reject + 6 guidance) — all green
- Regression: 56/56 passing across 5 merged test files

## What Was Built

### Task 1 — Hard-reject fs.read on office/pdf/pptx

`desktop/src/main/services/builtin-tool-executor.ts`:

- **`BINARY_EXT_MAP`** updated: `.xlsx` / `.xls` / `.xlsm` / `.docx` / `.pdf` all flipped from their pre-existing `xlsx.extract` / `docx.extract` / `pdf.extract` stubs to `suggestedTool: "document.read"`. `.pptx` added with `suggestedTool: "document.read"`. `.doc` intentionally left without a `suggestedTool` so the dedicated `[E_DOC_LEGACY_DOC_UNSUPPORTED]` path owns it.
- **New constants / helpers**:
  - `DOC_HARD_REJECT_EXTS = new Set([".xlsx", ".xls", ".xlsm", ".docx", ".pdf", ".pptx"])` — the canonical membership test for the hard-reject path.
  - `buildDocumentReadTemplate(filePath, ext)` → returns `JSON.stringify({ path, mode: "stats" })`. Always mode=stats as the recommended first hop.
  - `extractLowerExt(p)` → shared 4-line helper; replaces an inlined regex inside the dispatch branch.
- **`fs.read` dispatch branch rewritten** (line ~976). Decision tree, in order:
  1. If `bin` (known binary ext) AND `lowerExt ∈ DOC_HARD_REJECT_EXTS` → return `[E_DOC_USE_DOCUMENT_READ]` with 3-line body: error label, "请调用 document.read, 先用 mode=stats..." prose, and `示例调用：document.read {json-template}`. Xlsx family also gets a `（遗留用法：xlsx_extract 仍可用，但推荐迁移到 document.read）` trailer.
  2. If `lowerExt === ".doc"` → return `[E_DOC_LEGACY_DOC_UNSUPPORTED]` with "另存为 .docx" guidance.
  3. If `lowerExt === ".csv"` → read as text, truncate at 12000 chars, append `\n\n(tip: for structured access use document.read mode=read)` after content. Soft-hint only, not a hard reject.
  4. Other binary types (png/jpg/zip/exe/etc.) → keep pre-existing `[E_BINARY_FILE]` path byte-for-byte.
  5. Non-binary → read as utf-8 (unchanged).

`desktop/tests/document-fs-read-hard-reject.test.ts` (new, 7 tests):

1. `foo.docx` → `[E_DOC_USE_DOCUMENT_READ]` + `document.read` + JSON template with `"path"` and `"mode"` keys.
2. `foo.pdf` → hard-reject with `"mode":"stats"` template.
3. `foo.pptx` → hard-reject with `"mode":"stats"` template.
4. `foo.xlsx` → hard-reject mentioning BOTH `xlsx_extract` (legacy note) AND `document.read`.
5. `foo.md` → succeeds (plain text pass-through — NOT hard-rejected).
6. `foo.csv` → succeeds; output contains `"a,b,c"` content AND `document.read` tip AND `mode=read` marker.
7. `foo.doc` → `[E_DOC_LEGACY_DOC_UNSUPPORTED]` + `.docx` save-as guidance.

### Task 2 — De-Python guidance + tool-schema steering

`desktop/src/main/services/builtin-tool-executor.ts`:

- **`buildWindowsPythonFallbackCommand`** changed from `function` (non-exported) to `export function`. Body unchanged — Test 5 enforces the contract stays intact.
- **`buildSkillExecutionGuidance`** rewritten to lead with structured tools:
  - Bullet 1 (after skill-path line): "优先使用结构化工具:" parent bullet with 3 children — document.read for docs, xlsx_extract for xlsx legacy, exec_command for shell/node.
  - Bullets 2-4: cwd behavior + cd preamble + structured-input node example (`{"command":"node scripts/<script>.js"...}`).
  - Bullet 5: "仅当技能脚本明确要求 Python 环境时..." — explicit demotion language.
  - Bullet 6: The old `cd /d "${skillPath}" && py -3 scripts/<script>.py` line, now labeled `python 最后备选写法（仅当节点方案均不适用）`.
  - Bullet 7: Absolute-path py -3 variant, also labeled 绝对路径备选.
- Export changed from `function` to `export function` for testability.

`desktop/src/main/services/tool-schemas.ts`:

- **`fs_read` description** now mentions both `document_read` (primary) and `xlsx_extract` (still works). Removed the bare "For Excel files (.xlsx/.xls) use xlsx_extract instead" line.
- **`xlsx_extract` description** prefixed with "LEGACY alias — prefer `document_read` which also exposes stats/outline/search."
- **`document_read` description** rewritten from a single-line paragraph to an 8-line multi-line string joined by `\n`:
  - Line 1: Purpose statement.
  - Line 2: "Use this instead of fs_read for ..." — explicit extension list.
  - Line 3: "Examples:" header.
  - Lines 4-7: Four numbered JSON examples, one per mode, with realistic paths (`./Q4.pptx`, `./report.docx`, `./book.pdf`) and mode-appropriate args (`locator.heading` for read, `query` for search).
  - Line 8: Working directory footer (preserved).

`desktop/tests/document-guidance-no-python.test.ts` (new, 6 tests):

1. `buildSkillExecutionGuidance("/some/skill")` → contains `/document\.read/`.
2. First bullet (ignoring markdown header + skill-path line) does NOT match `/\bpy\s+-3\b/` or `/\bpython\b/i`.
3. `fs_read` description matches both `/document_read/` and `/xlsx_extract/`.
4. `document_read` description matches all four `"mode":"X"` fragments (stats/outline/read/search).
5. `buildWindowsPythonFallbackCommand` is a function; result for non-python input is null (non-win32 path).
6. `xlsx_extract` description matches `/document_read/`.

## Test Coverage

### Regression

Combined vitest run:

```
pnpm exec vitest run \
  tests/document-fs-read-hard-reject.test.ts \
  tests/document-guidance-no-python.test.ts \
  tests/phase4-tool-executor.test.ts \
  tests/document-read-facade.test.ts \
  tests/document-read-wiring.test.ts
```

Result: **56/56 passing** across 5 test files.

- `document-fs-read-hard-reject.test.ts` — 7/7 (new)
- `document-guidance-no-python.test.ts` — 6/6 (new)
- `phase4-tool-executor.test.ts` — 23/23 (regression — no breakage in fs.*, exec.*, git, http, web)
- `document-read-facade.test.ts` — 13/13 (08-03 regression)
- `document-read-wiring.test.ts` — 7/7 (08-03 regression)

### Typecheck

`pnpm exec tsc --noEmit -p tsconfig.main.json` — only the 5 pre-existing `doc-cache.ts` errors from 08-01 remain (already logged in `deferred-items.md`). No new TS errors introduced by this plan.

## Task Commits

| Task | Phase | Hash      | Message                                                                        |
|------|-------|-----------|--------------------------------------------------------------------------------|
| 1    | RED   | `351bdbc` | `test(08-09): add failing tests for fs.read hard-reject on document formats`   |
| 1    | GREEN | `d90336e` | `feat(08-09): hard-reject fs.read for office/pdf/pptx with document.read template` |
| 2    | RED   | `d5b7810` | `test(08-09): add failing tests for de-python guidance + document.read steering` |
| 2    | GREEN | `1270214` | `feat(08-09): de-python skill guidance + steer tool-schemas to document.read`  |

## Deviations from Plan

### [Rule 1 — Bug] buildDocumentReadTemplate uses mode=stats uniformly, not mode=outline for non-pdf/pptx

- **Found during:** Task 1 GREEN when wiring template to tests.
- **Issue:** The plan's pseudocode (`const mode = ext === ".pdf" || ext === ".pptx" ? "stats" : "outline";`) would have made `.docx` / `.xlsx` land on `mode=outline` by default. But Test 2 of the plan explicitly required pdf to suggest `mode=stats` FIRST, and extending the same "stats first" principle to all formats produces a more uniform model experience (single example pattern to learn vs. per-format branch).
- **Fix:** Uniform `mode: "stats"` for every hard-rejected format. The 4 mode examples in `document_read`'s description still cover `outline` / `read` / `search` explicitly, so the model still learns the full surface — just via the schema, not via the error template.
- **Files modified:** `desktop/src/main/services/builtin-tool-executor.ts` (`buildDocumentReadTemplate`).
- **Commit:** `d90336e`.
- **Trace:** Plan acceptance criterion "pdf template suggesting `mode=stats` first" still holds (Test 2 passes); uniformity is a strictly-additive behavior change.

### [Rule 2 — Auto-add missing critical functionality] Added `extractLowerExt` helper instead of inlining regex

- **Found during:** Task 1 GREEN.
- **Issue:** The plan's action block 3 inlined `(filePath.match(/\.[^.\\/]+$/) ?? [""])[0].toLowerCase()` inside the dispatch branch. Mixing regex literals with dispatch logic reduces readability and duplicates logic already conceptually covered by `detectBinaryByExt`.
- **Fix:** Extracted `extractLowerExt(p): string` as a named top-level helper. Dispatch branch now reads `const lowerExt = extractLowerExt(filePath);` — one clean token. Zero behavioral difference.
- **Files modified:** `desktop/src/main/services/builtin-tool-executor.ts`.
- **Commit:** `d90336e`.

All deviations applied per GSD Rules 1-2. No architectural changes.

## Deferred Issues (out of scope)

- **Pre-existing TS errors in `doc-cache.ts`.** Still present from 08-01 (5 × `TS2322`/`TS2345` around `Dirent<NonSharedBuffer>`). Already logged in `deferred-items.md`. Not touched.
- **Markdown inline styling in md parser.** Carried over from 08-08's deferred list — unchanged by this plan.
- **CSV encoding detection (GBK fallback).** Carried over from 08-08's deferred list — unchanged by this plan.
- **fs_write route through document.read.** The facade is currently read-only. Writing docx/pdf/pptx output from the model would need a separate facade + per-format renderer. Out of scope for Phase 08 — Phase 08's charter was explicitly "document-ir-document-READ".

## Next Phase Readiness

### Phase 08 complete

With this plan, every Phase 08 Wave is closed:

- **Wave 1 (contract)**: 08-01 DocumentIR contract + parser-registry + ir-to-markdown. Wave 1 complete.
- **Wave 2 (infra)**: 08-02 doc-cache + 08-03 document.read facade + executor wiring. Wave 2 complete.
- **Wave 3 (parsers)**: 08-04 xlsx + 08-05 docx + 08-06 pdf + 08-07 pptx + 08-08 md/txt/csv. All 9 formats live. Wave 3 complete.
- **Wave 4 (model guidance)**: 08-09 fs_read gate + de-python guidance. Wave 4 complete.

### Surface that's now locked in

The model can no longer:

1. Silently `fs_read` a `.xlsx` / `.docx` / `.pdf` / `.pptx` — returns `[E_DOC_USE_DOCUMENT_READ]` with a paste-ready template.
2. Fall back to `py -3` as first choice in a skill guidance — the guidance leads with node-based options and demotes py -3.
3. Pick `xlsx_extract` without seeing "LEGACY" in the description.
4. Open `document_read` without seeing all 4 mode examples in the schema itself.

### Outstanding across Phase 08

- `doc-cache.ts` pre-existing TS errors (08-01 / 08-02 deferred — logged in `deferred-items.md`).
- MD inline-styling fidelity gap (08-08 deferred).
- CSV GBK encoding fallback (08-08 deferred).
- Future ".doc" (old Word binary) support would need a dedicated parser — current guidance routes the user to save as .docx.

## Self-Check: PASSED

Files verified:

- FOUND: `desktop/tests/document-fs-read-hard-reject.test.ts`
- FOUND: `desktop/tests/document-guidance-no-python.test.ts`
- FOUND: `desktop/src/main/services/builtin-tool-executor.ts` (modified — BINARY_EXT_MAP + helpers + fs.read branch + guidance)
- FOUND: `desktop/src/main/services/tool-schemas.ts` (modified — fs_read / xlsx_extract / document_read descriptions)

Commits verified:

- FOUND: `351bdbc` (Task 1 RED)
- FOUND: `d90336e` (Task 1 GREEN)
- FOUND: `d5b7810` (Task 2 RED)
- FOUND: `1270214` (Task 2 GREEN)

Acceptance criteria verified via grep:

- `grep -c "E_DOC_USE_DOCUMENT_READ" builtin-tool-executor.ts` → 1 (≥ 1 required) ✓
- `grep -c "E_DOC_LEGACY_DOC_UNSUPPORTED" builtin-tool-executor.ts` → 1 (≥ 1 required) ✓
- `grep -c "DOC_HARD_REJECT_EXTS" builtin-tool-executor.ts` → 2 (≥ 2 required — constant + check) ✓
- `grep -c 'suggestedTool: "document.read"' builtin-tool-executor.ts` → 6 (≥ 6 required — xlsx/xls/xlsm/docx/pdf/pptx) ✓
- `grep -c "export function buildSkillExecutionGuidance" builtin-tool-executor.ts` → 1 ✓
- `grep -c "Windows 上如果 python 不可用" builtin-tool-executor.ts` → 0 (old python-first line removed) ✓
- `grep -c "document\.read" builtin-tool-executor.ts` → 25 (≥ 3 required) ✓
- `grep -c "py -3" builtin-tool-executor.ts` → 7 (≥ 1 required — preserved as last-resort) ✓
- `grep -c "buildWindowsPythonFallbackCommand" builtin-tool-executor.ts` → 2 (≥ 2 required — function + call-site preserved) ✓
- `grep -c "document_read" tool-schemas.ts` → 4 (≥ 3 required) ✓
- `grep -cE '"mode":"(stats|outline|read|search)"' tool-schemas.ts` → 4 (≥ 4 required — all 4 examples) ✓

Test suites:

- `document-fs-read-hard-reject.test.ts` — 7/7 passing
- `document-guidance-no-python.test.ts` — 6/6 passing
- `phase4-tool-executor.test.ts` regression — 23/23 passing
- `document-read-facade.test.ts` + `document-read-wiring.test.ts` regression — 20/20 passing

Typecheck:

- `pnpm exec tsc --noEmit -p tsconfig.main.json` → only 5 pre-existing `doc-cache.ts` errors remain (logged in `deferred-items.md`). No new errors introduced by this plan.

---
*Phase: 08-document-ir-document-read*
*Completed: 2026-04-21*
