# Model Route Probe And Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add model-route probing, recommendation, manual override, and save-time auto-probe to the desktop model configuration page while preserving current page structure and runtime contract compatibility.

**Architecture:** Extend the existing model configuration flow instead of creating a new diagnostics page. Add a route-probe IPC that evaluates the currently supported protocol targets, return a structured recommendation payload, expose it through preload/workspace store, and render a compact diagnostics block beside connectivity testing in `ModelDetailPage`. Persist the final user choice in `ModelProfile.protocolTarget`.

**Tech Stack:** Electron IPC, TypeScript, React, Zustand, Vitest, existing desktop model runtime protocol drivers.

---

### Task 1: Define shared route-probe contract

**Files:**
- Modify: `desktop/shared/contracts/model.ts`
- Test: compile/type usage via downstream consumers

**Step 1: Add shared route-probe types**

Add exact types for:
- `ModelRouteProbeEntry`
- `ModelRouteProbeResult`

Keep them in `model.ts` next to `ProtocolTarget` so renderer/main/preload can share them.

**Step 2: Add project route-priority constant**

Add a readonly priority list for:
- `openai-responses`
- `anthropic-messages`
- `openai-chat-compatible`

This must be the single source for recommendation ordering.

**Step 3: Run typecheck for contract consumers**

Run: `npm run typecheck`
Expected: pass or fail only on missing downstream wiring we are about to add

### Task 2: Add probe-routes IPC and preload wiring

