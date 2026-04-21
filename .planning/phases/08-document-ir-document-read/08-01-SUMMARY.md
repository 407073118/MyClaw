---
phase: 08-document-ir-document-read
plan: 01
subsystem: contracts
tags: [document-ir, markdown, parser-registry, type-only, desktop, vitest]

requires: []

provides:
  - DocumentIR TypeScript contract (DocumentSource/Meta/Locator/OutlineItem/MediaRef/InlineRun + 12-kind DocumentNode union)
  - Parser registry module (DocumentParser interface + register/get/list/reset helpers)
  - Pure IR->Markdown renderer (renderIrToMarkdown covering all 12 kinds with maxChars + includeImages)

affects:
  - 08-02 (doc-cache)
  - 08-03 (document.read facade)
  - 08-04 (xlsx parser)
  - 08-05 (docx parser)
  - 08-06 (pdf parser)
  - 08-07 (pptx parser)
  - 08-08 (md/txt/csv parsers)
  - 08-09 (fs_read gate + python-first guidance cleanup)

tech-stack:
  added: []
  patterns:
    - "Type-only contract module in desktop/shared/contracts/, re-exported via barrel index.ts"
    - "Pure utility module under desktop/src/main/services/document/ mirroring the ppt/ subfolder pattern"
    - "In-memory registry keyed by DocumentFormat with test-only reset helper"
    - "Exhaustive switch over discriminated union with never-type guard for future-proofing"

key-files:
  created:
    - desktop/shared/contracts/document.ts
    - desktop/src/main/services/document/parser-registry.ts
    - desktop/src/main/services/document/ir-to-markdown.ts
    - desktop/tests/document-ir-contract.test.ts
    - desktop/tests/document-ir-to-markdown.test.ts
    - .planning/phases/08-document-ir-document-read/deferred-items.md
  modified:
    - desktop/shared/contracts/index.ts

key-decisions:
  - "DocumentNode uses discriminated union with 12 kinds (heading/paragraph/list/table/image/code/quote/slide/sheet/comment/footnote/pageBreak), not a class hierarchy — keeps IR type-only and zero-runtime"
  - "Table renderer treats first row as GFM header and emits `| --- | --- |` separator — matches the Wave 2 facade's markdown output expectation"
  - "Image modes `refs` and `inline` both emit `![alt](media:<id>)`; actual data-uri inlining is pushed to the caller rather than baked into the renderer"
  - "maxChars truncation appends literal `\\n\\n...（已截断）` (Chinese) to match plan-specified behavior and user-facing tone"
  - "Output normalization collapses trailing newlines to exactly `\\n\\n` instead of `trimEnd() + \"\\n\"`, preserving per-node `\\n\\n` terminators so `## Hello\\n\\n` renders correctly"

patterns-established:
  - "Contract file: type-only TS module, no imports outside @shared, JSDoc in Chinese on field-level semantics"
  - "Registry pattern: Map<format, parser> + register/get/list + __resetXxxForTests (never production)"
  - "Renderer pattern: one renderX helper per node kind + renderNode dispatcher with `never` exhaustiveness guard"

requirements-completed: [TOOL-04]

duration: ~8min
completed: 2026-04-21
---

# Phase 08 Plan 01: DocumentIR Contract + Parser Registry + IR->Markdown Renderer Summary

**Type-only DocumentIR contract with 12-kind DocumentNode union, in-memory parser registry, and pure GFM Markdown renderer — the A-skeleton that Wave 2+ parsers and the document.read facade compile against.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-21T12:53:00Z
- **Completed:** 2026-04-21T13:01:24Z
- **Tasks:** 2 (both TDD)
- **Files created:** 6
- **Files modified:** 1
- **Tests added:** 11 (all green)

## Accomplishments

- `DocumentIR` type locked with `source / meta / outline / body / media` top-level fields and `DocumentFormat` enum covering `xlsx|xls|xlsm|docx|pdf|pptx|md|txt|csv`.
- 12-kind `DocumentNode` discriminated union compiles under strict TS with exhaustive switch guards in the renderer.
- `DocumentParser` interface + `registerParser / getParser / listRegisteredFormats / __resetParserRegistryForTests` shipped as a pure in-memory registry keyed by `DocumentFormat`.
- `renderIrToMarkdown` handles all 12 kinds, GFM tables with pipe/newline escaping, InlineRun bold/italic/code, slide notes block, sheet header, and `maxChars` truncation with the Chinese `...（已截断）` marker.
- Zero `node:*` / `electron` imports in any new module — fully pure, test-friendly, bundler-safe.

## Task Commits

