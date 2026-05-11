# Workflow Variable System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a mature workflow variable loop that covers start inputs, node input mapping, node outputs, final outputs, run snapshots, and debugger visibility.

**Architecture:** Keep the existing Pregel/channel runner, then add a typed variable layer on top of it. New contracts stay backward compatible with legacy `stateSchema`, `inputBindings`, and `outputBindings`, while runtime gradually shifts to typed refs and expression-based input sources.

**Tech Stack:** TypeScript, Electron IPC, React, Zustand, Vitest, existing workflow engine.

---

### Task 1: Variable Contract And Resolver

**Files:**
- Modify: `desktop/shared/contracts/workflow.ts`
- Create: `desktop/src/main/services/workflow-engine/variable-resolver.ts`
- Test: `desktop/tests/workflow-variable-resolver.test.ts`

**Steps:**
1. Write failing tests for static values, variable refs, expressions, dotted paths, and missing refs.
2. Add typed variable contract types with optional fields so old workflow JSON keeps loading.
3. Implement resolver helpers that read from `inputs`, `sys`, `vars`, `nodes`, `outputs`, and legacy flat state.
4. Run the resolver tests.

### Task 2: Runner State Snapshot

**Files:**
- Modify: `desktop/src/main/services/workflow-engine/pregel-runner.ts`
- Modify: `desktop/src/main/services/workflow-engine/channels.ts`
- Test: `desktop/tests/workflow-engine-pregel.test.ts`

**Steps:**
1. Write failing tests proving initial state is also visible under `inputs`, and node outputs are visible under `nodes.<nodeId>`.
2. Store start input as an object channel named `inputs`.
3. Store every node completion output in an object-merge `nodes` channel.
4. Emit `checkpoint-saved` after successful checkpoint persistence.

### Task 3: Unified Node Inputs And Outputs

**Files:**
- Modify: `desktop/src/main/services/workflow-engine/node-executor.ts`
- Modify: `desktop/src/main/services/workflow-engine/executors/llm.ts`
- Modify: `desktop/src/main/services/workflow-engine/executors/tool.ts`
- Modify: `desktop/src/main/services/workflow-engine/executors/http-request.ts`
- Modify: `desktop/src/main/services/workflow-engine/executors/end.ts`
- Test: existing workflow engine executor tests plus new resolver tests.

**Steps:**
1. Add `resolvedInputs` to node execution context.
2. Prefer new `inputSources`, then fall back to legacy `inputBindings`.
3. Support dotted `{{ inputs.topic }}` and `{{ nodes.llm.content }}` templates in LLM/HTTP fields.
4. Add end-node output mapping into `outputs`.

### Task 4: UI Variable Operations

**Files:**
- Create: `desktop/src/renderer/components/workflow/WorkflowVariablePicker.tsx`
- Modify: `desktop/src/renderer/components/workflow/WorkflowNodeEditor.tsx`
- Modify: `desktop/src/renderer/components/workflow/WorkflowRunPanel.tsx`
- Modify: `desktop/src/renderer/components/workflow/WorkflowDebugPanel.tsx`
- Modify: `desktop/src/renderer/pages/WorkflowStudioPage.tsx`

**Steps:**
1. Add run input form from workflow input variable definitions.
2. Add grouped variable picker for input variables, node outputs, run state, and system variables.
3. Show node-level input/output/debug data from stream events.
4. Keep UI dense and operational, matching the existing studio layout.

### Task 5: Verification

**Commands:**
- `cd desktop; pnpm test -- workflow-variable-resolver workflow-engine-pregel workflow-http-request-executor workflow-node-text workflow-run-panel workflow-studio-page`
- `cd desktop; pnpm run typecheck`
- Run the repository mojibake scan for modified files.

**Completion Criteria:**
- Workflow can be started with visible input variables.
- Nodes can consume variables through the unified resolver.
- Node outputs are visible as `nodes.<nodeId>.*`.
- Final outputs can be mapped by an end node.
- Debug UI can show run state and node output data.
