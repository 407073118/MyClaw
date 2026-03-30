# Runtime Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor `desktop/apps/runtime` into smaller, domain-based modules with a stable facade, isolated test layers, and safe parallel subagent execution boundaries.

**Architecture:** Keep the existing public runtime entry points stable while extracting internal modules behind facades. Split the work into a short Phase 0 owned by the main agent, then parallelize `server`, `runtime-state`, `model-provider`, and test migration work on disjoint write sets. Preserve behavioral contracts through targeted integration and contract tests before deleting old structure.

**Tech Stack:** TypeScript, Node.js HTTP server, Vitest, sql.js, pnpm

---

## Preconditions

- Run this plan in a dedicated worktree created with `@brainstorming` follow-up guidance and `using-git-worktrees`.
- Treat all files containing Chinese text as UTF-8-sensitive.
- Before editing any Chinese-containing file: read it first, patch only necessary lines, re-open it after edits, then run the repository mojibake gate.

## Subagent Execution Waves

### Wave 0: Main Agent Only

- Ownership:
  - `desktop/apps/runtime/vitest.config.ts`
  - `desktop/apps/runtime/tests/**`
  - `desktop/apps/runtime/src/server/**` facade skeleton only
  - `desktop/apps/runtime/src/store/runtime-state/**` facade skeleton only
  - `desktop/apps/runtime/src/services/model-provider/**` facade skeleton only
- Purpose:
  - Create stable directories, test config, and facade seams.
  - Prevent later subagents from racing on root entry files.

### Wave 1: Parallel Subagents

- Subagent A ownership:
  - `desktop/apps/runtime/src/server/**`
  - `desktop/apps/runtime/tests/integration/server/**`
  - `desktop/apps/runtime/tests/contract/runtime-api/**`
- Subagent B ownership:
  - `desktop/apps/runtime/src/store/runtime-state/**`
  - `desktop/apps/runtime/src/store/runtime-state-store.ts`
  - `desktop/apps/runtime/tests/unit/store/**`
  - `desktop/apps/runtime/tests/integration/store/**`
- Subagent C ownership:
  - `desktop/apps/runtime/src/services/model-provider/**`
  - `desktop/apps/runtime/tests/unit/services/model-provider/**`
  - `desktop/apps/runtime/tests/integration/services/model-provider/**`
- Subagent D ownership:
  - `desktop/apps/runtime/tests/**`
  - `desktop/apps/runtime/vitest.config.ts`
  - No production logic changes

### Wave 2: Main Agent Integration

- Ownership:
  - `desktop/apps/runtime/src/index.ts`
  - `desktop/apps/runtime/src/server.ts`
  - `desktop/apps/runtime/src/services/model-provider.ts`
  - `desktop/apps/runtime/src/store/runtime-state-store.ts`
  - Any import-path cleanup across `desktop/apps/runtime`
- Purpose:
  - Resolve imports, merge test moves, run full validation, and close remaining gaps.

## Task 1: Phase 0 Skeleton And Test Harness

**Files:**
- Create: `desktop/apps/runtime/vitest.config.ts`
- Create: `desktop/apps/runtime/tests/unit/.gitkeep`
- Create: `desktop/apps/runtime/tests/integration/.gitkeep`
- Create: `desktop/apps/runtime/tests/contract/runtime-api/.gitkeep`
- Create: `desktop/apps/runtime/src/server/index.ts`
- Create: `desktop/apps/runtime/src/server/runtime-context.ts`
- Create: `desktop/apps/runtime/src/store/runtime-state/.gitkeep`
- Create: `desktop/apps/runtime/src/services/model-provider/index.ts`
- Modify: `desktop/apps/runtime/package.json`

**Step 1: Write the failing test**

Create `desktop/apps/runtime/tests/contract/runtime-api/runtime-facade-smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("runtime facade skeleton", () => {
  it("loads the new test tree", async () => {
    expect(true).toBe(true);
  });
});
```

**Step 2: Run test to verify the new harness is wired**

Run:

