# NewApp Context Engineering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade `desktop` into a context-engineering system that can support arbitrary model sources, resolve real token limits dynamically, keep one chat window alive for long sessions, and add layered memory plus controlled compaction.

**Architecture:** Build a main-process pipeline of `ModelCapabilityResolver -> TokenBudgetManager -> ContextAssembler -> ContextCompactor -> MemoryService`, while keeping the existing `model:*` and `session:*` IPC entry points stable. Expand shared contracts, persistence, and renderer diagnostics incrementally so old model profiles and old sessions remain loadable.

**Tech Stack:** TypeScript, Electron, React, Zustand, Vitest, native fetch, JSON file persistence

---

## Preconditions

- Scope is limited to `desktop`.
- All touched files must remain UTF-8.
- Any touched Chinese-containing code files must be read before edit, patched minimally, re-opened after edit, and checked for mojibake.
- All new methods must include Chinese comments.
- All critical runtime decisions, degradations, and compaction actions must include Chinese logs.
- Existing IPC channel names and baseline semantics should remain stable.
- New contract fields must be optional unless there is a migration layer in place.

## Problem Statement

`desktop` already has basic context control, but it does not yet have a real context-engineering architecture:

- `desktop/shared/contracts/model.ts`
  - `ModelProfile` only exposes `contextWindow?: number`
  - there is no normalized capability model for max input, max output, capability source, provider flavor, or budget policy
- `desktop/src/main/ipc/models.ts`
  - `model:catalog` and `model:catalog-by-config` mainly return model IDs
  - provider-side capability metadata is not normalized into a shared runtime contract
- `desktop/src/main/ipc/sessions.ts`
  - compaction is still driven by `contextWindow * 0.8`
  - `calculateSessionTokens()` sums historical usage, which is closer to billing history than to current prompt size
  - system prompt, tools, memory, and output reserve do not have explicit budgets
- `desktop/src/main/services/model-client.ts`
  - usage normalization already exists for prompt and completion tokens
  - this is a strong base, but capability resolution and request budgeting are not wired in
- `desktop/src/renderer/pages/ModelDetailPage.tsx`
  - users can edit connection basics plus `headers` and `requestBody`
  - there is no UI for capability discovery, manual overrides, budget policy, memory policy, or compaction settings

## Industry Patterns To Reuse

Modern products treat model capability metadata as a first-class runtime input:

- Vercel AI Gateway exposes normalized model/provider metadata such as `context_window`, `max_tokens`, and supported parameters.
  - Source: <https://vercel.com/docs/ai-gateway/models-and-providers>
- OpenRouter exposes `context_length`, provider output limits, and normalized capability fields through one catalog endpoint.
  - Source: <https://openrouter.ai/docs/api-reference/models/get-models>
- Gemini model APIs expose input and output token limits directly.
  - Source: <https://ai.google.dev/api/models>
- Anthropic documents both token counting and compaction as formal long-conversation strategies.
  - Source: <https://platform.claude.com/docs/en/build-with-claude/token-counting>
  - Source: <https://platform.claude.com/docs/en/build-with-claude/compaction>
- OpenAI model retrieval is not sufficient by itself as a full runtime capability surface.
  - Source: <https://developers.openai.com/api/reference/resources/models/methods/retrieve>
  - Source: <https://developers.openai.com/api/docs/models/gpt-5-mini>
- LiteLLM maintains a static model capability registry, which is a useful fallback pattern for arbitrary providers.
  - Source: <https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json>
- Ollama shows that local models usually require separate probing beyond OpenAI-compatible `/models`.
  - Source: <https://docs.ollama.com/api-reference/show-model-details>
  - Source: <https://docs.ollama.com/api/openai-compatibility>

## Design Goals

1. Support arbitrary model sources and discover real token limits whenever possible.
2. Separate total context window, safe input budget, and max output tokens instead of using one `contextWindow` field as truth.
3. Keep a single chat window viable for long-running work by layering summaries, checkpoints, and memory.
4. Preserve backward compatibility for existing profiles, sessions, and IPC flows.
5. Make all budgeting, compaction, and memory injections observable and explainable.
6. Provide safe fallback behavior when provider metadata is missing or inaccurate.

## Non-Goals

