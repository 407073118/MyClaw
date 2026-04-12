# Vendor Runtime Follow-up Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the gap between the current vendor-aware runtime skeleton and true vendor-specific execution depth, so OpenAI, Anthropic, Qwen, Kimi, Volcengine Ark, and MiniMax move from "policy-aware" to "execution-optimized" without regressing BR MiniMax or the generic compatible baseline.

**Architecture:** Continue the existing `vendor-policy-registry -> vendor-runtime-policy-resolver -> turn-execution-plan -> execution-gateway -> protocol driver -> provider-adapter -> model-client/model-transport` stack instead of creating a parallel runtime. First re-baseline repo truth and rollout artifacts, then wire vendor+protocol rollout into the real execution path, deepen vendor adapters and transport flavor resolution, add native OpenAI/Anthropic execution extras on the current driver stack, and finally surface actual runtime state in UI and observability.

**Tech Stack:** TypeScript, Electron main process, React 18, Zustand, Vitest, existing `desktop/src/main/services/model-runtime/**`, `provider-adapters/**`, `ipc/models.ts`, `renderer/pages/*`

---

## Current Repo Truth

The engineer executing this plan should start from these verified facts:

- Vendor policy registry, vendor runtime policy resolution, route probing, route badges, and provider capability probers already exist and have passing tests.
- OpenAI Responses and Anthropic Messages already have real protocol drivers.
- `provider-adapters/*` are still shallow for most vendors; except for `br-minimax`, most adapters are aliases of `openAiCompatibleAdapter`.
- `execution-gateway.ts` still gates execution by `providerFamily`, not by `vendor + protocol`.
- Several older `.planning/phase10` artifacts refer to tests that do not exist in the current repo and must not be treated as source-of-truth completion evidence.

Use these files as the starting reference:

- `desktop/src/main/services/model-runtime/vendor-policy-registry.ts`
- `desktop/src/main/services/model-runtime/vendor-runtime-policy-resolver.ts`
- `desktop/src/main/services/model-runtime/turn-execution-plan-resolver.ts`
- `desktop/src/main/services/model-runtime/execution-gateway.ts`
- `desktop/src/main/services/model-runtime/rollout-gates.ts`
- `desktop/src/main/services/provider-adapters/*.ts`
- `desktop/src/main/services/model-client.ts`
- `desktop/src/main/ipc/models.ts`
- `desktop/src/renderer/pages/ModelDetailPage.tsx`
- `desktop/src/renderer/pages/ModelsPage.tsx`
- `desktop/src/renderer/pages/SettingsPage.tsx`

---

### Task 1: Re-baseline rollout truth and remove document/code drift

**Files:**
- Modify: `desktop/docs/plans/2026-04-11-vendor-runtime-tier-upgrade-design.md`
- Modify: `desktop/docs/plans/2026-04-11-vendor-runtime-tier-upgrade-implementation-plan.md`
- Modify: `desktop/.planning/phases/10-provider-adapters-for-minimax-first-reasoning-runtime/10-03-SUMMARY.md`
- Modify: `desktop/.planning/phases/10-provider-adapters-for-minimax-first-reasoning-runtime/10-VALIDATION.md`
- Create: `desktop/docs/plans/2026-04-11-vendor-runtime-rollout-truth-checklist.md`
- Test: `desktop/tests/model-runtime/contracts/vendor-policy-contracts.test.ts`
- Test: `desktop/tests/model-route-probe-ipc.test.ts`
- Test: `desktop/tests/model-detail-route-probe.test.ts`

**Step 1: Write the failing verification guard**

Create `desktop/tests/model-runtime/contracts/runtime-artifact-truth.test.ts` that asserts the current repo truth for rollout documentation:

- referenced follow-up test files actually exist
- current runtime artifacts referenced by the docs still exist
- the checklist file exists once created

Example assertions:

```ts
expect(existsSync(resolve(root, "desktop/tests/model-route-probe-ipc.test.ts"))).toBe(true);
expect(existsSync(resolve(root, "desktop/tests/model-detail-route-probe.test.ts"))).toBe(true);
expect(existsSync(resolve(root, "desktop/docs/plans/2026-04-11-vendor-runtime-rollout-truth-checklist.md"))).toBe(true);
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/contracts/runtime-artifact-truth.test.ts
```