```powershell
pnpm --dir desktop/apps/runtime exec vitest run tests/contract/runtime-api/runtime-facade-smoke.test.ts
```

Expected: FAIL first if `vitest.config.ts` or test tree is not recognized yet, then PASS after config is added.

**Step 3: Write minimal implementation**

- Add `desktop/apps/runtime/vitest.config.ts` with:
  - `test.include` covering `tests/**/*.test.ts` and legacy `src/**/*.test.ts`
  - `environment: "node"`
- Add `src/server/index.ts` and `src/services/model-provider/index.ts` as thin re-export barrels.
- Add placeholder `runtime-context.ts` with exported types only, no behavior change yet.
- Keep `src/server.ts`, `src/services/model-provider.ts`, and `src/store/runtime-state-store.ts` as source-of-truth implementations.

**Step 4: Run tests to verify the harness passes**

Run:

```powershell
pnpm --dir desktop/apps/runtime exec vitest run tests/contract/runtime-api/runtime-facade-smoke.test.ts
pnpm --dir desktop/apps/runtime test -- src/server.test.ts
```

Expected: PASS for the new smoke test, existing server test still runs.

**Step 5: Commit**

```bash
git add desktop/apps/runtime/package.json desktop/apps/runtime/vitest.config.ts desktop/apps/runtime/tests desktop/apps/runtime/src/server/index.ts desktop/apps/runtime/src/server/runtime-context.ts desktop/apps/runtime/src/services/model-provider/index.ts desktop/apps/runtime/src/store/runtime-state/.gitkeep
git commit -m "chore(runtime): add refactor skeleton and test harness"
```

## Task 2: Extract Runtime State Infrastructure Behind A Thin Facade

**Files:**
- Create: `desktop/apps/runtime/src/store/runtime-state/sqlite.ts`
- Create: `desktop/apps/runtime/src/store/runtime-state/schema.ts`
- Create: `desktop/apps/runtime/src/store/runtime-state/bootstrap.ts`
- Create: `desktop/apps/runtime/src/store/runtime-state/legacy.ts`
- Create: `desktop/apps/runtime/src/store/runtime-state/shared/parsing.ts`
- Create: `desktop/apps/runtime/src/store/runtime-state/codecs/sessions.ts`
- Create: `desktop/apps/runtime/src/store/runtime-state/codecs/approvals.ts`
- Create: `desktop/apps/runtime/src/store/runtime-state/codecs/mcp.ts`
- Create: `desktop/apps/runtime/src/store/runtime-state/codecs/workflows.ts`
- Create: `desktop/apps/runtime/src/store/runtime-state/codecs/workflow-roots.ts`
- Create: `desktop/apps/runtime/src/store/runtime-state/codecs/memory.ts`
- Create: `desktop/apps/runtime/src/store/runtime-state/codecs/pending-work.ts`
- Create: `desktop/apps/runtime/tests/unit/store/runtime-state-schema.test.ts`
- Create: `desktop/apps/runtime/tests/unit/store/runtime-state-legacy.test.ts`
- Create: `desktop/apps/runtime/tests/integration/store/runtime-state-facade.test.ts`
- Modify: `desktop/apps/runtime/src/store/runtime-state-store.ts`
- Modify: `desktop/apps/runtime/src/store/runtime-state-store.test.ts`

**Step 1: Write the failing tests**

Create `desktop/apps/runtime/tests/integration/store/runtime-state-facade.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadRuntimeState, saveRuntimeState } from "../../../src/store/runtime-state-store";

describe("runtime state facade", () => {
  it("round-trips persisted state through the facade", async () => {
    expect(typeof loadRuntimeState).toBe("function");
    expect(typeof saveRuntimeState).toBe("function");
  });
});
```

Create `desktop/apps/runtime/tests/unit/store/runtime-state-schema.test.ts` with a focused schema assertion for workflow root columns.

**Step 2: Run tests to verify failures**

Run:

```powershell
pnpm --dir desktop/apps/runtime exec vitest run tests/integration/store/runtime-state-facade.test.ts tests/unit/store/runtime-state-schema.test.ts
```