- Do not make an external vector database a hard dependency.
- Do not require every provider to expose native token counting.
- Do not rewrite the whole chat UX from scratch.
- Do not remove `requestBody` passthrough entirely; normalize it where it impacts runtime budgeting.

## Core Design Decisions

### Decision 1: Keep `provider`, add `providerFlavor`

Keep `provider` as the transport family:

- `openai-compatible`
- `anthropic`
- `local-gateway`

Add `providerFlavor` to capture vendor/runtime semantics:

- `openai`
- `openrouter`
- `vercel-ai-gateway`
- `qwen`
- `moonshot`
- `ollama`
- `lm-studio`
- `vllm`
- `generic-openai-compatible`
- `anthropic`
- `minimax-anthropic`
- `generic-local-gateway`

This allows transport compatibility and provider-specific probing to coexist.

### Decision 2: Model capabilities must be explicit structured data

Add normalized capability types in shared contracts:

```ts
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
  raw?: Record<string, unknown>;
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

### Decision 3: Capability resolution and request budgeting are separate services

- `ModelCapabilityResolver`
  - answers: "what can this model theoretically and practically handle?"
- `TokenBudgetManager`
  - answers: "how much input can this specific request safely include?"

Do not keep this logic embedded in `sessions.ts`.

### Decision 4: Long-session context is four layers, not one transcript

Each request context should be built from:

1. Fixed context
   - system prompt
   - tool schema
   - runtime/environment metadata
2. Recent turns
   - recent user, assistant, and tool messages
3. Working memory
   - current goals, constraints, open items, recent findings, rolling summary
4. Long-term memory
   - cross-session preferences, project facts, prior conclusions, checkpoints

### Decision 5: Compaction must preserve semantics, not just delete history

Compaction order should be fixed:

1. trim oversized tool output
2. summarize stale conversation blocks
3. update working memory
4. retrieve only relevant long-term memory
5. shrink output reserve if still safe
6. hard compact only as the final fallback

## Target Architecture

### 1. Contract Layer

**Files:**
- Modify: `desktop/shared/contracts/model.ts`
- Modify: `desktop/shared/contracts/session.ts`
- Modify: `desktop/shared/contracts/index.ts`

Recommended additions:

- `ModelProfile.providerFlavor?: string`
- `ModelProfile.capabilityOverrides?: Partial<ModelCapability>`
- `ModelProfile.budgetPolicy?: ContextBudgetPolicy`
- `ModelProfile.discoveredCapabilities?: ModelCapability | null`
- `ChatSession.contextState?: ChatSessionContextState`
- `ChatSession.memoryState?: ChatSessionMemoryState`

### 2. Capability Resolution Layer

**Create:**
- `desktop/src/main/services/model-capability-registry.ts`
- `desktop/src/main/services/model-capability-resolver.ts`
- `desktop/src/main/services/provider-capability-probers/openai-compatible.ts`
- `desktop/src/main/services/provider-capability-probers/anthropic.ts`
- `desktop/src/main/services/provider-capability-probers/local-gateway.ts`
- `desktop/src/main/services/provider-capability-probers/openrouter.ts`
- `desktop/src/main/services/provider-capability-probers/vercel-ai-gateway.ts`
- `desktop/src/main/services/provider-capability-probers/ollama.ts`

Responsibilities:

- load built-in registry defaults
- select probe strategy from `providerFlavor`
- query provider catalogs, model details, or token-count endpoints where available
- merge manual overrides
- return one normalized `ResolvedModelCapability`
- cache recent results

### 3. Token Budget Layer

**Create:**
- `desktop/src/main/services/token-estimator.ts`
- `desktop/src/main/services/token-budget-manager.ts`

Recommended formulas:

```ts
effectiveContextWindow =
  minNonNull(
    capability.contextWindowTokens,
    capability.maxInputTokens ? capability.maxInputTokens + capability.maxOutputTokens : undefined,
  ) ?? 32768;

effectiveMaxInput =
  minNonNull(capability.maxInputTokens, capability.contextWindowTokens) ?? effectiveContextWindow;

effectiveMaxOutput =
  capability.maxOutputTokens ?? 4096;

safeInputBudget =
  effectiveMaxInput
  - systemReserveTokens
  - toolReserveTokens
  - memoryReserveTokens
  - outputReserveTokens
  - safetyMarginTokens;
