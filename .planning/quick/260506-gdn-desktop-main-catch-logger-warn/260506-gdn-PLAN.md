---
phase: 260506-gdn-desktop-main-catch-logger-warn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - desktop/src/main/index.ts
  - desktop/src/main/ipc/workflows.ts
  - desktop/src/main/ipc/mcp.ts
autonomous: true
requirements:
  - QUICK-01-replace-silent-catch-with-logger-warn
must_haves:
  truths:
    - "Shutdown executor/workspace failures are written to the desktop log file (not silently swallowed)"
    - "Workflow run persistence failures are recorded with the runId so they can be diagnosed"
    - "MCP discover-external / import-servers handlers log a warn when mcpManager is missing, while still returning []"
    - "Existing control flow is unchanged: shutdown still completes, persistence failure still doesn't throw, MCP fallback still returns []"
  artifacts:
    - path: "desktop/src/main/index.ts"
      provides: "before-quit shutdown handler logs failures via existing `log` logger"
      contains: "log.warn"
    - path: "desktop/src/main/ipc/workflows.ts"
      provides: "saveWorkflowRun failure paths log error with runId"
      contains: "saveWorkflowRun"
    - path: "desktop/src/main/ipc/mcp.ts"
      provides: "mcpManager-missing branches log a warn before returning []"
      contains: "createLogger"
  key_links:
    - from: "desktop/src/main/index.ts:456,458"
      to: "logger.ts createLogger('main')"
      via: "existing `log` instance at index.ts:49"
      pattern: "log\\.warn"
    - from: "desktop/src/main/ipc/workflows.ts:766,859"
      to: "logger.ts createLogger"
      via: "new module-scoped logger at top of file"
      pattern: "createLogger\\(\"workflows-ipc\"\\)|createLogger\\(\"desktop-workflows\"\\)"
    - from: "desktop/src/main/ipc/mcp.ts:77,85"
      to: "logger.ts createLogger"
      via: "new module-scoped logger at top of file"
      pattern: "createLogger\\(\"mcp-ipc\"\\)|createLogger\\(\"desktop-mcp\"\\)"
---

