---
status: investigating
trigger: "Investigate issue: desktop-workflow-create-undefined-map\n\n**Summary:** Creating a workflow in the desktop app throws a renderer runtime error `Cannot read properties of undefined (reading 'map')`."
created: 2026-04-04T12:31:21+08:00
updated: 2026-04-04T12:34:33+08:00
---

## Current Focus

hypothesis: `workflow:update` stores a partial definition built from a summary plus partial updates, leaving `stateSchema` undefined; `WorkflowGraphInspector` then calls `draft.stateSchema.map(...)` when the new workflow studio opens
test: run the existing workflow IPC regression tests, then patch the main-process workflow handlers so create/get/update always materialize a normalized `WorkflowDefinition`
expecting: the failing path yields `stateSchema: []` for newly created workflows and the renderer no longer receives undefined arrays
next_action: execute `desktop/tests/workflow-ipc.test.ts` to confirm the handler currently violates the normalized definition contract

## Symptoms

expected: Creating a workflow should open/save successfully without crashing the renderer.
actual: The renderer crashes during workflow creation with `Cannot read properties of undefined (reading 'map')` and a minified stack pointing into the built renderer bundle.
errors: Cannot read properties of undefined (reading 'map') at F0 (file:///Users/zhangjianing/WebstormProjects/ai-project/MyClaw/desktop/dist/renderer/assets/index-DaA9Tanj.js:3908:1680) plus React component stack including aside/main sections and retry UI.
reproduction: Launch desktop app, go to workflow creation flow, attempt to create a workflow, observe runtime crash.
started: Reported on current local build as reproducible now. Prior working state unknown.

## Eliminated

## Evidence

- timestamp: 2026-04-04T12:32:09+08:00
  checked: active debug sessions and knowledge base
  found: multiple unrelated debug session files exist; `.planning/debug/knowledge-base.md` is absent
  implication: this issue needs a new dedicated session and there is no prior known-pattern entry to test first

- timestamp: 2026-04-04T12:32:09+08:00
  checked: desktop workflow-related source search
  found: workflow creation is handled through `desktop/src/main/ipc/workflows.ts`, stored in `desktop/src/renderer/stores/workspace.ts`, and rendered via `desktop/src/renderer/pages/WorkflowStudioPage.tsx` and workflow components with many direct `.map` calls
  implication: the likely fault is in normalization between IPC creation payloads and renderer workflow definition consumers

- timestamp: 2026-04-04T12:34:33+08:00
  checked: workflow creation page, IPC handlers, and studio child components
  found: `WorkflowsPage` creates a workflow, then calls `workspace.updateWorkflow()` with starter `nodes` and `edges` but no `stateSchema`; `workflow:update` stores `{ ...existingSummary, ...updates }` in `ctx.state.workflowDefinitions`; `WorkflowGraphInspector` immediately computes `draft.stateSchema.map(...)`
  implication: a brand-new workflow opens with `stateSchema === undefined`, which directly explains the renderer `undefined.map` crash

- timestamp: 2026-04-04T12:34:33+08:00
  checked: workflow contract and `workflow:get` fallback
  found: `WorkflowDefinition` requires `nodes`, `edges`, and `stateSchema` arrays, but `workflow:get` summary fallback only guarantees `nodes` and `edges`
  implication: the main-process workflow handlers do not consistently satisfy the shared contract, so the correct fix belongs in definition normalization there

## Resolution

root_cause:
fix:
verification:
files_changed: []