```

Important rules:

- `contextWindowTokens` is not the same as `maxInputTokens`
- output reserve must be explicit
- `requestBody.max_tokens`, `max_completion_tokens`, and similar fields must feed the final budget snapshot

### 4. Context Assembly Layer

**Create:**
- `desktop/src/main/services/context-assembler.ts`
- `desktop/src/main/services/context-compactor.ts`
- `desktop/src/main/services/context-checkpoint-service.ts`
- `desktop/src/main/services/tool-output-sanitizer.ts`

Responsibilities:

- estimate system prompt and tool schema cost first
- attach recent turns next
- decide how much working memory and long-term memory can fit
- compact using a fixed strategy when above budget
- return both final model messages and a budget snapshot for diagnostics

### 5. Memory Layer

**Create:**
- `desktop/src/main/services/memory-service.ts`
- `desktop/src/main/services/memory-extractor.ts`
- `desktop/src/main/services/memory-retriever.ts`
- `desktop/src/main/services/memory-ranker.ts`

Memory types:

- `rolling-summary`
- `working-memory`
- `project-fact`
- `user-preference`
- `tool-discovery`
- `checkpoint`
- `pinned-context`

Ranking factors:

- text relevance
- recency
- importance score
- session relevance
- explicit pin state

### 6. Persistence Layer

Extend current persistence with lazy-created files:

```text
<myClawDir>/
  models/
    <profileId>.json
  model-capabilities/
    <profileId>.json
  memory/
    index.json
    entries/
      <memoryId>.json
  sessions/
    <sessionId>/
      session.json
      messages.json
      context-state.json
      summaries.json
      checkpoints.json
```

Requirements:

- old session directories must still load without new files
- all new files are optional and lazily created
- write failures should degrade enhanced features, not basic chat

### 7. IPC And Renderer Layer

**Modify:**
- `desktop/src/main/ipc/models.ts`
- `desktop/src/main/ipc/sessions.ts`
- `desktop/src/main/ipc/bootstrap.ts`
- `desktop/src/preload/index.ts`
- `desktop/src/renderer/types/electron.d.ts`
- `desktop/src/renderer/stores/workspace.ts`
- `desktop/src/renderer/pages/ModelDetailPage.tsx`
- `desktop/src/renderer/pages/ModelsPage.tsx`
- `desktop/src/renderer/pages/SettingsPage.tsx`
- `desktop/src/renderer/pages/ChatPage.tsx`

UI additions:

- model capability card
  - effective values
  - source
  - last validation time
  - probe action
- manual override card
  - context window
  - max input
  - max output
  - supports tools/streaming/caching toggles
- budget policy card
  - output reserve
  - memory reserve
  - compact trigger ratio
  - recent-turn retention
- chat context diagnostics card
  - last estimated prompt tokens
  - last actual usage
  - last compaction reason
  - which summaries, memories, and checkpoints were injected

## Critical Runtime Flows

### Flow A: Save or update a model profile

1. User edits the profile in `ModelDetailPage`.
2. User can click "Probe capabilities".
3. Main process calls `ModelCapabilityResolver`.
4. Probe results are persisted into:
   - `profile.discoveredCapabilities`
   - `model-capabilities/<profileId>.json`
5. Renderer shows:
   - advertised capability
   - effective runtime capability
   - manual overrides
   - capability source

### Flow B: Send a message

1. `session:send-message` receives a new user turn.
2. Load the active `ModelProfile`.
3. Resolve capabilities through `ModelCapabilityResolver`.
4. Build a request budget through `TokenBudgetManager`.
5. `ContextAssembler` prepares:
   - system prompt
   - tool schema
   - recent turns
   - working memory
   - long-term memory
6. If above budget, pass through `ContextCompactor`.
7. Send final messages to `callModel()`.
8. Persist actual usage from the response.
9. Update:
   - `context-state`
   - rolling summary
   - memory candidates
   - checkpoint when needed

### Flow C: Context collapse for a very long conversation

When a session becomes too long, do not rely on keeping a huge transcript forever. Generate a checkpoint containing:

- current task goals
- confirmed constraints
- key file and tool discoveries
- open action items
- user preferences and forbidden actions
- only the most recent raw turns

This keeps the same chat window alive while the model sees `checkpoint + working memory + recent turns` instead of an unbounded transcript.

## Degradation And Failure Policy

1. Provider has no capability catalog
   - use registry
   - then safe defaults
2. Provider has model list but no capability metadata
   - return model IDs
   - capability still comes from `providerFlavor + registry + overrides`
3. Token counting is inaccurate
   - estimate first
   - calibrate with actual usage later
4. Model-generated compaction fails
   - fall back to summary stub
5. Memory retrieval fails
   - do not block the main chat request
6. New persistence writes fail
   - log the error
   - preserve baseline session and message persistence

## Implementation Tasks

### Task 1: Expand shared contracts and renderer types

**Files:**
- Modify: `desktop/shared/contracts/model.ts`
- Modify: `desktop/shared/contracts/session.ts`
- Modify: `desktop/shared/contracts/index.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Test: `desktop/tests/phase9-model-capability-contracts.test.ts`

