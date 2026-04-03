# NewApp Context Engineering Phase 1 Execution Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver the Phase 1 foundation for `desktop` context engineering by expanding contracts, adding a model capability resolver, and upgrading model catalog flows to return normalized capability metadata.

**Architecture:** Phase 1 does not change the session compaction path yet. It establishes the protocol and discovery foundation first: shared capability contracts, persistence support for discovered capabilities, resolver logic with clear precedence, and richer model catalog results flowing through IPC, preload, and renderer store APIs.

**Tech Stack:** TypeScript, Electron IPC, React, Zustand, Vitest, JSON persistence

---

## Scope

This phase covers only the first three items from the master plan:

1. Expand shared contracts and renderer types.
2. Build the capability registry and resolver.
3. Add provider probing and richer model catalogs.

This phase explicitly does **not** yet modify:

- prompt budgeting
- context assembly
- compaction strategy
- memory injection
- chat diagnostics rendering

## Success Criteria

- `ModelProfile` can represent provider flavor, discovered capabilities, manual overrides, and budget policy without breaking old profiles.
- Main process can resolve one effective capability object from `manual override > discovered > registry > default`.
- `model:catalog` and `model:catalog-by-config` can return a richer `ModelCatalogItem` shape.
- Preload and renderer store stop assuming model catalog means `string[]`.
- All new tests for contracts, resolver behavior, and catalog normalization pass.

## Preconditions

- Keep all new contract fields optional.
- Keep current renderer pages functional even if a provider returns only model IDs.
- Do not refactor `session:send-message` in this phase.
- All new methods must include Chinese comments when code is implemented.
- All critical resolver and probing decisions must log in Chinese when code is implemented.

## File Inventory

### Files to modify in this phase

- `desktop/shared/contracts/model.ts`
- `desktop/shared/contracts/index.ts`
- `desktop/src/renderer/types/electron.d.ts`
- `desktop/src/main/services/runtime-context.ts`
- `desktop/src/main/services/state-persistence.ts`
- `desktop/src/main/ipc/models.ts`
- `desktop/src/preload/index.ts`
- `desktop/src/renderer/stores/workspace.ts`
- `desktop/src/renderer/pages/ModelDetailPage.tsx`

### Files to create in this phase

- `desktop/src/main/services/model-capability-registry.ts`
- `desktop/src/main/services/model-capability-resolver.ts`
- `desktop/src/main/services/provider-capability-probers/openai-compatible.ts`
- `desktop/src/main/services/provider-capability-probers/anthropic.ts`
- `desktop/src/main/services/provider-capability-probers/local-gateway.ts`
- `desktop/src/main/services/provider-capability-probers/openrouter.ts`
- `desktop/src/main/services/provider-capability-probers/vercel-ai-gateway.ts`
- `desktop/src/main/services/provider-capability-probers/ollama.ts`
- `desktop/tests/phase9-model-capability-contracts.test.ts`
- `desktop/tests/phase10-model-capability-resolver.test.ts`
- `desktop/tests/phase11-provider-capability-probers.test.ts`

## Phase 1 Data Model

Implement these shapes first in shared contracts:

```ts
export type ProviderFlavor =
  | "openai"
  | "openrouter"
  | "vercel-ai-gateway"
  | "qwen"
  | "moonshot"
  | "ollama"
  | "lm-studio"
  | "vllm"
  | "generic-openai-compatible"
  | "anthropic"
  | "minimax-anthropic"
  | "generic-local-gateway";

export type ModelCapabilitySource =
  | "default"
  | "registry"
  | "provider-catalog"
  | "provider-detail"
  | "provider-token-count"
  | "manual-override"
  | "observed-response"
  | "degraded-after-error";

export type TokenCountingMode =
  | "provider-native"
  | "openai-compatible-estimate"
  | "anthropic-estimate"
  | "local-heuristic"
  | "character-fallback";

export type ModelCapability = {
  contextWindowTokens?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  supportsStreaming?: boolean;
  supportsPromptCaching?: boolean;
  supportsVision?: boolean;
  tokenCountingMode?: TokenCountingMode;
  source: ModelCapabilitySource;
  lastValidatedAt?: string | null;
  raw?: Record<string, JsonValue>;
};

export type ContextBudgetPolicy = {
  outputReserveTokens?: number;
  systemReserveTokens?: number;
  toolReserveTokens?: number;
  memoryReserveTokens?: number;
  safetyMarginTokens?: number;
  compactTriggerRatio?: number;
  minRecentTurnsToKeep?: number;
  maxSummaryBlocks?: number;
  enableLongTermMemory?: boolean;
  enableContextCheckpoint?: boolean;
};
```

