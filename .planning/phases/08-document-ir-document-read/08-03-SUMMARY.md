---
phase: 08-document-ir-document-read
plan: 03
subsystem: desktop/main/services/document + tool-schemas + ipc
tags:
  - document-ir
  - document-read
  - tool-facade
  - path-access-policy
  - wiring

dependency_graph:
  requires:
    - "08-01 DocumentIR contract (@shared/contracts/document)"
    - "08-01 parser-registry (getParser + __resetParserRegistryForTests)"
    - "08-01 ir-to-markdown (renderIrToMarkdown)"
    - "08-02 doc-cache (createDocCache + sha256OfBuffer)"
  provides:
    - "executeDocumentRead(args, deps) — mode router (stats/outline/read/search)"
    - "detectFormat(path) — ext -> DocumentFormat (with .doc special case)"
    - "DOC_MAX_BYTES = 50MB, DOC_MAX_CHARS_HARD_CAP = 32000, DOC_DEFAULT_MAX_CHARS = 8000"
    - "BuiltinToolExecutor.setDocCacheRoot(root) + lazy resolveDocCache()"
    - "document.read dispatch branch in executor (routed via existing PathAccessPolicy)"
    - "document_read OpenAI function schema (visible to the model)"
    - "buildToolLabel case for document.read args serialization"
    - "inferBuiltinToolSchemaGroup maps document_*/xlsx_extract -> 'fs' group"
  affects:
    - "08-04 xlsx migration: Wave 3 will register a parser via registerParser({format:'xlsx', parse}) and the model-facing surface is already live"
    - "08-05/06/07/08 docx/pdf/pptx/md-txt-csv parsers: same drop-in pattern, no executor changes needed"
    - "08-09 fs_read gate: will add hard rejection referencing document.read — facade's [E_DOC_FORMAT_UNSUPPORTED] list already aligned"

tech_stack:
  added: []
  patterns:
    - "lazy-factory-via-setter: setDocCacheRoot stores root; resolveDocCache builds cache on first dispatch"
    - "dispatch-with-hint-errors: every [E_DOC_*] branch carries an actionable Chinese sentence (ASST-04)"
    - "policy-reuse-by-composition: facade accepts resolved path; executor wraps dispatch in existing PathAccessPolicy"

key_files:
  created:
    - desktop/src/main/services/document/document-read-facade.ts
    - desktop/src/main/services/document/index.ts
    - desktop/tests/document-read-facade.test.ts
    - desktop/tests/document-read-wiring.test.ts
  modified:
    - desktop/src/main/services/builtin-tool-executor.ts
    - desktop/src/main/services/tool-schemas.ts
    - desktop/src/main/ipc/sessions.ts

decisions:
  - "Facade accepts already-resolved absolute path, not the raw user path. PathAccessPolicy reuse happens at executor dispatch boundary (inherited free of charge). Keeps the facade purely about mode routing + caching + parsing — no permission logic duplication."
  - "setDocCacheRoot is a one-line setter, not a constructor injection. Matches the existing setPathPolicy / setPathAudit pattern and keeps ipc/sessions.ts wiring symmetric (three setters at the same site)."
  - "Lazy cache factory (resolveDocCache) rather than eager. If setDocCacheRoot is never called, the first document.read call returns a structured [E_DOC_CACHE_NOT_INITIALIZED] error pointing the integrator at the wiring site — rather than a cryptic NPE."
  - "inferBuiltinToolSchemaGroup maps document_* AND legacy xlsx_extract to the 'fs' group. The pre-existing null-group bug on xlsx_extract would have hidden document_read from every policy; fixing it for both keeps the tool visible without extending BuiltinToolSchemaGroup."
  - "8 [E_DOC_*] error codes declared (6 required by the plan, plus READ_FAILED and INVALID_MODE for robustness). Every branch ends with a `请…。` sentence — grep-verifiable for ASST-04 traceability."
  - "ctx.runtime.paths.cacheDir is the canonical accessor, not ctx.paths.cacheDir (the plan's tentative phrasing). Verified against RuntimeContext shape in runtime-context.ts line 42-51."

metrics:
  duration_minutes: 13
  completed_date: "2026-04-21"
  tasks_total: 2
  tasks_done: 2
  tests_added: 20
  tests_passing: 20

requirements-completed: [TOOL-04, GOV-02, ASST-04]
---

# Phase 8 Plan 03: document.read Facade + Executor Wiring Summary

