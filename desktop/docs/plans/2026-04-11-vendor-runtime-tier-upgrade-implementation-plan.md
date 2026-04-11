# Vendor Runtime Tier Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the desktop model runtime from a single-family single-protocol compatible baseline into a vendor-policy-driven multi-protocol runtime that treats OpenAI, Anthropic, Qwen, Kimi, Volcengine Ark, and MiniMax as first-tier vendors while preserving the existing BR MiniMax behavior.

**Architecture:** Introduce a central vendor policy registry, decouple vendor family from protocol target, thread vendor-aware policy selection through execution planning, prompt/tool/replay composition, rollout gates, route probing, and model settings, then onboard each first-tier vendor with explicit protocol matrices and fallback chains. Keep legacy behavior stable by wrapping current OpenAI-compatible and BR MiniMax flows rather than rewriting them in one shot.

**Tech Stack:** TypeScript, Electron main process, React 18, Zustand, Vitest, existing `execution-gateway` / `protocol driver` / `provider-adapter` runtime

---

### Task 1: Add vendor runtime contracts and registry scaffolding

**Files:**
- Modify: `desktop/shared/contracts/model.ts`
- Modify: `desktop/shared/contracts/session-runtime.ts`
- Create: `desktop/src/main/services/model-runtime/vendor-policy-registry.ts`
- Test: `desktop/tests/model-runtime/contracts/vendor-policy-contracts.test.ts`

**Step 1: Write the failing test**

Add `desktop/tests/model-runtime/contracts/vendor-policy-contracts.test.ts` that asserts:
- `VendorFamily` includes `openai`, `anthropic`, `qwen`, `kimi`, `volcengine-ark`, `minimax`, `generic-openai-compatible`, `generic-local-gateway`
- a vendor policy can declare multiple supported protocols
- `MiniMax` can expose a `br-private` deployment profile while still belonging to the `minimax` vendor family

Example shape to assert:

```ts
expect(VENDOR_FAMILY_VALUES).toContain("kimi");
expect(getVendorPolicy("qwen").supportedProtocols).toEqual(
  expect.arrayContaining(["openai-chat-compatible", "openai-responses", "anthropic-messages"]),
);
expect(getVendorPolicy("minimax").deploymentProfiles).toContain("br-private");
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/contracts/vendor-policy-contracts.test.ts
```

Expected: FAIL because `VendorFamily` and `vendor-policy-registry.ts` do not exist yet.

**Step 3: Write minimal implementation**

Modify `desktop/shared/contracts/model.ts` and `desktop/shared/contracts/session-runtime.ts` to add:
- `VendorFamily`
- `VENDOR_FAMILY_VALUES`
- optional `vendorFamily`, `deploymentProfile`, `savedProtocolPreferences`, `protocolSelectionSource`
- execution-plan-facing protocol selection metadata

Create `desktop/src/main/services/model-runtime/vendor-policy-registry.ts` with:
- a `VendorPolicy` type
- `VENDOR_POLICY_REGISTRY`
- `getVendorPolicy(vendorFamily)`
- minimal seeded entries for `openai`, `anthropic`, `qwen`, `kimi`, `volcengine-ark`, `minimax`, `generic-openai-compatible`, `generic-local-gateway`

Keep all comments and any added logs in Chinese.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/contracts/vendor-policy-contracts.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/shared/contracts/model.ts desktop/shared/contracts/session-runtime.ts desktop/src/main/services/model-runtime/vendor-policy-registry.ts desktop/tests/model-runtime/contracts/vendor-policy-contracts.test.ts
git commit -m "feat: add vendor runtime policy contracts"
```

### Task 2: Replace family-only resolution with vendor-aware runtime policy resolution

**Files:**
- Modify: `desktop/src/main/services/model-runtime/family-policy-resolver.ts`
- Create: `desktop/src/main/services/model-runtime/vendor-runtime-policy-resolver.ts`
- Modify: `desktop/src/main/services/model-runtime/turn-execution-plan-resolver.ts`
- Test: `desktop/tests/model-runtime/unit/vendor-runtime-policy-resolver.test.ts`
- Modify: `desktop/tests/model-runtime/unit/turn-execution-plan-resolver.test.ts`

**Step 1: Write the failing test**

Add `vendor-runtime-policy-resolver.test.ts` that verifies:
- `Qwen` can resolve multiple supported protocols
- `Kimi` resolves `anthropic-messages` as preferred when no explicit override exists
- `Volcengine Ark` resolves `openai-responses` as preferred but still exposes fallback protocols
- `MiniMax` keeps `br-private` deployment metadata without losing `minimax` vendor family

Extend `turn-execution-plan-resolver.test.ts` to assert the plan now carries:
- `vendorFamily`
- `supportedProtocolTargets`
- `recommendedProtocolTarget`
- `fallbackChain`

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/unit/vendor-runtime-policy-resolver.test.ts tests/model-runtime/unit/turn-execution-plan-resolver.test.ts
```

