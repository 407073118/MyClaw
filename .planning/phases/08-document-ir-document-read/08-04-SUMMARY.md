---
phase: 08-document-ir-document-read
plan: 04
subsystem: desktop/main/services/document/parsers + builtin-tool-executor
tags:
  - document-ir
  - xlsx-parser
  - parser-registry
  - backward-compat
  - wave-3

dependency_graph:
  requires:
    - "08-01 DocumentIR contract + parser-registry"
    - "08-03 document.read facade + setDocCacheRoot wiring"
  provides:
    - "xlsxParser/xlsParser/xlsmParser — DocumentParser implementations for Excel formats"
    - "parseXlsxBuffer(input) — pure SheetJS-backed DocumentIR builder with merge expansion"
    - "BuiltinToolExecutor.ensureParsersRegistered — idempotent registration at dispatch entry"
  affects:
    - "08-05 docx / 08-06 pdf / 08-07 pptx / 08-08 md-txt-csv: same drop-in pattern — add parser, register in ensureParsersRegistered (or another seam), done"
    - "08-09 fs_read gate: xlsx/xls/xlsm formats are now live behind document.read; fs_read can hard-reject these extensions and redirect"

tech_stack:
  added: []
  patterns:
    - "idempotent-parser-registration: dispatch-entry guard uses getParser check so test replacements / future overrides are not clobbered"
    - "legacy-untouched: executeXlsxExtract body preserved byte-for-byte; only a 3-line comment block added above the method for deprecation traceability"
    - "buffer-only-parsing: parseXlsxBuffer consumes ParseInput.buffer via XLSX.read(buffer, {type:'buffer'}); no readFile/readFileSync in parser source"

key_files:
  created:
    - desktop/src/main/services/document/parsers/xlsx-parser.ts
    - desktop/tests/document-parser-xlsx.test.ts
    - desktop/tests/document-xlsx-extract-alias.test.ts
  modified:
    - desktop/src/main/services/document/index.ts
    - desktop/src/main/services/builtin-tool-executor.ts

decisions:
  - "Lazy registration at dispatch entry (ensureParsersRegistered), not constructor. Avoids loading xlsx at executor construction time (main-process startup stays light), but guarantees parsers are live before the first dispatch call."
  - "Guard with getParser check before registerParser. If a test replaced the xlsx parser earlier in the suite, the executor must not clobber it. registerParser is last-write-wins, so skipping-when-present preserves test replacements and opt-in overrides."
  - "Legacy executeXlsxExtract body left 100% untouched. No shim, no re-routing, no re-entry. The legacy path still calls xlsxMod.readFile directly and emits the exact pre-Phase-8 markdown output (incl. the `（共 N 行，已显示前 M 行...）` truncation footer). Byte-compatibility is non-negotiable during the deprecation window."
  - "Merge expansion happens in the AoA layer (not deferred to the renderer). The anchor value is copied into every covered cell, so downstream consumers (outline, search, markdown renderer, JSON mode) all see a rectangular, fully-filled matrix without caring about merge metadata."
  - "Parser does not read !merges metadata into the IR. TableNode carries no merge info — just expanded values. This keeps the IR contract unchanged and matches CONTEXT.md's requirement that 'merged cells are represented in the table representation' without introducing a new node/field."

metrics:
  duration_minutes: 8
  completed_date: "2026-04-21"
  tasks_total: 2
  tasks_done: 2
  tests_added: 12
  tests_passing: 12

requirements-completed: [TOOL-04]
---

# Phase 8 Plan 04: XLSX Parser Wired Into document.read Summary

SheetJS-backed `parseXlsxBuffer` produces `DocumentIR` with merged cells expanded; registered on the executor at first dispatch via an idempotent guard. Legacy `xlsx.extract` toolId left byte-compatibly intact — only a 3-line deprecation comment added above it.

## Performance

- Duration: ~8 min
- Started: 2026-04-21T13:27:05Z
- Completed: 2026-04-21T13:34:56Z
- Tasks: 2 (both TDD RED→GREEN)
- Files created: 3
- Files modified: 2
- Tests added: 12 (all green)

## What Was Built

### Task 1 — xlsxParser (`desktop/src/main/services/document/parsers/xlsx-parser.ts`)

A new parsers/ subfolder under `document/` hosts the first `DocumentParser` implementation:

- `parseXlsxBuffer(input)` — async function consuming `ParseInput` (path / buffer / sha256 / mediaDir) and returning `DocumentIR`.
  - Uses `require("xlsx")` lazily (matches the legacy `executeXlsxExtract` pattern — no hard dep at startup).
  - Calls `XLSX.read(buffer, { type: "buffer" })` exclusively — no filesystem touch, even on a nonexistent path input.
  - For each sheet, pulls `sheet_to_json(sheet, { header: 1, defval: "" })`, then iterates `sheet["!merges"]` and copies the anchor value across every covered cell. Rows are padded to the workbook's max column count.
  - Emits one `SheetNode` per sheet (`kind: "sheet"`, `name`, `dims: {rows, cols}`, `table: TableNode`, `locator: { sheet }`) and one `OutlineItem` per sheet (`level: 1`, `title: name`, `locator.sheet`).
  - `source.format` derived from extname (`xlsx` / `xls` / `xlsm`); anything else falls back to `xlsx`. `sha256` and `bytes` pass through from `ParseInput` verbatim.
