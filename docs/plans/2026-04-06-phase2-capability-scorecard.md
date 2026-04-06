# Phase 2 Capability Scorecard

**Date:** 2026-04-06  
**Phase:** Phase 2 - Execution Plan Runtime  
**Status:** Shipped

This file is the canonical Phase 2 shipped-state record / appendix.

## Shipped Surface

- richer session/runtime contracts for Phase 2
- `reasoning-runtime` now acts as the execution-plan decision authority
- `context-assembler` and `context-compactor` now apply replay policy during context assembly
- `sessions.ts` now runs a real `intent -> plan -> context -> execute` handoff
- session persistence now types and round-trips `executionPlan`
- degradation / integration coverage was added for the Phase 2 runtime cutover

## Final Files Touched

### Runtime and Contracts

- `desktop/shared/contracts/session-runtime.ts`
- `desktop/shared/contracts/session.ts`
- `desktop/shared/contracts/index.ts`

### Main-Process Runtime

- `desktop/src/main/services/reasoning-runtime.ts`
- `desktop/src/main/services/context-assembler.ts`
- `desktop/src/main/services/context-compactor.ts`
- `desktop/src/main/services/state-persistence.ts`
- `desktop/src/main/ipc/sessions.ts`

### Verification Files

- `desktop/tests/phase2-session-runtime-contracts.test.ts`
- `desktop/tests/phase2-execution-plan-runtime.test.ts`
- `desktop/tests/phase2-context-replay-policy.test.ts`
- `desktop/tests/phase2-session-orchestration.test.ts`
- `desktop/tests/phase2-session-persistence.test.ts`
- `desktop/tests/phase2-degradation-integration.test.ts`
- `desktop/tests/phase1-session-runtime-integration.test.ts`

## Verification Commands

Authoritative verification for Phase 2 is the focused 11-file batch rerun plus `desktop` typecheck.

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

```bash
pnpm --dir desktop run typecheck
```

## Verification Result

- Focused Phase 2 batch passed: 11 files / 34 tests
- `desktop` typecheck passed

## Remaining Gaps Before Phase 3

- planner runtime has not started
- delegation runtime has not started
- a small low-risk follow-up remains available if needed later: centralize replay-policy precedence into one helper instead of leaving it distributed across Phase 2 call sites