**Files:**
- Modify: `desktop/src/main/ipc/models.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Modify: `desktop/src/renderer/stores/workspace.ts`

**Step 1: Write failing tests for IPC/UI-facing contract**

Add tests that expect:
- a probe API exists at renderer boundary
- it returns recommended route + available routes + entries

Prefer renderer/store-level tests if possible so contract is exercised from user-facing code.

**Step 2: Implement `model:probe-routes-by-config`**

Behavior:
- accept unsaved config fields already used by `testModelByConfig`
- probe only current project-supported routes
- return structured entries with `ok`, `latencyMs`, `reason`, and `notes`
- compute `recommendedProtocolTarget` by fixed project priority

**Step 3: Expose renderer-facing API**

Wire through preload, global window typing, and workspace store action:
- `probeModelRoutes(input) => Promise<ModelRouteProbeResult>`

**Step 4: Verify focused tests**

Run: renderer/store-focused tests added in this task
Expected: pass

### Task 3: Add ModelDetailPage route diagnostics UI

**Files:**
- Modify: `desktop/src/renderer/pages/ModelDetailPage.tsx`
- Test: new `desktop/tests/model-detail-route-probe.test.tsx`

**Step 1: Write failing page tests**

Add tests covering:
- probe button disabled until a model is chosen
- successful probe shows recommended route
- route selector only lists available routes
- detail icon reveals route diagnostics
- manual route selection is preserved

**Step 2: Implement local page state**

Add:
- `routeProbeResult`
- `selectedRoute`
- `routeSelectionSource`
- `isProbingRoutes`
- `routeProbeError`
- detail panel open/close state

**Step 3: Render diagnostics block beside connectivity actions**

Keep style aligned with current `ModelDetailPage` sections:
- compact action row near `测试联通`
- recommendation hint
- select box
- detail icon
- small diagnostics surface, not a heavyweight modal

**Step 4: Verify page tests**

Run: `npx vitest run tests/model-detail-route-probe.test.tsx`
Expected: pass

### Task 4: Add save-time auto-probe fallback

**Files:**
- Modify: `desktop/src/renderer/pages/ModelDetailPage.tsx`
- Update tests: `desktop/tests/model-detail-route-probe.test.tsx`

**Step 1: Write failing test for save fallback**

Case:
- no probe result
- no manually selected route
- user clicks save
- system auto-probes
- applies best route
- persists profile with `protocolTarget`

**Step 2: Implement save branching**

Rules:
- manual route selected => save directly
- probe available but no manual override => save recommended route
- neither manual nor probe => auto-probe then save
- auto-probe failure => block save and show error

**Step 3: Verify focused tests**

Run: `npx vitest run tests/model-detail-route-probe.test.tsx`
Expected: pass

### Task 5: Full verification and document sync

**Files:**
- Modify: `docs/plans/2026-04-11-model-route-probe-and-selection-design.md`
- Update: this implementation plan with completion evidence

**Step 1: Update design doc if implementation differs**

Record any implementation-level constraint or naming change.

**Step 2: Run verification**

Run:
- `npm run typecheck`
- `npm run lint`
- `npx vitest run tests/model-runtime`
- `npx vitest run tests/model-detail-br-minimax-diagnostics.test.tsx tests/model-detail-route-probe.test.tsx`

Expected:
- typecheck pass
- lint pass or only pre-existing unrelated warnings
- all targeted tests pass

**Step 3: Record verification evidence**

Add exact commands and status to this document.

---

## Completion Notes

- 2026-04-11: Shared contract extended with `ModelRouteProbeEntry`, `ModelRouteProbeResult`, and `PROTOCOL_TARGET_RECOMMENDATION_ORDER`.
- 2026-04-11: Added `model:probe-routes-by-config` in `desktop/src/main/ipc/models.ts`, plus preload and renderer workspace wiring.
- 2026-04-11: Added route diagnostics UI to `desktop/src/renderer/pages/ModelDetailPage.tsx`, including:
  - probe button beside connectivity actions
  - recommended route hint
  - available-route-only selector
  - detail toggle panel
  - save-time auto-probe fallback
- 2026-04-11: Added list-page completion polish:
  - save now returns to `/settings/models`
  - `desktop/src/renderer/pages/ModelsPage.tsx` shows the saved route badge
  - save success notice is surfaced on the models list page
- 2026-04-11: Added settings-page consistency polish:
  - `desktop/src/renderer/pages/SettingsPage.tsx` model cards now show the saved route badge too
  - `ModelDetailPage` save/back/delete now return to `/settings` model tab instead of the standalone models route
  - `SettingsPage` consumes `modelConfigNotice` from navigation state and renders the save success notice inline
- 2026-04-11: Fixed high-priority follow-up issues:
  - route decisions now invalidate when key connection fields change
  - saved route is preserved across re-probe when still available
  - BR MiniMax managed writes preserve `protocolTarget`
  - route probing now carries safe `requestBody` overrides and fallback recommendation behavior is covered
  - auto-probe failure / empty-route failure paths are now covered
  - route detail button expanded-state behavior is now covered
  - same-session navigation between model detail routes now has regression protection
  - manual custom gateways now probe all project-supported routes (`openai-responses` / `anthropic-messages` / `openai-chat-compatible`)
- 2026-04-11: Added regression tests:
  - `desktop/tests/model-detail-route-probe.test.ts`
  - `desktop/tests/model-route-probe-ipc.test.ts`
  - `desktop/tests/models-page-route-badge.test.ts`
  - `desktop/tests/settings-page-route-badge.test.ts`
  - `desktop/tests/br-minimax-managed-write.test.ts` extended with `protocolTarget` persistence coverage

## Verification Evidence

- `npx vitest run tests/model-detail-route-probe.test.ts`
- `npx vitest run tests/model-detail-route-probe.test.ts tests/model-route-probe-ipc.test.ts tests/model-detail-br-minimax-diagnostics.test.tsx`
- `npx vitest run tests/model-detail-route-probe.test.ts tests/models-page-route-badge.test.ts`
- `npx vitest run tests/model-detail-route-probe.test.ts tests/model-route-probe-ipc.test.ts tests/models-page-route-badge.test.ts tests/settings-page-route-badge.test.ts`
- `npx vitest run tests/model-detail-route-probe.test.ts tests/br-minimax-managed-write.test.ts tests/model-route-probe-ipc.test.ts`
- `npx vitest run tests/model-detail-route-probe.test.ts tests/model-route-probe-ipc.test.ts tests/models-page-route-badge.test.ts tests/settings-page-route-badge.test.ts tests/br-minimax-managed-write.test.ts`
- `npm run typecheck`
- `npm run lint`

Result:
- Route probe UI tests passed
- Route probe IPC tests passed
- Typecheck passed
- Lint completed with pre-existing renderer hook warnings only; no new lint errors introduced by this feature
