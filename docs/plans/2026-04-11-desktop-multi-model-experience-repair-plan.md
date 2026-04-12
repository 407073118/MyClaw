# Desktop Multi-Model Experience Repair Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the audited gaps in the desktop multi-model rollout so scorecard data is trustworthy and native-family execution is no longer shim-only.

**Architecture:** Keep the existing family-aware execution gateway and repair the missing closure points in order of risk: first outcome metrics, then native OpenAI transport, then native Anthropic transport, then remaining coverage and rollout evidence. Each task must end with a document update before moving to the next task.

**Tech Stack:** Electron, TypeScript, Vitest, native `fetch`, SSE parsing, desktop model runtime.

---

## Repair Order

- [x] Task 1: Backfill workflow turn outcome metrics so scorecard data is consistent across session and workflow paths.
- [x] Task 2: Replace `openai-native` canonical execution shim with direct Responses API transport.
- [x] Task 3: Replace `anthropic-native` canonical execution shim with direct Messages API transport.
- [x] Task 4: Tighten remaining rollout coverage for scorecard correctness and family behavior.

## Task 1: Workflow Outcome Metrics Backfill

**Files:**
- Modify: `desktop/src/main/ipc/workflows.ts`
- Modify: `desktop/tests/model-runtime/integration/workflows-execution-gateway.test.ts`
- Update after completion: this document

**Plan:**
1. Add a failing test that proves workflow LLM turns do not currently backfill `toolSuccessCount` and `contextStability`.
2. Implement a workflow-side outcome persistence helper mirroring the session-side writeback pattern.
3. Re-run the focused workflow gateway test file until green.
4. Mark this task complete in this document with the exact test evidence.

**Verification target:**
- `npx vitest run tests/model-runtime/integration/workflows-execution-gateway.test.ts`

## Task 2: OpenAI Native Transport

**Files:**
- Modify: `desktop/src/main/services/model-runtime/protocols/openai-responses-driver.ts`
- Modify: `desktop/tests/model-runtime/unit/openai-responses-driver.test.ts`
- Modify: `desktop/tests/model-runtime/integration/execution-gateway.test.ts`
- Update after completion: this document

**Plan:**
1. Add failing tests that prove the driver still relies on `callModel` shim semantics in canonical execution.
2. Implement direct `/v1/responses` request execution with native request body handling and Responses-style SSE parsing.
3. Preserve rollout-disabled fallback semantics and canonical output contract.
4. Re-run focused unit/integration tests and record the result here.

**Verification target:**
- `npx vitest run tests/model-runtime/unit/openai-responses-driver.test.ts tests/model-runtime/integration/openai-native-family.test.ts tests/model-runtime/integration/execution-gateway.test.ts`

## Task 3: Anthropic Native Transport

**Files:**
- Modify: `desktop/src/main/services/model-runtime/protocols/anthropic-messages-driver.ts`
- Modify: `desktop/tests/model-runtime/unit/anthropic-messages-driver.test.ts`
- Modify: `desktop/tests/model-runtime/integration/execution-gateway.test.ts`
- Update after completion: this document

**Plan:**
1. Add failing tests that prove the driver still depends on shim behavior in canonical execution.
2. Implement direct `/v1/messages` request execution with Anthropic SSE parsing for text, thinking, and tool calls.
3. Preserve canonical output contract and truthful fallback metadata.
4. Re-run focused unit/integration tests and record the result here.

**Verification target:**
- `npx vitest run tests/model-runtime/unit/anthropic-messages-driver.test.ts tests/model-runtime/integration/anthropic-native-family.test.ts tests/model-runtime/integration/execution-gateway.test.ts`

## Task 4: Coverage Hardening

**Files:**
- Modify: `desktop/tests/model-runtime/observability/provider-scorecard.test.ts`
- Modify: `desktop/tests/model-runtime/integration/volcengine-ark-family.test.ts`
- Modify as needed: related runtime tests
- Update after completion: this document

**Plan:**
1. Add direct coverage for `completionRate`.
2. Add stronger runtime/request-shape coverage where family support is currently only asserted by identification.
3. Re-run the focused scorecard/family suites and record the evidence here.

**Verification target:**
- `npx vitest run tests/model-runtime/observability/provider-scorecard.test.ts tests/model-runtime/integration/volcengine-ark-family.test.ts tests/model-runtime/integration/generic-compatible-family.test.ts tests/model-runtime/integration/qwen-dashscope-family.test.ts`

## Progress Log

- 2026-04-11: Plan created. Execution will proceed in this session in the order above, with this document updated after each completed task.
- 2026-04-11: Task 1 completed. Added workflow-side `turn outcome` metric writeback in `desktop/src/main/ipc/workflows.ts` and a regression assertion in `desktop/tests/model-runtime/integration/workflows-execution-gateway.test.ts`. Verification:
  - `npx vitest run tests/model-runtime/integration/workflows-execution-gateway.test.ts`
  - `npx vitest run tests/model-runtime/integration/workflows-execution-gateway.test.ts tests/model-runtime/integration/session-workflow-outcome-roundtrip.test.ts`
- 2026-04-11: Task 2 completed. Replaced `openai-native` canonical path shim behavior with direct `/v1/responses` execution in `desktop/src/main/services/model-runtime/protocols/openai-responses-driver.ts`, including native SSE parsing and transport-level request ids. Verification:
  - `npx vitest run tests/model-runtime/unit/openai-responses-driver.test.ts tests/model-runtime/integration/execution-gateway.test.ts tests/model-runtime/integration/openai-native-family.test.ts`
- 2026-04-11: Task 3 completed. Replaced `anthropic-native` canonical path shim behavior with direct `/v1/messages` execution in `desktop/src/main/services/model-runtime/protocols/anthropic-messages-driver.ts`, including native SSE parsing for text / thinking / tool-use deltas. Verification:
  - `npx vitest run tests/model-runtime/unit/anthropic-messages-driver.test.ts tests/model-runtime/integration/execution-gateway.test.ts tests/model-runtime/integration/anthropic-native-family.test.ts`
- 2026-04-11: Task 4 completed. Added direct `completionRate` coverage in `provider-scorecard.test.ts` and strengthened `volcengine-ark` coverage from taxonomy-only to runtime policy assertions in `volcengine-ark-family.test.ts`. Verification:
  - `npx vitest run tests/model-runtime/observability/provider-scorecard.test.ts tests/model-runtime/integration/volcengine-ark-family.test.ts tests/model-runtime/integration/generic-compatible-family.test.ts tests/model-runtime/integration/qwen-dashscope-family.test.ts`
- 2026-04-11: Final verification completed.
  - `npm run typecheck`
  - `npx vitest run tests/model-runtime`
  - `npm run lint` (passed with pre-existing renderer hook warnings only; no new errors from this repair set)
