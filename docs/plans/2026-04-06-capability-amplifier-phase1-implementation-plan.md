# Capability Amplifier Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first runnable slice of the desktop capability amplifier runtime by introducing session runtime intent, provider adapter infrastructure, replay-aware reasoning runtime, and a transport-thinned model client for MiniMax plus generic OpenAI-compatible models.

**Architecture:** Phase 1 does not attempt to ship planner or delegator features. It creates the substrate they depend on: replay-safe session/runtime contracts, adapter-owned request/response shaping, and a thin transport client. The existing chat loop in `sessions.ts` remains the execution host, but it must stop owning provider-specific decision logic.

**Tech Stack:** Electron main process, TypeScript, Vitest, shared desktop contracts, existing context assembly and model capability services.

---

### Task 1: Add Session Runtime Contracts

**Files:**
- Create: `desktop/shared/contracts/session-runtime.ts`
- Modify: `desktop/shared/contracts/session.ts`
- Modify: `desktop/shared/contracts/index.ts`
- Test: `desktop/tests/phase1-session-runtime-contracts.test.ts`

**Step 1: Write the failing contract test**

Verify we can serialize and read:
- `SessionRuntimeIntent`
- `ExecutionPlan`
- replay policy enums
- session metadata fields such as `runtimeVersion`

**Step 2: Run test to verify it fails**

Run: `pnpm vitest desktop/tests/phase1-session-runtime-contracts.test.ts`
Expected: FAIL because the new contract file and exports do not exist.

**Step 3: Implement minimal shared contracts**

Create a new runtime contract module with:
- session runtime intent
- replay policy
- provider adapter selection metadata
- execution plan shell

Extend `ChatSession` with the smallest safe runtime metadata needed for Phase 1.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest desktop/tests/phase1-session-runtime-contracts.test.ts`
Expected: PASS

### Task 2: Build Reasoning Runtime Shell

**Files:**
- Create: `desktop/src/main/services/reasoning-runtime.ts`
- Test: `desktop/tests/phase1-reasoning-runtime.test.ts`

**Step 1: Write failing runtime tests**

Cover:
- default runtime intent resolution
- BR MiniMax adapter selection
- replay policy defaults
- execution plan fallback defaults

**Step 2: Run test to verify it fails**

Run: `pnpm vitest desktop/tests/phase1-reasoning-runtime.test.ts`
Expected: FAIL because the runtime file does not exist.

**Step 3: Implement the runtime shell**

Add a small `buildExecutionPlan()` flow that:
- accepts session/runtime intent, profile, resolved capability
- selects adapter id
- emits replay policy
- emits Phase 1 fallback chain

Do not move planner or delegator behavior into this phase.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest desktop/tests/phase1-reasoning-runtime.test.ts`
Expected: PASS

### Task 3: Introduce Provider Adapter Base

**Files:**
- Create: `desktop/src/main/services/provider-adapters/base.ts`
- Create: `desktop/src/main/services/provider-adapters/index.ts`
- Test: `desktop/tests/phase1-provider-adapter-contracts.test.ts`

**Step 1: Write failing adapter contract tests**

Cover:
- adapter interface shape
- request preparation contract
- replay materialization contract
- fallback variant contract

**Step 2: Run test to verify it fails**

Run: `pnpm vitest desktop/tests/phase1-provider-adapter-contracts.test.ts`
Expected: FAIL

**Step 3: Implement adapter base**

Define:
- adapter id type
- adapter context
- request body preparation interface
- response normalization interface
- replay materialization interface

Keep it generic and provider-neutral.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest desktop/tests/phase1-provider-adapter-contracts.test.ts`
Expected: PASS

### Task 4: Extract MiniMax Adapter

**Files:**
- Create: `desktop/src/main/services/provider-adapters/minimax.ts`
- Modify: `desktop/shared/br-minimax.ts`
- Modify: `desktop/src/main/services/br-minimax-runtime.ts`
- Test: `desktop/tests/phase1-minimax-adapter.test.ts`
- Test: `desktop/tests/br-minimax-model-client.test.ts`

**Step 1: Write failing MiniMax adapter tests**

Cover:
- assistant reasoning replay into `<think>`
- reasoning split primary request
- compatibility fallback request
- diagnostics-driven single path selection

**Step 2: Run test to verify it fails**

Run: `pnpm vitest desktop/tests/phase1-minimax-adapter.test.ts desktop/tests/br-minimax-model-client.test.ts`
Expected: FAIL because MiniMax behavior still lives inside `model-client.ts`.

**Step 3: Move MiniMax shaping logic into adapter**

Extract:
- request body variant building
- assistant replay materialization
- diagnostics-aware fallback selection

Leave diagnostics probing in `br-minimax-runtime.ts`, but adapter should consume the result.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest desktop/tests/phase1-minimax-adapter.test.ts desktop/tests/br-minimax-model-client.test.ts`
Expected: PASS

