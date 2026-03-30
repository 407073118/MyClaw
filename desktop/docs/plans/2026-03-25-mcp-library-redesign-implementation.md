# MCP Library Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the desktop MCP management experience into a card-based library plus expandable detail pages while keeping the existing MCP runtime APIs and invocation pipeline working.

**Architecture:** Keep the current `workspace` MCP actions, runtime HTTP endpoints, and `McpService` unchanged. Replace the current single `McpView` "list + always-on form" page with a library page, a detail page, and a reusable form component that only activates in edit mode. Reuse the workflow library page structure for top-level layout and action placement, and introduce MCP-specific presentation components instead of overloading workflow or skills components.

**Tech Stack:** Vue 3, Vue Router, Pinia, Vitest, existing desktop runtime client, existing MCP shared contracts

---

## Parallel Execution Strategy

### Wave 1: Foundation

- **Owner: Main agent or Worker A**
- **Write scope:** `apps/desktop/src/router/index.ts`, `apps/desktop/src/layouts/AppShell.vue`, `apps/desktop/src/tests/views/AppShell.test.ts`
- **Reason:** Route shape and sidebar active-state logic affect every later MCP page.

### Wave 2: Independent UI tracks

- **Worker B: MCP library page**
  - **Write scope:** `apps/desktop/src/views/McpView.vue`, `apps/desktop/src/components/mcp/McpLibraryCard.vue`, `apps/desktop/src/tests/views/McpView.test.ts`
- **Worker C: MCP detail page**
  - **Write scope:** `apps/desktop/src/views/McpDetailView.vue`, `apps/desktop/src/tests/views/McpDetailView.test.ts`
- **Constraint:** Both workers must treat `workspace` MCP actions and runtime client APIs as fixed inputs.

### Wave 3: Shared edit flow

- **Owner: Worker D after Wave 2 lands**
- **Write scope:** `apps/desktop/src/components/mcp/McpServerForm.vue`, `apps/desktop/src/views/McpDetailView.vue`, `apps/desktop/src/tests/views/McpDetailView.test.ts`
- **Reason:** The reusable form depends on the final detail-page section layout.

### Wave 4: Integration and verification

- **Owner: Main agent**
- **Write scope:** any conflict resolution across Wave 1-3 files, plus verification-only updates
- **Reason:** This wave reconciles route integration, test migration, and mojibake checks.

## Guardrails

- Do not change `apps/desktop/src/stores/workspace.ts` MCP action signatures unless a blocking issue is discovered.
- Do not change `apps/desktop/src/services/runtime-client.ts` MCP request contracts in this redesign.
- Do not change runtime MCP endpoints or `apps/runtime/src/services/mcp-service.ts`.
- Avoid copying existing mojibake Chinese text from touched files; write fresh UTF-8 text and re-open touched files after edits.
- Keep `/mcp` as the stable sidebar entry even after adding `/mcp/new` and `/mcp/:id`.

### Task 1: Add MCP route structure and sidebar compatibility

**Files:**
- Modify: `apps/desktop/src/router/index.ts`
- Modify: `apps/desktop/src/layouts/AppShell.vue`
- Modify: `apps/desktop/src/tests/views/AppShell.test.ts`

**Steps:**
1. Add failing route coverage for `/mcp`, `/mcp/new`, and `/mcp/:id` sidebar activation behavior.
2. Add route entries for the MCP library page, MCP create page, and MCP detail page.
3. Update sidebar active-state logic so all MCP subroutes keep the MCP nav item highlighted.
4. Run `pnpm --dir apps/desktop test -- AppShell`.

### Task 2: Build the card-based MCP library page

**Files:**
- Modify: `apps/desktop/src/views/McpView.vue`
- Create: `apps/desktop/src/components/mcp/McpLibraryCard.vue`
- Modify: `apps/desktop/src/tests/views/McpView.test.ts`

