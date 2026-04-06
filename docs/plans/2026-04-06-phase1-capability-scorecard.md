# Phase 1 Capability Scorecard

**Date:** 2026-04-06  
**Phase:** Phase 1 - Replay + Adapter Core  
**Status:** Shipped

This file is the canonical Phase 1 shipped-state record / appendix.

## Shipped Surface

- Session runtime contracts + `runtimeVersion` / `runtimeIntent` metadata
- `reasoning-runtime` shell + `buildExecutionPlan`
- provider adapters for `br-minimax` and `openai-compatible`
- `model-transport`
- `model-sse-parser`
- `model-client` now uses `executionPlan` plus adapter / transport / parser boundaries
- `sessions.ts` now generates execution plans before model calls
- `ipc/models` and `br-minimax-runtime` reuse `buildRequestHeaders`

## Final Files Touched

### Runtime and Contracts

- `desktop/shared/contracts/session-runtime.ts`
- `desktop/shared/contracts/session.ts`
- `desktop/shared/contracts/index.ts`

### Main-Process Runtime

- `desktop/src/main/services/reasoning-runtime.ts`
- `desktop/src/main/services/provider-adapters/base.ts`
- `desktop/src/main/services/provider-adapters/index.ts`
- `desktop/src/main/services/provider-adapters/minimax.ts`
- `desktop/src/main/services/provider-adapters/openai-compatible.ts`
- `desktop/src/main/services/model-client.ts`
- `desktop/src/main/services/model-transport.ts`
- `desktop/src/main/services/model-sse-parser.ts`
- `desktop/src/main/services/br-minimax-runtime.ts`
- `desktop/src/main/ipc/sessions.ts`
- `desktop/src/main/ipc/models.ts`

### Verification Files

- `desktop/tests/phase1-session-runtime-contracts.test.ts`
- `desktop/tests/phase1-reasoning-runtime.test.ts`
- `desktop/tests/phase1-provider-adapter-contracts.test.ts`
- `desktop/tests/phase1-minimax-adapter.test.ts`
- `desktop/tests/phase1-openai-compatible-adapter.test.ts`
- `desktop/tests/phase1-model-client-transport.test.ts`
- `desktop/tests/phase1-session-runtime-integration.test.ts`
- `desktop/tests/phase1-golden-transcripts.test.ts`
- `desktop/tests/br-minimax-model-client.test.ts`
- `desktop/tests/phase1-model-transport.test.ts`
- `desktop/tests/phase1-model-sse-parser.test.ts`

## Verification Commands

```bash
pnpm --dir desktop exec vitest run \
  tests/phase1-session-runtime-contracts.test.ts \
  tests/phase1-reasoning-runtime.test.ts \
  tests/phase1-provider-adapter-contracts.test.ts \
  tests/phase1-minimax-adapter.test.ts \
  tests/phase1-openai-compatible-adapter.test.ts \
  tests/phase1-model-client-transport.test.ts \
  tests/phase1-session-runtime-integration.test.ts \
  tests/phase1-golden-transcripts.test.ts \
  tests/br-minimax-model-client.test.ts \
  tests/phase1-model-transport.test.ts \
  tests/phase1-model-sse-parser.test.ts
```

```bash
pnpm --dir desktop run typecheck
```

## Remaining Gaps Before Phase 2

- `ExecutionPlan` is still a Phase 1 shell; it does not yet express the full runtime cutover.
- planner runtime, delegation runtime, and structured task state are not implemented yet.
- broader regression coverage and golden transcript depth still need to grow before Phase 2 cutover.