**Step 1: Write the failing test**

- Add serialization and shape tests for capability fields, budget fields, and session context fields.

**Step 2: Run the test to verify failure**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase9-model-capability-contracts.test.ts
```

**Step 3: Write minimal implementation**

- add `providerFlavor`
- add capability and budget types
- add session context state types
- keep all new fields optional

**Step 4: Run regression tests**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase9-model-capability-contracts.test.ts tests/phase6-smart-compact.test.ts
```

**Step 5: Commit**

```bash
git add desktop/shared/contracts desktop/src/renderer/types/electron.d.ts desktop/tests/phase9-model-capability-contracts.test.ts
git commit -m "feat(newapp): add context engineering contracts"
```

### Task 2: Build the capability registry and resolver

**Files:**
- Create: `desktop/src/main/services/model-capability-registry.ts`
- Create: `desktop/src/main/services/model-capability-resolver.ts`
- Modify: `desktop/src/main/services/runtime-context.ts`
- Modify: `desktop/src/main/services/state-persistence.ts`
- Test: `desktop/tests/phase10-model-capability-resolver.test.ts`

**Step 1: Write the failing test**

- cover priority order: `manual override > discovered > registry > default`
- cover provider flavor matching
- cover old profiles without new fields

**Step 2: Run the test to verify failure**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase10-model-capability-resolver.test.ts
```

**Step 3: Write minimal implementation**

- add a built-in registry
- add `resolve(profile, options)` API
- cache the latest resolution output

**Step 4: Run regression tests**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase10-model-capability-resolver.test.ts
```

**Step 5: Commit**

```bash
git add desktop/src/main/services/model-capability-registry.ts desktop/src/main/services/model-capability-resolver.ts desktop/src/main/services/runtime-context.ts desktop/src/main/services/state-persistence.ts desktop/tests/phase10-model-capability-resolver.test.ts
git commit -m "feat(newapp): add model capability resolver"
```

### Task 3: Add provider probing and richer model catalogs

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
- Test: `desktop/tests/phase11-provider-capability-probers.test.ts`

**Step 1: Write the failing test**

- cover normalized outputs for OpenRouter, Vercel, and Ollama-like responses
- cover degraded cases where only model IDs are available

**Step 2: Run the test to verify failure**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase11-provider-capability-probers.test.ts
```

**Step 3: Write minimal implementation**

- change `model:catalog` to return rich objects, not just strings
- evolve `fetchAvailableModelIds()` into `fetchModelCatalog()`
- keep the renderer compatible with ID-only providers

**Step 4: Run regression tests**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase11-provider-capability-probers.test.ts
```

**Step 5: Commit**

```bash
git add desktop/src/main/services/provider-capability-probers desktop/src/main/ipc/models.ts desktop/src/preload/index.ts desktop/src/renderer/stores/workspace.ts desktop/src/renderer/types/electron.d.ts desktop/tests/phase11-provider-capability-probers.test.ts
git commit -m "feat(newapp): enrich model catalog with capabilities"
```

### Task 4: Add token estimation and request budgeting

**Files:**
- Create: `desktop/src/main/services/token-estimator.ts`
- Create: `desktop/src/main/services/token-budget-manager.ts`
- Modify: `desktop/src/main/services/model-client.ts`
- Test: `desktop/tests/phase12-token-budget-manager.test.ts`

**Step 1: Write the failing test**

- cover budget formulas
- cover output reserve handling
- cover `requestBody.max_tokens` and similar fields
- cover calibration from actual usage