Single `document.read` tool with stats/outline/read/search modes, routed through the parser registry and backed by the sha256-keyed doc cache, with every error branch carrying an actionable next-step hint (ASST-04). PathAccessPolicy reused at the executor boundary — no new permission logic added.

## Performance

- Duration: ~13 min
- Started: 2026-04-21T13:09:13Z
- Completed: 2026-04-21T13:21:47Z
- Tasks: 2 (both TDD)
- Files created: 4
- Files modified: 3
- Tests added: 20 (all green)

## What Was Built

### Task 1 — document.read facade (`desktop/src/main/services/document/document-read-facade.ts`)

A single async `executeDocumentRead(args, deps)` that:

- Detects format from extension; `.doc` routes to a dedicated `[E_DOC_LEGACY_DOC_UNSUPPORTED]` with "另存为 .docx" hint; unknown extensions get `[E_DOC_FORMAT_UNSUPPORTED]` listing `xlsx/xls/xlsm/docx/pdf/pptx/md/txt/csv`.
- Enforces the 50MB file-size gate (`DOC_MAX_BYTES = 50 * 1024 * 1024`) before reading the buffer, and directs the model to `mode=stats` on overflow.
- Reads the buffer, computes sha256, and delegates IR construction to `cache.getOrBuild(sha, builder)` — so second reads of the same file skip parsing entirely.
- Routes by mode:
  - `stats` → compact JSON `{format, bytes, sha256, meta, outlineCount, bodyCount}`
  - `outline` → markdown list `- Lv{level}: title (locator-suffix)`
  - `read` → heading/page/slide/sheet/range slice → `renderIrToMarkdown` (clamped to 32000 hard cap) or JSON
  - `search` → case-insensitive substring scan over paragraphs/tables/slide-body/slide-notes, first 20 hits with `[locator-suffix] snippet` prefix
- Clamps `maxChars` to `[100, 32000]`; oversize output is truncated with `...（已截断）`.
- Emits a structured log line per call: `[document-read] read done {sha256, mode, path, returnedBytes, sessionId}`.
- Declares 8 `[E_DOC_*]` error codes; every branch ends with a Chinese sentence in `请…。` form (ASST-04).

Re-exported through `desktop/src/main/services/document/index.ts` barrel alongside the existing 08-01 / 08-02 modules.

### Task 2 — Executor + schemas + ipc wiring

`desktop/src/main/services/builtin-tool-executor.ts`:

- Added imports for `createDocCache` and `executeDocumentRead`.
- `inferOperation` now maps `document.read -> "read"`.
- Two new private fields: `_docCacheRoot` and `_docCache` (nulled when root changes).
- Two new methods: `setDocCacheRoot(root)` (mirrors `setPathPolicy` / `setPathAudit`) and private `resolveDocCache()` (lazy; throws `[E_DOC_CACHE_NOT_INITIALIZED]` with wiring-site hint when unset).
- New dispatch branch for `toolId === "document.read"` placed BEFORE the `xlsx.extract` branch. Parses JSON label, validates `path` + `mode`, resolves path through existing `resolvePathSafe` (which inherits the PathAccessPolicy wrap), grabs the cache, and delegates to the facade.
- Legacy `xlsx.extract` branch preserved byte-for-byte — a dedicated Wave 3 plan will migrate it.

`desktop/src/main/services/tool-schemas.ts`:

- Inserted a `document_read` function-calling schema after `xlsx_extract`, with the 4-mode enum, `path` + `mode` required, `maxChars` description explicitly mentioning `default 8000, hard cap 32000`.
- Added a `document.read` case to `buildToolLabel` that serializes the full arg set to JSON (matches the `xlsx.extract` pattern).
- Updated `inferBuiltinToolSchemaGroup` to route `document_*` — and the previously-ungrouped `xlsx_extract` — into the `"fs"` group, so both tools become visible under every existing tool policy (`generic.tools.default` etc.).

`desktop/src/main/ipc/sessions.ts`:

- Added `toolExecutor.setDocCacheRoot(ctx.runtime.paths.cacheDir)` immediately after `setPathPolicy` / `setPathAudit` (line 2604). Single well-known wiring point.

## Test Coverage

### `document-read-facade.test.ts` — 13 tests

