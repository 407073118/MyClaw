# OpenClaw Desktop V1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a first usable desktop AI workbench with chat, configurable model providers, global MCP management, manually imported Skills, approval-gated execution, and per-session attached local directory access.

**Architecture:** Use `Tauri 2` for the desktop shell and native boundaries, `Vue 3 + TypeScript + Vite` for the workbench UI, and a bundled `Node.js + TypeScript` sidecar as the local orchestration runtime. Persist app state locally and expose all executable capabilities through one approval-aware runtime abstraction.

**Tech Stack:** Tauri 2, Rust, Vue 3, TypeScript, Vite, Pinia, Vue Router, Node.js sidecar, official MCP TypeScript SDK, SQLite, Vitest, Playwright, Cargo test.

---

## Preconditions

This workspace is currently not a git repository and does not yet contain an application scaffold. Before implementation starts:

- initialize git if version control is desired
- create the Tauri + Vue project scaffold
- decide the package manager, recommended: `pnpm`
- confirm the local toolchain: Node.js, Rust, Tauri prerequisites

The tasks below assume implementation will happen in this repository after scaffold creation.

### Task 1: Initialize the repository and scaffold the app

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/runtime/package.json`
- Create: `docs/plans/2026-03-10-openclaw-desktop-v1-design.md`

**Step 1: Create the empty scaffold command checklist**

Write down the exact bootstrap commands in a scratch note:

```text
pnpm create tauri-app
pnpm install
pnpm dev
```

**Step 2: Run scaffold creation**

Run the chosen scaffold command and place the desktop app under `apps/desktop`.

Expected: a runnable Tauri + Vue + TypeScript app exists and `src-tauri` is generated.

**Step 3: Create the sidecar workspace package**

Create `apps/runtime` with:

- `package.json`
- `tsconfig.json`
- `src/index.ts`

Expected: runtime package can build independently.

**Step 4: Add workspace wiring**

Add a root workspace file:

```yaml
packages:
  - apps/*
```

Expected: `pnpm install` links both app packages.

**Step 5: Verify the baseline app runs**

Run: `pnpm --dir apps/desktop tauri dev`

Expected: desktop window opens with the baseline Vue app.

**Step 6: Commit**

If git is initialized:

```bash
git add .
git commit -m "chore: scaffold desktop and runtime workspace"
```

### Task 2: Define shared domain models and event contracts

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/contracts/events.ts`
- Create: `packages/shared/src/contracts/session.ts`
- Create: `packages/shared/src/contracts/model.ts`
- Create: `packages/shared/src/contracts/mcp.ts`
- Create: `packages/shared/src/contracts/skill.ts`
- Create: `packages/shared/src/contracts/approval.ts`
- Test: `packages/shared/src/contracts/contracts.test.ts`

**Step 1: Write the failing contract test**

Create a test that asserts exported contract enums and shapes exist:

```ts
import { EventType, ToolRiskCategory, ScopeKind } from "./events"

it("exports stable core enums", () => {
  expect(EventType.APPROVAL_REQUESTED).toBeDefined()
  expect(ToolRiskCategory.READ).toBeDefined()
  expect(ScopeKind.GLOBAL).toBeDefined()
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/shared test`

Expected: FAIL because files do not exist yet.

**Step 3: Implement the shared contracts**

Define exact domain entities for:

- sessions
- messages
- model profiles
- MCP servers and tools
- Skills and install specs
- approvals
- structured runtime events

Keep the models minimal but leave room for future scope fields.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir packages/shared test`

Expected: PASS

**Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat: add shared app contracts"
```

### Task 3: Build the local persistence layer

**Files:**
- Create: `apps/runtime/src/db/schema.ts`
- Create: `apps/runtime/src/db/client.ts`
- Create: `apps/runtime/src/db/migrations/001_initial.sql`
- Create: `apps/runtime/src/repositories/session-repository.ts`
- Create: `apps/runtime/src/repositories/model-profile-repository.ts`
- Create: `apps/runtime/src/repositories/mcp-repository.ts`
- Create: `apps/runtime/src/repositories/skill-repository.ts`
- Create: `apps/runtime/src/repositories/approval-policy-repository.ts`
- Test: `apps/runtime/src/repositories/repositories.test.ts`

**Step 1: Write the failing repository test**

Create tests that:

- insert a model profile
- create a session
- store an MCP server
- store a Skill record
- load approval policy defaults

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test repositories.test.ts`

Expected: FAIL because no DB layer exists.

**Step 3: Implement the schema and repositories**

Create an initial schema with tables for:

- `sessions`
- `messages`
- `model_profiles`
- `mcp_servers`
- `mcp_tools`
- `skills`
- `approval_policies`
- `tool_call_logs`

Use a local SQLite file under the app data directory.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test repositories.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/runtime
git commit -m "feat: add local persistence layer"
```

### Task 4: Implement the model provider abstraction

**Files:**
- Create: `apps/runtime/src/providers/provider-client.ts`
- Create: `apps/runtime/src/providers/openai-compatible-client.ts`
- Create: `apps/runtime/src/providers/anthropic-client.ts`
- Create: `apps/runtime/src/providers/provider-registry.ts`
- Test: `apps/runtime/src/providers/provider-registry.test.ts`

**Step 1: Write the failing provider test**

Test that a provider registry can:

- register provider profiles
- resolve a provider by profile id
- normalize streaming deltas
- surface tool-call requests in a shared shape

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test provider-registry.test.ts`

Expected: FAIL

**Step 3: Implement the provider abstraction**

Define one interface for:

- send chat request
- stream deltas
- request tool actions
- return final assistant message

Implement the OpenAI-compatible adapter first. Stub the Anthropic adapter if needed, but keep the interface production-ready.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test provider-registry.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/runtime
git commit -m "feat: add model provider abstraction"
```

### Task 5: Implement the MCP manager with manual import

**Files:**
- Create: `apps/runtime/src/mcp/mcp-manager.ts`
- Create: `apps/runtime/src/mcp/importers/cursor-importer.ts`
- Create: `apps/runtime/src/mcp/importers/claude-importer.ts`
- Create: `apps/runtime/src/mcp/importers/codex-importer.ts`
- Create: `apps/runtime/src/mcp/mcp-health.ts`
- Create: `apps/runtime/src/mcp/mcp-tool-cache.ts`
- Test: `apps/runtime/src/mcp/mcp-manager.test.ts`

**Step 1: Write the failing MCP import test**

Test these cases:

- import a valid external config into the app schema
- reject an invalid config
- run an initial health check
- cache discovered tools

Use fixture configs instead of live external clients.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test mcp-manager.test.ts`

Expected: FAIL

**Step 3: Implement the MCP manager**

Use the official TypeScript MCP SDK. Support:

- `stdio`
- remote HTTP transport
- manual import from known config formats
- `list_tools`
- server enable or disable
- health state refresh

Do not implement workspace scoping.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test mcp-manager.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/runtime
git commit -m "feat: add global MCP manager"
```

### Task 6: Implement the Skill import and indexing system

**Files:**
- Create: `apps/runtime/src/skills/skill-parser.ts`
- Create: `apps/runtime/src/skills/skill-manager.ts`
- Create: `apps/runtime/src/skills/skill-eligibility.ts`
- Create: `apps/runtime/src/skills/installers/installer-registry.ts`
- Create: `apps/runtime/src/skills/installers/npm-installer.ts`
- Create: `apps/runtime/src/skills/installers/pip-installer.ts`
- Create: `apps/runtime/src/skills/installers/uv-installer.ts`
- Test: `apps/runtime/src/skills/skill-manager.test.ts`

**Step 1: Write the failing Skill test**

Test that the runtime can:

- import a local Skill folder containing `SKILL.md`
- parse metadata
- detect optional `scripts/`
- mark a Skill as eligible or ineligible
- reject unsupported installer kinds

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test skill-manager.test.ts`

Expected: FAIL

**Step 3: Implement the Skill manager**

Support:

- manual Skill import
- managed storage copy
- metadata parsing
- compact discovery summaries
- whitelist installer parsing
- install status reporting

Do not auto-scan external directories.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test skill-manager.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/runtime
git commit -m "feat: add managed Skills system"
```

### Task 7: Build the unified approval policy engine

**Files:**
- Create: `apps/runtime/src/approvals/policy-engine.ts`
- Create: `apps/runtime/src/approvals/approval-service.ts`
- Create: `apps/runtime/src/approvals/risk-classifier.ts`
- Test: `apps/runtime/src/approvals/policy-engine.test.ts`

**Step 1: Write the failing policy test**

Test rules for:

- auto-allow read-only actions
- require prompt for write actions
- support `allow once`
- support `allow this run`
- persist `always allow this tool`

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test policy-engine.test.ts`

Expected: FAIL

**Step 3: Implement the policy engine**

Make one policy service that evaluates:

- action type
- tool source
- tool identity
- session scope
- global defaults
- session run overrides

Output either:

- immediate approval
- approval request event
- denial

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test policy-engine.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/runtime
git commit -m "feat: add approval policy engine"
```

### Task 8: Implement session-attached local directory tools

**Files:**
- Create: `apps/runtime/src/files/attached-directory-service.ts`
- Create: `apps/runtime/src/files/path-guard.ts`
- Create: `apps/runtime/src/files/file-tools.ts`
- Test: `apps/runtime/src/files/file-tools.test.ts`

**Step 1: Write the failing file tool test**

Test that:

- reads succeed inside the attached root
- writes succeed inside the attached root after approval
- traversal outside the root is rejected
- file listings are normalized

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test file-tools.test.ts`

Expected: FAIL

**Step 3: Implement the file tool service**

Provide tool handlers for:

- list files
- search files
- read file
- write file
- rename file

Use strict root-bound path checks.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test file-tools.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/runtime
git commit -m "feat: add attached directory file tools"
```

### Task 9: Build the runtime event bus and chat orchestration loop

**Files:**
- Create: `apps/runtime/src/events/event-bus.ts`
- Create: `apps/runtime/src/chat/session-runner.ts`
- Create: `apps/runtime/src/chat/prompt-assembler.ts`
- Create: `apps/runtime/src/chat/tool-runtime.ts`
- Test: `apps/runtime/src/chat/session-runner.test.ts`

**Step 1: Write the failing orchestration test**

Test one full mocked flow:

1. user sends a message
2. provider requests a tool
3. approval is required
4. approval is granted
5. tool executes
6. assistant returns final answer

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test session-runner.test.ts`

Expected: FAIL

**Step 3: Implement the orchestration loop**

The session runner must:

- assemble model context
- include Skill discovery summaries
- include enabled MCP tool definitions
- dispatch tool calls
- request approval when needed
- stream events in a stable shape

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test session-runner.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/runtime
git commit -m "feat: add chat orchestration runtime"
```

### Task 10: Add Tauri-to-runtime process supervision

**Files:**
- Modify: `apps/desktop/src-tauri/src/main.rs`
- Create: `apps/desktop/src-tauri/src/runtime_supervisor.rs`
- Test: `apps/desktop/src-tauri/src/runtime_supervisor_test.rs`

**Step 1: Write the failing Rust test**

Test that the runtime supervisor:

- resolves the sidecar path
- starts the sidecar process
- handles already-running state
- reports startup failure clearly

**Step 2: Run test to verify it fails**

Run: `cargo test runtime_supervisor --manifest-path apps/desktop/src-tauri/Cargo.toml`

Expected: FAIL

**Step 3: Implement minimal supervision**

Add a Rust module that:

- launches the sidecar on app startup or first use
- captures its lifecycle
- exposes status to the frontend

Keep the first version simple and reliable.

**Step 4: Run test to verify it passes**

Run: `cargo test runtime_supervisor --manifest-path apps/desktop/src-tauri/Cargo.toml`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri
git commit -m "feat: supervise local runtime sidecar"
```

### Task 11: Build the workbench shell UI

**Files:**
- Create: `apps/desktop/src/layouts/AppShell.vue`
- Create: `apps/desktop/src/router/index.ts`
- Create: `apps/desktop/src/stores/sessionStore.ts`
- Create: `apps/desktop/src/stores/runtimeStore.ts`
- Create: `apps/desktop/src/views/ChatView.vue`
- Create: `apps/desktop/src/views/McpView.vue`
- Create: `apps/desktop/src/views/SkillsView.vue`
- Create: `apps/desktop/src/views/ModelsView.vue`
- Create: `apps/desktop/src/views/SettingsView.vue`
- Test: `apps/desktop/src/views/AppShell.test.ts`

**Step 1: Write the failing UI shell test**

Test that:

- navigation renders
- chat workspace renders
- right panel renders
- route changes switch modules correctly

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test AppShell.test.ts`

Expected: FAIL

**Step 3: Implement the shell**

Build a single-window layout with:

- left navigation
- center content
- right execution panel

Wire state with Pinia.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test AppShell.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src
git commit -m "feat: add desktop workbench shell"
```

### Task 12: Build the chat timeline and composer

**Files:**
- Create: `apps/desktop/src/components/chat/MessageTimeline.vue`
- Create: `apps/desktop/src/components/chat/ComposerBox.vue`
- Create: `apps/desktop/src/components/chat/InlineApprovalCard.vue`
- Create: `apps/desktop/src/components/chat/ToolCallCard.vue`
- Test: `apps/desktop/src/components/chat/InlineApprovalCard.test.ts`

**Step 1: Write the failing chat component test**

Test that:

- streaming messages append correctly
- approval card buttons emit the right action
- tool call cards render status changes

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test InlineApprovalCard.test.ts`

Expected: FAIL

**Step 3: Implement the chat UI**

Build:

- timeline with streaming assistant states
- composer with submit and attachment controls
- inline approval cards with:
  - `Allow once`
  - `Allow this run`
  - `Always allow this tool`
  - `Deny`

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test InlineApprovalCard.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/components/chat
git commit -m "feat: add chat timeline and approval cards"
```

### Task 13: Build the model settings UI

**Files:**
- Create: `apps/desktop/src/components/models/ModelProfileForm.vue`
- Create: `apps/desktop/src/views/ModelsView.vue`
- Test: `apps/desktop/src/components/models/ModelProfileForm.test.ts`

**Step 1: Write the failing model settings test**

Test create, edit, validate, and delete for provider profiles.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test ModelProfileForm.test.ts`

Expected: FAIL

**Step 3: Implement the settings form**

Support fields for:

- profile name
- provider kind
- base URL
- API key/token
- model
- optional headers

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test ModelProfileForm.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/components/models apps/desktop/src/views/ModelsView.vue
git commit -m "feat: add model provider settings UI"
```

### Task 14: Build the MCP manager UI

**Files:**
- Create: `apps/desktop/src/components/mcp/McpImportDialog.vue`
- Create: `apps/desktop/src/components/mcp/McpServerList.vue`
- Create: `apps/desktop/src/views/McpView.vue`
- Test: `apps/desktop/src/components/mcp/McpServerList.test.ts`

**Step 1: Write the failing MCP UI test**

Test:

- import flow entry point
- server list rendering
- enabled toggle
- health status badge
- tool count display

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test McpServerList.test.ts`

Expected: FAIL

**Step 3: Implement the MCP UI**

Include:

- manual import button
- server status cards
- tool count
- enable or disable controls
- last validation state

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test McpServerList.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/components/mcp apps/desktop/src/views/McpView.vue
git commit -m "feat: add MCP management UI"
```

### Task 15: Build the Skill manager UI

**Files:**
- Create: `apps/desktop/src/components/skills/SkillImportDialog.vue`
- Create: `apps/desktop/src/components/skills/SkillList.vue`
- Create: `apps/desktop/src/components/skills/SkillInstallCard.vue`
- Create: `apps/desktop/src/views/SkillsView.vue`
- Test: `apps/desktop/src/components/skills/SkillList.test.ts`

**Step 1: Write the failing Skill UI test**

Test:

- manual import flow
- enable or disable toggle
- eligibility display
- install action state
- unsupported installer warning

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test SkillList.test.ts`

Expected: FAIL

**Step 3: Implement the Skill UI**

Show:

- imported Skill list
- parsed metadata summary
- dependency status
- install action CTA
- script/risk indicators

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test SkillList.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/components/skills apps/desktop/src/views/SkillsView.vue
git commit -m "feat: add Skill management UI"
```

### Task 16: Build the attached-directory UX

**Files:**
- Create: `apps/desktop/src/components/chat/AttachDirectoryButton.vue`
- Create: `apps/desktop/src/components/chat/AttachedDirectoryBadge.vue`
- Test: `apps/desktop/src/components/chat/AttachDirectoryButton.test.ts`

**Step 1: Write the failing directory UX test**

Test:

- attach directory action dispatches correctly
- current attached path is rendered
- detach action clears session state

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test AttachDirectoryButton.test.ts`

Expected: FAIL

**Step 3: Implement the directory UX**

Add controls to:

- choose a local directory
- display the current attached directory
- clear the directory from the current session

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test AttachDirectoryButton.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/components/chat
git commit -m "feat: add attached directory UX"
```

### Task 17: Wire runtime events into the desktop UI

**Files:**
- Create: `apps/desktop/src/services/runtime-client.ts`
- Modify: `apps/desktop/src/stores/sessionStore.ts`
- Modify: `apps/desktop/src/stores/runtimeStore.ts`
- Test: `apps/desktop/src/services/runtime-client.test.ts`

**Step 1: Write the failing event integration test**

Test that:

- runtime events update session state
- approval requests appear in both chat and right panel
- tool completion updates the run log

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test runtime-client.test.ts`

Expected: FAIL

**Step 3: Implement the runtime client**

Connect the UI to the local runtime using one stable transport. Normalize reconnection and runtime-unavailable states.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test runtime-client.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/src
git commit -m "feat: connect UI to local runtime events"
```

### Task 18: Add end-to-end smoke tests for the core flow

**Files:**
- Create: `apps/desktop/e2e/chat-mcp-skill.spec.ts`
- Create: `apps/desktop/e2e/fixtures/mock-runtime.ts`

**Step 1: Write the failing end-to-end test**

Cover one complete smoke path:

1. create a session
2. send a message
3. receive a mocked tool call
4. approve it
5. receive a final assistant response

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test:e2e`

Expected: FAIL

**Step 3: Implement the test harness**

Use a mock runtime or fixture transport so the desktop UI can be tested without real provider or MCP calls.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test:e2e`

Expected: PASS

**Step 5: Commit**

```bash
git add apps/desktop/e2e
git commit -m "test: add desktop core-flow smoke coverage"
```

### Task 19: Package-time verification and release checklist

**Files:**
- Create: `docs/release-checklist.md`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`

**Step 1: Write the failing release checklist item set**

Document required checks for:

- runtime bundling
- app data path creation
- model settings persistence
- MCP import validation
- Skill import validation
- attached-directory guardrails

**Step 2: Run the verification commands**

Run:

```bash
pnpm --dir apps/runtime test
pnpm --dir apps/desktop test
pnpm --dir apps/desktop test:e2e
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --dir apps/desktop tauri build
```

Expected: all checks PASS and a desktop package is produced.

**Step 3: Fix any packaging issues**

Update the Tauri config and sidecar packaging definitions until the app builds cleanly.

**Step 4: Re-run verification**

Run the same commands again.

Expected: PASS

**Step 5: Commit**

```bash
git add docs/release-checklist.md apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json
git commit -m "chore: finalize packaging and release checks"
```
