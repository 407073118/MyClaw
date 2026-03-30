# MCPorter-Backed MCP Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current fake MCP compatibility layer with a real MCP integration that imports Claude/Codex/Cursor configs, supports manual stdio/http server setup, and routes MCP tool calls through OpenClaw's existing approval and execution pipeline.

**Architecture:** OpenClaw remains the application boundary for persistence, approvals, execution intents, chat logs, and UI. MCPorter is integrated only as an import and transport adapter behind a runtime-owned `McpService`, which normalizes server state, discovered tools, and tool invocation results into OpenClaw contracts. MCP management UI is split by responsibility: the MCP page manages servers and connectivity, while the Tools page manages MCP tool policy.

**Tech Stack:** TypeScript, Vue 3, Pinia, Vitest, existing OpenClaw runtime HTTP API, MCPorter-backed adapter layer, stdio/http MCP transports.

**Execution Status:** Tasks 1-7 implemented and verified; Task 8 planned; Task 9 not started.

**Execution Scope:** Phase 1 covered Tasks 1-7 (MCP server management, tool preferences, approvals, manual invocation). The next phase focuses on Task 8 (model exposure) and Task 9 (full verification and cleanup).

---

### Task 1: Expand Shared MCP and Execution Contracts [DONE]

**Files:**
- Modify: `packages/shared/src/contracts/mcp.ts`
- Modify: `packages/shared/src/contracts/approval.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared` build validation via `tsc`

**Step 1: Write the failing contract usage test**

Create a temporary type-level usage in a new runtime or desktop test that expects:
- `McpServerConfig`
- `McpServerState`
- `McpTool`
- `McpToolPreference`
- `ExecutionIntent` fields for `serverId`, `toolName`, and structured `arguments`

Expected failure: TypeScript cannot find the new MCP contract types or intent fields.

**Step 2: Run build to verify it fails**

Run: `pnpm --dir packages/shared build`  
Expected: FAIL with missing type or property errors.

**Step 3: Add minimal shared types**

Implement the new shared types with these responsibilities:
- `McpServerConfig`: persisted server config for stdio/http
- `McpServerState`: runtime-only server health and connection snapshot
- `McpTool`: discovered MCP tool plus schema, risk, and server ownership
- `McpToolPreference`: enable/expose/approval overrides for MCP tools
- Extend `ExecutionIntent` and `ApprovalRequest` payloads to carry MCP context cleanly

Keep the existing exports stable where possible and avoid renaming current public fields unless required.

**Step 4: Run build to verify it passes**