<objective>
Replace six `.catch(() => {})` / silent fallback sites in `desktop/src/main` with logger.warn (or logger.error for persistence failures) so failures are captured in the daily log file, while preserving the existing control flow (shutdown still proceeds, persistence still doesn't throw, MCP discover/import still returns `[]`).

Purpose: Failed shutdowns, failed workflow run persistence, and degraded MCP handlers are currently invisible — they leave no trace in the log file, which makes production debugging impossible. This change converts silent swallow into observable swallow.

Output: Three modified files. No new tests, no behavior change, no schema change. Type-check must still pass with `cd desktop && pnpm tsc --noEmit`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@CLAUDE.md
@desktop/src/main/services/logger.ts
@desktop/src/main/index.ts
@desktop/src/main/ipc/workflows.ts
@desktop/src/main/ipc/mcp.ts

<interfaces>
<!-- Logger contract from desktop/src/main/services/logger.ts -->
```typescript
export function createLogger(module: string): {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info:  (message: string, context?: Record<string, unknown>) => void;
  warn:  (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
};
```

<!-- Existing usage in desktop/src/main/index.ts (already imported and instantiated) -->
```typescript
// index.ts:35
import { initLogger, createLogger } from "./services/logger";
// index.ts:49
const log = createLogger("main");
```

<!-- Project logging convention (per CLAUDE.md "Logging" section) -->
- Bracketed subsystem prefix in the message string, e.g. `[shutdown]`, `[workflow:start-run]`, `[mcp:discover-external]`
- Structured context object as the second argument (NOT string concat)
- Chinese business messages are acceptable for operational logs in main-process services
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Replace silent catches in index.ts and workflows.ts with logger calls</name>
  <files>desktop/src/main/index.ts, desktop/src/main/ipc/workflows.ts</files>
  <action>
Make TWO file edits. Do not change any control flow — only convert silent swallows to logged swallows.

### Edit 1: `desktop/src/main/index.ts` (lines ~456, 458)

The file already has `const log = createLogger("main");` at line 49. Reuse it.

Current code (inside `app.on("before-quit", ...)`):
```typescript
shutdownToolExecutor().catch(() => {});
shutdownAllWorkspaces().catch(() => {});
```

Change to:
```typescript
shutdownToolExecutor().catch((err) => {
  log.warn("[shutdown] 关闭工具执行器失败", { error: err instanceof Error ? err.message : String(err) });
});
shutdownAllWorkspaces().catch((err) => {
  log.warn("[shutdown] 关闭硅基员工工作空间失败", { error: err instanceof Error ? err.message : String(err) });
});
```

Notes:
- Use `log.warn` (not error) — shutdown is best-effort, the app is going down anyway. Operator should still see it but it's not a service-down condition.
- Do NOT add `await` or anything that could block shutdown.
- Do NOT touch `runtimeContext?.services.timeScheduler?.stop()` / `timeStore?.close()` on the next two lines — they are synchronous and out of scope for this plan.

### Edit 2: `desktop/src/main/ipc/workflows.ts` (lines ~766, 859)

This file does NOT yet import the logger. Add the import and a module-scoped logger.

At the top of the file (after the existing imports, around line 30, alongside other service imports):
```typescript
import { createLogger } from "../services/logger";
```

Then, after the imports block and before `export function registerWorkflowHandlers(...)` (or wherever module-scoped consts live in this file — keep it co-located with other top-level declarations), add:
```typescript
const log = createLogger("desktop-workflows");
```

Then change the two `saveWorkflowRun(...).catch(() => {})` sites:

**Site A (around line 766, in the `start-run` failure branch):**

Current:
```typescript
trackSave(saveWorkflowRun(ctx.runtime.paths, failedRun).catch(() => {}));
```

Change to:
```typescript
trackSave(saveWorkflowRun(ctx.runtime.paths, failedRun).catch((err) => {
  log.error("[workflow:start-run] 保存失败状态记录失败", {
    runId,
    error: err instanceof Error ? err.message : String(err),
  });
}));
```

**Site B (around line 859, in the `interrupt-resume` failure branch):**

Current:
```typescript
trackSave(saveWorkflowRun(ctx.runtime.paths, failedRun).catch(() => {}));
```

Change to:
```typescript
trackSave(saveWorkflowRun(ctx.runtime.paths, failedRun).catch((err) => {
  log.error("[workflow:interrupt-resume] 保存失败状态记录失败", {
    runId: input.runId,
    error: err instanceof Error ? err.message : String(err),
  });
}));
```

Notes:
- Use `log.error` here (not warn): persistence failure means the run record is now inconsistent with reality — that's a real defect surface, not a benign degradation.
- Each site already has access to `runId` (Site A's outer scope) or `input.runId` (Site B's outer scope) — use those directly. Do NOT rename or shadow these.
- Do NOT migrate the surrounding `console.error("[workflow:start-run] 工作流执行异常", ...)` / `console.info(...)` calls. They are out of scope per the plan constraints (logging-only change at silent-swallow sites).
- Do NOT touch the line ~833 `saveWorkflowRun(...).catch((err) => { console.error(...) })` — that one already logs (it's not a silent swallow). Leave it as-is.
  </action>
  <verify>
    <automated>cd desktop && pnpm tsc --noEmit</automated>
  </verify>
  <done>
- `desktop/src/main/index.ts`: both `.catch(() => {})` at lines ~456, 458 are replaced with `.catch((err) => { log.warn(...) })`.
- `desktop/src/main/ipc/workflows.ts`: import for `createLogger` added; module-scoped `log` const added; both `saveWorkflowRun(...).catch(() => {})` sites at lines ~766 and ~859 replaced with `.catch((err) => { log.error(...) })` that includes the `runId`.
- `pnpm tsc --noEmit` passes with no new errors.
- No other lines in either file are changed.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add logger to mcp.ts and warn when mcpManager is missing</name>
  <files>desktop/src/main/ipc/mcp.ts</files>
  <action>
This file does NOT yet import the logger. Add the import and a module-scoped logger, then warn (without throwing) at the two fallback sites.

### Step 1: Add import at the top of the file

After the existing imports (line 6 imports `DiscoveredMcpServer`), add:
```typescript
import { createLogger } from "../services/logger";
```

### Step 2: Add a module-scoped logger after the imports, before the `type` declarations

```typescript
const log = createLogger("desktop-mcp");
```

Place it between the imports block and the `type CreateMcpServerInput = ...` line (around line 8).

### Step 3: Update line ~77 — `mcp:discover-external`

Current:
```typescript
ipcMain.handle("mcp:discover-external", async (): Promise<DiscoveredMcpServer[]> => {
  if (!ctx.services.mcpManager) return [];
  return ctx.services.mcpManager.discoverExternalServers();
});
```

Change to:
```typescript
ipcMain.handle("mcp:discover-external", async (): Promise<DiscoveredMcpServer[]> => {
  if (!ctx.services.mcpManager) {
    log.warn("[mcp:discover-external] mcpManager 未初始化，返回空发现列表");
    return [];
  }
  return ctx.services.mcpManager.discoverExternalServers();
});
```

### Step 4: Update line ~85 — `mcp:import-servers`

Current:
```typescript
ipcMain.handle(
  "mcp:import-servers",
  async (_event, servers: DiscoveredMcpServer[]): Promise<McpServer[]> => {
    if (!ctx.services.mcpManager) return [];
    return ctx.services.mcpManager.importServers(servers);
  },
);
```

Change to:
```typescript
ipcMain.handle(
  "mcp:import-servers",
  async (_event, servers: DiscoveredMcpServer[]): Promise<McpServer[]> => {
    if (!ctx.services.mcpManager) {
      log.warn("[mcp:import-servers] mcpManager 未初始化，跳过导入", { requested: servers.length });
      return [];
    }
    return ctx.services.mcpManager.importServers(servers);
  },
);
```

Notes:
- Use `log.warn` (not error). Per the constraints: "currently returns [] when mcpManager missing. Keep returning [] (some callers depend on this), but log a warning describing which handler degraded."
- Do NOT touch the OTHER `mcpManager` guards in this file (`mcp:create-server`, `mcp:update-server`, `mcp:delete-server`, `mcp:refresh-server`, `mcp:connect-server`). Those throw or return `{ success: false }` — they are not in the audit list and are out of scope.
- Do NOT add a logger to `mcp:list-servers` — it doesn't have a silent-swallow site.
  </action>
  <verify>
    <automated>cd desktop && pnpm tsc --noEmit</automated>
  </verify>
  <done>
- `desktop/src/main/ipc/mcp.ts`: import for `createLogger` added; module-scoped `log` const added.
- The `mcp:discover-external` handler at line ~77 logs a warn before returning `[]` when `mcpManager` is missing; still returns `[]`.
- The `mcp:import-servers` handler at line ~85 logs a warn (with `requested` count) before returning `[]` when `mcpManager` is missing; still returns `[]`.
- No other handler in this file is modified.
- `pnpm tsc --noEmit` passes with no new errors.
  </done>
</task>

</tasks>

<verification>
After both tasks complete, run from repo root:
```
cd desktop && pnpm tsc --noEmit
```
Expectation: no new TypeScript errors introduced by the changes.

Spot-check by grep that no `.catch(() => {})` remains at the six audit sites:
- `desktop/src/main/index.ts` lines 454-475 (`before-quit` block)
- `desktop/src/main/ipc/workflows.ts` lines 757-870 (start-run + interrupt-resume failure branches)
- `desktop/src/main/ipc/mcp.ts` lines 75-90 (discover-external + import-servers)

Spot-check that the OTHER `.catch` sites in workflows.ts (e.g. line ~832 which already logs via `console.error`) are NOT modified.
</verification>

<success_criteria>
- All six audit sites now produce a log line on failure (warn for shutdown/MCP, error for workflow persistence).
- No control-flow change: shutdown still proceeds without blocking on the catch; workflow persistence failure does not throw to caller; MCP handlers still return `[]` when manager is missing.
- TypeScript compilation clean (`pnpm tsc --noEmit`).
- No unrelated `.catch(() => {})` sites in other files were modified.
- No `console.*` migration outside the six audit sites.
</success_criteria>

<output>
After completion, create `.planning/quick/260506-gdn-desktop-main-catch-logger-warn/260506-gdn-SUMMARY.md` capturing:
- Exact line numbers of the six edits (post-edit numbers)
- The two new `createLogger(...)` instances and where they live
- Confirmation that `pnpm tsc --noEmit` passed
- Note that no behavior changed and no tests were added (logging-only change)
</output>