Expected: FAIL because the new resolver and fields are missing.

**Step 3: Write minimal implementation**

Create `vendor-runtime-policy-resolver.ts` that:
- infers `vendorFamily` from existing `providerFlavor` / `providerFamily` / `baseUrl` / `model`
- loads the vendor policy from the registry
- picks a recommended protocol based on saved selection, explicit override, registry defaults, and rollout availability
- emits a stable fallback chain

Refactor `family-policy-resolver.ts` so it becomes a compatibility layer:
- keep exported helpers needed by old tests
- internally delegate to vendor policy concepts

Update `turn-execution-plan-resolver.ts` to persist vendor-aware metadata while preserving legacy `ExecutionPlan`.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/unit/vendor-runtime-policy-resolver.test.ts tests/model-runtime/unit/turn-execution-plan-resolver.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/services/model-runtime/family-policy-resolver.ts desktop/src/main/services/model-runtime/vendor-runtime-policy-resolver.ts desktop/src/main/services/model-runtime/turn-execution-plan-resolver.ts desktop/tests/model-runtime/unit/vendor-runtime-policy-resolver.test.ts desktop/tests/model-runtime/unit/turn-execution-plan-resolver.test.ts
git commit -m "feat: resolve runtime policy by vendor and protocol"
```

### Task 3: Upgrade rollout gates from family-level to vendor+protocol-level

**Files:**
- Modify: `desktop/src/main/services/model-runtime/rollout-gates.ts`
- Modify: `desktop/src/main/services/model-runtime/execution-gateway.ts`
- Test: `desktop/tests/model-runtime/unit/rollout-gates.test.ts`
- Test: `desktop/tests/model-runtime/integration/execution-gateway.test.ts`

**Step 1: Write the failing test**

Extend `rollout-gates.test.ts` to verify:
- `qwen + openai-responses`
- `qwen + anthropic-messages`
- `kimi + anthropic-messages`
- `ark + openai-responses`
- `minimax + anthropic-messages`

can each be toggled independently.

Extend `execution-gateway.test.ts` to assert the gateway records:
- selected protocol
- actual execution path
- shim fallback reason when rollout is off

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/unit/rollout-gates.test.ts tests/model-runtime/integration/execution-gateway.test.ts
```

Expected: FAIL because rollout gates still only understand `ProviderFamily -> boolean`.

**Step 3: Write minimal implementation**

Refactor `rollout-gates.ts` to introduce a per-vendor-per-protocol rollout model such as:

```ts
type VendorProtocolRolloutState = "disabled" | "beta" | "stable";
```

Expose helpers that can answer:
- whether a specific protocol is enabled for a vendor
- whether the chosen protocol must fall back to shim execution