Expected: FAIL because the new checklist and artifact-truth test do not exist yet.

**Step 3: Write minimal implementation**

Update the design/implementation docs so they match the real repo:

- mark already-landed items as implemented
- mark shallow items as "skeleton only" instead of "complete"
- explicitly call out that old Phase 10 references to `phase10-message-replay.test.ts`, `phase10-minimax-adapter.test.ts`, `phase10-model-settings.test.ts`, and `phase9-provider-reasoning-mapper.test.ts` are stale and replaced by current `model-runtime/**`, route-probe, and provider-capability-prober suites
- create `desktop/docs/plans/2026-04-11-vendor-runtime-rollout-truth-checklist.md` with four sections:
  - landed and verified
  - landed but shallow
  - not implemented
  - docs/tests that drifted from repo truth

Keep all explanatory copy in Chinese where you add or revise narrative text.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/contracts/runtime-artifact-truth.test.ts tests/model-runtime/contracts/vendor-policy-contracts.test.ts tests/model-route-probe-ipc.test.ts tests/model-detail-route-probe.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/docs/plans/2026-04-11-vendor-runtime-tier-upgrade-design.md desktop/docs/plans/2026-04-11-vendor-runtime-tier-upgrade-implementation-plan.md desktop/docs/plans/2026-04-11-vendor-runtime-rollout-truth-checklist.md desktop/.planning/phases/10-provider-adapters-for-minimax-first-reasoning-runtime/10-03-SUMMARY.md desktop/.planning/phases/10-provider-adapters-for-minimax-first-reasoning-runtime/10-VALIDATION.md desktop/tests/model-runtime/contracts/runtime-artifact-truth.test.ts
git commit -m "docs: re-baseline vendor runtime rollout truth"
```

### Task 2: Make execution gating truly vendor+protocol-aware

**Files:**
- Modify: `desktop/src/main/services/model-runtime/rollout-gates.ts`
- Modify: `desktop/src/main/services/model-runtime/execution-gateway.ts`
- Modify: `desktop/src/main/services/model-runtime/turn-outcome-store.ts`
- Modify: `desktop/src/main/services/model-runtime/telemetry.ts`
- Test: `desktop/tests/model-runtime/unit/rollout-gates.test.ts`
- Test: `desktop/tests/model-runtime/integration/execution-gateway.test.ts`
- Create: `desktop/tests/model-runtime/integration/vendor-protocol-rollout.test.ts`

**Step 1: Write the failing test**

Add `vendor-protocol-rollout.test.ts` that proves:

- `qwen + openai-responses` can be enabled while `qwen + anthropic-messages` stays disabled
- `kimi + anthropic-messages` can execute as canonical while `kimi + openai-chat-compatible` remains fallback-only
- `volcengine-ark + openai-responses` can be gated independently from `volcengine-ark + openai-chat-compatible`
- gateway outcomes record both `recommendedProtocolTarget` and `actualExecutionPath`

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/unit/rollout-gates.test.ts tests/model-runtime/integration/execution-gateway.test.ts tests/model-runtime/integration/vendor-protocol-rollout.test.ts
```

Expected: FAIL because the execution gateway still only consumes `resolveProviderFamilyRolloutGate()`.

**Step 3: Write minimal implementation**

Update runtime gating so execution chooses protocol behavior using both:

- `vendorFamily`
- `protocolTarget`

Concrete implementation targets:

- add a helper in `rollout-gates.ts` that returns the effective rollout decision for a selected `vendorFamily + protocolTarget`
- update `execution-gateway.ts` to consume that helper instead of only `providerFamily`
- persist richer outcome metadata so telemetry and scorecards can distinguish:
  - selected protocol
  - actual driver
  - shim fallback
  - rollout-disabled fallback

