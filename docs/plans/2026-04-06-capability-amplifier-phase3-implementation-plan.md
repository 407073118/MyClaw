# Capability Amplifier Phase 3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a real planning runtime on top of the Phase 2 execution-plan foundation so complex tasks can be decomposed into structured task state, progressed through the tool loop, persisted in sessions, and exposed through minimal UI/debug surfaces.

**Architecture:** Phase 3 does not introduce delegation yet. It adds the smallest durable planning substrate: a typed `PlanState`, a planner runtime/plugin layer, tool-loop progress updates, session persistence for plan state, and a minimal renderer/debug surface. The goal is to make complex work persistent and observable, not to ship a heavy productized planner UI.

**Tech Stack:** Electron main process, TypeScript, shared desktop contracts, Vitest, existing execution-plan runtime, session persistence, renderer pages/utilities, and context/tool orchestration from Phase 2.

---

### Task 1: Define the Plan State Contract

**Files:**
- Create: `desktop/shared/contracts/plan.ts`
- Modify: `desktop/shared/contracts/session.ts`
- Modify: `desktop/shared/contracts/index.ts`
- Test: `desktop/tests/phase3-plan-contracts.test.ts`

**Step 1: Write the failing contract test**

Cover:
- `PlanTask`
- `PlanState`
- task status values
- optional session persistence compatibility

**Step 2: Run test to verify it fails**

Run: `pnpm --dir desktop exec vitest run tests/phase3-plan-contracts.test.ts`
Expected: FAIL

**Step 3: Implement the minimal plan contract**

Define:
- stable task ids
- task status (`pending`, `in_progress`, `completed`, `blocked`)
- optional blocker/detail fields
- `PlanState` metadata such as `updatedAt`

Extend `ChatSession` with optional `planState`.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir desktop exec vitest run tests/phase3-plan-contracts.test.ts`
Expected: PASS

### Task 2: Add Planner Runtime Core

**Files:**
- Create: `desktop/src/main/services/planner-runtime.ts`
- Test: `desktop/tests/phase3-planner-runtime.test.ts`

**Step 1: Write the failing runtime test**

Cover:
- create initial plan state
- update task status
- derive planner state transitions
- reject invalid transitions

**Step 2: Run test to verify it fails**

Run: `pnpm --dir desktop exec vitest run tests/phase3-planner-runtime.test.ts`
Expected: FAIL

**Step 3: Implement planner runtime**

Create a small planner service that:
- initializes plan state
- updates tasks
- records plan timestamps
- provides helper methods for progress updates

**Step 4: Run test to verify it passes**

Run: `pnpm --dir desktop exec vitest run tests/phase3-planner-runtime.test.ts`
Expected: PASS

### Task 3: Attach Plan State to Session Persistence

**Files:**
- Modify: `desktop/src/main/services/state-persistence.ts`
- Test: `desktop/tests/phase3-plan-persistence.test.ts`

**Step 1: Write the failing persistence test**

Cover:
- save/load round-trip for `planState`
- compatibility with sessions missing plan state

**Step 2: Run test to verify it fails**

Run: `pnpm --dir desktop exec vitest run tests/phase3-plan-persistence.test.ts`
Expected: FAIL

**Step 3: Implement persistence**

Ensure `planState` survives real disk round-trips without breaking older sessions.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir desktop exec vitest run tests/phase3-plan-persistence.test.ts`
Expected: PASS

### Task 4: Integrate Planning into Session Orchestration

**Files:**
- Modify: `desktop/src/main/ipc/sessions.ts`
- Test: `desktop/tests/phase3-session-planning-orchestration.test.ts`

**Step 1: Write the failing orchestration test**

Cover:
- session creates/updates plan state
- plan state is visible on the session during execution
- plan progress survives a round

**Step 2: Run test to verify it fails**

Run: `pnpm --dir desktop exec vitest run tests/phase3-session-planning-orchestration.test.ts`
Expected: FAIL