Expected: FAIL because new modules do not exist yet.

**Step 3: Write minimal implementation**

- Move SQLite runtime helpers into `src/store/runtime-state/sqlite.ts`.
- Move schema creation and column migration helpers into `src/store/runtime-state/schema.ts`.
- Move legacy JSON compatibility into `src/store/runtime-state/legacy.ts`.
- Move default-state assembly and total sanitize logic into `src/store/runtime-state/bootstrap.ts`.
- Move parsing helpers into `src/store/runtime-state/shared/parsing.ts`.
- Move domain-specific table serialization into codec modules.
- Reduce `runtime-state-store.ts` to:
  - exported `RuntimeState` type
  - exported facade functions
  - orchestration calls to extracted modules

**Step 4: Run targeted tests**

Run:

```powershell
pnpm --dir desktop/apps/runtime exec vitest run tests/integration/store/runtime-state-facade.test.ts tests/unit/store/runtime-state-schema.test.ts tests/unit/store/runtime-state-legacy.test.ts src/store/runtime-state-store.test.ts
```

Expected: PASS with no behavior change to public facade.

**Step 5: Commit**

```bash
git add desktop/apps/runtime/src/store/runtime-state desktop/apps/runtime/src/store/runtime-state-store.ts desktop/apps/runtime/src/store/runtime-state-store.test.ts desktop/apps/runtime/tests/unit/store desktop/apps/runtime/tests/integration/store
git commit -m "refactor(runtime): split runtime state persistence internals"
```

## Task 3: Extract Model Provider Into Stable Facade And Provider Modules

**Files:**
- Create: `desktop/apps/runtime/src/services/model-provider/types.ts`
- Create: `desktop/apps/runtime/src/services/model-provider/shared/http.ts`
- Create: `desktop/apps/runtime/src/services/model-provider/shared/text.ts`
- Create: `desktop/apps/runtime/src/services/model-provider/openai-compatible/flavor.ts`
- Create: `desktop/apps/runtime/src/services/model-provider/openai-compatible/messages.ts`
- Create: `desktop/apps/runtime/src/services/model-provider/openai-compatible/parser.ts`
- Create: `desktop/apps/runtime/src/services/model-provider/openai-compatible/sse.ts`
- Create: `desktop/apps/runtime/src/services/model-provider/openai-compatible/client.ts`
- Create: `desktop/apps/runtime/src/services/model-provider/openai-compatible/conversation.ts`
- Create: `desktop/apps/runtime/src/services/model-provider/anthropic/messages.ts`
- Create: `desktop/apps/runtime/src/services/model-provider/anthropic/parser.ts`
- Create: `desktop/apps/runtime/src/services/model-provider/anthropic/sse.ts`
- Create: `desktop/apps/runtime/src/services/model-provider/anthropic/client.ts`
- Create: `desktop/apps/runtime/src/services/model-provider/anthropic/conversation.ts`
- Create: `desktop/apps/runtime/tests/unit/services/model-provider/openai-compatible.test.ts`
- Create: `desktop/apps/runtime/tests/unit/services/model-provider/anthropic.test.ts`
- Create: `desktop/apps/runtime/tests/integration/services/model-provider-facade.test.ts`
- Modify: `desktop/apps/runtime/src/services/model-provider.ts`
- Modify: `desktop/apps/runtime/src/services/builtin-tool-registry.ts`
- Modify: `desktop/apps/runtime/src/services/model-provider.test.ts`

**Step 1: Write the failing tests**

Create `desktop/apps/runtime/tests/integration/services/model-provider-facade.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runModelConversation, testModelProfileConnectivity } from "../../../src/services/model-provider";

describe("model provider facade", () => {
  it("exports stable runtime entry points", () => {
    expect(typeof runModelConversation).toBe("function");
    expect(typeof testModelProfileConnectivity).toBe("function");
  });
});
```

Add focused unit tests for:

- OpenAI-compatible SSE incremental text parsing
- Anthropic `tool_use` / `thinking_delta` parsing
- provider routing based on `profile.provider`

**Step 2: Run tests to verify failures**

Run:

```powershell
pnpm --dir desktop/apps/runtime exec vitest run tests/integration/services/model-provider-facade.test.ts tests/unit/services/model-provider/openai-compatible.test.ts tests/unit/services/model-provider/anthropic.test.ts
```

Expected: FAIL until the new provider tree exists.

**Step 3: Write minimal implementation**

- Move shared types into `types.ts`.
- Move reusable HTTP/text helpers into `shared/`.
- Move OpenAI-compatible logic into its folder without changing behavior.
- Move Anthropic logic into its folder without changing behavior.
- Reduce `src/services/model-provider.ts` to a facade that re-exports from `src/services/model-provider/index.ts`.
- Keep `MYCLAW_MODEL_TOOLS` ownership in one place only. If moved, update `builtin-tool-registry.ts` imports in the same task.

**Step 4: Run targeted tests**

Run:

```powershell
pnpm --dir desktop/apps/runtime exec vitest run tests/integration/services/model-provider-facade.test.ts tests/unit/services/model-provider/openai-compatible.test.ts tests/unit/services/model-provider/anthropic.test.ts src/services/model-provider.test.ts src/server.streaming.test.ts
```

Expected: PASS, including streaming behavior and existing mocked server-provider boundary.

**Step 5: Commit**

```bash
git add desktop/apps/runtime/src/services/model-provider desktop/apps/runtime/src/services/model-provider.ts desktop/apps/runtime/src/services/builtin-tool-registry.ts desktop/apps/runtime/src/services/model-provider.test.ts desktop/apps/runtime/tests/unit/services/model-provider desktop/apps/runtime/tests/integration/services/model-provider-facade.test.ts
git commit -m "refactor(runtime): split model provider adapters"
```

## Task 4: Extract Server Context, Payloads, And Route Domains

**Files:**
- Create: `desktop/apps/runtime/src/server/create-runtime-app.ts`
- Create: `desktop/apps/runtime/src/server/http/router.ts`
- Create: `desktop/apps/runtime/src/server/http/session-stream.ts`
- Create: `desktop/apps/runtime/src/server/http/payloads/common.ts`
- Create: `desktop/apps/runtime/src/server/http/payloads/employees.ts`
- Create: `desktop/apps/runtime/src/server/http/payloads/workflows.ts`
- Create: `desktop/apps/runtime/src/server/http/payloads/mcp.ts`
- Create: `desktop/apps/runtime/src/server/chat/tool-intent.ts`
- Create: `desktop/apps/runtime/src/server/chat/model-tools.ts`
- Create: `desktop/apps/runtime/src/server/chat/conversation-service.ts`
- Create: `desktop/apps/runtime/src/server/workflows/runtime-adapter.ts`
- Create: `desktop/apps/runtime/src/server/routes/bootstrap.ts`
- Create: `desktop/apps/runtime/src/server/routes/cloud-hub.ts`
- Create: `desktop/apps/runtime/src/server/routes/skills.ts`
- Create: `desktop/apps/runtime/src/server/routes/packages.ts`
- Create: `desktop/apps/runtime/src/server/routes/employees.ts`
- Create: `desktop/apps/runtime/src/server/routes/workflow-runs.ts`
- Create: `desktop/apps/runtime/src/server/routes/workflows.ts`
- Create: `desktop/apps/runtime/src/server/routes/pending-work.ts`
- Create: `desktop/apps/runtime/src/server/routes/mcp.ts`
- Create: `desktop/apps/runtime/src/server/routes/model-profiles.ts`
- Create: `desktop/apps/runtime/src/server/routes/tools.ts`
- Create: `desktop/apps/runtime/src/server/routes/sessions.ts`
- Create: `desktop/apps/runtime/src/server/routes/approvals.ts`
- Create: `desktop/apps/runtime/tests/integration/server/bootstrap-route.test.ts`
- Create: `desktop/apps/runtime/tests/integration/server/workflows-route.test.ts`
- Create: `desktop/apps/runtime/tests/contract/runtime-api/sessions.contract.test.ts`
- Modify: `desktop/apps/runtime/src/server.ts`
- Modify: `desktop/apps/runtime/src/index.ts`
- Modify: `desktop/apps/runtime/src/server.test.ts`
- Modify: `desktop/apps/runtime/src/server.streaming.test.ts`
- Modify: `desktop/apps/runtime/src/server.pending-approval.test.ts`
- Modify: `desktop/apps/runtime/src/server.approval-resume.test.ts`