Run: `pnpm --dir packages/shared build`  
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/contracts/mcp.ts packages/shared/src/contracts/approval.ts packages/shared/src/index.ts
git commit -m "feat: expand shared MCP contracts"
```

### Task 2: Persist Real MCP Server Configs and Tool Preferences [DONE]

**Files:**
- Modify: `apps/runtime/src/store/runtime-state-store.ts`
- Modify: `apps/runtime/src/store/runtime-state-store.test.ts`
- Modify: `apps/runtime/src/store/settings-store.ts`
- Modify: `apps/runtime/src/routes.ts`
- Test: `apps/runtime/src/store/runtime-state-store.test.ts`

**Step 1: Write the failing persistence tests**

Add tests that prove runtime state can:
- save and reload `mcpServerConfigs`
- save and reload `mcpToolPreferences`
- avoid treating dynamic MCP runtime status as static config

Expected failure: persisted payload ignores the new fields or corrupts them on reload.

**Step 2: Run the targeted tests to verify they fail**

Run: `pnpm --dir apps/runtime test -- src/store/runtime-state-store.test.ts`  
Expected: FAIL with missing MCP persistence fields.

**Step 3: Implement minimal persistence changes**

Update runtime state serialization and bootstrap payload generation so that:
- static fake `createDefaultMcpServers()` usage is no longer the source of truth
- bootstrap returns persisted server configs plus runtime state placeholders
- defaults remain safe for fresh installs

Do not implement transport logic here; only storage and bootstrap shape.

**Step 4: Run the targeted tests to verify they pass**

Run: `pnpm --dir apps/runtime test -- src/store/runtime-state-store.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/runtime/src/store/runtime-state-store.ts apps/runtime/src/store/runtime-state-store.test.ts apps/runtime/src/store/settings-store.ts apps/runtime/src/routes.ts
git commit -m "feat: persist MCP server configs"
```

### Task 3: Add MCPorter Adapter and Runtime MCP Service [DONE]

**Files:**
- Create: `apps/runtime/src/services/mcporter-adapter.ts`
- Create: `apps/runtime/src/services/mcp-service.ts`
- Modify: `apps/runtime/src/services/mcp-manager.ts`
- Create: `apps/runtime/src/services/mcp-service.test.ts`
- Test: `apps/runtime/src/services/mcp-service.test.ts`

**Step 1: Write the failing service tests**

Add tests for a runtime-facing MCP service that can:
- import external configs into normalized `McpServerConfig`
- initialize stdio and http servers through an adapter
- cache discovered tools
- surface `healthy`, `unknown`, and `error` states
- normalize invocation results and recent errors

Use fake adapter responses. Do not use real MCP servers in this first test.

Expected failure: `McpService` does not exist or does not return the expected normalized shape.

**Step 2: Run the targeted tests to verify they fail**

Run: `pnpm --dir apps/runtime test -- src/services/mcp-service.test.ts`  
Expected: FAIL with missing module or missing methods.

**Step 3: Implement the adapter boundary and service**

Implement:
- `MCPorterAdapter` interface wrapper for import/connect/list/invoke
- `McpService` that owns runtime state, health snapshots, tool discovery, and recent errors
- a thin `mcp-manager.ts` that becomes a delegating facade or is removed in favor of the new service

The service API should at minimum support:
- `listServers()`
- `importServers(...)`
- `saveServer(...)`
- `refreshServer(serverId)`
- `listTools()`
- `invoke(serverId, toolName, args)`

**Step 4: Run the targeted tests to verify they pass**

Run: `pnpm --dir apps/runtime test -- src/services/mcp-service.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/runtime/src/services/mcporter-adapter.ts apps/runtime/src/services/mcp-service.ts apps/runtime/src/services/mcp-manager.ts apps/runtime/src/services/mcp-service.test.ts
git commit -m "feat: add MCP runtime service"
```

### Task 4: Expose MCP Import and Management APIs [DONE]

**Files:**
- Modify: `apps/runtime/src/server.ts`
- Modify: `apps/runtime/src/server.test.ts`
- Modify: `apps/desktop/src/services/runtime-client.ts`
- Modify: `apps/desktop/src/stores/workspace.ts`
- Test: `apps/runtime/src/server.test.ts`

**Step 1: Write the failing API tests**

Add runtime API tests for:
- importing MCP configs from supported sources
- creating/editing/deleting MCP servers manually
- refreshing one server
- returning normalized server state and discovered tools in bootstrap and MCP-specific endpoints

Expected failure: routes return 404 or bootstrap lacks the new MCP payload.

**Step 2: Run the targeted tests to verify they fail**

Run: `pnpm --dir apps/runtime test -- src/server.test.ts`  
Expected: FAIL on missing MCP endpoints or payload fields.

**Step 3: Implement minimal API surface**

Implement routes such as:
- `GET /api/mcp/servers`
- `POST /api/mcp/import`
- `POST /api/mcp/servers`
- `PUT /api/mcp/servers/:id`
- `DELETE /api/mcp/servers/:id`
- `POST /api/mcp/servers/:id/refresh`

Update desktop runtime client and workspace store to consume these routes without touching chat execution yet.

**Step 4: Run the targeted tests to verify they pass**

Run: `pnpm --dir apps/runtime test -- src/server.test.ts`  
Expected: PASS for the new MCP server management flows.

**Step 5: Commit**

```bash
git add apps/runtime/src/server.ts apps/runtime/src/server.test.ts apps/desktop/src/services/runtime-client.ts apps/desktop/src/stores/workspace.ts
git commit -m "feat: add MCP management APIs"
```

### Task 5: Build MCP Management UI for Import and Manual Server Setup [DONE]

**Files:**
- Modify: `apps/desktop/src/views/McpView.vue`
- Modify: `apps/desktop/src/tests/views/McpView.test.ts`
- Modify: `apps/desktop/src/test-utils/workspace-fixture.ts`
- Test: `apps/desktop/src/tests/views/McpView.test.ts`

**Step 1: Write the failing UI tests**

Add desktop tests that prove the MCP page can:
- render imported and manual servers with real runtime state
- submit a manual stdio server form
- submit a manual http server form
- trigger an import action
- trigger refresh/enable/disable/edit/delete actions
- display recent error and health labels

Expected failure: current MCP page only renders static cards and has no actions.

**Step 2: Run the targeted tests to verify they fail**

Run: `pnpm --dir apps/desktop test -- src/tests/views/McpView.test.ts`  
Expected: FAIL because the page has no forms or management actions.

**Step 3: Implement minimal MCP page interactions**

Implement:
- import actions for Claude/Codex/Cursor
- manual server form with conditional stdio/http fields
- server list actions using the workspace store
- status/error presentation based on runtime state

Do not manage MCP tool approval/exposure on this page; keep that for Tools view.

**Step 4: Run the targeted tests to verify they pass**

Run: `pnpm --dir apps/desktop test -- src/tests/views/McpView.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/views/McpView.vue apps/desktop/src/tests/views/McpView.test.ts apps/desktop/src/test-utils/workspace-fixture.ts
git commit -m "feat: add MCP server management UI"
```

### Task 6: Route MCP Tool Calls Through ExecutionIntent and Approval [DONE]

**Files:**
- Modify: `apps/runtime/src/services/tool-executor.ts`
- Modify: `apps/runtime/src/services/tool-executor.test.ts`
- Modify: `apps/runtime/src/server.ts`
- Modify: `apps/runtime/src/server.approval-resume.test.ts`
- Modify: `apps/runtime/src/server.pending-approval.test.ts`
- Test: `apps/runtime/src/services/tool-executor.test.ts`
- Test: `apps/runtime/src/server.pending-approval.test.ts`
- Test: `apps/runtime/src/server.approval-resume.test.ts`

**Step 1: Write the failing execution tests**

Add tests that prove:
- an MCP tool invocation becomes a real `ExecutionIntent`
- MCP tools use approval policy like builtin tools
- `allow-once`, `allow-session`, and `always-allow-tool` work for MCP tools
- approval resume continues the model conversation after MCP execution

Expected failure: MCP tool calls still hit the old hard-coded compatibility branch or bypass the new MCP service.

**Step 2: Run the targeted tests to verify they fail**

Run: `pnpm --dir apps/runtime test -- src/services/tool-executor.test.ts`  
Run: `pnpm --dir apps/runtime test -- src/server.pending-approval.test.ts`  
Run: `pnpm --dir apps/runtime test -- src/server.approval-resume.test.ts`  
Expected: FAIL on missing MCP execution integration.

**Step 3: Implement minimal execution-path changes**

Replace the current MCP compatibility branch with:
- MCP intent payload mapping that preserves `serverId`, `toolName`, and structured arguments
- approval risk calculation using explicit config or conservative fallback
- delegation to `McpService.invoke(...)`
- normalized `ToolExecutionResult` appended to the session log

Keep builtin tools and skills unchanged.

**Step 4: Run the targeted tests to verify they pass**

Run the three targeted commands again.  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/runtime/src/services/tool-executor.ts apps/runtime/src/services/tool-executor.test.ts apps/runtime/src/server.ts apps/runtime/src/server.pending-approval.test.ts apps/runtime/src/server.approval-resume.test.ts
git commit -m "feat: route MCP tools through approvals"
```

