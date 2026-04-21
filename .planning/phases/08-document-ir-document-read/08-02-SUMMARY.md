---
phase: 08-document-ir-document-read
plan: 02
subsystem: desktop/main/services/document
tags:
  - document-ir
  - cache
  - lru
  - sha256
dependency_graph:
  requires:
    - "desktop/src/main/services/logger.ts (createLogger)"
    - "desktop/src/main/services/directory-service.ts (MyClawPaths.cacheDir; wiring happens in 08-03)"
  provides:
    - "createDocCache(opts) — factory returning DocCache instance"
    - "sha256OfBuffer(buf) — shared sha256 helper"
    - "DEFAULT_CACHE_MAX_BYTES — 500MB cap constant"
    - "DocCache / DocCacheMeta / DocCacheOptions types"
  affects:
    - "Wave 2: document.read executor will call createDocCache + setDocCacheRoot in 08-03"
    - "Phase 8 acceptance anchor: 同一文件二次读秒回"
tech_stack:
  added: []
  patterns:
    - "factory-returns-closure (rootDir + maxBytes closed over)"
    - "disk-backed LRU (meta.lastAccess drives eviction)"
    - "graceful ENOENT / JSON-parse fallback (treat as miss)"
key_files:
  created:
    - desktop/src/main/services/document/doc-cache.ts
    - desktop/tests/document-doc-cache.test.ts
  modified: []
decisions:
  - "Factory over singleton — keeps module pure-Node, testable without Electron and without global state."
  - "LRU by meta.lastAccess (ISO8601 string) rather than mtime — resilient to clock skew and file-system touches that aren't real reads."
  - "Corrupted ir.json OR missing/corrupt meta.json both trigger rebuild — no partial-state recovery path to reason about."
  - "enforceLru runs after every successful build (best-effort, errors logged, never thrown) — keeps cache bounded without a background sweeper."
metrics:
  duration_minutes: 8
  completed_date: "2026-04-21"
  tasks_total: 1
  tasks_done: 1
---

# Phase 8 Plan 02: Doc Cache (sha256-keyed on-disk IR cache) Summary

One-liner: Disk-backed sha256-keyed IR cache with LRU eviction at 500MB, using meta.json lastAccess for ordering and treating corrupted entries as cache misses.

## What Was Built

A self-contained, pure-Node cache module at `desktop/src/main/services/document/doc-cache.ts` plus a 10-case vitest suite at `desktop/tests/document-doc-cache.test.ts`.

Surface:

- `createDocCache({ rootDir, maxBytes? }) -> DocCache` — factory; cache root is `<rootDir>/docCache/`.
- `sha256OfBuffer(Buffer) -> string` — hex sha256, shared helper.
- `DEFAULT_CACHE_MAX_BYTES = 500 * 1024 * 1024`.
- `DocCache` instance exposes:
  - `getRoot()` / `entryDir(sha)` / `mediaDir(sha)`
  - `getOrBuild(sha, builder)` — returns cached IR or invokes `builder(mediaDir)` then persists
  - `clear()` — `rm -rf` the docCache root
  - `enforceLru()` — callable independently for manual sweeps

On-disk layout per entry (matches CONTEXT.md §4):

```
<rootDir>/docCache/<sha>/
  ir.json        # DocumentIR serialized
  media/         # asset outputs from builder
  meta.json      # { sha256, cachedAt, lastAccess, hits, bytes }
```

## Why These Choices

- **Factory over module-level state:** plan 08-03 will call `setDocCacheRoot` from `desktop/src/main/ipc/sessions.ts` at the same site that already wires `setPathPolicy`. A factory makes that wiring one line while keeping the module unit-testable in isolation — no Electron mocks, no global reset between tests.
- **`import type { DocumentIR } from "@shared/contracts"`:** Only a type reference. esbuild strips it at import-elision before tests run, so 08-02 does not depend on 08-01's contract file existing at runtime — matching the "no overlap with 08-01" requirement in the plan header.
- **LRU by ISO timestamps in meta.json:** chose string timestamps over mtime because (a) meta.json is rewritten on every hit so lastAccess reflects logical reads, not incidental file touches, and (b) string ISO8601 sorts the same as numeric time for the ranges we care about.
- **Corrupted entry = miss:** keeps the state machine tiny. There's no "partial" state to inspect — if either ir.json or meta.json won't parse, builder runs, both files are overwritten, hits reset to 0.
- **Best-effort enforceLru:** runs after every miss, wrapped in try/catch that logs and swallows. A user-facing read must never fail because eviction tripped on a half-removed directory.

## Test Coverage (10/10 passing)

1. DEFAULT_CACHE_MAX_BYTES is 500MB
2. sha256OfBuffer produces stable 64-char hex, differs across inputs
3. Cold cache: builder invoked once, ir.json + meta.json + media/ all persisted with correct meta fields
4. Warm cache: builder NOT invoked, returned IR deep-equals the first result
5. Second warm read increments hits and advances lastAccess; third read bumps again
6. LRU: with maxBytes=2048 and 4 bulky entries, oldest is evicted, newest survives
7. Corrupted ir.json triggers rebuild; meta.hits resets to 0
8. `clear()` removes the entire docCache root
9. `getRoot()` equals `<rootDir>/docCache`
10. Missing entry (ENOENT) is handled as miss without throwing

Command: `cd desktop && pnpm exec vitest run tests/document-doc-cache.test.ts`

## Deviations from Plan

None — plan executed exactly as written. The only implementation-level call-out is that `enforceLru` was made part of the public `DocCache` surface (plan listed it in the DocCache type but only as an obligation on the factory); this lets later plans call it explicitly from a maintenance IPC if needed.

## Key Files

Created:

- `desktop/src/main/services/document/doc-cache.ts` — cache factory, LRU, helpers (239 lines).
- `desktop/tests/document-doc-cache.test.ts` — 10 vitest cases covering hit/miss/LRU/corruption paths.

Modified: none.

## Commits

| Hash      | Message                                                                       |
|-----------|-------------------------------------------------------------------------------|
| `e9ec8b1` | test(08-02): add failing tests for doc-cache disk IR cache                    |
| `766db14` | feat(08-02): implement sha256-keyed disk IR cache with LRU eviction           |

## Handoff Notes for Plan 08-03

- Call `createDocCache({ rootDir: paths.cacheDir })` from the executor wiring in `desktop/src/main/ipc/sessions.ts` (same site as `setPathPolicy`, per the plan's `key_links` note).
- If you prefer a module-level setter pattern, wrap the factory: `let active: DocCache | null = null; export function setDocCacheRoot(paths) { active = createDocCache({ rootDir: paths.cacheDir }); }`.
- `sha256OfBuffer` is exported for reuse by parsers that read file bytes anyway — avoids hashing twice.
- `DocumentIR` is referenced only via `import type`; when 08-01 merges the shared contract, no cache-side change is needed.

## Self-Check: PASSED

Files verified:

- FOUND: `desktop/src/main/services/document/doc-cache.ts`
- FOUND: `desktop/tests/document-doc-cache.test.ts`

Commits verified:

- FOUND: `e9ec8b1` (test commit)
- FOUND: `766db14` (feat commit)

Acceptance criteria verified via grep:

- `createHash` present (line 1, line 42)
- `docCache` subdirectory name present (line 22, line 104, line 107)
- `enforceLru` declared and called (lines 37, 119, 216, 218, 237)
- No `electron` import in module
- Test suite: 10 passed, 0 failed, 0 skipped