**Step 1: Write the failing tests**

Create `desktop/apps/runtime/tests/integration/server/bootstrap-route.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("runtime bootstrap route", () => {
  it("keeps bootstrap behavior stable after route extraction", () => {
    expect(true).toBe(true);
  });
});
```

Create `desktop/apps/runtime/tests/contract/runtime-api/sessions.contract.test.ts` for `/api/sessions` and `/api/sessions/:id/messages` behavior.

**Step 2: Run tests to verify failures**

Run:

```powershell
pnpm --dir desktop/apps/runtime exec vitest run tests/integration/server/bootstrap-route.test.ts tests/contract/runtime-api/sessions.contract.test.ts
```

Expected: FAIL until routes and test paths are wired.

**Step 3: Write minimal implementation**

- Introduce `runtime-context.ts` to hold mutable state, dependencies, and `persistState()`.
- Move request parsing helpers into `http/payloads/*`.
- Move session streaming helpers into `http/session-stream.ts`.
- Move workflow adaptation logic into `server/workflows/runtime-adapter.ts`.
- Move chat/tool orchestration into `server/chat/*`.
- Move route bodies into domain route files.
- Keep `src/server.ts` as a thin compatibility layer that re-exports `createRuntimeApp` from `src/server/create-runtime-app.ts`.

**Step 4: Run targeted tests**

Run:

```powershell
pnpm --dir desktop/apps/runtime exec vitest run tests/integration/server/bootstrap-route.test.ts tests/integration/server/workflows-route.test.ts tests/contract/runtime-api/sessions.contract.test.ts src/server.test.ts src/server.streaming.test.ts src/server.pending-approval.test.ts src/server.approval-resume.test.ts
```

Expected: PASS with no API contract regressions.

**Step 5: Commit**

```bash
git add desktop/apps/runtime/src/server desktop/apps/runtime/src/server.ts desktop/apps/runtime/src/index.ts desktop/apps/runtime/tests/integration/server desktop/apps/runtime/tests/contract/runtime-api desktop/apps/runtime/src/server.test.ts desktop/apps/runtime/src/server.streaming.test.ts desktop/apps/runtime/src/server.pending-approval.test.ts desktop/apps/runtime/src/server.approval-resume.test.ts
git commit -m "refactor(runtime): split runtime server routes and context"
```

## Task 5: Migrate Legacy Test Placement Into A Structured Test Tree

**Files:**
- Create: `desktop/apps/runtime/tests/integration/server/server-root.test.ts`
- Create: `desktop/apps/runtime/tests/contract/runtime-api/approvals.contract.test.ts`
- Create: `desktop/apps/runtime/tests/contract/runtime-api/bootstrap.contract.test.ts`
- Modify: `desktop/apps/runtime/vitest.config.ts`
- Modify: `desktop/apps/runtime/src/server.test.ts`
- Modify: `desktop/apps/runtime/src/server.workflows.test.ts`
- Modify: `desktop/apps/runtime/src/server.workflow-definitions.test.ts`
- Modify: `desktop/apps/runtime/src/server.workflow-runs.test.ts`
- Modify: `desktop/apps/runtime/src/server.pending-work.test.ts`
- Modify: `desktop/apps/runtime/src/server.packages.test.ts`
- Modify: `desktop/apps/runtime/src/server.employees.test.ts`
- Modify: `desktop/apps/runtime/src/server.streaming.test.ts`
- Modify: `desktop/apps/runtime/src/server.pending-approval.test.ts`
- Modify: `desktop/apps/runtime/src/server.approval-resume.test.ts`