**Step 2: Run the test to verify failure**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase12-token-budget-manager.test.ts
```

**Step 3: Write minimal implementation**

- add `estimatePromptTokens()`
- add `buildBudgetSnapshot()`
- normalize output-limit request fields in `model-client.ts`

**Step 4: Run regression tests**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase12-token-budget-manager.test.ts tests/phase6-smart-compact.test.ts
```

**Step 5: Commit**

```bash
git add desktop/src/main/services/token-estimator.ts desktop/src/main/services/token-budget-manager.ts desktop/src/main/services/model-client.ts desktop/tests/phase12-token-budget-manager.test.ts
git commit -m "feat(newapp): add token budget manager"
```

### Task 5: Refactor message assembly and compaction

**Files:**
- Create: `desktop/src/main/services/context-assembler.ts`
- Create: `desktop/src/main/services/context-compactor.ts`
- Create: `desktop/src/main/services/context-checkpoint-service.ts`
- Create: `desktop/src/main/services/tool-output-sanitizer.ts`
- Modify: `desktop/src/main/ipc/sessions.ts`
- Test: `desktop/tests/phase13-context-assembly.test.ts`

**Step 1: Write the failing test**

- cover recent-turn retention
- cover tool output trimming
- cover working-summary injection
- cover multi-stage compaction order

**Step 2: Run the test to verify failure**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase13-context-assembly.test.ts
```

**Step 3: Write minimal implementation**

- replace `buildModelMessagesWithCompact()` with an assembler entry point
- move `smartCompactMessages()` into a dedicated compactor
- keep the current fallback summary initially, then upgrade to model-generated summaries

**Step 4: Run regression tests**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase13-context-assembly.test.ts tests/phase6-smart-compact.test.ts
```

**Step 5: Commit**

```bash
git add desktop/src/main/services/context-assembler.ts desktop/src/main/services/context-compactor.ts desktop/src/main/services/context-checkpoint-service.ts desktop/src/main/services/tool-output-sanitizer.ts desktop/src/main/ipc/sessions.ts desktop/tests/phase13-context-assembly.test.ts
git commit -m "refactor(newapp): add context assembly pipeline"
```

### Task 6: Add working memory, long-term memory, and checkpoints

**Files:**
- Create: `desktop/src/main/services/memory-service.ts`
- Create: `desktop/src/main/services/memory-extractor.ts`
- Create: `desktop/src/main/services/memory-retriever.ts`
- Create: `desktop/src/main/services/memory-ranker.ts`
- Modify: `desktop/src/main/services/state-persistence.ts`
- Modify: `desktop/src/main/ipc/bootstrap.ts`
- Modify: `desktop/src/main/ipc/sessions.ts`
- Test: `desktop/tests/phase14-memory-service.test.ts`

**Step 1: Write the failing test**

- cover memory extraction
- cover retrieval ranking
- cover checkpoint creation
- cover compatibility for old sessions without memory files

**Step 2: Run the test to verify failure**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase14-memory-service.test.ts
```

**Step 3: Write minimal implementation**

- add the memory directory layout
- retrieve relevant memories before model call
- extract memory candidates after model response
- generate checkpoints after severe compaction

**Step 4: Run regression tests**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase14-memory-service.test.ts tests/phase13-context-assembly.test.ts
```

**Step 5: Commit**

```bash
git add desktop/src/main/services/memory-service.ts desktop/src/main/services/memory-extractor.ts desktop/src/main/services/memory-retriever.ts desktop/src/main/services/memory-ranker.ts desktop/src/main/services/state-persistence.ts desktop/src/main/ipc/bootstrap.ts desktop/src/main/ipc/sessions.ts desktop/tests/phase14-memory-service.test.ts
git commit -m "feat(newapp): add memory and checkpoint services"
```

### Task 7: Upgrade model settings and chat diagnostics UI

**Files:**
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Modify: `desktop/src/renderer/pages/ModelDetailPage.tsx`
- Modify: `desktop/src/renderer/pages/ModelsPage.tsx`
- Modify: `desktop/src/renderer/pages/SettingsPage.tsx`
- Modify: `desktop/src/renderer/pages/ChatPage.tsx`
- Test: `desktop/tests/phase15-context-ui.test.tsx`

**Step 1: Write the failing test**

- cover capability probe action
- cover manual override save flow
- cover chat diagnostics rendering

