# Builtin Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first coding-first builtin tools slice: shared contracts, persisted builtin tool preferences, bootstrap exposure, and runtime APIs for updating tool preferences.

**Architecture:** Keep builtin tools separate from MCP and Skills. Add a static builtin tool registry in the runtime, persist only user preference overrides in `runtime-state.db`, and expose resolved builtin tool metadata through bootstrap and dedicated APIs. Do not implement tool execution in this slice.

**Tech Stack:** TypeScript, Vitest, sql.js, Node runtime sidecar, Vue desktop bootstrap contract

---

### Task 1: Add builtin tool contract coverage

**Files:**
- Create: `packages/shared/src/contracts/builtin-tool.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/contracts/contracts.test.ts`

**Step 1: Write the failing test**

- Add assertions that shared exports builtin tool groups and approval modes.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/shared test`

Expected: FAIL because builtin tool exports do not exist yet.

**Step 3: Write minimal implementation**

- Add builtin tool types and constants.
- Export them from `packages/shared/src/index.ts`.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir packages/shared test`

Expected: PASS.

### Task 2: Persist builtin tool preferences in runtime state

**Files:**
- Modify: `apps/runtime/src/store/runtime-state-store.ts`
- Test: `apps/runtime/src/store/runtime-state-store.test.ts`

**Step 1: Write the failing test**

- Add a runtime state round-trip test that includes builtin tool preferences.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test -- runtime-state-store.test.ts`

Expected: FAIL because runtime state does not store builtin tool preferences.

**Step 3: Write minimal implementation**

- Extend `RuntimeState`.
- Add the `builtin_tool_preferences` table.
- Read and write tool preferences.
- Add sanitization fallback.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test -- runtime-state-store.test.ts`

Expected: PASS.

### Task 3: Expose resolved builtin tools via bootstrap and update API

**Files:**
- Create: `apps/runtime/src/services/builtin-tool-registry.ts`
- Modify: `apps/runtime/src/routes.ts`
- Modify: `apps/runtime/src/server.ts`
- Test: `apps/runtime/src/server.test.ts`

**Step 1: Write the failing test**

- Add bootstrap assertions for builtin tools.
- Add an API test for updating a builtin tool preference.
- Add a restart persistence assertion for the preference change.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test -- server.test.ts`

Expected: FAIL because bootstrap does not include builtin tools and update API does not exist.

**Step 3: Write minimal implementation**

- Add a static builtin tool registry for the coding-first P0 tools.
- Resolve builtin tool defaults against persisted preferences.
- Include builtin tools in bootstrap response.
- Add `GET /api/tools/builtin` and `PUT /api/tools/builtin/:toolId`.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test -- server.test.ts`

Expected: PASS.

### Task 4: Verify and gate encoding

**Files:**
- Check: `docs/plans/2026-03-17-builtin-tools-implementation-plan.md`
- Check: modified source and test files

**Step 1: Run targeted builds and tests**

Run:

- `pnpm --dir packages/shared build`
- `pnpm --dir apps/runtime build`
- `pnpm --dir packages/shared test`
- `pnpm --dir apps/runtime test`

**Step 2: Run mojibake gate**

Run:

- `rg -n "�|锟|Ã|Ð|\?/h[1-6]>" docs packages apps *.md`

**Step 3: Summarize results**

- Report which commands passed.
- Report any remaining gaps before moving to builtin tool execution.