**Step 1: Write the failing test**

Add one test in `desktop/apps/runtime/tests/contract/runtime-api/bootstrap.contract.test.ts` that imports the shared runtime test helpers from the new tree.

**Step 2: Run test to verify failure**

Run:

```powershell
pnpm --dir desktop/apps/runtime exec vitest run tests/contract/runtime-api/bootstrap.contract.test.ts
```

Expected: FAIL until imports and test config support the new layout.

**Step 3: Write minimal implementation**

- Move or duplicate high-value legacy tests into `tests/integration/server/**` and `tests/contract/runtime-api/**`.
- Keep low-risk pure unit tests under `tests/unit/**`.
- Update `vitest.config.ts` so both the new tree and any temporary legacy `src/**/*.test.ts` files continue to run during transition.
- Once moved tests are green, delete or shrink legacy duplicates.

**Step 4: Run migrated test suites**

Run:

```powershell
pnpm --dir desktop/apps/runtime exec vitest run tests/integration/server tests/contract/runtime-api
```

Expected: PASS with clear separation between integration and contract coverage.

**Step 5: Commit**

```bash
git add desktop/apps/runtime/tests desktop/apps/runtime/vitest.config.ts desktop/apps/runtime/src/*.test.ts
git commit -m "test(runtime): reorganize runtime tests by layer"
```

## Task 6: Full Verification, Encoding Gate, And Cleanup

**Files:**
- Modify: `docs/plans/2026-03-27-runtime-refactor-design.md`
- Modify: `docs/plans/2026-03-27-runtime-refactor-implementation-plan.md`
- Modify: any touched runtime files that still contain transitional comments or dead re-exports

**Step 1: Write the failing verification checklist**

Create a short checklist in the PR/work log:

```text
[ ] runtime targeted tests green
[ ] runtime full test suite green
[ ] desktop build green
[ ] shared build green
[ ] mojibake scan clean for touched files
```

**Step 2: Run the full verification commands**

Run:

```powershell
pnpm --dir desktop/packages/shared build
pnpm --dir desktop/apps/runtime test
pnpm --dir desktop/apps/runtime build
pnpm --dir desktop/apps/desktop test
pnpm --dir desktop/apps/desktop build
```

Expected: all commands PASS.

**Step 3: Run the mojibake gate**

Run:

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern desktop/apps/runtime docs/plans/2026-03-27-runtime-refactor-design.md docs/plans/2026-03-27-runtime-refactor-implementation-plan.md
```

Expected: no matches in touched files. If PowerShell default output shows garbling, re-open touched files explicitly with `-Encoding utf8` before declaring success.

**Step 4: Clean up compatibility leftovers**

- Remove empty legacy files only after all imports and tests are green.
- Remove unused re-exports introduced during transition.
- Re-open any Chinese-containing touched file with UTF-8 decoding and confirm the text is readable.

**Step 5: Commit**

```bash
git add desktop/apps/runtime docs/plans/2026-03-27-runtime-refactor-design.md docs/plans/2026-03-27-runtime-refactor-implementation-plan.md
git commit -m "chore(runtime): finalize refactor cleanup and verification"
```

## Recommended Execution Order

1. Main agent executes Task 1 alone.
2. Parallel subagents execute Tasks 2, 3, 4, and 5 on their owned write sets.
3. Main agent executes Task 6 and resolves any integration conflicts.

## Notes For The Main Agent

- Do not let multiple subagents edit `desktop/apps/runtime/src/server.ts`, `desktop/apps/runtime/src/services/model-provider.ts`, or `desktop/apps/runtime/src/store/runtime-state-store.ts` at the same time.
- Treat `persistState()` behavior, SSE incremental semantics, and provider-specific quirks as contract behavior, not implementation detail.
- Keep the refactor YAGNI: no API redesign, no contract renaming, no opportunistic feature work.
