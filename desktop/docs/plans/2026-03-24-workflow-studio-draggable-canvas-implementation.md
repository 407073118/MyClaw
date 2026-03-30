# Workflow Studio Draggable Canvas Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the desktop workflow studio from a selection-based canvas shell into a usable draggable graph editor with persisted node positions, drag-to-connect edges, and direct edge/node deletion.

**Architecture:** Keep workflow execution semantics unchanged and add editor-only canvas metadata to the shared workflow definition so layout persists across desktop sessions without affecting runtime execution. Desktop owns drag state, edge-creation preview, hit-testing, and viewport interactions; runtime only validates and round-trips the persisted canvas metadata. The first milestone optimizes for a reliable personal desktop authoring experience, not collaborative editing or advanced graph layout.

**Tech Stack:** TypeScript, Vue 3, Pinia, Vitest, shared workflow contracts, desktop workflow studio components, runtime workflow validation/storage

---

## Scope

- Draggable workflow nodes on a real positioned canvas
- Persisted node positions inside workflow definitions
- Drag-to-connect edge creation from source handle to target handle
- Delete selected edges and nodes from the canvas
- Auto-placement for newly created nodes
- Canvas pan support for oversized graphs
- Studio tests covering drag, connect, delete, and persistence behavior

## Out Of Scope For This Plan

- Multi-user live collaboration
- Freeform annotations, grouping, or comments
- Automatic graph layout engines
- Production-grade zoom/minimap polish
- Runtime execution redesign

## Design Decision

Use **editor metadata inside `WorkflowDefinition`** instead of keeping positions in a desktop-only side store.

Chosen shape:

```ts
type WorkflowCanvasPoint = { x: number; y: number };

type WorkflowCanvasNodeLayout = {
  nodeId: string;
  position: WorkflowCanvasPoint;
};

type WorkflowCanvasViewport = {
  offsetX: number;
  offsetY: number;
};

type WorkflowEditorCanvas = {
  viewport: WorkflowCanvasViewport;
  nodes: WorkflowCanvasNodeLayout[];
};

type WorkflowEditorMetadata = {
  canvas: WorkflowEditorCanvas;
};
```

Reasoning:

- layout survives reloads and future import/export
- runtime can validate references without caring about rendering
- desktop can evolve UI without polluting execution fields like nodes/edges/state schema

## Preconditions

Before executing feature work, repair the workspace dependency links if `tsx`, `vitest`, or `tsc` still resolve into another repository path. The current environment has shown `node_modules` junctions pointing outside `F:\MyClaw\desktop`, so tests/builds must be made runnable first.

---

### Task 1: Add Shared Canvas Metadata Contracts

**Files:**
- Modify: `packages/shared/src/contracts/workflow.ts`
- Modify: `packages/shared/src/contracts/contracts.test.ts`
- Modify: `packages/shared/src/index.ts`

**Step 1: Write the failing test**

Add contract assertions covering:
- `WorkflowCanvasPoint`
- `WorkflowCanvasNodeLayout`
- `WorkflowCanvasViewport`
- `WorkflowEditorCanvas`
- `WorkflowEditorMetadata`
- `WorkflowDefinition.editor`

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir packages/shared test -- contracts`

Expected: FAIL because canvas metadata types are not exported yet.

**Step 3: Write minimal implementation**

Implement:
- new canvas/editor metadata types in `workflow.ts`
- optional `editor?: WorkflowEditorMetadata` on `WorkflowDefinition`
- export wiring through `src/index.ts`

Keep the change additive and backward-compatible.

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir packages/shared test -- contracts`

Expected: PASS for the new contract assertions.

**Step 5: Commit**

```bash
git add packages/shared/src/contracts/workflow.ts packages/shared/src/contracts/contracts.test.ts packages/shared/src/index.ts
git commit -m "feat: add workflow canvas editor contracts"
```

---

### Task 2: Teach Runtime Validation And Persistence To Round-Trip Canvas Metadata

