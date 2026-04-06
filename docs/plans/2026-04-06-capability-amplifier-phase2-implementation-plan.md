# Capability Amplifier Phase 2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the Phase 1 runtime skeleton into a real execution-plan runtime so each model call flows through `intent -> plan -> execute`, with explicit replay policy, adapter choice, degradation metadata, and plan-aware context assembly.

**Architecture:** Phase 2 does not add planner or delegator behavior yet. It hardens the runtime decision layer created in Phase 1 by extending the session runtime contract, enriching `ExecutionPlan`, refactoring `sessions.ts` into a clearer orchestration flow, and making `context-assembler` consume replay policy instead of blindly carrying reasoning. This phase turns the runtime shell into the real decision authority for model execution.

**Tech Stack:** Electron main process, TypeScript, shared desktop contracts, Vitest, existing capability resolver, context assembler/compactor, provider adapters, transport/parser split from Phase 1.

---

### Task 1: Expand Session Runtime Contracts for Phase 2

**Files:**
- Modify: `desktop/shared/contracts/session-runtime.ts`
- Modify: `desktop/shared/contracts/session.ts`
- Modify: `desktop/shared/contracts/index.ts`
- Test: `desktop/tests/phase2-session-runtime-contracts.test.ts`

**Step 1: Write the failing contract test**

Cover:
- richer `SessionRuntimeIntent`
- richer `ExecutionPlan`
- explicit replay / degradation / tool strategy fields
- backward compatibility for existing sessions

**Step 2: Run test to verify it fails**

Run: `pnpm --dir desktop exec vitest run tests/phase2-session-runtime-contracts.test.ts`
Expected: FAIL

**Step 3: Implement minimal contract expansion**

Add fields for:
- `reasoningEnabled`
- `reasoningEffort`
- `adapterHint`
- `replayPolicy`
- `toolStrategy`
- `degradationReason`
- `planSource`

Keep all session-persisted additions backward compatible.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir desktop exec vitest run tests/phase2-session-runtime-contracts.test.ts`
Expected: PASS

### Task 2: Promote ExecutionPlan into the Runtime Decision Authority

**Files:**
- Modify: `desktop/src/main/services/reasoning-runtime.ts`
- Create: `desktop/tests/phase2-execution-plan-runtime.test.ts`

**Step 1: Write the failing runtime tests**

Cover:
- explicit adapter selection from intent
- degradation reasons when capability is missing
- replay policy derivation from intent + capability + provider
- plan metadata stability for MiniMax vs generic providers

**Step 2: Run test to verify it fails**

Run: `pnpm --dir desktop exec vitest run tests/phase2-execution-plan-runtime.test.ts`
Expected: FAIL

**Step 3: Implement richer plan resolution**

Turn `buildExecutionPlan()` into a real decision layer that:
- merges persisted session intent and request-time overrides
- resolves adapter choice
- resolves replay policy
- emits degradation metadata
- emits a stable `planSource`

**Step 4: Run test to verify it passes**

Run: `pnpm --dir desktop exec vitest run tests/phase2-execution-plan-runtime.test.ts`
Expected: PASS

### Task 3: Make Context Assembly Replay-Policy Aware

**Files:**
- Modify: `desktop/src/main/services/context-assembler.ts`
- Modify: `desktop/src/main/services/context-compactor.ts`
- Test: `desktop/tests/phase2-context-replay-policy.test.ts`

**Step 1: Write the failing context tests**

Cover:
- `content-only` strips assistant reasoning from outbound model messages
- `assistant-turn` keeps assistant turn structure but no reasoning payload
- `assistant-turn-with-reasoning` keeps reasoning for replay-aware providers

**Step 2: Run test to verify it fails**

Run: `pnpm --dir desktop exec vitest run tests/phase2-context-replay-policy.test.ts`
Expected: FAIL

**Step 3: Implement replay-policy aware assembly**

Accept execution-plan or replay-policy input and apply it during model message assembly.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir desktop exec vitest run tests/phase2-context-replay-policy.test.ts`
Expected: PASS