Extend `ModelProfile` with:

```ts
providerFlavor?: ProviderFlavor;
capabilityOverrides?: Partial<ModelCapability>;
discoveredCapabilities?: ModelCapability | null;
budgetPolicy?: ContextBudgetPolicy;
```

Use this richer catalog shape in Phase 1:

```ts
export type ModelCatalogItem = {
  id: string;
  name: string;
  provider: ProviderKind;
  providerFlavor?: ProviderFlavor;
  contextWindowTokens?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  source?: ModelCapabilitySource;
  raw?: Record<string, JsonValue>;
};
```

## Task 1: Expand shared contracts and renderer types

**Files:**
- Modify: `desktop/shared/contracts/model.ts`
- Modify: `desktop/shared/contracts/index.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Test: `desktop/tests/phase9-model-capability-contracts.test.ts`

### Step 1: Write the failing contract test

Create `desktop/tests/phase9-model-capability-contracts.test.ts` with checks for:

- `ModelProfile` accepts `providerFlavor`
- `ModelProfile` accepts `capabilityOverrides`
- `ModelProfile` accepts `discoveredCapabilities`
- `ModelProfile` accepts `budgetPolicy`
- a `ModelCatalogItem`-like object can hold richer capability fields
- JSON serialization and deserialization preserve the new fields

Example assertions:

```ts
expect(profile.providerFlavor).toBe("openrouter");
expect(profile.discoveredCapabilities?.contextWindowTokens).toBe(200000);
expect(profile.capabilityOverrides?.maxOutputTokens).toBe(8192);
expect(profile.budgetPolicy?.outputReserveTokens).toBe(4096);
```

### Step 2: Run the contract test and verify failure

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase9-model-capability-contracts.test.ts
```

Expected:

- FAIL because the current contract does not define the new fields.

### Step 3: Modify `model.ts`

Add the new exported types and fields in `desktop/shared/contracts/model.ts`.

Required edits:

- keep `ProviderKind`
- add `ProviderFlavor`
- add `ModelCapabilitySource`
- add `TokenCountingMode`
- add `ModelCapability`
- add `ContextBudgetPolicy`
- extend `ModelProfile`
- keep `contextWindow?: number` for backward compatibility in Phase 1

Implementation note:

- do **not** remove `contextWindow` yet
- do **not** rename `requestBody`
- use `JsonValue` for `raw` payloads to keep persistence safe

### Step 4: Re-export through `index.ts`

Check `desktop/shared/contracts/index.ts`.

Expected change:

- none if `model.ts` is already exported and all new types are exported from that file
- otherwise, add any missing explicit exports

### Step 5: Update renderer declaration surface

Modify `desktop/src/renderer/types/electron.d.ts`.

Required changes:

- update `fetchAvailableModelIds` declaration to the future richer catalog API name, or introduce a temporary second method
- add return type support for richer model catalog items

Recommended transitional shape:

```ts
fetchModelCatalog: (
  input: Pick<ModelProfile, "provider" | "baseUrl" | "baseUrlMode" | "apiKey" | "model" | "headers" | "requestBody" | "providerFlavor">
) => Promise<{ modelIds: ModelCatalogItem[] }>;
```

If you keep `fetchAvailableModelIds` temporarily, mark it transitional in comments and have it derive from the richer method.

### Step 6: Re-run tests

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase9-model-capability-contracts.test.ts tests/phase6-smart-compact.test.ts
```

Expected:

- PASS for the new contract tests
- PASS for existing smart compact tests after retaining `contextWindow`

### Step 7: Commit

```bash
git add desktop/shared/contracts/model.ts desktop/shared/contracts/index.ts desktop/src/renderer/types/electron.d.ts desktop/tests/phase9-model-capability-contracts.test.ts
git commit -m "feat(newapp): extend model capability contracts"
```

## Task 2: Build the capability registry and resolver

**Files:**
- Create: `desktop/src/main/services/model-capability-registry.ts`
- Create: `desktop/src/main/services/model-capability-resolver.ts`
- Modify: `desktop/src/main/services/runtime-context.ts`
- Modify: `desktop/src/main/services/state-persistence.ts`
- Test: `desktop/tests/phase10-model-capability-resolver.test.ts`

### Step 1: Write the failing resolver test

Create `desktop/tests/phase10-model-capability-resolver.test.ts`.

Cover these cases:

1. manual override wins over discovered capability
2. discovered capability wins over registry default
3. registry match wins over hardcoded fallback
4. unknown provider flavor falls back to safe defaults
5. old profile with only `contextWindow` still resolves to a valid capability

Example expectations:

```ts
expect(result.effective.source).toBe("manual-override");
expect(result.effective.maxOutputTokens).toBe(8192);
expect(result.effective.contextWindowTokens).toBe(200000);
```

### Step 2: Run the resolver test and verify failure

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase10-model-capability-resolver.test.ts
```

