# Workflow LangGraph Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade workflow definitions, runtime compatibility, and desktop studio editing so each node type has distinct behavior and inspector fields closer to a LangGraph-style graph authoring model.

**Architecture:** Keep the existing `WorkflowDefinition` as the cross-layer source of truth, enrich node-specific payloads in `packages/shared`, validate them in runtime, adapt them into executable runtime graphs, and expose the same typed model in desktop canvas cards and the inspector. Reuse the current executor where practical instead of rewriting the whole workflow runtime.

**Tech Stack:** Vue 3, Pinia, Vitest, TypeScript, Node runtime server

---

### Task 1: Expand Shared Workflow Node Contracts

**Files:**
- Modify: `desktop/packages/shared/src/contracts/workflow.ts`
- Test: `desktop/packages/shared/src/contracts/contracts.test.ts`

**Step 1:** Add failing shared contract tests for typed `llm`, `tool`, `condition`, and `subgraph` node payloads.

**Step 2:** Run the relevant shared tests and confirm the new assertions fail for the expected missing fields.

**Step 3:** Add the minimal shared contract types needed for richer node configuration while preserving existing compatible shapes.

**Step 4:** Re-run the shared tests and confirm they pass.

### Task 2: Strengthen Runtime Validation and Graph Adaptation

**Files:**
- Modify: `desktop/apps/runtime/src/services/workflow-definition-validator.ts`
- Modify: `desktop/apps/runtime/src/server.ts`
- Test: `desktop/apps/runtime/src/server.workflow-definitions.test.ts`
- Test: `desktop/apps/runtime/src/server.workflow-runs.test.ts`

**Step 1:** Add failing runtime tests that prove richer node definitions are rejected or flattened incorrectly today.

**Step 2:** Run only those runtime tests and verify the failures are caused by missing validation/adaptation support.

**Step 3:** Update validation and runtime graph adaptation so node-specific data survives into execution-compatible forms.

**Step 4:** Re-run the targeted runtime tests and confirm they pass.

### Task 3: Improve Runtime Execution Semantics

**Files:**
- Modify: `desktop/apps/runtime/src/services/workflow-graph-executor.ts`
- Test: runtime workflow executor tests that cover condition, tool, llm, subgraph, and human-input behavior

**Step 1:** Add failing tests for node execution behavior that should differ by node kind.

**Step 2:** Run the executor-focused tests and confirm the failures represent real missing behavior rather than bad expectations.

**Step 3:** Implement the smallest runtime changes that provide consistent execution semantics and checkpoints per node kind.

**Step 4:** Re-run the executor tests and confirm they pass.

### Task 4: Make Desktop Inspector Typed Per Node

**Files:**
- Modify: `desktop/apps/desktop/src/components/workflow/WorkflowNodeEditor.vue`
- Modify: `desktop/apps/desktop/src/components/workflow/WorkflowGraphInspector.vue`
- Modify: `desktop/apps/desktop/src/components/workflow/workflow-node-factory.ts`
- Test: `desktop/apps/desktop/src/tests/components/workflow/WorkflowGraphInspector.test.ts`
- Test: `desktop/apps/desktop/src/tests/components/workflow/workflow-node-factory.test.ts`

**Step 1:** Add failing component tests proving node kinds do not expose distinct editor fields today.

**Step 2:** Run the component tests and confirm they fail for the right reasons.

**Step 3:** Implement typed editor sections for `llm`, `tool`, `human-input`, `condition`, `subgraph`, `join`, `start`, and `end`.

**Step 4:** Re-run the targeted component tests and confirm they pass.

### Task 5: Make Canvas Cards Reflect Node Meaning

**Files:**
- Modify: `desktop/apps/desktop/src/components/workflow/WorkflowCanvas.vue`
- Test: `desktop/apps/desktop/src/tests/components/workflow/WorkflowCanvas.test.ts`

**Step 1:** Add failing tests for node card summaries that should differ by node kind.

**Step 2:** Run the targeted canvas tests and confirm current cards are too generic.

**Step 3:** Implement minimal node summaries and visual distinctions that surface node-specific information on the canvas.

**Step 4:** Re-run the targeted canvas tests and confirm they pass.

### Task 6: Integrate Studio and Run End-to-End Verification

**Files:**
- Modify: `desktop/apps/desktop/src/views/WorkflowStudioView.vue`
- Test: `desktop/apps/desktop/src/tests/views/WorkflowStudioView.test.ts`

**Step 1:** Add or update failing studio integration tests for selection, typed inspector rendering, and persisted node updates.

**Step 2:** Run the targeted studio tests and confirm the failures are integration gaps.

**Step 3:** Implement the smallest studio integration changes needed to wire the typed editor into persistence and selection flows.

**Step 4:** Re-run all workflow-related desktop/runtime tests, then run:
- `pnpm --dir desktop/packages/shared test`
- `pnpm --dir desktop/apps/runtime test`
- `pnpm --dir desktop/apps/desktop test`
- `pnpm --dir desktop/apps/runtime build`
- `pnpm --dir desktop/apps/desktop build`

**Step 5:** Run the repository乱码门禁 against modified files and manually re-open changed Chinese files to verify no encoding corruption.