Do not remove the existing provider-family gate until all current tests have equivalent coverage under the new helper.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/unit/rollout-gates.test.ts tests/model-runtime/integration/execution-gateway.test.ts tests/model-runtime/integration/vendor-protocol-rollout.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/services/model-runtime/rollout-gates.ts desktop/src/main/services/model-runtime/execution-gateway.ts desktop/src/main/services/model-runtime/turn-outcome-store.ts desktop/src/main/services/model-runtime/telemetry.ts desktop/tests/model-runtime/unit/rollout-gates.test.ts desktop/tests/model-runtime/integration/execution-gateway.test.ts desktop/tests/model-runtime/integration/vendor-protocol-rollout.test.ts
git commit -m "feat: gate runtime execution by vendor and protocol"
```

### Task 3: Deepen vendor adapters so they stop being simple aliases

**Files:**
- Modify: `desktop/src/main/services/provider-adapters/base.ts`
- Modify: `desktop/src/main/services/provider-adapters/openai-compatible.ts`
- Modify: `desktop/src/main/services/provider-adapters/openai-native.ts`
- Modify: `desktop/src/main/services/provider-adapters/anthropic-native.ts`
- Modify: `desktop/src/main/services/provider-adapters/qwen.ts`
- Modify: `desktop/src/main/services/provider-adapters/kimi.ts`
- Modify: `desktop/src/main/services/provider-adapters/volcengine-ark.ts`
- Modify: `desktop/src/main/services/provider-adapters/minimax-compatible.ts`
- Test: `desktop/tests/phase1-provider-adapter-contracts.test.ts`
- Create: `desktop/tests/model-runtime/unit/vendor-adapter-behavior.test.ts`

**Step 1: Write the failing test**

Add `vendor-adapter-behavior.test.ts` that asserts:

- `openai-native` adds Responses-native reasoning/body hints without reusing the raw generic object unchanged
- `anthropic-native` emits Anthropic-friendly replay materialization and request variants
- `qwen` can mark conservative tool/reasoning hints distinctly from generic compatible mode
- `kimi` can emit anthropic-first compatibility hints and a downgrade reason when forced to openai-compatible replay
- `volcengine-ark` can distinguish Ark-specific compile/request hints from generic compatible mode
- `minimax-compatible` is different from `br-minimax`

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/phase1-provider-adapter-contracts.test.ts tests/model-runtime/unit/vendor-adapter-behavior.test.ts
```

Expected: FAIL because most vendor adapters are still aliases.

**Step 3: Write minimal implementation**

Promote adapters from alias-only wrappers into vendor-aware adapters. Each adapter should minimally own:

- replay materialization rules
- request variant patching
- degraded reason / fallback reason shape
- vendor-specific diagnostics hints

Do not force protocol choice inside the adapter; protocol remains selected by the plan/gateway. The adapter should only shape vendor-specific request/replay semantics inside the chosen protocol path.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/phase1-provider-adapter-contracts.test.ts tests/model-runtime/unit/vendor-adapter-behavior.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/services/provider-adapters/base.ts desktop/src/main/services/provider-adapters/openai-compatible.ts desktop/src/main/services/provider-adapters/openai-native.ts desktop/src/main/services/provider-adapters/anthropic-native.ts desktop/src/main/services/provider-adapters/qwen.ts desktop/src/main/services/provider-adapters/kimi.ts desktop/src/main/services/provider-adapters/volcengine-ark.ts desktop/src/main/services/provider-adapters/minimax-compatible.ts desktop/tests/phase1-provider-adapter-contracts.test.ts desktop/tests/model-runtime/unit/vendor-adapter-behavior.test.ts
git commit -m "feat: deepen vendor-specific adapter behavior"
```

### Task 4: Fix Kimi, public MiniMax, and Ark transport semantics

**Files:**
- Modify: `desktop/src/main/services/model-client.ts`
- Modify: `desktop/src/main/services/model-runtime/vendor-runtime-policy-resolver.ts`
- Modify: `desktop/src/main/ipc/models.ts`
- Modify: `desktop/src/main/services/model-capability-registry.ts`
- Test: `desktop/tests/model-runtime/unit/vendor-runtime-policy-resolver.test.ts`
- Test: `desktop/tests/model-route-probe-ipc.test.ts`
- Create: `desktop/tests/model-runtime/integration/kimi-execution-route.test.ts`
- Create: `desktop/tests/model-runtime/integration/minimax-public-execution-route.test.ts`
- Create: `desktop/tests/model-runtime/integration/ark-execution-route.test.ts`

**Step 1: Write the failing test**

Add integration coverage that proves:

- Kimi anthropic-first selection is not just a plan artifact; the request path can actually resolve compatible endpoint/header behavior for that route
- public MiniMax is no longer semantically collapsed into `br-minimax`
- Ark can execute different protocol paths with clear downgrade explanation

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/unit/vendor-runtime-policy-resolver.test.ts tests/model-route-probe-ipc.test.ts tests/model-runtime/integration/kimi-execution-route.test.ts tests/model-runtime/integration/minimax-public-execution-route.test.ts tests/model-runtime/integration/ark-execution-route.test.ts
```