Expected:

- FAIL because the resolver files do not exist.

### Step 3: Create the registry file

Create `desktop/src/main/services/model-capability-registry.ts`.

Export:

- a normalized registry map keyed by `providerFlavor + model pattern`
- a helper such as `findRegistryCapability(profile: ModelProfile): ModelCapability | null`

Seed the registry with a small, useful set only:

- `openai`
- `anthropic`
- `openrouter`
- `qwen`
- `ollama`
- generic fallbacks for `openai-compatible`, `anthropic`, and `local-gateway`

Do not overbuild the registry in Phase 1.

### Step 4: Create the resolver file

Create `desktop/src/main/services/model-capability-resolver.ts`.

Export a function like:

```ts
resolveModelCapability(profile: ModelProfile, options?: {
  registryCapability?: ModelCapability | null;
  discoveredCapability?: ModelCapability | null;
}): {
  effective: ModelCapability;
  registry: ModelCapability | null;
  discovered: ModelCapability | null;
  manualOverride: Partial<ModelCapability> | null;
}
```

Resolver precedence:

1. `profile.capabilityOverrides`
2. `profile.discoveredCapabilities`
3. registry capability
4. legacy `contextWindow`
5. safe hardcoded fallback

Safe fallback suggestion:

```ts
{
  contextWindowTokens: 32768,
  maxInputTokens: 28672,
  maxOutputTokens: 4096,
  supportsTools: true,
  supportsStreaming: true,
  tokenCountingMode: "character-fallback",
  source: "default",
}
```

### Step 5: Extend runtime context

Modify `desktop/src/main/services/runtime-context.ts`.

Add resolver exposure:

```ts
services: {
  ...
  resolveModelCapability?: (profile: ModelProfile) => ResolvedModelCapability;
}
```

Do not wire the full bootstrap path yet if it creates churn. It is acceptable in Phase 1 to expose the service only where `models.ts` needs it.

### Step 6: Extend persistence support

Modify `desktop/src/main/services/state-persistence.ts`.

Phase 1 persistence goals:

- old `ModelProfile` JSON must still load
- new fields on `ModelProfile` must serialize and deserialize cleanly
- no separate `model-capabilities/` directory yet unless it is genuinely needed in the implementation

If you do create separate capability files in Phase 1, keep them optional and lazy.

### Step 7: Re-run tests

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase10-model-capability-resolver.test.ts
```

Expected:

- PASS for precedence and fallback resolution

### Step 8: Commit

```bash
git add desktop/src/main/services/model-capability-registry.ts desktop/src/main/services/model-capability-resolver.ts desktop/src/main/services/runtime-context.ts desktop/src/main/services/state-persistence.ts desktop/tests/phase10-model-capability-resolver.test.ts
git commit -m "feat(newapp): add model capability resolver"
```

## Task 3: Add provider probing and richer model catalogs

**Files:**
- Create: `desktop/src/main/services/provider-capability-probers/openai-compatible.ts`
- Create: `desktop/src/main/services/provider-capability-probers/anthropic.ts`
- Create: `desktop/src/main/services/provider-capability-probers/local-gateway.ts`
- Create: `desktop/src/main/services/provider-capability-probers/openrouter.ts`
- Create: `desktop/src/main/services/provider-capability-probers/vercel-ai-gateway.ts`
- Create: `desktop/src/main/services/provider-capability-probers/ollama.ts`
- Modify: `desktop/src/main/ipc/models.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Modify: `desktop/src/renderer/pages/ModelDetailPage.tsx`
- Test: `desktop/tests/phase11-provider-capability-probers.test.ts`

### Step 1: Write the failing probe test

Create `desktop/tests/phase11-provider-capability-probers.test.ts`.

Cover:

- OpenRouter-like payload normalized to `ModelCatalogItem`
- Vercel-like payload normalized to `ModelCatalogItem`
- Ollama-like payload normalized to `ModelCatalogItem`
- generic provider list returning only IDs
- Anthropic list response without rich capability fields

Suggested helper test shape:

```ts
expect(item.id).toBe("openai/gpt-4.1");
expect(item.contextWindowTokens).toBe(1047576);
expect(item.maxOutputTokens).toBe(32768);
expect(item.source).toBe("provider-catalog");
```