**Files:**
- Modify: `apps/runtime/src/services/workflow-definition-validator.ts`
- Modify: `apps/runtime/src/services/workflow-definition-validator.test.ts`
- Modify: `apps/runtime/src/store/workflow-definition-store.ts`
- Modify: `apps/runtime/src/server.workflow-definitions.test.ts`
- Modify: `apps/runtime/src/server.ts`

**Step 1: Write the failing test**

Cover:
- workflow definition with valid editor canvas metadata loads and saves successfully
- canvas layout rejects duplicate `nodeId`
- canvas layout rejects unknown `nodeId`
- viewport values must be finite numbers
- `GET /api/workflows/:id` returns saved editor metadata unchanged
- `PATCH /api/workflows/:id` preserves editor metadata

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/runtime test -- workflow-definition-validator server.workflow-definitions`

Expected: FAIL because validator and API do not understand the `editor.canvas` shape yet.

**Step 3: Write minimal implementation**

Implement:
- validator checks for `editor.canvas.nodes[*].nodeId` referential integrity
- validator checks for finite `x`, `y`, `offsetX`, `offsetY`
- server patch path accepts `editor`
- draft workflow creation seeds a starter canvas layout for `start` and `end`
- file store round-trips metadata without transforming it

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/runtime test -- workflow-definition-validator server.workflow-definitions`

Expected: PASS for canvas metadata validation and API round-trip.

**Step 5: Commit**

```bash
git add apps/runtime/src/services/workflow-definition-validator.ts apps/runtime/src/services/workflow-definition-validator.test.ts apps/runtime/src/store/workflow-definition-store.ts apps/runtime/src/server.workflow-definitions.test.ts apps/runtime/src/server.ts
git commit -m "feat: persist workflow canvas metadata"
```

---

### Task 3: Preserve Canvas Metadata Through Desktop Client And Store

**Files:**
- Modify: `apps/desktop/src/services/runtime-client.ts`
- Modify: `apps/desktop/src/stores/workspace.ts`
- Modify: `apps/desktop/src/test-utils/workspace-fixture.ts`
- Modify: `apps/desktop/src/tests/stores/workspace-workflows.test.ts`

**Step 1: Write the failing test**

Cover:
- workflow detail hydration includes `editor.canvas`
- workflow create returns default layout for starter graph
- workflow update preserves canvas metadata when non-canvas fields change
- store keeps layout intact across `loadWorkflowById` and `updateWorkflow`

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/desktop test -- workspace-workflows`

Expected: FAIL because fixtures/store assumptions do not include canvas metadata yet.

**Step 3: Write minimal implementation**

Implement:
- client payload typing for `editor`
- fixture definitions with starter positions
- store updates that do not strip `editor`
- helper normalization for missing editor metadata on older workflows

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/desktop test -- workspace-workflows`

Expected: PASS for layout persistence in the desktop store.

**Step 5: Commit**

```bash
git add apps/desktop/src/services/runtime-client.ts apps/desktop/src/stores/workspace.ts apps/desktop/src/test-utils/workspace-fixture.ts apps/desktop/src/tests/stores/workspace-workflows.test.ts
git commit -m "feat: preserve workflow canvas layout in desktop store"
```

---

### Task 4: Add Canvas Geometry Helpers And Drag State Utilities

**Files:**
- Create: `apps/desktop/src/components/workflow/workflow-canvas-geometry.ts`
- Create: `apps/desktop/src/tests/components/workflow/workflow-canvas-geometry.test.ts`
- Modify: `apps/desktop/src/components/workflow/workflow-node-factory.ts`
- Modify: `apps/desktop/src/tests/components/workflow/workflow-node-factory.test.ts`

**Step 1: Write the failing test**