- Exports three `DocumentParser` singletons: `xlsxParser` / `xlsParser` / `xlsmParser` — each with a distinct format tag but sharing the same `parse` function. This keeps registry entries explicit (one per format) without duplicating implementation.
- Re-exported through `desktop/src/main/services/document/index.ts` barrel so downstream consumers import from `./document`.

### Task 2 — Executor registration wiring (no legacy path disturbance)

`desktop/src/main/services/builtin-tool-executor.ts`:

- New imports: `getParser` + `registerParser` from `parser-registry`, and the three parser singletons from `parsers/xlsx-parser`.
- New private field `parsersRegistered: boolean` alongside the existing `_docCacheRoot` / `_docCache`.
- New private method `ensureParsersRegistered()`:
  - Returns immediately if already done (idempotent).
  - For each of `xlsx` / `xls` / `xlsm`: only calls `registerParser` if `getParser(format)` returns `null` — preserves earlier test replacements and future opt-in overrides.
  - Sets `parsersRegistered = true` only after the three checks, so a future extension that fails mid-registration can be re-tried.
- Call-site: `this.ensureParsersRegistered()` at the very top of `dispatch()` (line ~948). Guarantees parsers are live before `document.read`, `xlsx.extract`, or any future document-tool dispatch, without front-loading heavy deps at executor construction.
- Legacy `executeXlsxExtract(label, cwd, ctx)` body untouched. The ONLY change in that region is a 3-line JSDoc-adjacent comment block above the method declaration:
  ```
  // NOTE: legacy toolId "xlsx.extract" preserved for backward compatibility.
  // Prefer document.read (Phase 8). Remove in a future phase after deprecation window.
  // Byte-compatible output is tested by tests/document-xlsx-extract-alias.test.ts.
  ```
- `xlsxMod.readFile(resolved)` call still present (grep-verified) — confirms the legacy path remains intact.

## Test Coverage

### `document-parser-xlsx.test.ts` — 7 tests

1. 2-sheet workbook → two SheetNodes with correct name + `dims`.
2. Empty cells render as `[{ text: "" }]` runs (matches `defval: ""`).
3. Merge `A1:B1` with anchor "Q1" → both `rows[0][0]` and `rows[0][1]` hold `[{ text: "Q1" }]`; row 2 untouched.
4. Extname → format mapping covers `xlsx` / `xls` / `xlsm`; `sha256` and `bytes` forwarded from `ParseInput`.
5. `meta.pages` undefined; outline has one entry per sheet with `level: 1` and `locator.sheet`.
6. Parser source file contains no `readFile(Sync)?(` call (grep-assertion); runtime call against a nonexistent path still succeeds (proves buffer-only).
7. Exports: `xlsxParser.format === "xlsx"`, `xlsParser.format === "xls"`, `xlsmParser.format === "xlsm"`, each with a callable `parse` function.

### `document-xlsx-extract-alias.test.ts` — 5 tests

1. `xlsx.extract` returns markdown table output containing `| ` header, `| --- ` separator, and `工作表 "Summary"（可选：Summary, Details）` sheet header — no `[E_DOC_*]` leakage.
2. `xlsx.extract` with `sheet: "Details"` targets that sheet (header contains `工作表 "Details"` and only `Details` column names, not `Col1`).
3. `xlsx.extract` with `maxRows: 3` on a 6-row sheet emits the Chinese footer `（共 6 行，已显示前 3 行...）`.
4. `document.read` with `mode: "stats"` on the same xlsx returns JSON with `format: "xlsx"`, `bodyCount: 2`, `outlineCount: 2`, a valid 64-hex sha256, and positive `bytes`.
5. Two consecutive `document.read` dispatches leave the registry with exactly `[xls, xlsm, xlsx]` — parsers are registered once, not multiplied.

### Regression

- `phase4-tool-executor.test.ts` (23 tests): all green. No regression in `fs.*`, `exec.command`, git, http, or web tools.
- `document-read-facade.test.ts` (13 tests): all green.
- `document-read-wiring.test.ts` (7 tests): all green.

Command: `cd desktop && pnpm exec vitest run tests/document-parser-xlsx.test.ts tests/document-xlsx-extract-alias.test.ts tests/phase4-tool-executor.test.ts` → 35/35 passing.

## Task Commits

| Task | Phase | Hash      | Message                                                                     |
|------|-------|-----------|-----------------------------------------------------------------------------|
| 1    | RED   | `2dd8ea4` | `test(08-04): add failing tests for xlsxParser (DocumentIR)`                |
| 1    | GREEN | `3b343c2` | `feat(08-04): implement xlsxParser for DocumentIR (xlsx/xls/xlsm)`          |
| 2    | RED   | `69db472` | `test(08-04): add failing tests for xlsx parser registration + legacy alias`|
| 2    | GREEN | `7f536f1` | `feat(08-04): register xlsx/xls/xlsm parsers on executor; keep legacy path intact` |

