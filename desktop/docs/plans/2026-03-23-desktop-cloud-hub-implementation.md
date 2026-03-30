# Desktop Cloud Hub Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a cloud-backed Hub page to the desktop app that browses cloud Skills and MCP items, then imports selected items into local Skills or MCP configuration without requiring login.

**Architecture:** Keep cloud and local concepts separate. The desktop app will add a new `Hub` route and a cloud client that reads the same hub data shape used by `cloud-web`. Local MCP import will map cloud manifests into existing runtime MCP APIs, while local Skill import will use a new runtime endpoint that downloads and extracts a cloud zip into the runtime skills directory.

**Tech Stack:** Vue 3, Vue Router, Pinia, Vite, Node runtime HTTP server, TypeScript

---

### Task 1: Lock the desktop Hub shell with failing tests

**Files:**
- Modify: `apps/desktop/src/tests/views/AppShell.test.ts`
- Create: `apps/desktop/src/tests/views/HubView.test.ts`

**Step 1: Write the failing test**

Add assertions for:
- a new sidebar `Hub` entry
- a `/hub` route rendered inside the desktop shell
- top-level `Skills` and `MCP` filters inside the Hub page
- action buttons for viewing details and importing locally

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test`
Expected: FAIL because the route, nav entry, and view do not exist yet.

**Step 3: Write minimal implementation**

Add the route, sidebar link, and a placeholder `HubView.vue` with the expected markers.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test`
Expected: PASS for the new Hub shell assertions.

### Task 2: Add desktop cloud Hub data access

**Files:**
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/src/services/cloud-hub-client.ts`
- Modify: `apps/desktop/src/stores/workspace.ts`
- Modify: `apps/desktop/src/test-utils/workspace-fixture.ts`

**Step 1: Write the failing test**

Extend `HubView.test.ts` to require:
- cloud item loading
- switching between cloud `skill` and `mcp`
- selecting an item and loading its detail plus manifest

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test`
Expected: FAIL because no cloud client or store state exists.

**Step 3: Write minimal implementation**

Add:
- a small cloud client with default base URL behavior
- store state and actions for cloud items/details/manifests
- fixture data for cloud skills and MCP connectors

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test`
Expected: PASS for data loading and selection flows.

### Task 3: Support local import targets for cloud items

**Files:**
- Create: `apps/runtime/src/services/skill-manager.test.ts`
- Modify: `apps/runtime/src/services/skill-manager.ts`
- Modify: `apps/runtime/src/server.ts`
- Modify: `apps/desktop/src/services/runtime-client.ts`
- Modify: `apps/desktop/src/stores/workspace.ts`
- Modify: `apps/desktop/src/views/HubView.vue`
- Modify: `apps/desktop/src/tests/views/HubView.test.ts`

**Step 1: Write the failing test**

Add assertions for:
- importing a cloud MCP item creates a local MCP server through existing runtime APIs
- importing a cloud Skill triggers a runtime endpoint and updates local skills
- Skill installation extracts the downloaded zip into the runtime skills root

**Step 2: Run test to verify it fails**

Run:
- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/desktop test`

Expected: FAIL because the runtime import endpoint and desktop import actions do not exist.

**Step 3: Write minimal implementation**

Add:
- `SkillManager` helper to install a zip archive into a named skill directory
- runtime endpoint for cloud skill import
- desktop store actions for `importCloudSkill` and `importCloudMcp`
- Hub view action buttons wired to those flows

**Step 4: Run test to verify it passes**

Run:
- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/desktop test`

Expected: PASS.

### Task 4: Verify builds and text safety

**Files:**
- Verify: `apps/desktop/**/*`
- Verify: `apps/runtime/**/*`

**Step 1: Run targeted verification**

Run:
- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/desktop test`
- `pnpm --dir apps/desktop build`

Expected: PASS.

**Step 2: Run garble scan**

Run:
- `rg -n "�|锟|Ã|Ð|\\?/h[1-6]>" apps/desktop apps/runtime docs *.md`

Expected: no matches in files modified for this task.