Update `execution-gateway.ts` to attach richer transport metadata:
- selected protocol
- actual protocol driver used
- whether legacy shim was used

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/unit/rollout-gates.test.ts tests/model-runtime/integration/execution-gateway.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/services/model-runtime/rollout-gates.ts desktop/src/main/services/model-runtime/execution-gateway.ts desktop/tests/model-runtime/unit/rollout-gates.test.ts desktop/tests/model-runtime/integration/execution-gateway.test.ts
git commit -m "feat: add vendor protocol rollout gates"
```

### Task 4: Make prompt, tool, and reasoning policies registry-driven

**Files:**
- Modify: `desktop/src/main/services/model-runtime/prompt-composer.ts`
- Modify: `desktop/src/main/services/model-runtime/tool-middleware.ts`
- Modify: `desktop/src/main/services/model-runtime/experience-profile-resolver.ts`
- Test: `desktop/tests/model-runtime/unit/prompt-composer.test.ts`
- Test: `desktop/tests/model-runtime/unit/tool-middleware-compile.test.ts`
- Create: `desktop/tests/model-runtime/unit/vendor-policy-profile-selection.test.ts`

**Step 1: Write the failing test**

Add tests that verify:
- `Qwen` prompt overlay is loaded from the registry rather than a local map
- `Kimi` and `MiniMax` can choose different reasoning profiles under different protocols
- `Ark` tool compilation can differ from generic compatible mode without adding a new hardcoded branch in `tool-middleware.ts`

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/unit/prompt-composer.test.ts tests/model-runtime/unit/tool-middleware-compile.test.ts tests/model-runtime/unit/vendor-policy-profile-selection.test.ts
```

Expected: FAIL because prompt/tool/reasoning policies are still hardcoded by family.

**Step 3: Write minimal implementation**

Update:
- `prompt-composer.ts` to pull overlay lines from the vendor policy registry
- `tool-middleware.ts` to compile using a `toolProfileId` or `toolCompileMode` resolved from the selected vendor protocol
- `experience-profile-resolver.ts` to allow vendor-specific defaults while keeping current generic fallbacks

Do not remove current behavior until the new registry-driven path proves equivalent for existing OpenAI, Anthropic, and BR MiniMax tests.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/unit/prompt-composer.test.ts tests/model-runtime/unit/tool-middleware-compile.test.ts tests/model-runtime/unit/vendor-policy-profile-selection.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/services/model-runtime/prompt-composer.ts desktop/src/main/services/model-runtime/tool-middleware.ts desktop/src/main/services/model-runtime/experience-profile-resolver.ts desktop/tests/model-runtime/unit/prompt-composer.test.ts desktop/tests/model-runtime/unit/tool-middleware-compile.test.ts desktop/tests/model-runtime/unit/vendor-policy-profile-selection.test.ts
git commit -m "feat: drive prompt and tool policies from vendor registry"
```

### Task 5: Preserve BR MiniMax while moving MiniMax into the unified mechanism

**Files:**
- Modify: `desktop/shared/br-minimax.ts`
- Modify: `desktop/src/main/services/provider-adapters/index.ts`
- Modify: `desktop/src/main/services/provider-adapters/minimax.ts`
- Modify: `desktop/src/main/services/managed-model-profile.ts`
- Test: `desktop/tests/br-minimax-managed-write.test.ts`
- Test: `desktop/tests/br-minimax-model-client.test.ts`
- Test: `desktop/tests/phase1-golden-transcripts.test.ts`

**Step 1: Write the failing test**

Extend existing BR MiniMax tests to assert:
- `vendorFamily=minimax`
- `deploymentProfile=br-private`
- legacy `providerFlavor=br-minimax` still round-trips
- `reasoning_split / reasoning_content` probe behavior remains unchanged
- `<think>` replay shape remains unchanged

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/br-minimax-managed-write.test.ts tests/br-minimax-model-client.test.ts tests/phase1-golden-transcripts.test.ts
```

Expected: FAIL because BR MiniMax has not yet been represented inside the new vendor mechanism.

**Step 3: Write minimal implementation**

Keep all existing BR MiniMax files in place, but:
- attach `vendorFamily=minimax`
- attach `deploymentProfile=br-private`
- register BR MiniMax as a MiniMax deployment profile in the vendor registry
- keep `br-minimax` adapter id and existing request/replay behavior intact