### Task 7: Surface MCP Tools in the Tools Directory [DONE]

**Files:**
- Modify: `apps/desktop/src/views/ToolsView.vue`
- Modify: `apps/desktop/src/tests/views/ToolsView.test.ts`
- Modify: `apps/desktop/src/services/runtime-client.ts`
- Modify: `apps/desktop/src/stores/workspace.ts`
- Test: `apps/desktop/src/tests/views/ToolsView.test.ts`

**Step 1: Write the failing tools-view tests**

Add tests that prove the Tools page can:
- show MCP tools in their own group
- toggle enable/disable
- toggle expose-to-model
- show approval overrides and risk

Expected failure: Tools view only knows builtin tools.

**Step 2: Run the targeted tests to verify they fail**

Run: `pnpm --dir apps/desktop test -- src/tests/views/ToolsView.test.ts`  
Expected: FAIL because MCP tools are absent from the tool directory.

**Step 3: Implement minimal MCP tool management**

Extend the runtime payload and desktop store so MCP tool preferences flow into the Tools page. Reuse existing toggle behavior and approval labels where possible instead of inventing a second UI.

**Step 4: Run the targeted tests to verify they pass**

Run: `pnpm --dir apps/desktop test -- src/tests/views/ToolsView.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/views/ToolsView.vue apps/desktop/src/tests/views/ToolsView.test.ts apps/desktop/src/services/runtime-client.ts apps/desktop/src/stores/workspace.ts
git commit -m "feat: manage MCP tools in tools view"
```

### Task 8: Phase 2 - Expose MCP Tools to the Model [DONE]