### Task 4: Refactor Session Send Flow into intent -> plan -> execute

**Files:**
- Modify: `desktop/src/main/ipc/sessions.ts`
- Test: `desktop/tests/phase2-session-orchestration.test.ts`

**Step 1: Write the failing orchestration test**

Cover:
- session send flow derives runtime intent
- execution plan is built before context assembly
- replay policy is passed through to the model execution path
- degradation metadata survives the round

**Step 2: Run test to verify it fails**

Run: `pnpm --dir desktop exec vitest run tests/phase2-session-orchestration.test.ts`
Expected: FAIL

**Step 3: Refactor the send path**

Introduce a clearer pipeline:
- derive session runtime intent
- resolve capability
- build execution plan
- assemble context with replay policy
- execute model call
- persist plan metadata on the session

**Step 4: Run test to verify it passes**

Run: `pnpm --dir desktop exec vitest run tests/phase2-session-orchestration.test.ts`
Expected: PASS

### Task 5: Record Plan Metadata in Session Persistence

**Files:**
- Modify: `desktop/src/main/services/state-persistence.ts`
- Test: `desktop/tests/phase2-session-persistence.test.ts`

**Step 1: Write the failing persistence test**

Cover:
- sessions with richer runtime intent still serialize/deserialize safely
- missing Phase 2 fields do not break older persisted sessions

**Step 2: Run test to verify it fails**

Run: `pnpm --dir desktop exec vitest run tests/phase2-session-persistence.test.ts`
Expected: FAIL

**Step 3: Implement the minimal persistence hardening**

Ensure the richer session/runtime metadata survives save/load without migration regressions.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir desktop exec vitest run tests/phase2-session-persistence.test.ts`
Expected: PASS

### Task 6: Add Phase 2 Integration and Degradation Tests

**Files:**
- Create: `desktop/tests/phase2-degradation-integration.test.ts`
- Optionally modify: `desktop/tests/phase16-context-fallbacks.test.ts`

**Step 1: Write the failing integration test**

Cover:
- unknown capability falls back safely
- degradation reason is recorded
- MiniMax still picks replay-aware behavior
- generic provider still stays on simpler replay semantics

**Step 2: Run test to verify it fails**

Run: `pnpm --dir desktop exec vitest run tests/phase2-degradation-integration.test.ts`
Expected: FAIL

**Step 3: Implement only the minimum code needed**

If needed, adjust runtime/context glue, not provider adapters.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir desktop exec vitest run tests/phase2-degradation-integration.test.ts`
Expected: PASS

### Task 7: Run the Phase 2 Focused Verification Batch

**Files:**
- No code changes required

**Step 1: Execute the focused Phase 2 verification batch**

Run:

```bash
pnpm --dir desktop exec vitest run \
  tests/phase2-session-runtime-contracts.test.ts \
  tests/phase2-execution-plan-runtime.test.ts \
  tests/phase2-context-replay-policy.test.ts \
  tests/phase2-session-orchestration.test.ts \
  tests/phase2-session-persistence.test.ts \
  tests/phase2-degradation-integration.test.ts \
  tests/phase1-session-runtime-integration.test.ts \
  tests/phase1-golden-transcripts.test.ts \
  tests/phase1-model-transport.test.ts \
  tests/phase1-model-sse-parser.test.ts \
  tests/phase1-model-client-transport.test.ts
```

Then run:

```bash
pnpm --dir desktop run typecheck
```

Expected: all pass

### Task 8: Save the Phase 2 Summary

**Files:**
- Update: `docs/plans/2026-04-06-desktop-model-capability-amplifier-design.md`
- Optional create: `docs/plans/2026-04-06-phase2-capability-scorecard.md`

**Step 1: Record what actually shipped**

Include:
- final files touched
- verification commands
- remaining gaps before Phase 3

**Step 2: Commit**

Use a Lore protocol commit message after fresh verification.