1. Exported constants equal the documented 50MB / 32000 / 8000 values.
2. `detectFormat` maps known extensions and returns null for `.doc` / unknown.
3-7. Four-mode routing (stats / outline / read with locator / read whole / search) on a fake md parser.
8. 50MB gate on a sparse 51MB file via `truncateSync`.
9. `maxChars=999999` is clamped to 32000 with `...（已截断）` marker.
10. Unregistered format returns `[E_DOC_FORMAT_UNSUPPORTED]` with supported-format list and `请…。` hint.
11. Legacy `.doc` returns `[E_DOC_LEGACY_DOC_UNSUPPORTED]` with save-as-docx hint.
12. Successful call emits `[document-read] read done` with sha256 + mode + returnedBytes.
13. Every `[E_DOC_*]` branch (6 distinct codes exercised) ends with a `请…。` or `Please…\.` sentence — the ASST-04 traceability test.

### `document-read-wiring.test.ts` — 7 tests

1. `buildToolSchemas` exposes a `document_read` entry with the 4-mode enum and `path`/`mode` required.
2. Executor dispatches `document.read` to the facade and returns a successful `stats` payload.
3. Legacy `xlsx.extract` still dispatches correctly (no regression; no `[E_DOC_` leakage into the legacy branch).
4. `functionNameToToolId("document_read") === "document.read"` (the normalizer's default underscore→dot rule already covers it).
5. Schema documents `maxChars` default 8000 and hard cap 32000.
6. Dispatching `document.read` before `setDocCacheRoot` returns `[E_DOC_CACHE_NOT_INITIALIZED]` with a hint pointing at `sessions.ts` / `setDocCacheRoot`.
7. `buildToolLabel("document_read", …)` round-trips through JSON.

### Regression

`phase4-tool-executor.test.ts` + `phase4-tool-exec-timeout.test.ts` — 35 tests, all green. No breakage in `fs.*`, `exec.command`, `xlsx.extract`, git, http, or web tools.

Command: `cd desktop && pnpm exec vitest run tests/document-read-facade.test.ts tests/document-read-wiring.test.ts tests/phase4-tool-executor.test.ts tests/phase4-tool-exec-timeout.test.ts` → 55/55 passing.

## Task Commits

| Task | Phase | Hash      | Message                                                                                  |
|------|-------|-----------|------------------------------------------------------------------------------------------|
| 1    | RED   | `1e680ed` | `test(08-03): add failing tests for document.read facade`                                |
| 1    | GREEN | `aa6b9f9` | `feat(08-03): implement document.read facade with mode router + 50MB gate + audit log`   |
| 2    | RED   | `e1bfadd` | `test(08-03): add failing tests for document.read wiring (schemas + executor)`           |
| 2    | GREEN | `9f90df7` | `feat(08-03): wire document.read into builtin-tool-executor + tool-schemas`              |

## Deviations from Plan

### [Rule 3 — Blocking issue] Fixed pre-existing `xlsx_extract` grouping gap

- **Found during:** Task 2 (wiring)
- **Issue:** `inferBuiltinToolSchemaGroup("xlsx_extract")` returned `null`, which means the filter at `tool-schemas.ts:785` dropped `xlsx_extract` (and would have dropped `document_read` by the same rule). The plan's Test 1 (schema must include `document_read`) would have failed without grouping.
- **Fix:** Extended `inferBuiltinToolSchemaGroup` to map `document_*` AND legacy `xlsx_extract` into the existing `"fs"` group. Both share the fs-style path-access gate, so grouping is semantically correct. No new `BuiltinToolSchemaGroup` literal was introduced — avoids touching all 8 policy entries in `vendor-policy-registry.ts`.
- **Files modified:** `desktop/src/main/services/tool-schemas.ts` only.
- **Commit:** `9f90df7`
- **Trace:** Plan's acceptance criterion "grep `document_read` in `tool-schemas.ts` ≥ 2 matches" now returns 2 (schema entry + label-switch case); plan's Test 1 now passes.

### [Rule 1 — Bug] Fixed plan's tentative `ctx.paths.cacheDir` -> actual `ctx.runtime.paths.cacheDir`

- **Found during:** Task 2 tsc compile check
- **Issue:** Plan's action step 9 suggested `ctx.paths.cacheDir` but noted "adapt if the accessor differs". Actual `RuntimeContext` shape (line 42-51 of `runtime-context.ts`) exposes paths under `runtime.paths`.
- **Fix:** Used `ctx.runtime.paths.cacheDir` in `ipc/sessions.ts` and updated the `[E_DOC_CACHE_NOT_INITIALIZED]` hint text inside the executor to match.
- **Files modified:** `desktop/src/main/ipc/sessions.ts`, `desktop/src/main/services/builtin-tool-executor.ts`.

Both deviations were auto-applied per GSD deviation rules. No user decision needed.

## Deferred Issues (out of scope)

- Pre-existing TS errors in `desktop/src/main/services/document/doc-cache.ts` (5 `TS2322` / `TS2345` around `Dirent<NonSharedBuffer>` vs `Dirent<string>` at lines 58/65/122/131/133). Already logged in `deferred-items.md` by the 08-01 agent. Not caused by this plan — `pnpm exec tsc --noEmit -p tsconfig.main.json` output for this plan's files is clean; the five lines are from the sibling 08-02 file.

## Next Phase Readiness

### Ready for Wave 3 (08-04 xlsx migration, 08-05 docx, 08-06 pdf, 08-07 pptx, 08-08 md/txt/csv)

Each Wave 3 plan now reduces to:

1. Add a parser impl under `desktop/src/main/services/document/parsers/`.
2. Register it via `registerParser({ format, parse })` at main startup.
3. Done — the model-facing `document_read` schema is already live and the executor already dispatches to the facade.

No more executor, IPC, or schema changes needed for the remaining Wave 3 plans.

### Ready for 08-09 (fs_read gate + python-first guidance cleanup)

- Facade's `[E_DOC_FORMAT_UNSUPPORTED]` message already mentions the same format list (`xlsx/xls/xlsm/docx/pdf/pptx/md/txt/csv`) that `fs_read`'s new hard-reject should point to. 08-09 can copy the list or reference a shared constant.
- Audit log format `[document-read] {sha256, mode, path, returnedBytes}` is established; `fs_read`'s binary-format rejection can land on the same log subsystem for consistency.

### Outstanding

- Wave 3 parsers (08-04 through 08-08) still need implementation.
- `doc-cache.ts` pre-existing TS errors (deferred to 08-02 owner or Phase 08 verifier).

## Self-Check: PASSED

Files verified:

- FOUND: `desktop/src/main/services/document/document-read-facade.ts`
- FOUND: `desktop/src/main/services/document/index.ts`
- FOUND: `desktop/tests/document-read-facade.test.ts`
- FOUND: `desktop/tests/document-read-wiring.test.ts`

Commits verified:

- FOUND: `1e680ed` (Task 1 RED)
- FOUND: `aa6b9f9` (Task 1 GREEN)
- FOUND: `e1bfadd` (Task 2 RED)
- FOUND: `9f90df7` (Task 2 GREEN)

Acceptance criteria verified via grep:

- `grep -c "document\.read" builtin-tool-executor.ts` → 6 (≥ 3 required)
- `grep -n "setDocCacheRoot" builtin-tool-executor.ts` → 2 matches (setter definition + hint string, covering setter + resolve check)
- `grep -n "setDocCacheRoot" ipc/sessions.ts` → exactly 1 match at line 2604
- `grep -c "E_DOC_CACHE_NOT_INITIALIZED" builtin-tool-executor.ts` → 1 match
- `grep -c "document_read" tool-schemas.ts` → 2 matches (schema entry + label switch case)
- `grep -n '"stats", "outline", "read", "search"' tool-schemas.ts` → 1 match at schema entry
- `grep -c "executeXlsxExtract" builtin-tool-executor.ts` → 2 matches (definition + call-site)
- `grep -c 'if (toolId === "xlsx.extract")' builtin-tool-executor.ts` → 2 matches (comment + actual branch; branch intact)
- `grep -c "50 \* 1024 \* 1024" facade` → 1 match
- `grep -c "32000" facade` → 1 match
- `grep -cE "\[E_DOC_[A-Z_]+\]" facade` → 12 matches covering 8 distinct error codes (≥ 6 required)
- `grep -c "import.*PathAccessPolicy" facade` → 0 matches (reuse happens at executor layer only)

Test suites:

- `document-read-facade.test.ts` — 13/13 passing
- `document-read-wiring.test.ts` — 7/7 passing
- `phase4-tool-executor.test.ts` + `phase4-tool-exec-timeout.test.ts` regression — 35/35 passing

Typecheck:

- `pnpm exec tsc --noEmit -p tsconfig.main.json` → only 5 pre-existing `doc-cache.ts` errors remain (logged in `deferred-items.md`). No new errors introduced by this plan.

---
*Phase: 08-document-ir-document-read*
*Completed: 2026-04-21*
