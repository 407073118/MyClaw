# Desktop Personal Workflow Graph Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild personal desktop workflows as LangGraph-style executable graph definitions with durable local storage, checkpoints, retry policies, explicit joins, and desktop-first authoring.

**Architecture:** Keep the current SQLite runtime state file as the fast index for summaries, library roots, recent runs, and lightweight bootstrap metadata. Store full workflow definitions, graph versions, node assets, and run checkpoints as UTF-8 JSON files under the runtime layout so the desktop can inspect, diff, back up, and later sync or mount multiple library roots without overloading SQLite blobs. Desktop reads workflow summaries for library views and full workflow definitions for studio editing; runtime owns validation, checkpoint persistence, retry scheduling, join semantics, and execution against the graph definition.

**Tech Stack:** TypeScript, Vue 3, Pinia, Vitest, Node HTTP runtime, sql.js, filesystem JSON persistence

---

## Scope

- Personal desktop workflows only
- One writable personal workflow library root in V1, with root abstractions designed for future mounted roots
- LangGraph-style graph definitions with `start`, `llm`, `tool`, `human-input`, `condition`, `subgraph`, `join`, and `end`
- Explicit state schema with field-level merge strategies
- Runtime checkpointing, retry policy, and join coordination
- Desktop library and studio rebuilt around full workflow definitions instead of summaries

## Out Of Scope For This Plan

- Cloud publish/import schema migration
- Visual freeform canvas polish
- Multi-user collaboration and remote sync
- Production-grade parallel worker pool optimization

## Local Storage Decision

Use a hybrid layout:

- SQLite remains the source for:
  - workflow summaries
  - workflow library roots
  - recent run summaries
  - pending workflow run resumptions
- File storage becomes the source for:
  - `definition.json`
  - `versions/<version>.json`
  - `runs/<run-id>/checkpoint-*.json`
  - `runs/<run-id>/events.json`
  - future `assets/` attachments

Suggested runtime layout under the existing runtime root:

```text
workflows/
  roots/
    personal/
      workflow-<id>/
        definition.json
        versions/
          v1.json
        assets/
      workflow-<id-2>/
        definition.json
  runs/
    run-<id>/
      checkpoint-0001.json
      checkpoint-0002.json
      events.json
```

This keeps bootstrap fast, keeps full graph JSON readable on disk, and leaves a clean path for future additional roots such as imported folders or mounted workspaces.

## Subagent Waves

**Write-scope rule:** do not let two subagents edit the same file set at once. `packages/shared/**`, `apps/runtime/**`, and `apps/desktop/**` can be split after the contract checkpoint lands.

### Wave 1: Foundation

- Worker A: shared workflow graph contracts in `packages/shared/**`
- Worker B: runtime storage and filesystem layout in `apps/runtime/src/store/**` and `apps/runtime/src/services/**`

### Wave 2: Runtime And Desktop In Parallel

- Worker C: runtime workflow CRUD, validation, and execution APIs in `apps/runtime/src/server.ts` and new runtime services
- Worker D: desktop runtime client and workspace store updates in `apps/desktop/src/services/**` and `apps/desktop/src/stores/**`
- Worker E: desktop workflow library and studio UI in `apps/desktop/src/views/**`, `apps/desktop/src/components/workflow/**`, and related tests

### Wave 3: Integration And Verification

- Worker F: run/debug UX, fixtures, and regression coverage across runtime and desktop
- Worker G: final verification pass, mojibake gate, and doc updates

## Task 1: Define Shared Workflow Graph Contracts

**Files:**
- Modify: `packages/shared/src/contracts/workflow.ts`
- Create: `packages/shared/src/contracts/workflow-run.ts`
- Modify: `packages/shared/src/contracts/contracts.test.ts`
- Modify: `packages/shared/src/index.ts`

**Step 1: Write the failing test**

Add contract assertions covering:
- `WorkflowSummary`
- `WorkflowDefinition`
- `WorkflowNode`
- `WorkflowEdge`
- `WorkflowStateSchemaField`
- `WorkflowMergeStrategy`
- `WorkflowNodePolicy`
- `WorkflowRunSummary`

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir packages/shared test`

Expected: FAIL because the new workflow graph contracts are not exported yet.

**Step 3: Write minimal implementation**

Define:
- enums and discriminated unions for node kinds and edge kinds
- summary vs full definition separation
- state schema with merge strategy declarations
- node-level retry, timeout, idempotency, and failure policy
- run summary types needed by desktop and runtime

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir packages/shared test`

Expected: PASS for the new workflow graph contract assertions.

**Step 5: Commit**

```bash
git add packages/shared/src/contracts/workflow.ts packages/shared/src/contracts/workflow-run.ts packages/shared/src/contracts/contracts.test.ts packages/shared/src/index.ts
git commit -m "feat: add workflow graph shared contracts"
```