Cover:
- finding node layout by `nodeId`
- default fallback positions for legacy workflows with no layout
- auto-placement of a new node near the selected upstream node
- edge anchor point calculations from node rectangles
- layout cleanup when a node is deleted

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/desktop test -- workflow-canvas-geometry workflow-node-factory`

Expected: FAIL because geometry helpers and placement rules do not exist yet.

**Step 3: Write minimal implementation**

Implement:
- pure helpers for reading/writing layout entries
- deterministic starter positions
- helper for placing newly created nodes with fixed horizontal spacing
- cleanup helper for stale layout entries
- optional layout seed return from node creation flow where helpful

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/desktop test -- workflow-canvas-geometry workflow-node-factory`

Expected: PASS for geometry and auto-placement helpers.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/workflow/workflow-canvas-geometry.ts apps/desktop/src/tests/components/workflow/workflow-canvas-geometry.test.ts apps/desktop/src/components/workflow/workflow-node-factory.ts apps/desktop/src/tests/components/workflow/workflow-node-factory.test.ts
git commit -m "feat: add workflow canvas geometry helpers"
```

---

### Task 5: Rebuild WorkflowCanvas As A Real Draggable Surface

**Files:**
- Modify: `apps/desktop/src/components/workflow/WorkflowCanvas.vue`
- Modify: `apps/desktop/src/tests/components/workflow/WorkflowCanvas.test.ts`
- Create: `apps/desktop/src/tests/components/workflow/WorkflowCanvas.drag.test.ts`

**Step 1: Write the failing test**

Cover:
- nodes render from persisted absolute positions
- pointer drag updates a node position preview
- drag end emits updated layout payload
- canvas pan updates viewport offsets
- edge list and direct delete affordance still work

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/desktop test -- WorkflowCanvas`

Expected: FAIL because the current canvas is a lane/list layout without positioned drag behavior.

**Step 3: Write minimal implementation**

Implement:
- absolute-position node rendering inside a bounded canvas stage
- pointerdown / pointermove / pointerup drag lifecycle
- stage pan when dragging empty canvas background
- temporary in-memory drag state without immediately persisting on every move
- visual edge rendering using SVG overlay between anchor points
- selection behavior unchanged where practical

Do not add zoom in this task unless the drag implementation needs a scale abstraction internally.

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/desktop test -- WorkflowCanvas`

Expected: PASS for positioned rendering, dragging, and panning.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/workflow/WorkflowCanvas.vue apps/desktop/src/tests/components/workflow/WorkflowCanvas.test.ts apps/desktop/src/tests/components/workflow/WorkflowCanvas.drag.test.ts
git commit -m "feat: rebuild workflow canvas as draggable surface"
```

---

### Task 6: Add Drag-To-Connect Edge Creation And Direct Edge Deletion

**Files:**
- Modify: `apps/desktop/src/components/workflow/WorkflowCanvas.vue`
- Modify: `apps/desktop/src/tests/components/workflow/WorkflowCanvas.drag.test.ts`
- Modify: `apps/desktop/src/views/WorkflowStudioView.vue`
- Modify: `apps/desktop/src/tests/views/WorkflowStudioView.test.ts`

**Step 1: Write the failing test**

Cover:
- starting a connection drag from a source handle shows a preview edge
- dropping onto a valid target emits `connect:node`
- invalid target cancels the preview without mutating edges
- selecting an edge and pressing delete or clicking delete removes the edge
- duplicate edges are still blocked

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/desktop test -- WorkflowCanvas WorkflowStudioView`

Expected: FAIL because current edge creation is button-based rather than drag-based.

**Step 3: Write minimal implementation**

Implement:
- node source/target handles
- transient connection drag state
- target hit detection and preview rendering
- keyboard/button delete for selected edge
- studio handlers that persist the new edge list through `updateWorkflow`

Retain the current duplicate-edge guard and join-protection logic.

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/desktop test -- WorkflowCanvas WorkflowStudioView`

Expected: PASS for drag-to-connect and delete-edge flows.

**Step 5: Commit**

```bash
git add apps/desktop/src/components/workflow/WorkflowCanvas.vue apps/desktop/src/tests/components/workflow/WorkflowCanvas.drag.test.ts apps/desktop/src/views/WorkflowStudioView.vue apps/desktop/src/tests/views/WorkflowStudioView.test.ts
git commit -m "feat: add workflow canvas edge drag interactions"
```