**Files:**
- Modify: `apps/runtime/src/services/model-provider.ts`
- Modify: `apps/runtime/src/services/model-provider.test.ts`
- Modify: `apps/runtime/src/server.ts`
- Modify: `apps/runtime/src/server.test.ts`
- Test: `apps/runtime/src/services/model-provider.test.ts`
- Test: `apps/runtime/src/server.test.ts`

**Step 1: Write the failing model-tool tests**

Add tests that prove:
- enabled-and-exposed MCP tools are included in the model tool list
- disabled or hidden MCP tools are excluded
- tool call arguments are mapped back into MCP execution intents

Expected failure: provider tool list contains only builtin tools and skills.

**Step 2: Run the targeted tests to verify they fail**

Run: `pnpm --dir apps/runtime test -- src/services/model-provider.test.ts`  
Run: `pnpm --dir apps/runtime test -- src/server.test.ts`  
Expected: FAIL because MCP tools are not surfaced to the model.

**Step 3: Implement minimal provider and intent integration**

Implement:
- In `model-provider.ts`, extend `buildModelToolDefinitions` to add MCP tools derived from `ResolvedMcpTool`, including only tools with `enabled === true` and `exposedToModel === true`.
- Use a stable naming convention for MCP tools, for example `mcp_${serverId}_${toolName}`, so that `serverId` and `toolName` can be recovered from the model tool name.
- Map `description` from the MCP tool description, and map `parameters` from `tool.inputSchema` (falling back to a conservative `{ type: "object" }` when needed).
- In `server.ts`, extend `createExecutionIntentFromModelToolCall` to detect MCP tool names by prefix, parse `serverId` and `toolName`, and build an `ExecutionIntent` with:
  - `source: "mcp-tool"`
  - `toolId: \`${serverId}:${toolName}\``
  - `label: toolName`
  - a descriptive `detail` string, e.g. `model requested MCP tool ${serverId}/${toolName}`
  - `serverId`, `toolName`, and `arguments` taken from `call.input`.
- Ensure the approval pipeline treats MCP tool intents the same as builtin tool intents.

**Step 4: Run the targeted tests to verify they pass**

Run the two targeted commands again.  
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/runtime/src/services/model-provider.ts apps/runtime/src/services/model-provider.test.ts apps/runtime/src/server.ts apps/runtime/src/server.test.ts
git commit -m "feat: expose MCP tools to model providers"
```

### Task 9: Full Verification and Cleanup [DONE]

**Files:**
- Check: `packages/shared/src/contracts/mcp.ts`
- Check: `apps/runtime/src/services/mcp-service.ts`
- Check: `apps/runtime/src/server.ts`
- Check: `apps/desktop/src/views/McpView.vue`
- Check: `apps/desktop/src/views/ToolsView.vue`

**Step 1: Run focused package verification**

Run:
- `pnpm --dir packages/shared build`
- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/runtime build`
- `pnpm --dir apps/desktop test`
- `pnpm --dir apps/desktop build`

Expected: all commands PASS.  
Status: all listed commands have been executed and are currently passing.

**Step 2: Run mojibake gate on touched files**

Run:
- `rg -n "\\?/h[1-6]>" apps packages docs *.md`
- Run the repository-standard Latin-1 mojibake checks from `AGENTS.md` in a UTF-8-capable terminal.
- Run the repository-standard Unicode mojibake gate from `AGENTS.md` in a UTF-8-capable terminal for replacement-character checks.

Expected: no new hits in modified files.  
Status: mojibake checks have been run against the newly modified runtime/server, model-provider, and this plan file with no hits.

**Step 3: Manual regression checklist**

Verify manually:
- import a Claude/Codex/Cursor MCP config
- create one stdio MCP server manually
- create one http MCP server manually
- refresh server state
- run one MCP tool through approval flow
- confirm tool output appears in chat
- confirm tool policy appears in Tools page

**Step 4: Commit (out of scope for this workspace copy)**

## Notes for Execution

- Use `@superpowers:executing-plans` to implement this plan in order.
- Tasks 1-7 are complete; MCP server management, tool preferences, approvals, and manual MCP invocation are wired end-to-end.
- The next phase is Task 8, exposing MCP tools to the model and mapping model tool calls into MCP execution intents, followed by Task 9 for full verification.
- Do not use git worktrees for this repository; work directly in the current workspace as requested.
- Keep the legacy `/mcp read_file/write_file/list_files` compatibility behavior only as a short-lived shim while Task 8 is under development; prefer real MCP tools for new flows.