Do not rewrite the BR MiniMax probe or replay internals in this task.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/br-minimax-managed-write.test.ts tests/br-minimax-model-client.test.ts tests/phase1-golden-transcripts.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/shared/br-minimax.ts desktop/src/main/services/provider-adapters/index.ts desktop/src/main/services/provider-adapters/minimax.ts desktop/src/main/services/managed-model-profile.ts desktop/tests/br-minimax-managed-write.test.ts desktop/tests/br-minimax-model-client.test.ts desktop/tests/phase1-golden-transcripts.test.ts
git commit -m "feat: preserve BR MiniMax inside unified vendor policy"
```

### Task 6: Add first-tier vendor policies for OpenAI, Anthropic, Qwen, Kimi, Ark, and MiniMax

**Files:**
- Modify: `desktop/src/main/services/model-runtime/vendor-policy-registry.ts`
- Modify: `desktop/src/main/services/model-capability-registry.ts`
- Modify: `desktop/src/main/services/provider-adapters/openai-compatible.ts`
- Create: `desktop/src/main/services/provider-adapters/qwen.ts`
- Create: `desktop/src/main/services/provider-adapters/kimi.ts`
- Create: `desktop/src/main/services/provider-adapters/volcengine-ark.ts`
- Create: `desktop/src/main/services/provider-adapters/openai-native.ts`
- Create: `desktop/src/main/services/provider-adapters/anthropic-native.ts`
- Test: `desktop/tests/model-runtime/contracts/vendor-policy-contracts.test.ts`
- Test: `desktop/tests/model-runtime/integration/openai-native-family.test.ts`
- Test: `desktop/tests/model-runtime/integration/anthropic-native-family.test.ts`
- Test: `desktop/tests/model-runtime/integration/qwen-dashscope-family.test.ts`
- Test: `desktop/tests/model-runtime/integration/volcengine-ark-family.test.ts`
- Create: `desktop/tests/model-runtime/integration/kimi-family.test.ts`
- Modify: `desktop/tests/model-runtime/integration/br-minimax-family.test.ts`

**Step 1: Write the failing test**

Add `kimi-family.test.ts` and extend existing family tests to assert:
- OpenAI, Anthropic, Qwen, Kimi, Ark, and MiniMax each expose explicit supported protocol sets
- Kimi is no longer inferred only as Moonshot/generic compatible
- Qwen and Ark no longer flatten to a single compatible-only route in the registry

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/integration/openai-native-family.test.ts tests/model-runtime/integration/anthropic-native-family.test.ts tests/model-runtime/integration/qwen-dashscope-family.test.ts tests/model-runtime/integration/volcengine-ark-family.test.ts tests/model-runtime/integration/kimi-family.test.ts tests/model-runtime/integration/br-minimax-family.test.ts
```

Expected: FAIL because the registry and adapter map still flatten most vendors.

**Step 3: Write minimal implementation**

Add vendor-aware adapter registration and registry entries for:
- OpenAI
- Anthropic
- Qwen
- Kimi
- Volcengine Ark
- MiniMax

Keep `openai-compatible` as the generic fallback adapter, but let the registry pick richer vendor-specific adapters first when available.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/integration/openai-native-family.test.ts tests/model-runtime/integration/anthropic-native-family.test.ts tests/model-runtime/integration/qwen-dashscope-family.test.ts tests/model-runtime/integration/volcengine-ark-family.test.ts tests/model-runtime/integration/kimi-family.test.ts tests/model-runtime/integration/br-minimax-family.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/services/model-runtime/vendor-policy-registry.ts desktop/src/main/services/model-capability-registry.ts desktop/src/main/services/provider-adapters/openai-compatible.ts desktop/src/main/services/provider-adapters/qwen.ts desktop/src/main/services/provider-adapters/kimi.ts desktop/src/main/services/provider-adapters/volcengine-ark.ts desktop/src/main/services/provider-adapters/openai-native.ts desktop/src/main/services/provider-adapters/anthropic-native.ts desktop/tests/model-runtime/integration/openai-native-family.test.ts desktop/tests/model-runtime/integration/anthropic-native-family.test.ts desktop/tests/model-runtime/integration/qwen-dashscope-family.test.ts desktop/tests/model-runtime/integration/volcengine-ark-family.test.ts desktop/tests/model-runtime/integration/kimi-family.test.ts desktop/tests/model-runtime/integration/br-minimax-family.test.ts
git commit -m "feat: add first-tier vendor policies and adapters"
```

### Task 7: Upgrade route probing, model profile saving, and settings UI to use vendor protocol matrices

**Files:**
- Modify: `desktop/src/main/ipc/models.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Modify: `desktop/src/renderer/pages/ModelDetailPage.tsx`
- Modify: `desktop/src/renderer/pages/SettingsPage.tsx`
- Test: `desktop/tests/model-route-probe-ipc.test.ts`
- Test: `desktop/tests/model-detail-route-probe.test.ts`
- Test: `desktop/tests/models-page-route-badge.test.ts`
- Test: `desktop/tests/settings-page-route-badge.test.ts`