### Step 2: Run the probe test and verify failure

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase11-provider-capability-probers.test.ts
```

Expected:

- FAIL because the prober files do not exist.

### Step 3: Create provider-specific normalization helpers

Each prober file should do one thing:

- accept raw provider payload
- normalize provider-specific fields
- return `ModelCatalogItem[]`

Recommended function names:

- `normalizeOpenAiCompatibleCatalog(...)`
- `normalizeAnthropicCatalog(...)`
- `normalizeLocalGatewayCatalog(...)`
- `normalizeOpenRouterCatalog(...)`
- `normalizeVercelGatewayCatalog(...)`
- `normalizeOllamaCatalog(...)`

Do not make these functions fetch by themselves in Phase 1 if that complicates testing. A clean split is:

- `models.ts` handles fetch
- prober files handle normalization only

### Step 4: Upgrade `models.ts`

Modify `desktop/src/main/ipc/models.ts`.

Required changes:

- move `ModelCatalogItem` to a richer shape
- infer `providerFlavor` from profile where possible
- for known providers, route response JSON through the right normalizer
- fall back to the current ID-based mapping for generic lists

Keep both handlers working:

- `model:catalog`
- `model:catalog-by-config`

Add one helper:

```ts
function resolveProviderFlavor(profile: Pick<ModelProfile, "provider" | "baseUrl" | "model" | "providerFlavor">): ProviderFlavor
```

This helper should:

- respect explicit `profile.providerFlavor`
- infer from `baseUrl`
- infer from `model` prefix for known providers
- fall back to a generic flavor per `provider`

### Step 5: Upgrade preload API

Modify `desktop/src/preload/index.ts`.

Replace or supplement:

- `fetchAvailableModelIds(...)`

with:

- `fetchModelCatalog(...)`

Transitional behavior:

- `fetchModelCatalog()` returns `{ modelIds: ModelCatalogItem[] }`
- `fetchAvailableModelIds()` may still exist temporarily and derive `string[]` from the richer method

### Step 6: Upgrade renderer store

Modify `desktop/src/renderer/stores/workspace.ts`.

Required changes:

- add a richer method returning `ModelCatalogItem[]`
- keep any existing call sites from breaking
- do not force immediate full renderer migration outside model settings pages

Recommended shape:

```ts
fetchModelCatalog: (...) => Promise<ModelCatalogItem[]>;
fetchAvailableModelIds: (...) => Promise<string[]>;
```

with:

- `fetchAvailableModelIds` implemented as `fetchModelCatalog(...).map((item) => item.id)`

### Step 7: Upgrade model settings page minimally

Modify `desktop/src/renderer/pages/ModelDetailPage.tsx`.

Phase 1 renderer requirement is minimal:

- keep current dropdown working
- allow richer catalog payloads to populate the dropdown
- optionally keep the richer item list in local state for later Phase 2 use

Do **not** yet add the large diagnostics UI in this phase.

### Step 8: Re-run tests

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase11-provider-capability-probers.test.ts
pnpm --dir desktop exec vitest run tests/phase9-model-capability-contracts.test.ts tests/phase10-model-capability-resolver.test.ts tests/phase11-provider-capability-probers.test.ts
```

Expected:

- PASS for all new Phase 1 tests

### Step 9: Commit

```bash
git add desktop/src/main/services/provider-capability-probers desktop/src/main/ipc/models.ts desktop/src/preload/index.ts desktop/src/renderer/stores/workspace.ts desktop/src/renderer/types/electron.d.ts desktop/src/renderer/pages/ModelDetailPage.tsx desktop/tests/phase11-provider-capability-probers.test.ts
git commit -m "feat(newapp): enrich model catalog and provider probing"
```

## Phase 1 Verification Sweep

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase9-model-capability-contracts.test.ts tests/phase10-model-capability-resolver.test.ts tests/phase11-provider-capability-probers.test.ts
pnpm --dir desktop test
pnpm --dir desktop typecheck
```

Expected:

- all targeted Phase 1 tests pass
- no baseline regressions in existing tests
- typecheck passes with richer catalog types

## Phase 1 Handoff Notes

After this phase is complete, the codebase should be ready for Phase 2 work on:

- token estimation
- request budgeting
- context assembly
- compaction pipeline

Do not start Phase 2 until the richer capability data can flow end-to-end from:

`ModelProfile -> resolver -> model catalog IPC -> preload -> workspace store -> model settings page`

## Notes For The Main Agent

- Keep `contextWindow?: number` alive during Phase 1 for backward compatibility.
- Do not let Phase 1 drift into session compaction changes.
- Prefer small, composable normalization helpers over one giant provider-switch file.
- Treat `ModelDetailPage.tsx` as a compatibility surface in this phase, not the final UX.