## Task 2: Add Hybrid Workflow Library Storage

**Files:**
- Modify: `apps/runtime/src/services/runtime-layout.ts`
- Modify: `apps/runtime/src/store/runtime-state-store.ts`
- Create: `apps/runtime/src/store/workflow-definition-store.ts`
- Create: `apps/runtime/src/store/workflow-library-root-store.ts`
- Create: `apps/runtime/src/store/workflow-definition-store.test.ts`
- Modify: `apps/runtime/src/store/runtime-state-store.test.ts`

**Step 1: Write the failing test**

Cover:
- default personal workflow library root is created
- workflow definitions round-trip through `definition.json`
- SQLite stores only summary and root metadata, not full graph blobs
- future root abstractions can list more than one root even if only one is writable in V1

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/runtime test -- workflow-definition-store runtime-state-store`

Expected: FAIL because workflow definition files and library roots are not implemented.

**Step 3: Write minimal implementation**

Implement:
- runtime layout entries for `workflowRootsDir` and `workflowRunsDir`
- file-backed workflow definition read/write helpers
- root metadata store with one default `personal` writable root
- SQLite schema changes for workflow summaries and workflow library roots

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/runtime test -- workflow-definition-store runtime-state-store`

Expected: PASS for hybrid storage and index behavior.

**Step 5: Commit**

```bash
git add apps/runtime/src/services/runtime-layout.ts apps/runtime/src/store/runtime-state-store.ts apps/runtime/src/store/workflow-definition-store.ts apps/runtime/src/store/workflow-library-root-store.ts apps/runtime/src/store/workflow-definition-store.test.ts apps/runtime/src/store/runtime-state-store.test.ts
git commit -m "feat: add workflow hybrid storage foundation"
```

## Task 3: Add Runtime Workflow Definition CRUD APIs

**Files:**
- Modify: `apps/runtime/src/server.ts`
- Create: `apps/runtime/src/services/workflow-definition-validator.ts`
- Create: `apps/runtime/src/services/workflow-definition-validator.test.ts`
- Modify: `apps/runtime/src/server.workflows.test.ts`
- Create: `apps/runtime/src/server.workflow-definitions.test.ts`

**Step 1: Write the failing test**

Cover:
- `GET /api/workflows` returns summaries only
- `POST /api/workflows` creates a draft full definition plus summary
- `GET /api/workflows/:id` returns full definition
- `PATCH /api/workflows/:id` updates nodes, edges, schema, and policies
- invalid joins, missing entry nodes, and bad merge strategies reject with `400`

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/runtime test -- server.workflows server.workflow-definitions workflow-definition-validator`

Expected: FAIL because the server still treats workflows as summary-only records.

**Step 3: Write minimal implementation**

Implement:
- summary/detail API split
- validator for graph shape, node references, join dependencies, and merge strategy declarations
- creation of a default draft graph with `start -> end`
- persistence path that updates summary index and file-backed definition together

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/runtime test -- server.workflows server.workflow-definitions workflow-definition-validator`

Expected: PASS for workflow definition CRUD and validation.

**Step 5: Commit**

```bash
git add apps/runtime/src/server.ts apps/runtime/src/services/workflow-definition-validator.ts apps/runtime/src/services/workflow-definition-validator.test.ts apps/runtime/src/server.workflows.test.ts apps/runtime/src/server.workflow-definitions.test.ts
git commit -m "feat: add workflow definition runtime apis"
```

## Task 4: Implement Runtime Graph Execution, Retry, And Checkpoints

**Files:**
- Create: `apps/runtime/src/services/workflow-checkpoint-store.ts`
- Create: `apps/runtime/src/services/workflow-graph-executor.ts`
- Create: `apps/runtime/src/services/workflow-graph-executor.test.ts`
- Create: `apps/runtime/src/services/workflow-checkpoint-store.test.ts`
- Modify: `apps/runtime/src/server.ts`
- Create: `apps/runtime/src/server.workflow-runs.test.ts`

**Step 1: Write the failing test**

Cover:
- run starts at `start` and ends at `end`
- `condition` routes by current state
- `parallel` fan-out waits on explicit `join`
- field-level merge strategies apply at `join`
- node retry policy increments attempts and creates checkpoints
- `human-input` pauses run and resumes from checkpoint

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/runtime test -- workflow-graph-executor workflow-checkpoint-store server.workflow-runs`

Expected: FAIL because no executor or checkpoint store exists yet.

**Step 3: Write minimal implementation**

Implement:
- deterministic graph executor over the shared definition model
- checkpoint files per run step
- retry scheduler metadata
- explicit join bookkeeping
- lightweight run API endpoints for create, inspect, and resume

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/runtime test -- workflow-graph-executor workflow-checkpoint-store server.workflow-runs`

