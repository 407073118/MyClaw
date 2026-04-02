---
status: awaiting_human_verify
trigger: "newApp Electron app has multiple bugs - login succeeds but nothing happens, comprehensive investigation needed"
created: 2026-03-31T00:00:00Z
updated: 2026-03-31T02:00:00Z
---

## Current Focus

hypothesis: 14 IPC handler channels are called by preload but have no registered handler in main process, causing "No handler registered" errors on every sidebar click
test: Register all missing handlers as stubs in the appropriate handler files
expecting: All sidebar navigation and page loading works without IPC errors
next_action: Add missing handlers to tools.ts, workflows.ts, cloud.ts; create employees.ts; register employees in index.ts

## Symptoms

expected: Sidebar navigation works, clicking items loads content
actual: Clicking anything in sidebar triggers errors, nothing works
errors:
  - "Error occurred in handler for 'tool:list-mcp': Error: No handler registered for 'tool:list-mcp'"
  - "[cloud:skills] stub" repeated 3 times
  - Generally every click produces errors
reproduction: After login, try clicking any sidebar item
started: Previous 9 bugs were fixed, app now loads past login but UI is non-functional

## Eliminated

- hypothesis: Zustand getter properties lost after set() calls
  evidence: Fixed in previous round - wrapped set() to recompute derived state
  timestamp: 2026-03-31T00:30:00Z

- hypothesis: Bootstrap payload shape mismatches
  evidence: Fixed in previous round - corrected all payload shapes
  timestamp: 2026-03-31T00:30:00Z

- hypothesis: Preload API method names misaligned with workspace store
  evidence: Fixed in previous round - rewrote preload to match workspace store expectations
  timestamp: 2026-03-31T00:30:00Z

## Evidence

- timestamp: 2026-03-31T02:00:00Z
  checked: Cross-referenced ALL preload ipcRenderer.invoke channels vs ALL ipcMain.handle registrations
  found: 14 missing IPC handlers. Preload calls these channels but no handler exists in main:
    tools.ts missing: tool:list-mcp, tool:update-builtin-pref, tool:update-mcp-pref
    workflows.ts missing: workflow:get, workflow:create, workflow:list-runs, workflow:start-run, workflow:resume-run
    No employee handler file: employee:list, employee:get, employee:create, employee:update
    cloud.ts missing: skill:detail (local skill detail lookup)
    No handler: publish:create-draft
  implication: Every page that loads and tries to fetch data via these channels gets "No handler registered" error

- timestamp: 2026-03-31T02:00:00Z
  checked: Pages that call missing handlers on mount
  found: ToolsPage calls loadBuiltinTools + loadMcpTools (tool:list-mcp missing), EmployeesPage calls loadEmployees (employee:list missing), WorkflowsPage calls loadWorkflows (workflow:list exists but workflow:get/create/runs missing for interactions)
  implication: These pages will error on mount or on user interaction

## Resolution

root_cause: 14 IPC channels referenced by preload have no corresponding ipcMain.handle registration in the main process. The preload bridge correctly calls these channels, but when Electron tries to route the invoke call, no handler is found, producing "No handler registered" errors.

fix:
  1. tools.ts: Add handlers for tool:list-mcp, tool:update-builtin-pref, tool:update-mcp-pref
  2. workflows.ts: Add handlers for workflow:get, workflow:create, workflow:list-runs, workflow:start-run, workflow:resume-run
  3. Create employees.ts: Add handlers for employee:list, employee:get, employee:create, employee:update
  4. cloud.ts: Add handler for skill:detail
  5. Create publish handler or add to cloud.ts: publish:create-draft
  6. ipc/index.ts: Register employee handlers
  7. runtime-context.ts: Add employees and skills state to context

verification: TypeScript compilation passes for main (including preload) and renderer. Full build succeeds with zero errors.

files_changed:
  - src/main/ipc/tools.ts
  - src/main/ipc/workflows.ts
  - src/main/ipc/employees.ts (new)
  - src/main/ipc/cloud.ts
  - src/main/ipc/index.ts
  - src/main/services/runtime-context.ts
  - src/main/index.ts
  - src/preload/index.ts
