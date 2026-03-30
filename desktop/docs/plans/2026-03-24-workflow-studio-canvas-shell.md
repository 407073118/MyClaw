# Workflow Studio Canvas Shell Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the desktop workflow studio into a canvas-first editor shell with a central graph canvas, right-side inspector, and bottom run/debug panel while reusing the existing workflow data flow.

**Architecture:** Keep the current `workspace.workflowDefinitions` and runtime APIs unchanged. Add a new `WorkflowCanvas` presentation component for graph visualization and selection, lift selection state into `WorkflowStudioView`, and narrow `WorkflowGraphInspector` into an inspector sidebar that edits the currently selected node or edge plus shared schema metadata.

**Tech Stack:** Vue 3, Pinia, Vitest, existing desktop workflow components

---

### Task 1: Define canvas-first studio behavior with tests

**Files:**
- Modify: `apps/desktop/src/tests/views/WorkflowStudioView.test.ts`
- Create: `apps/desktop/src/tests/components/workflow/WorkflowCanvas.test.ts`

**Steps:**
1. Add a failing view test asserting the studio renders canvas, inspector sidebar, and run/debug panel together.
2. Add failing canvas tests covering node/edge rendering and selection events.
3. Run `pnpm --dir apps/desktop test -- WorkflowStudioView WorkflowCanvas`.

### Task 2: Implement the new studio shell

**Files:**
- Create: `apps/desktop/src/components/workflow/WorkflowCanvas.vue`
- Modify: `apps/desktop/src/views/WorkflowStudioView.vue`

**Steps:**
1. Build a graph overview canvas with node cards, edge list, selection state, and graph stats.
2. Move studio page layout to `canvas main + inspector sidebar + run/debug bottom`.
3. Keep workflow metadata as a compact summary panel instead of the primary form.

### Task 3: Narrow inspector responsibilities

**Files:**
- Modify: `apps/desktop/src/components/workflow/WorkflowGraphInspector.vue`
- Modify: `apps/desktop/src/tests/components/workflow/WorkflowGraphInspector.test.ts`

**Steps:**
1. Change the inspector to edit the selected node or edge rather than owning the graph list UI.
2. Keep schema validation and save behavior intact.
3. Preserve compatibility with existing node, edge, and schema editor components.

### Task 4: Verify and guard against mojibake

**Files:**
- Inspect only modified files from this task

**Steps:**
1. Run targeted desktop tests.
2. Run the repository mojibake gate against the touched paths.
3. Re-open touched files and confirm Chinese text remains readable.