**Step 1: Write the failing test**

Extend UI and IPC tests to verify:
- route probe chooses candidates from the vendor policy matrix rather than a hardcoded two-route list
- `Qwen`, `Kimi`, `Ark`, and `MiniMax` can surface different protocol sets
- saved model profiles persist protocol choice source and fallback chain
- the settings/model page shows a vendor-aware recommended route label

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-route-probe-ipc.test.ts tests/model-detail-route-probe.test.ts tests/models-page-route-badge.test.ts tests/settings-page-route-badge.test.ts
```

Expected: FAIL because probing is still driven by hardcoded OpenAI/Anthropic assumptions.

**Step 3: Write minimal implementation**

Refactor `ipc/models.ts` so that:
- `resolveRouteProbeCandidates` reads the vendor registry
- vendor-specific protocol probe order is explicit
- saved profiles can remember selection source and fallback chain

Update `ModelDetailPage.tsx` and `SettingsPage.tsx` to:
- render vendor-aware protocol options
- explain recommended/default routes with concise Chinese copy
- preserve BR MiniMax managed behavior

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-route-probe-ipc.test.ts tests/model-detail-route-probe.test.ts tests/models-page-route-badge.test.ts tests/settings-page-route-badge.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/ipc/models.ts desktop/src/preload/index.ts desktop/src/renderer/stores/workspace.ts desktop/src/renderer/pages/ModelDetailPage.tsx desktop/src/renderer/pages/SettingsPage.tsx desktop/tests/model-route-probe-ipc.test.ts desktop/tests/model-detail-route-probe.test.ts desktop/tests/models-page-route-badge.test.ts desktop/tests/settings-page-route-badge.test.ts
git commit -m "feat: make model route probing vendor aware"
```

### Task 8: Run regression verification and document rollout readiness

**Files:**
- Modify: `desktop/docs/plans/2026-04-11-vendor-runtime-tier-upgrade-design.md`
- Create: `desktop/docs/plans/2026-04-11-vendor-runtime-tier-upgrade-rollout-checklist.md`
- Test: `desktop/tests/model-runtime/integration/execution-gateway.test.ts`
- Test: `desktop/tests/model-runtime/e2e/session-turn-e2e.test.ts`
- Test: `desktop/tests/model-runtime/e2e/workflow-turn-e2e.test.ts`
- Test: `desktop/tests/model-runtime/e2e/continuity-e2e.test.ts`

**Step 1: Write the failing verification checklist**

Create `desktop/docs/plans/2026-04-11-vendor-runtime-tier-upgrade-rollout-checklist.md` with:
- vendor-by-vendor protocol rollout states
- manual smoke checks
- fallback verification items
- BR MiniMax non-regression checks

**Step 2: Run verification suite**

Run:

```bash
pnpm --dir desktop exec vitest run tests/model-runtime/integration/execution-gateway.test.ts tests/model-runtime/e2e/session-turn-e2e.test.ts tests/model-runtime/e2e/workflow-turn-e2e.test.ts tests/model-runtime/e2e/continuity-e2e.test.ts
```

Expected: PASS; if not, fix regressions before continuing.

**Step 3: Update docs with actual rollout notes**

Amend the design doc and checklist with:
- protocol states that are truly ready
- known gaps by vendor
- explicit note that BR MiniMax behavior remains pinned

**Step 4: Re-run targeted high-risk suites**

Run:

```bash
pnpm --dir desktop exec vitest run tests/br-minimax-model-client.test.ts tests/phase1-golden-transcripts.test.ts tests/model-route-probe-ipc.test.ts tests/model-runtime/integration/openai-native-family.test.ts tests/model-runtime/integration/anthropic-native-family.test.ts tests/model-runtime/integration/kimi-family.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add desktop/docs/plans/2026-04-11-vendor-runtime-tier-upgrade-design.md desktop/docs/plans/2026-04-11-vendor-runtime-tier-upgrade-rollout-checklist.md
git commit -m "docs: record vendor runtime rollout readiness"
```

Plan complete and saved to `desktop/docs/plans/2026-04-11-vendor-runtime-tier-upgrade-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