1. **Task 1 RED: Failing DocumentIR contract test** — `d7a7095` (test)
2. **Task 1 GREEN: DocumentIR contract + barrel re-export** — `92eae15` (feat)
3. **Task 2 RED: Failing parser-registry + ir-to-markdown tests** — `7d4c3a8` (test)
4. **Task 2 GREEN: parser-registry + IR->Markdown renderer** — `1607155` (feat)

**Plan metadata:** (to be added after SUMMARY / STATE / ROADMAP updates)

## Files Created/Modified

- `desktop/shared/contracts/document.ts` — DocumentIR + all 12 node kinds, type-only
- `desktop/shared/contracts/index.ts` — added `export * from "./document";` in alphabetical slot after `./calendar`
- `desktop/src/main/services/document/parser-registry.ts` — DocumentParser interface + registry API
- `desktop/src/main/services/document/ir-to-markdown.ts` — pure renderer, 12 kinds, maxChars + includeImages
- `desktop/tests/document-ir-contract.test.ts` — 2 tests (literal construction + 12-kind exhaustive switch)
- `desktop/tests/document-ir-to-markdown.test.ts` — 9 tests (all 5 plan behaviors + 12-kind smoke + inline styles + pipe escape + registry API)
- `.planning/phases/08-document-ir-document-read/deferred-items.md` — log of pre-existing 08-02 `doc-cache.ts` TS errors

## Decisions Made

- **12-kind union up front.** Plan CONTEXT.md lists 12 node types; defined all at once so Wave 2 parsers can target any without contract churn. Trade-off: some kinds (comment/footnote/pageBreak) have no parser consumer yet, but adding them later would force a contract revision and re-test of all downstream consumers.
- **First table row = GFM header.** Real parsers (docx / pptx) may not always have a dedicated header row, but GFM requires one. A future `table.hasHeader` flag could be introduced without breaking the current shape.
- **Image modes merged.** `refs` and `inline` both emit `![alt](media:<id>)`; the plan's behavior spec allows this. Callers that want true inline data-uris replace the `media:` URL themselves — keeps the renderer pure.
- **`\n\n` normalization over trimEnd.** Initial `joined.trimEnd() + "\n"` collapsed heading terminators. Switched to `joined.replace(/\n+$/u, "\n\n")` to preserve plan-specified heading output `## Hello\n\n`.

## Deviations from Plan

None that required architectural action. One minor behavior adjustment (newline normalization) was made during TDD GREEN when Test 1 failed — documented above under Decisions.

One out-of-scope observation was logged to `deferred-items.md`:

- **[Out of scope]** `desktop/src/main/services/document/doc-cache.ts` (committed by the parallel 08-02 agent at `766db14`) has 5 pre-existing TS errors around `Dirent<NonSharedBuffer>` vs `Dirent<string>`. Not caused by this plan's changes. Flagged for the 08-02 owner / Phase 08 verifier.

## Issues Encountered

- Initial `renderIrToMarkdown` implementation used `trimEnd()` on the joined output, which stripped the `\n\n` suffix from trailing headings. Diagnosed via Test 1 failure; fixed by replacing with a regex-based newline normalizer. Single iteration, no further failures.

## User Setup Required

None — pure TS contracts and in-memory utilities. No env vars, no external services, no new deps.

## Next Phase Readiness

**Ready for Wave 2 (08-02 doc-cache — already in flight, 08-03 document.read facade) and Wave 3 parsers:**

- Contract surface is stable; `DocumentParser`, `ParseInput`, and `DocumentIR` can be imported directly without waiting for more scaffolding.
- IR→Markdown renderer passes 11 tests; document.read facade can call `renderIrToMarkdown(ir, { maxChars, includeImages })` as its `format: "markdown"` implementation.
- `__resetParserRegistryForTests` available so Wave 3 parser tests can run in isolation.

**Blockers / concerns:** None from this plan. Sibling 08-02 `doc-cache.ts` has TS errors that will need resolution before Phase 08 verifier passes — already logged.

## Self-Check: PASSED

Verified claims:

- `desktop/shared/contracts/document.ts` — EXISTS
- `desktop/shared/contracts/index.ts` contains `export * from "./document"` — CONFIRMED
- `desktop/src/main/services/document/parser-registry.ts` — EXISTS
- `desktop/src/main/services/document/ir-to-markdown.ts` — EXISTS
- `desktop/tests/document-ir-contract.test.ts` — EXISTS, 2 tests passing
- `desktop/tests/document-ir-to-markdown.test.ts` — EXISTS, 9 tests passing
- Commits `d7a7095`, `92eae15`, `7d4c3a8`, `1607155` — all present in `git log`
- `grep -c "case \"" ir-to-markdown.ts` returns 12 — CONFIRMED
- `grep -c "kind:" document.ts` returns 12 — CONFIRMED
- No `import` from `node:*` or `electron` in new module files — CONFIRMED

---
*Phase: 08-document-ir-document-read*
*Completed: 2026-04-21*