Expected: PASS for the initial runtime execution engine.

**Step 5: Commit**

```bash
git add apps/runtime/src/services/workflow-checkpoint-store.ts apps/runtime/src/services/workflow-graph-executor.ts apps/runtime/src/services/workflow-graph-executor.test.ts apps/runtime/src/services/workflow-checkpoint-store.test.ts apps/runtime/src/server.ts apps/runtime/src/server.workflow-runs.test.ts
git commit -m "feat: add workflow graph runtime executor"
```

## Task 5: Update Desktop Runtime Client And Workspace Store

**Files:**
- Modify: `apps/desktop/src/services/runtime-client.ts`
- Modify: `apps/desktop/src/stores/workspace.ts`
- Modify: `apps/desktop/src/test-utils/workspace-fixture.ts`
- Create: `apps/desktop/src/tests/stores/workspace-workflows.test.ts`

**Step 1: Write the failing test**

Cover:
- loading workflow summaries separately from workflow definitions
- creating a workflow returns a default draft definition
- loading workflow detail hydrates the editor state
- starting and resuming a run updates local store state

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/desktop test -- workspace-workflows`

Expected: FAIL because the desktop store only knows about workflow summaries today.

**Step 3: Write minimal implementation**

Implement:
- summary/detail client payloads
- store maps for `workflowSummaries`, `workflowDefinitions`, and `workflowRuns`
- normalization helpers that preserve backward-compatible summary usage where practical
- fixtures upgraded to full graph definitions

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/desktop test -- workspace-workflows`

Expected: PASS for desktop workflow data loading and run state hydration.

**Step 5: Commit**

```bash
git add apps/desktop/src/services/runtime-client.ts apps/desktop/src/stores/workspace.ts apps/desktop/src/test-utils/workspace-fixture.ts apps/desktop/src/tests/stores/workspace-workflows.test.ts
git commit -m "feat: add workflow definition desktop store support"
```

## Task 6: Rebuild The Desktop Workflow Library View

**Files:**
- Modify: `apps/desktop/src/views/WorkflowsView.vue`
- Create: `apps/desktop/src/components/workflow/WorkflowLibraryCard.vue`
- Create: `apps/desktop/src/components/workflow/WorkflowLibraryFilters.vue`
- Modify: `apps/desktop/src/tests/views/WorkflowsView.test.ts`
- Create: `apps/desktop/src/tests/components/workflow/WorkflowLibraryCard.test.ts`

**Step 1: Write the failing test**

Cover:
- summary list shows graph stats like node count and last edited timestamp
- create action creates a real draft graph, not just a metadata row
- personal library can later expose root badges even if only one root is active in V1
- list gracefully handles invalid definition summaries reported by runtime

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/desktop test -- WorkflowsView WorkflowLibraryCard`

Expected: FAIL because the library page still renders summary-only records.

**Step 3: Write minimal implementation**

Implement:
- library cards with status, root badge, graph stats, and quick-open action
- create workflow flow that boots a starter graph
- filter and sort controls that read from the new summary store

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/desktop test -- WorkflowsView WorkflowLibraryCard`

Expected: PASS for desktop library behavior.

**Step 5: Commit**

```bash
git add apps/desktop/src/views/WorkflowsView.vue apps/desktop/src/components/workflow/WorkflowLibraryCard.vue apps/desktop/src/components/workflow/WorkflowLibraryFilters.vue apps/desktop/src/tests/views/WorkflowsView.test.ts apps/desktop/src/tests/components/workflow/WorkflowLibraryCard.test.ts
git commit -m "feat: rebuild workflow library for graph definitions"
```

## Task 7: Rebuild Workflow Studio Around Graph Definitions

**Files:**
- Modify: `apps/desktop/src/views/WorkflowStudioView.vue`
- Create: `apps/desktop/src/components/workflow/WorkflowGraphInspector.vue`
- Create: `apps/desktop/src/components/workflow/WorkflowNodeEditor.vue`
- Create: `apps/desktop/src/components/workflow/WorkflowEdgeEditor.vue`
- Create: `apps/desktop/src/components/workflow/WorkflowStateSchemaEditor.vue`
- Create: `apps/desktop/src/components/workflow/WorkflowExecutionPolicyEditor.vue`
- Modify: `apps/desktop/src/tests/views/WorkflowStudioView.test.ts`
- Create: `apps/desktop/src/tests/components/workflow/WorkflowGraphInspector.test.ts`

**Step 1: Write the failing test**

Cover:
- editing nodes and edges updates the in-memory definition
- editing state schema fields and merge strategies is validated in the UI
- explicit join configuration can list upstream dependencies
- node retry and timeout policy edits persist correctly
- a `human-input` node exposes structured fields instead of freeform text blobs

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/desktop test -- WorkflowStudioView WorkflowGraphInspector`

Expected: FAIL because the studio is still only a metadata form.

**Step 3: Write minimal implementation**

Implement:
- structured inspector layout first, no freeform canvas requirement
- node list, edge list, state schema editor, and policy editor
- optimistic save against the full definition API
- basic validation feedback for invalid graph references

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/desktop test -- WorkflowStudioView WorkflowGraphInspector`