Expected: FAIL because transport flavor resolution is still too coarse and MiniMax semantics still blur public vs BR-private behavior.

**Step 3: Write minimal implementation**

Refactor `model-client.ts` flavor resolution so it can express more than `anthropic/qwen/generic` while preserving backward compatibility.

Concrete goals:

- Kimi anthropic-first execution has a real transport interpretation
- public MiniMax has a distinct path from BR MiniMax even if it still falls back to compatible behavior
- Ark path selection is consistent between runtime policy and probe logic
- `ipc/models.ts` route probe and catalog semantics stay aligned with the runtime flavor logic

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/unit/vendor-runtime-policy-resolver.test.ts tests/model-route-probe-ipc.test.ts tests/model-runtime/integration/kimi-execution-route.test.ts tests/model-runtime/integration/minimax-public-execution-route.test.ts tests/model-runtime/integration/ark-execution-route.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/services/model-client.ts desktop/src/main/services/model-runtime/vendor-runtime-policy-resolver.ts desktop/src/main/ipc/models.ts desktop/src/main/services/model-capability-registry.ts desktop/tests/model-runtime/unit/vendor-runtime-policy-resolver.test.ts desktop/tests/model-route-probe-ipc.test.ts desktop/tests/model-runtime/integration/kimi-execution-route.test.ts desktop/tests/model-runtime/integration/minimax-public-execution-route.test.ts desktop/tests/model-runtime/integration/ark-execution-route.test.ts
git commit -m "feat: align vendor transport semantics with runtime policy"
```

### Task 5: Add the missing native extras for OpenAI and Anthropic on the existing driver stack

**Files:**
- Modify: `desktop/shared/contracts/model.ts`
- Modify: `desktop/shared/contracts/session-runtime.ts`
- Modify: `desktop/src/main/services/model-capability-registry.ts`
- Modify: `desktop/src/main/services/model-capability-resolver.ts`
- Modify: `desktop/src/main/services/model-runtime/protocols/openai-responses-driver.ts`
- Modify: `desktop/src/main/services/model-runtime/protocols/anthropic-messages-driver.ts`
- Modify: `desktop/src/main/services/model-runtime/context-policy-resolver.ts` (create if needed)
- Create: `desktop/src/main/services/openai-models.json`
- Test: `desktop/tests/model-runtime/unit/openai-responses-request-body.test.ts`
- Test: `desktop/tests/model-runtime/unit/openai-responses-driver.test.ts`
- Test: `desktop/tests/model-runtime/unit/anthropic-messages-driver.test.ts`
- Create: `desktop/tests/model-runtime/unit/native-capability-overrides.test.ts`

**Step 1: Write the failing test**

Add coverage for the missing native extras described by the 2026-04-10 OpenAI design:

- OpenAI profiles can resolve richer capability defaults from `openai-models.json`
- Responses request body can emit `store: false` safely
- Responses request body can preserve safe overrides while protecting native keys
- native usage parsing can retain `reasoningTokens` and `cachedInputTokens`
- Anthropic request path can preserve protocol-specific reasoning/cache metadata

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/unit/openai-responses-request-body.test.ts tests/model-runtime/unit/openai-responses-driver.test.ts tests/model-runtime/unit/anthropic-messages-driver.test.ts tests/model-runtime/unit/native-capability-overrides.test.ts
```