**Step 3: Implement minimal orchestration**

Do not build a full planner UX yet. Just ensure session orchestration can:
- initialize plan state when required
- carry it through the round
- persist updated state

**Step 4: Run test to verify it passes**

Run: `pnpm --dir desktop exec vitest run tests/phase3-session-planning-orchestration.test.ts`
Expected: PASS

### Task 5: Wire Tool Loop Progress Updates

**Files:**
- Modify: `desktop/src/main/ipc/sessions.ts`
- Test: `desktop/tests/phase3-tool-loop-plan-updates.test.ts`

**Step 1: Write the failing tool-loop test**

Cover:
- tool success can advance a task
- tool failure can mark or keep a task blocked/in-progress
- plan state remains structurally valid

**Step 2: Run test to verify it fails**

Run: `pnpm --dir desktop exec vitest run tests/phase3-tool-loop-plan-updates.test.ts`
Expected: FAIL

**Step 3: Implement minimal progress updates**

Add only enough glue to reflect task progress in plan state during execution.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir desktop exec vitest run tests/phase3-tool-loop-plan-updates.test.ts`
Expected: PASS

### Task 6: Add Minimal Renderer/Debug Surface

**Files:**
- Modify: `desktop/src/renderer/pages/ChatPage.tsx`
- Optionally create: `desktop/src/renderer/components/plan-state-panel.tsx`
- Test: `desktop/tests/phase3-plan-ui.test.ts`

**Step 1: Write the failing UI test**

Cover:
- plan state can be rendered minimally
- task statuses are visible
- no heavy planner UX assumptions

**Step 2: Run test to verify it fails**

Run: `pnpm --dir desktop exec vitest run tests/phase3-plan-ui.test.ts`
Expected: FAIL

**Step 3: Implement a minimal surface**

Expose plan state readably, without overbuilding.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir desktop exec vitest run tests/phase3-plan-ui.test.ts`
Expected: PASS

### Task 7: Add Planning Benchmarks

**Files:**
- Create: `desktop/tests/phase3-planning-benchmarks.test.ts`

**Step 1: Write the failing benchmark test**

Cover:
- multi-step task progression
- blocked task path
- completed task path

**Step 2: Run test to verify it fails**

Run: `pnpm --dir desktop exec vitest run tests/phase3-planning-benchmarks.test.ts`
Expected: FAIL

**Step 3: Implement the benchmark fixtures/assertions**

Freeze expected planning behavior without overfitting a product UI.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir desktop exec vitest run tests/phase3-planning-benchmarks.test.ts`
Expected: PASS

### Task 8: Run the Phase 3 Focused Verification Batch

**Files:**
- No code changes required

**Step 1: Execute the focused Phase 3 verification batch**

Run:

```bash
pnpm --dir desktop exec vitest run \
  tests/phase3-plan-contracts.test.ts \
  tests/phase3-planner-runtime.test.ts \
  tests/phase3-plan-persistence.test.ts \
  tests/phase3-session-planning-orchestration.test.ts \
  tests/phase3-tool-loop-plan-updates.test.ts \
  tests/phase3-plan-ui.test.ts \
  tests/phase3-planning-benchmarks.test.ts \
  tests/phase2-session-orchestration.test.ts \
  tests/phase2-session-persistence.test.ts \
  tests/phase2-context-replay-policy.test.ts \
  tests/phase1-session-runtime-integration.test.ts
```

Then run:

```bash
pnpm --dir desktop run typecheck
```

Expected: all pass

### Task 9: Save the Phase 3 Summary

**Files:**
- Update: `docs/plans/2026-04-06-desktop-model-capability-amplifier-design.md`
- Optional create: `docs/plans/2026-04-06-phase3-capability-scorecard.md`

**Step 1: Record what actually shipped**

Include:
- final files touched
- verification commands
- remaining gaps before Phase 4

**Step 2: Commit**

Use a Lore protocol commit message after fresh verification.