Expected: PASS for graph definition editing.

**Step 5: Commit**

```bash
git add apps/desktop/src/views/WorkflowStudioView.vue apps/desktop/src/components/workflow/WorkflowGraphInspector.vue apps/desktop/src/components/workflow/WorkflowNodeEditor.vue apps/desktop/src/components/workflow/WorkflowEdgeEditor.vue apps/desktop/src/components/workflow/WorkflowStateSchemaEditor.vue apps/desktop/src/components/workflow/WorkflowExecutionPolicyEditor.vue apps/desktop/src/tests/views/WorkflowStudioView.test.ts apps/desktop/src/tests/components/workflow/WorkflowGraphInspector.test.ts
git commit -m "feat: rebuild workflow studio as graph inspector"
```

## Task 8: Add Desktop Run, Debug, And Resume UX

**Files:**
- Modify: `apps/desktop/src/views/WorkflowStudioView.vue`
- Create: `apps/desktop/src/components/workflow/WorkflowRunPanel.vue`
- Create: `apps/desktop/src/components/workflow/WorkflowCheckpointTimeline.vue`
- Create: `apps/desktop/src/tests/components/workflow/WorkflowRunPanel.test.ts`
- Modify: `apps/desktop/src/tests/views/WorkflowStudioView.test.ts`

**Step 1: Write the failing test**

Cover:
- start run from the current workflow definition
- show paused `human-input` state
- show retry attempts and last error
- show join waiting state and merged field previews
- resume run from a pending checkpoint

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/desktop test -- WorkflowRunPanel WorkflowStudioView`

Expected: FAIL because the studio has no run/debug surface.

**Step 3: Write minimal implementation**

Implement:
- run panel that uses runtime run endpoints
- checkpoint timeline and latest state preview
- resume action for paused or retryable runs
- desktop-safe error rendering for runtime validation failures

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/desktop test -- WorkflowRunPanel WorkflowStudioView`

Expected: PASS for desktop personal run/debug flows.

**Step 5: Commit**

```bash
git add apps/desktop/src/views/WorkflowStudioView.vue apps/desktop/src/components/workflow/WorkflowRunPanel.vue apps/desktop/src/components/workflow/WorkflowCheckpointTimeline.vue apps/desktop/src/tests/components/workflow/WorkflowRunPanel.test.ts apps/desktop/src/tests/views/WorkflowStudioView.test.ts
git commit -m "feat: add workflow run debug ux"
```

## Task 9: Regression, Verification, And Cleanup

**Files:**
- Modify: `docs/plans/2026-03-24-desktop-personal-workflow-graph-implementation.md`
- Modify: `README.startup.md`
- Modify: `apps/desktop/src/tests/views/HubView.test.ts`
- Modify: `apps/runtime/src/server.packages.test.ts`

**Step 1: Write the failing test**

Add regression coverage to prove:
- summary-only assumptions are gone from desktop and runtime tests
- cloud-facing workflow package behavior is explicitly marked deferred or shimmed
- startup docs mention the new personal workflow storage layout

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/desktop test`

Expected: at least one regression FAIL until outdated tests and docs are updated.

**Step 3: Write minimal implementation**

Implement:
- final doc updates
- shim or explicit TODO markers for package flows still using summary-only workflow payloads
- cleanup of outdated fixtures and assumptions

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir packages/shared build`
- `pnpm --dir apps/runtime build`
- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/desktop test`
- `pnpm --dir apps/desktop build`

Expected: PASS for the personal workflow graph milestone. If package flow shims remain, document them clearly.

**Step 5: Commit**

```bash
git add README.startup.md docs/plans/2026-03-24-desktop-personal-workflow-graph-implementation.md apps/desktop/src/tests/views/HubView.test.ts apps/runtime/src/server.packages.test.ts
git commit -m "docs: finalize desktop personal workflow graph milestone"
```

## Notes For Execution

- Keep `WorkflowSummary` for fast library rendering and route lists.
- Treat `WorkflowDefinition` as the only editable source of truth.
- Do not bundle cloud package redesign into the first execution wave.
- Prefer structured desktop editors over freeform text JSON fields.
- Keep all new JSON files UTF-8 and verify no mojibake is introduced.

## Recommended Execution Order

1. Task 1
2. Task 2
3. Task 3
4. Tasks 4, 5, and 6 in parallel after Task 3 lands
5. Task 7 after Task 5 and Task 6 land
6. Task 8 after Task 4 and Task 7 land
7. Task 9 last