**Step 2: Run the test to verify failure**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase15-context-ui.test.tsx
```

**Step 3: Write minimal implementation**

- add capability, override, and budget cards to `ModelDetailPage`
- add context diagnostics to `ChatPage`
- show capability source and window summary in `ModelsPage`

**Step 4: Run regression tests**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase15-context-ui.test.tsx
```

**Step 5: Commit**

```bash
git add desktop/src/preload/index.ts desktop/src/renderer/types/electron.d.ts desktop/src/renderer/stores/workspace.ts desktop/src/renderer/pages/ModelDetailPage.tsx desktop/src/renderer/pages/ModelsPage.tsx desktop/src/renderer/pages/SettingsPage.tsx desktop/src/renderer/pages/ChatPage.tsx desktop/tests/phase15-context-ui.test.tsx
git commit -m "feat(newapp): add context capability and diagnostics ui"
```

### Task 8: Add logging, fallbacks, and verification gates

**Files:**
- Modify: `desktop/src/main/services/model-client.ts`
- Modify: `desktop/src/main/ipc/models.ts`
- Modify: `desktop/src/main/ipc/sessions.ts`
- Modify: `desktop/src/main/services/logger.ts` if present, otherwise create it
- Modify: `desktop/vitest.config.ts`
- Test: `desktop/tests/phase16-context-fallbacks.test.ts`

**Step 1: Write the failing test**

- cover catalog failure fallback
- cover memory failure without blocking the request
- cover compaction failure falling back to summary stub

**Step 2: Run the test to verify failure**

Run:

```powershell
pnpm --dir desktop exec vitest run tests/phase16-context-fallbacks.test.ts
```

**Step 3: Write minimal implementation**

- add Chinese logs for capability resolution, budgeting, compaction, and memory injection
- unify fallback behavior for all key failure modes
- update test wiring

**Step 4: Run the full verification suite**

Run:

```powershell
pnpm --dir desktop test
pnpm --dir desktop typecheck
pnpm --dir desktop build
```

**Step 5: Run the mojibake gate**

Run:

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern desktop docs/plans/2026-04-02-newapp-context-engineering-implementation-plan.md
```

**Step 6: Commit**

```bash
git add desktop docs/plans/2026-04-02-newapp-context-engineering-implementation-plan.md
git commit -m "chore(newapp): finalize context engineering safeguards"
```

## Recommended Execution Order

1. Complete Task 1 and Task 2 first to establish contracts and capability resolution.
2. Complete Task 3 and Task 4 next so model-window and token-budget logic become real.
3. Complete Task 5 and Task 6 after that to make long-session behavior durable.
4. Finish with Task 7 and Task 8 to add renderer visibility, fallbacks, and gates.

## Main Risks And Mitigations

### Risk 1: Token rules differ heavily across providers

Mitigation:

- normalize through `TokenCountingMode`
- prefer provider-native counting where possible
- calibrate with actual usage
- keep safety margins conservative by default

### Risk 2: The OpenAI-compatible ecosystem is fragmented

Mitigation:

- add `providerFlavor`
- stack `registry + probe + override`
- treat discovery failure as a normal path, not a rare exception

### Risk 3: Memory injection pollutes prompts

Mitigation:

- memory must be typed
- rank and size-limit before injection
- separate working memory from long-term memory
- support future pin/unpin and cleanup flows

### Risk 4: Semantics are lost after compaction

Mitigation:

- generate working summaries before deleting stale blocks
- create checkpoints for major compaction events
- show compaction reason and sources in the UI

## Expected Outcome

After implementation, `desktop` should be able to:

- support arbitrary model sources without relying on a single manually-entered `contextWindow`
- compute a real request budget before every model call
- convert long sessions into summaries, checkpoints, and memory instead of only deleting history
- keep one chat window alive for much longer conversations
- show capability source, budget state, compaction events, and memory injections in the UI

## Notes For The Main Agent

- Do not let multiple workers modify `desktop/src/main/ipc/sessions.ts` at the same time.
- `desktop/shared/contracts/model.ts` and `desktop/shared/contracts/session.ts` are protocol-critical and must be reviewed last across all consumers.
- Any `requestBody` fields such as `max_tokens`, `max_completion_tokens`, `thinking`, or `reasoning` must pass through normalization so budgeting remains correct.
- Re-open any touched Chinese-containing files with UTF-8 decoding before calling the work complete.