Expected: FAIL because these native extras are not fully implemented yet.

**Step 3: Write minimal implementation**

Implement only the parts that fit the current architecture:

- add optional profile/runtime fields for native execution extras
- add `openai-models.json` as a data source for richer OpenAI capability defaults
- extend Responses request building to support privacy and richer usage parsing
- extend Anthropic native path only where it improves execution semantics without forking the whole stack

Do not create a separate parallel `services/openai/` runtime. Keep everything on the current driver stack.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/unit/openai-responses-request-body.test.ts tests/model-runtime/unit/openai-responses-driver.test.ts tests/model-runtime/unit/anthropic-messages-driver.test.ts tests/model-runtime/unit/native-capability-overrides.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/shared/contracts/model.ts desktop/shared/contracts/session-runtime.ts desktop/src/main/services/model-capability-registry.ts desktop/src/main/services/model-capability-resolver.ts desktop/src/main/services/model-runtime/protocols/openai-responses-driver.ts desktop/src/main/services/model-runtime/protocols/anthropic-messages-driver.ts desktop/src/main/services/openai-models.json desktop/tests/model-runtime/unit/openai-responses-request-body.test.ts desktop/tests/model-runtime/unit/openai-responses-driver.test.ts desktop/tests/model-runtime/unit/anthropic-messages-driver.test.ts desktop/tests/model-runtime/unit/native-capability-overrides.test.ts
git commit -m "feat: add native execution extras for openai and anthropic"
```

### Task 6: Surface runtime truth in UI, catalog, and scorecards

**Files:**
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Modify: `desktop/src/renderer/pages/ModelDetailPage.tsx`
- Modify: `desktop/src/renderer/pages/ModelsPage.tsx`
- Modify: `desktop/src/renderer/pages/SettingsPage.tsx`
- Modify: `desktop/src/main/ipc/models.ts`
- Modify: `desktop/src/main/services/model-runtime/provider-scorecard.ts`
- Modify: `desktop/scripts/model-runtime-scorecard.js`
- Test: `desktop/tests/model-detail-route-probe.test.ts`
- Test: `desktop/tests/models-page-route-badge.test.ts`
- Test: `desktop/tests/settings-page-route-badge.test.ts`
- Test: `desktop/tests/model-runtime/observability/provider-scorecard.test.ts`
- Create: `desktop/tests/model-runtime/observability/vendor-protocol-scorecard.test.ts`

**Step 1: Write the failing test**

Add tests that assert:

- the renderer can see `vendorFamily`, `protocolSelectionSource`, `fallbackChain`, and rich catalog metadata
- model/settings pages can show both recommended route and actual saved route
- scorecards can aggregate by `vendor + protocol`, not only by provider family

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-detail-route-probe.test.ts tests/models-page-route-badge.test.ts tests/settings-page-route-badge.test.ts tests/model-runtime/observability/provider-scorecard.test.ts tests/model-runtime/observability/vendor-protocol-scorecard.test.ts
```

Expected: FAIL because the UI still collapses rich metadata and scorecards still center on provider family only.

**Step 3: Write minimal implementation**

Update the model configuration and observability surfaces to expose runtime truth without overwhelming the user:

- keep the default UI concise
- expose richer route details in the probe/details panel
- persist and display `protocolSelectionSource`
- preserve rich catalog entries instead of only flattening to string IDs where useful
- extend scorecards so rollout reviews can distinguish `vendor + protocol`