## Deviations from Plan

### [Rule 3 — Blocking issue] Test 6 strategy switched from `vi.spyOn(fs, …)` to source-level grep

- **Found during:** Task 1 first GREEN run.
- **Issue:** The plan's Test 6 suggested `vi.spyOn(fsPromises, "readFile")` + `vi.spyOn(fsModule, "readFileSync")` to prove the parser is buffer-only. Vitest 3 with Vite ESM rejects those spies at runtime (`Cannot spy on export "readFile". Module namespace is not configurable in ESM.`).
- **Fix:** Reframed Test 6 as a two-pronged assertion:
  1. Static: read `xlsx-parser.ts` as text and `expect(...).not.toMatch(/readFile(Sync)?\s*\(/)` — catches any future regression that adds a filesystem read to the parser.
  2. Runtime: call `parseXlsxBuffer` with a path that deliberately does not exist on disk. If the parser ever opened the path, Node would throw ENOENT; success proves buffer-only behavior.
- **Files modified:** `desktop/tests/document-parser-xlsx.test.ts` only.
- **Commit:** included in `3b343c2` (Task 1 GREEN).
- **Trace:** Plan's "Parser does NOT open the file path" truth is still enforced, with a more robust mechanism (source grep + nonexistent-path runtime check) than module-level spy stubbing.

No other deviations. Plan executed as written.

## Deferred Issues (out of scope)

- Pre-existing TS errors in `desktop/src/main/services/document/doc-cache.ts` (5 `TS2322` / `TS2345` at lines 58/65/122/131/133). Already logged in `deferred-items.md` by the 08-01 agent. Not introduced by this plan — this plan's own files compile cleanly under `tsc --noEmit -p tsconfig.main.json`.

## Next Phase Readiness

### Ready for remaining Wave 3 plans (08-05 docx, 08-06 pdf, 08-07 pptx, 08-08 md/txt/csv)

The plumbing proven here is reusable:

1. Add `parsers/<format>-parser.ts` exporting a `DocumentParser` + optional sibling singletons.
2. Re-export from `document/index.ts` barrel.
3. Add an import + `getParser`/`registerParser` pair inside `ensureParsersRegistered` — three lines per format family.
4. Done. `document.read` dispatch and `document_read` schema are already live (from 08-03).

No executor, IPC, or schema changes needed for the remaining Wave 3 plans.

### Ready for 08-09 (fs_read gate + python-first guidance cleanup)

The `xlsx`/`xls`/`xlsm` formats are now fully served by `document.read`. `fs_read` can hard-reject these extensions and point users at `document.read` without losing any capability.

## Self-Check: PASSED

Files verified:

- FOUND: `desktop/src/main/services/document/parsers/xlsx-parser.ts`
- FOUND: `desktop/tests/document-parser-xlsx.test.ts`
- FOUND: `desktop/tests/document-xlsx-extract-alias.test.ts`
- FOUND: `desktop/src/main/services/document/index.ts` (modified)
- FOUND: `desktop/src/main/services/builtin-tool-executor.ts` (modified)

Commits verified:

- FOUND: `2dd8ea4` (Task 1 RED)
- FOUND: `3b343c2` (Task 1 GREEN)
- FOUND: `69db472` (Task 2 RED)
- FOUND: `7f536f1` (Task 2 GREEN)

Acceptance criteria verified via grep:

- `grep -c 'require("xlsx")' xlsx-parser.ts` → 2 (1 comment reference + 1 actual call)
- `grep -c '!merges' xlsx-parser.ts` → 2 (1 comment reference + 1 access)
- `grep -cE 'readFile|readFileSync' xlsx-parser.ts` → 0 (parser is buffer-only)
- `grep -c 'ensureParsersRegistered\|parsersRegistered' builtin-tool-executor.ts` → 5 (field + guard method header + two return/set lines + dispatch call-site comment/call)
- `grep -c 'import.*xlsxParser\|import.*xlsParser' builtin-tool-executor.ts` → 1
- `grep -c 'executeXlsxExtract' builtin-tool-executor.ts` → 2 (definition + dispatch call-site)
- `grep -cE 'xlsxMod.readFile|xlsxMod.read\(' builtin-tool-executor.ts` → 1 (legacy body preserved)
- `grep -c 'legacy toolId "xlsx.extract"' builtin-tool-executor.ts` → 1 (deprecation note present)

Test suites:

- `document-parser-xlsx.test.ts` — 7/7 passing
- `document-xlsx-extract-alias.test.ts` — 5/5 passing
- `phase4-tool-executor.test.ts` regression — 23/23 passing
- `document-read-facade.test.ts` + `document-read-wiring.test.ts` regression — 20/20 passing

Typecheck:

- `pnpm exec tsc --noEmit -p tsconfig.main.json` → only the pre-existing 5 `doc-cache.ts` errors remain (logged in `deferred-items.md`). No new errors introduced by this plan.

---
*Phase: 08-document-ir-document-read*
*Completed: 2026-04-21*