### Task 5: Add Generic OpenAI-Compatible Adapter

**Files:**
- Create: `desktop/src/main/services/provider-adapters/openai-compatible.ts`
- Test: `desktop/tests/phase1-openai-compatible-adapter.test.ts`

**Step 1: Write failing adapter tests**

Cover:
- generic request preparation
- non-BR provider replay pass-through
- default fallback behavior

**Step 2: Run test to verify it fails**

Run: `pnpm vitest desktop/tests/phase1-openai-compatible-adapter.test.ts`
Expected: FAIL

**Step 3: Implement generic OpenAI-compatible adapter**

Support:
- regular request body preparation
- reasoning field pass-through where safe
- default adapter diagnostics payload

**Step 4: Run test to verify it passes**

Run: `pnpm vitest desktop/tests/phase1-openai-compatible-adapter.test.ts`
Expected: PASS

### Task 6: Thin the Model Client into Transport

**Files:**
- Modify: `desktop/src/main/services/model-client.ts`
- Test: `desktop/tests/phase1-model-client-transport.test.ts`

**Step 1: Write failing transport tests**

Cover:
- transport consumes prepared request variants
- transport delegates normalization hooks
- SSE accumulation remains intact

**Step 2: Run test to verify it fails**

Run: `pnpm vitest desktop/tests/phase1-model-client-transport.test.ts`
Expected: FAIL

**Step 3: Refactor model client**

Keep inside transport:
- endpoint resolution
- headers
- fetch/retry
- SSE parsing

Move out of transport:
- provider-specific request shaping
- provider-specific replay shaping
- diagnostics-based fallback choice

**Step 4: Run test to verify it passes**

Run: `pnpm vitest desktop/tests/phase1-model-client-transport.test.ts`
Expected: PASS

### Task 7: Integrate Runtime Shell into Session Send Flow

**Files:**
- Modify: `desktop/src/main/ipc/sessions.ts`
- Modify: `desktop/src/main/services/state-persistence.ts`
- Test: `desktop/tests/phase1-session-runtime-integration.test.ts`

**Step 1: Write failing integration tests**

Cover:
- session creation initializes runtime metadata
- send flow builds execution plan before calling model transport
- plan metadata survives save/load

**Step 2: Run test to verify it fails**

Run: `pnpm vitest desktop/tests/phase1-session-runtime-integration.test.ts`
Expected: FAIL

**Step 3: Implement minimal integration**

Change the send path to:
- derive runtime intent from session and/or defaults
- resolve capability
- build execution plan
- choose adapter
- call transport through adapter-owned request variants

Do not add planner/delegator behavior yet.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest desktop/tests/phase1-session-runtime-integration.test.ts`
Expected: PASS

### Task 8: Establish Phase 1 Verification Baseline

**Files:**
- Create: `desktop/tests/phase1-golden-transcripts.test.ts`
- Optionally create: `desktop/tests/fixtures/phase1/*`

**Step 1: Write the failing verification harness**

Create a first-pass golden suite for:
- MiniMax replay
- tool-loop reasoning preservation
- fallback downgrade path

**Step 2: Run test to verify it fails**

Run: `pnpm vitest desktop/tests/phase1-golden-transcripts.test.ts`
Expected: FAIL

**Step 3: Implement the minimal fixtures and assertions**

The goal is not exhaustive realism yet. The goal is to freeze expected execution shape.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest desktop/tests/phase1-golden-transcripts.test.ts`
Expected: PASS

### Task 9: Run the Phase 1 Test Batch

**Files:**
- No code changes required

**Step 1: Execute the focused Phase 1 verification batch**

Run:

```bash
pnpm vitest \
  desktop/tests/phase1-session-runtime-contracts.test.ts \
  desktop/tests/phase1-reasoning-runtime.test.ts \
  desktop/tests/phase1-provider-adapter-contracts.test.ts \
  desktop/tests/phase1-minimax-adapter.test.ts \
  desktop/tests/phase1-openai-compatible-adapter.test.ts \
  desktop/tests/phase1-model-client-transport.test.ts \
  desktop/tests/phase1-session-runtime-integration.test.ts \
  desktop/tests/phase1-golden-transcripts.test.ts \
  desktop/tests/br-minimax-model-client.test.ts
```

Expected: all pass

### Task 10: Save the Phase 1 Summary

**Files:**
- Update: `docs/plans/2026-04-06-desktop-model-capability-amplifier-design.md`
- Optional create: `docs/plans/2026-04-06-phase1-capability-scorecard.md`

**Step 1: Record what actually shipped**

Include:
- final files touched
- verification commands
- remaining gaps before Phase 2

**Step 2: Commit**

Use a Lore protocol commit message after fresh verification.