**Steps:**
1. Replace the current always-on form layout with a workflow-style library page shell.
2. Add a primary "New MCP" action styled like the workflow create button and keep import actions as secondary actions.
3. Render MCP servers as cards showing name, health, enabled status, transport, tool count, and recent error or last check.
4. Keep lightweight actions on cards: open detail, refresh, enable or disable.
5. Update tests to assert library rendering, card actions, and navigation entry points.
6. Run `pnpm --dir apps/desktop test -- McpView`.

### Task 3: Add a read-only MCP detail page

**Files:**
- Create: `apps/desktop/src/views/McpDetailView.vue`
- Create: `apps/desktop/src/tests/views/McpDetailView.test.ts`

**Steps:**
1. Add failing tests for loading an MCP server detail page by route id.
2. Build a read-only detail page with sections for overview, connection configuration, tools, and runtime state.
3. Handle missing-server, empty-tools, and recent-error states cleanly.
4. Add top-level actions for back navigation, refresh, enable or disable, and entering edit mode.
5. Run `pnpm --dir apps/desktop test -- McpDetailView`.

### Task 4: Extract reusable MCP form and edit mode

**Files:**
- Create: `apps/desktop/src/components/mcp/McpServerForm.vue`
- Modify: `apps/desktop/src/views/McpDetailView.vue`
- Modify: `apps/desktop/src/tests/views/McpDetailView.test.ts`

**Steps:**
1. Add failing tests for switching from read-only detail to edit mode.
2. Move stdio/http field parsing and validation into a reusable MCP form component.
3. Support both create mode (`/mcp/new`) and edit mode (`/mcp/:id` after clicking Edit).
4. Preserve current create and update behavior by continuing to call `workspace.createMcpServer()` and `workspace.updateMcpServer()`.
5. Keep form errors local to the edit area and return to read-only detail after a successful save.
6. Run `pnpm --dir apps/desktop test -- McpDetailView McpView`.

### Task 5: Migrate MCP tests and remove obsolete page assumptions

**Files:**
- Modify: `apps/desktop/src/tests/views/McpView.test.ts`
- Modify: `apps/desktop/src/test-utils/workspace-fixture.ts`
- Inspect: any MCP-related view tests affected by route changes

**Steps:**
1. Remove test assumptions that MCP create and edit form fields live on the list page.
2. Add fixture coverage for at least one healthy stdio server and one failing HTTP server.
3. Add navigation assertions between library and detail pages.
4. Run `pnpm --dir apps/desktop test -- McpView McpDetailView AppShell`.

### Task 6: Verify, scan for mojibake, and protect MCP invocation flow

**Files:**
- Inspect only touched files from Tasks 1-5

**Steps:**
1. Run `pnpm --dir apps/desktop test`.
2. Run `pnpm --dir apps/desktop build`.
3. Run the mojibake gate against touched desktop files.
4. Re-open all touched MCP files and confirm Chinese text is readable UTF-8.
5. Spot-check that no changes were made to the MCP runtime API or invocation pipeline files.

## Suggested Subagent Dispatch

1. **Subagent A: Route shell and sidebar**
   - Owns Task 1 only.
   - Must not modify MCP view implementation files.

2. **Subagent B: MCP library page**
   - Owns Task 2 only.
   - Must not edit router or detail-page files.

3. **Subagent C: MCP detail read-only page**
   - Owns Task 3 only.
   - Must not edit the library page except for importing the new route target if required by tests.

4. **Subagent D: Shared MCP form and edit mode**
   - Owns Task 4 after Tasks 2 and 3 are merged.
   - Must adapt to existing detail-page structure instead of redesigning the page again.

5. **Main agent**
   - Owns Task 5 and Task 6.
   - Reviews merge conflicts, verification results, and encoding safety.

## Notes for Reviewers

- The redesign is successful only if MCP servers remain manageable through the existing runtime endpoints without changing runtime behavior.
- The list page should become lighter, not more feature-dense.
- The detail page should default to read-only and only reveal editable inputs after an explicit Edit action.
- Route-based MCP navigation must remain intuitive from the left sidebar.