---

### Task 7: Persist Drag Results From Studio And Keep Layout Consistent On Mutations

**Files:**
- Modify: `apps/desktop/src/views/WorkflowStudioView.vue`
- Modify: `apps/desktop/src/components/workflow/WorkflowGraphInspector.vue`
- Modify: `apps/desktop/src/tests/views/WorkflowStudioView.test.ts`
- Modify: `apps/desktop/src/tests/components/workflow/WorkflowGraphInspector.test.ts`

**Step 1: Write the failing test**

Cover:
- node drag persists updated `editor.canvas.nodes`
- new nodes receive default positions instead of stacking at origin
- deleting a node removes its layout metadata
- inspector save does not wipe the latest layout metadata
- loading an old workflow with no editor block backfills visible positions

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/desktop test -- WorkflowStudioView WorkflowGraphInspector`

Expected: FAIL because studio persistence paths currently only think about nodes/edges/state schema.

**Step 3: Write minimal implementation**

Implement:
- canvas change handler from `WorkflowCanvas` back into `WorkflowStudioView`
- persistence of updated `editor`
- layout cleanup on delete-node
- merge-safe save logic so inspector-driven saves keep canvas metadata intact
- compatibility fill-in for legacy workflows

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/desktop test -- WorkflowStudioView WorkflowGraphInspector`

Expected: PASS for canvas metadata persistence across all edit paths.

**Step 5: Commit**

```bash
git add apps/desktop/src/views/WorkflowStudioView.vue apps/desktop/src/components/workflow/WorkflowGraphInspector.vue apps/desktop/src/tests/views/WorkflowStudioView.test.ts apps/desktop/src/tests/components/workflow/WorkflowGraphInspector.test.ts
git commit -m "feat: persist draggable workflow canvas layout"
```

---

### Task 8: Regression, Docs, And Verification

**Files:**
- Modify: `docs/plans/2026-03-24-workflow-studio-draggable-canvas-implementation.md`
- Modify: `README.startup.md`
- Inspect only touched workflow files for mojibake

**Step 1: Add final regression assertions**

Extend tests as needed to prove:
- old summary/detail workflow flows still load
- runtime execution ignores editor-only metadata
- canvas interactions do not break run/debug panel rendering

**Step 2: Run verification**

Run:
- `pnpm --dir packages/shared build`
- `pnpm --dir apps/runtime test -- workflow-definition-validator server.workflow-definitions`
- `pnpm --dir apps/desktop test -- workspace-workflows WorkflowCanvas WorkflowStudioView WorkflowGraphInspector`
- `pnpm --dir apps/desktop build`

Expected: PASS for the draggable studio milestone.

**Step 3: Run mojibake gate**

Run:

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n --glob '!**/node_modules/**' --glob '!**/dist/**' $pattern apps/desktop apps/runtime packages docs README*.md
```

Expected: no new mojibake hits in modified files.

**Step 4: Re-open touched files**

Manually re-open the modified workflow files and confirm Chinese text remains readable.

**Step 5: Commit**

```bash
git add docs/plans/2026-03-24-workflow-studio-draggable-canvas-implementation.md README.startup.md apps/desktop apps/runtime packages/shared
git commit -m "feat: add draggable workflow studio canvas"
```

---

## Recommended Execution Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Tasks 5 and 6
6. Task 7
7. Task 8

## Notes For Execution

- Keep runtime execution graph logic separate from editor-only layout metadata.
- Do not bundle minimap, zoom, grouping, and comments into the first draggable milestone.
- Prefer pointer events over mouse-only handlers so the interaction model stays future-friendly.
- Treat canvas metadata as optional when reading old workflow definitions.
- Preserve existing edge validation and join constraints while upgrading interaction style.
- If the current dependency links still point at another repository, fix the workspace install before claiming test coverage.