Keep Chinese product copy short and action-oriented.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-detail-route-probe.test.ts tests/models-page-route-badge.test.ts tests/settings-page-route-badge.test.ts tests/model-runtime/observability/provider-scorecard.test.ts tests/model-runtime/observability/vendor-protocol-scorecard.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/preload/index.ts desktop/src/renderer/stores/workspace.ts desktop/src/renderer/pages/ModelDetailPage.tsx desktop/src/renderer/pages/ModelsPage.tsx desktop/src/renderer/pages/SettingsPage.tsx desktop/src/main/ipc/models.ts desktop/src/main/services/model-runtime/provider-scorecard.ts desktop/scripts/model-runtime-scorecard.js desktop/tests/model-detail-route-probe.test.ts desktop/tests/models-page-route-badge.test.ts desktop/tests/settings-page-route-badge.test.ts desktop/tests/model-runtime/observability/provider-scorecard.test.ts desktop/tests/model-runtime/observability/vendor-protocol-scorecard.test.ts
git commit -m "feat: surface vendor runtime truth in ui and scorecards"
```

### Task 7: Run final regression and publish rollout readiness

**Files:**
- Modify: `desktop/docs/plans/2026-04-11-vendor-runtime-rollout-truth-checklist.md`
- Create: `desktop/docs/plans/2026-04-11-vendor-runtime-followup-rollout-readiness.md`
- Test: `desktop/tests/model-runtime/integration/execution-gateway.test.ts`
- Test: `desktop/tests/model-runtime/e2e/session-turn-e2e.test.ts`
- Test: `desktop/tests/model-runtime/e2e/workflow-turn-e2e.test.ts`
- Test: `desktop/tests/model-runtime/e2e/continuity-e2e.test.ts`
- Test: `desktop/tests/br-minimax-model-client.test.ts`
- Test: `desktop/tests/phase1-golden-transcripts.test.ts`

**Step 1: Write the failing readiness checklist**

Create `desktop/docs/plans/2026-04-11-vendor-runtime-followup-rollout-readiness.md` with per-vendor sections:

- protocol states
- remaining risks
- fallback expectations
- manual smoke checks
- BR MiniMax non-regression checks

**Step 2: Run verification suite**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/integration/execution-gateway.test.ts tests/model-runtime/e2e/session-turn-e2e.test.ts tests/model-runtime/e2e/workflow-turn-e2e.test.ts tests/model-runtime/e2e/continuity-e2e.test.ts tests/br-minimax-model-client.test.ts tests/phase1-golden-transcripts.test.ts
```

Expected: PASS; if not, fix regressions before continuing.

**Step 3: Update docs with actual readiness notes**

Amend the checklist and readiness doc with:

- what is stable now
- what is still beta or guarded
- what remains vendor-policy-only rather than execution-deep
- explicit note that BR MiniMax behavior remains pinned

**Step 4: Re-run targeted high-risk suites**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-route-probe-ipc.test.ts tests/model-detail-route-probe.test.ts tests/model-runtime/integration/openai-native-family.test.ts tests/model-runtime/integration/anthropic-native-family.test.ts tests/model-runtime/integration/kimi-family.test.ts tests/model-runtime/integration/volcengine-ark-family.test.ts tests/model-runtime/integration/br-minimax-family.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/docs/plans/2026-04-11-vendor-runtime-rollout-truth-checklist.md desktop/docs/plans/2026-04-11-vendor-runtime-followup-rollout-readiness.md
git commit -m "docs: record vendor runtime follow-up readiness"
```

---

## Execution Notes

- Do not rewrite the runtime into a separate parallel OpenAI stack. Extend the current `protocol driver` architecture.
- Do not revert or rewrite unrelated in-progress files in the worktree.
- Preserve BR MiniMax behavior first; deepen public-vendor execution second.
- Prefer adding tests under `desktop/tests/model-runtime/**` unless the behavior is clearly renderer-only.
- When a previous `.planning` artifact conflicts with current repo truth, trust the current code and tests, then update the artifact.

## Recommended Execution Order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7

## Definition of Done

- Vendor+protocol rollout is part of real execution, not just policy declaration.
- Qwen, Kimi, Ark, and public MiniMax have non-trivial adapter behavior beyond alias wrappers.
- OpenAI and Anthropic native paths include the missing execution extras that fit the current architecture.
- UI and scorecards expose runtime truth clearly enough for rollout decisions.
- BR MiniMax remains stable across transport, replay, and settings flows.
