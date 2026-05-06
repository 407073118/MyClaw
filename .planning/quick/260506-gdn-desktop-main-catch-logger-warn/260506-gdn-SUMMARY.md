---
phase: 260506-gdn-desktop-main-catch-logger-warn
plan: 01
subsystem: desktop-main
tags: [logging, observability, desktop-main, ipc, refactor]
requires:
  - desktop/src/main/services/logger.ts (createLogger)
provides:
  - "Shutdown failures observable in daily log file"
  - "Workflow run persistence failures observable with runId"
  - "MCP discover/import degraded mode observable"
affects:
  - desktop/src/main/index.ts
  - desktop/src/main/ipc/workflows.ts
  - desktop/src/main/ipc/mcp.ts
tech-stack:
  added: []
  patterns:
    - "Module-scoped logger via createLogger() at top of IPC files"
    - "Bracketed subsystem prefix in log messages, structured context object as second arg"
key-files:
  created: []
  modified:
    - desktop/src/main/index.ts
    - desktop/src/main/ipc/workflows.ts
    - desktop/src/main/ipc/mcp.ts
decisions:
  - "Use log.warn for shutdown (best-effort, app going down anyway, not service-down)"
  - "Use log.error for workflow run persistence (run record now inconsistent with reality, real defect surface)"
  - "Use log.warn for MCP missing-manager fallback (degradation, not failure)"
  - "Reuse existing log instance in index.ts (line 49); add new module-scoped loggers in workflows.ts and mcp.ts"
metrics:
  tasks_completed: 2
  files_modified: 3
  commits: 2
  duration: ~10 min
  completed: 2026-05-06
---

# Phase 260506-gdn Plan 01: desktop main catch logger.warn Summary

Replaced six silent `.catch(() => {})` / silent fallback sites in `desktop/src/main` with logger calls so failures become observable in the daily log file, while preserving existing control flow (shutdown still proceeds, persistence still does not throw, MCP fallback still returns `[]`).

## Edits (post-edit line numbers)

### desktop/src/main/index.ts
Reused the existing `const log = createLogger("main")` at line 49 (no new logger added).

| Line | Change |
| --- | --- |
| 457 | `shutdownToolExecutor().catch((err) => { log.warn("[shutdown] 关闭工具执行器失败", { error }) })` |
| 461 | `shutdownAllWorkspaces().catch((err) => { log.warn("[shutdown] 关闭硅基员工工作空间失败", { error }) })` |

### desktop/src/main/ipc/workflows.ts
Added new module-scoped logger.

| Line | Change |
| --- | --- |
| 8 (import) | `import { createLogger } from "../services/logger";` |
| 43 | `const log = createLogger("desktop-workflows");` |
| 770 | `saveWorkflowRun(...).catch((err) => log.error("[workflow:start-run] 保存失败状态记录失败", { runId, error }))` |
| 868 | `saveWorkflowRun(...).catch((err) => log.error("[workflow:interrupt-resume] 保存失败状态记录失败", { runId: input.runId, error }))` |

### desktop/src/main/ipc/mcp.ts
Added new module-scoped logger.

| Line | Change |
| --- | --- |
| 7 (import) | `import { createLogger } from "../services/logger";` |
| 9 | `const log = createLogger("desktop-mcp");` |
| 81 | `mcp:discover-external` — `log.warn("[mcp:discover-external] mcpManager 未初始化，返回空发现列表")` before returning `[]` |
| 92 | `mcp:import-servers` — `log.warn("[mcp:import-servers] mcpManager 未初始化，跳过导入", { requested })` before returning `[]` |

## New createLogger Instances

| File | Line | Module Tag |
| --- | --- | --- |
| `desktop/src/main/ipc/workflows.ts` | 43 | `desktop-workflows` |
| `desktop/src/main/ipc/mcp.ts` | 9 | `desktop-mcp` |

(`desktop/src/main/index.ts` reused the existing `main` logger at line 49 — no new instance.)

## Behavior Verification

- Shutdown: `app.on("before-quit", ...)` still does NOT await the catch handlers; shutdown proceeds without blocking. The `.catch` is fire-and-forget, just no longer silent.
- Workflow persistence: failure path inside `saveWorkflowRun(...).catch(...)` still does not rethrow; caller (the outer `.catch` chain on the run promise) is unaffected.
- MCP: both handlers still return `[]` when `ctx.services.mcpManager` is falsy. Callers depending on the empty-array fallback (per plan constraint) are unaffected.

## TypeScript Verification

`cd desktop && pnpm tsc --noEmit` — **passed for all three modified files**. Zero errors reported in `src/main/index.ts`, `src/main/ipc/workflows.ts`, or `src/main/ipc/mcp.ts`.

Pre-existing errors exist in `tests/*.ts` (test type drift around `MyClawPaths`, `RuntimeContext`, `WorkflowDefinition`, `WorkflowRunSummary`, `ApprovalRequest`, missing `@types/jest` etc.) — these are unrelated to this plan and out of scope. Confirmed they existed prior to this change by filtering tsc output: no errors map to the three files touched.

## Deviations from Plan

None — plan executed exactly as written.

## Tests

No new tests added (logging-only change, no behavior change). Per user memory `feedback_skip_intermediate_tests`, typecheck was run only at the end.

## Commits

| Task | Commit | Message |
| --- | --- | --- |
| 1 | `befbea1` | `refactor(desktop-main): replace silent catches with logger.warn/error in shutdown and workflow persistence` |
| 2 | `a9e4cd6` | `refactor(desktop-mcp): warn when mcpManager is missing in discover/import handlers` |

## Self-Check: PASSED

- `desktop/src/main/index.ts` line 457, 461 — `log.warn("[shutdown] ...")` present (verified via grep).
- `desktop/src/main/ipc/workflows.ts` line 43 — `const log = createLogger("desktop-workflows")` present.
- `desktop/src/main/ipc/workflows.ts` line 770, 868 — `log.error("[workflow:...]")` present with runId in context.
- `desktop/src/main/ipc/mcp.ts` line 9 — `const log = createLogger("desktop-mcp")` present.
- `desktop/src/main/ipc/mcp.ts` line 81, 92 — `log.warn("[mcp:...]")` present.
- Commits `befbea1` and `a9e4cd6` exist in `git log`.
- `pnpm tsc --noEmit` reports zero errors in the three modified files.
