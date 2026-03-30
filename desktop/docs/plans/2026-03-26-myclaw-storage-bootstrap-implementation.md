# MyClaw Home Directory Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor desktop runtime so all user-private application data is stored under `~/.myClaw`, including runtime state, `skills`, `sessions` conversations, workflows, memory, pending work, logs, and publish drafts, with no runtime dependency on repo-local development folders.

**Architecture:** Replace the current mixed persistence model with one fixed application home root: `~/.myClaw`. `workspaceRoot` remains only for user-attached project execution and tool sandboxing. Introduce a single layout resolver for `.myClaw` plus explicit child folders such as `skills/`, `sessions/`, `workflows/`, and `logs/`. Move session persistence out of the single runtime DB into dedicated per-session folders. Treat repo-local `desktop/apps/runtime/skills` only as a development seed source or packaged resource seed, never as the runtime source of truth after first boot.

**Tech Stack:** Node runtime service, Vue 3, Pinia, Vitest, Tauri desktop shell, file-system persistence under user home, existing runtime HTTP bootstrap flow

---

## Product Rules Locked By This Plan

- The one true application-private root is `~/.myClaw`.
- No app-private runtime data may be stored under the executable directory.
- No app-private runtime data may depend on the repo working tree existing on the target machine.
- `workspaceRoot` is not a data root. It is only an execution or attached-project root.
- `skills` must resolve from `~/.myClaw/skills`.
- `sessions` must live under `~/.myClaw/sessions` with one folder per session.
- Folder count is not a concern. Clear separation is preferred over collapsing everything into one DB file.

## Target Directory Layout

```text
~/.myClaw/
  runtime/
    state.db
    settings.json
  skills/
    code-review/
      SKILL.md
      run.ps1
  sessions/
    session-default/
      session.json
      messages.json
  workflows/
    roots/
      personal/
        <workflow-id>/
          definition.json
    runs/
  memory/
  pending-work/
  publish-drafts/
  logs/
  cache/
```

## Current Problems To Remove

- `apps/runtime/src/store/runtime-state-store.ts` currently defaults to `.openclaw-desktop`, which does not match the desired `~/.myClaw` root.
- `apps/runtime/src/server.ts` currently derives `skillsRootPath` from `workspaceRoot`, which makes packaged app usage depend on a repo or working directory.
- Session messages are currently persisted inside the central runtime state store, which makes conversation data harder to inspect and manage as independent session artifacts.
- Development `skills` under `desktop/apps/runtime/skills` are too close to being treated like runtime storage, which breaks end-user expectations on a machine without the repo.

## Required Behavioral Outcome

- A packaged app sent to another person must boot cleanly on a machine with no repo checkout.
- On first launch, the app auto-creates `~/.myClaw` and required subfolders.
- Starter or built-in `skills` are copied or seeded into `~/.myClaw/skills` on first launch.
- Session creation immediately creates a folder under `~/.myClaw/sessions/<session-id>/`.
- Runtime bootstrap reports paths from `~/.myClaw`, not repo-local paths.

## Subagent-Optimized Execution Strategy

This plan is meant for efficient subagent execution, not sequential implementation.

### Hotspot Ownership Rules

- `apps/runtime/src/server.ts` has one owner only: the main integration agent.
- `apps/desktop/src/stores/workspace.ts` has one owner only: the desktop integration agent.
- `apps/desktop/src/views/SettingsView.vue` has one owner only: the desktop UI agent.
- Helper modules, storage services, and focused test files may be parallelized.
- No two subagents should edit the same hotspot file in the same wave.

### Wave 0: Main agent prep

- Read the whole plan once.
- Create task tickets with explicit ownership and write scopes.
- Lock hotspot ownership before spawning anyone.
- Prepare shared assumptions for `.myClaw` layout so workers do not invent their own variants.

### Wave 1: Parallel helper work only

- **Worker A: Core `.myClaw` layout**
  - **Write scope:** `apps/runtime/src/services/myclaw-layout.ts`, `apps/runtime/src/services/runtime-layout.ts`, `apps/runtime/src/store/runtime-state-store.ts`, `apps/runtime/src/store/runtime-state-store.test.ts`
  - **Output:** canonical path resolver and metadata persistence updated to `.myClaw`

- **Worker B: Session persistence helper**
  - **Write scope:** `apps/runtime/src/store/session-store.ts`, `apps/runtime/src/services/session-persistence.ts`, session-focused tests
  - **Output:** file-based session persistence helpers under `.myClaw/sessions`

- **Worker C: Skills storage and seed helper**
  - **Write scope:** `apps/runtime/src/services/skill-manager.ts`, skill-focused tests, any seed helper modules
  - **Output:** `.myClaw/skills` resolution plus first-run seeding behavior

- **Worker D: Desktop contract preparation**
  - **Write scope:** `apps/desktop/src/services/runtime-client.ts`, `apps/desktop/src/test-utils/workspace-fixture.ts`, storage-related desktop types/tests
  - **Output:** client-side payload types ready for `.myClaw` bootstrap fields

### Wave 2: Main runtime integration

- **Owner:** Main agent only
- **Write scope:** `apps/runtime/src/server.ts`, `apps/runtime/src/routes.ts`, shared runtime integration tests
- **Reason:** `server.ts` is the highest-conflict file and should be wired once after helper branches are ready.
- **Work:** connect layout, session persistence, skill manager, bootstrap payload, and packaged-user assumptions.

### Wave 3: Desktop integration and UI

- **Worker E: Desktop store integration**
  - **Write scope:** `apps/desktop/src/stores/workspace.ts`, desktop store tests
  - **Depends on:** Wave 2 contracts merged

- **Worker F: Settings and visibility**
  - **Write scope:** `apps/desktop/src/views/SettingsView.vue`, `apps/desktop/src/tests/views/SettingsView.test.ts`
  - **Depends on:** Wave 2 contracts merged

- **Constraint:** Worker E and Worker F must not both edit `workspace.ts` or `SettingsView.vue`.

### Wave 4: Packaging and final verification

- **Owner:** Main agent
- **Write scope:** `apps/desktop/src-tauri/src/runtime_supervisor.rs`, packaging glue if needed, docs, full verification
- **Reason:** packaged-mode validation and final path guarantees need one owner and one integration pass.

### Why This Is Faster

- Helpers are parallelized where write scopes are naturally disjoint.
- Hotspot files are serialized on purpose, which avoids expensive merge repair.
- Runtime and desktop each get one integration pass instead of repeated rebases across subagents.
- Tests are grouped by ownership so each worker can verify locally before handoff.

## Guardrails

- Do not reintroduce a configurable data root in this refactor.
- Do not keep `skills` under `workspaceRoot` as a fallback after the refactor is complete.
- Do not keep session messages only inside the central runtime DB.
- Do not silently read from repo-local `desktop/apps/runtime/skills` in packaged-user mode.
- Keep changes minimal outside storage, bootstrap, and visibility paths.

### Task 1: Create a canonical `.myClaw` layout resolver

**Files:**
- Create: `apps/runtime/src/services/myclaw-layout.ts`
- Modify: `apps/runtime/src/services/runtime-layout.ts`
- Modify: `apps/runtime/src/store/runtime-state-store.ts`
- Modify: `apps/runtime/src/store/runtime-state-store.test.ts`

**Steps:**
1. Write failing tests for a canonical home root resolved as `join(homedir(), ".myClaw")`.
2. Define one layout service that returns exact directories for:
   - `rootDir`
   - `runtimeDir`
   - `runtimeStateFilePath`
   - `skillsDir`
   - `sessionsDir`
   - `workflowsDir`
   - `workflowRootsDir`
   - `workflowRunsDir`
   - `memoryDir`
   - `pendingWorkDir`
   - `publishDraftsDir`
   - `logsDir`
   - `cacheDir`
3. Replace old `.openclaw-desktop` path derivation with `.myClaw`.
4. Ensure layout helpers create parent directories lazily and predictably.
5. Run `pnpm --dir apps/runtime test -- src/store/runtime-state-store.test.ts`.

### Task 2: Shrink the central runtime DB to app-level metadata only

**Files:**
- Modify: `apps/runtime/src/store/runtime-state-store.ts`
- Modify: `apps/runtime/src/store/session-store.ts`
- Modify: session-related runtime tests that currently assume sessions live in the DB

**Steps:**
1. Write failing tests proving sessions are no longer sourced solely from the central runtime DB.
2. Keep the DB for app-level metadata such as:
   - model profiles
   - approvals
   - MCP configs
   - lightweight indexes if still needed
3. Remove session message persistence responsibility from the central runtime-state save path.
4. Add or adapt helpers so session state is loaded from `.myClaw/sessions`.
5. Run targeted runtime tests for session creation, deletion, and restart persistence.

### Task 3: Persist each session under `~/.myClaw/sessions/<session-id>/`

**Files:**
- Modify: `apps/runtime/src/store/session-store.ts`
- Modify: `apps/runtime/src/server.ts`
- Modify: `apps/runtime/src/server.test.ts`
- Optionally create: `apps/runtime/src/services/session-persistence.ts`

**Steps:**
1. Write failing tests for:
   - session folder creation on new session
   - messages written under the session folder
   - restart reload from session folders
   - session deletion removing its folder
2. Choose and implement a minimal per-session format:
   - `session.json` for metadata
   - `messages.json` for ordered messages
3. Ensure `session-default` is also materialized under `.myClaw/sessions/session-default/`.
4. Update bootstrap loading to scan `.myClaw/sessions` and rebuild the in-memory session list.
5. Run `pnpm --dir apps/runtime test -- src/server.test.ts`.

### Task 4: Move `skills` to `~/.myClaw/skills`

**Files:**
- Modify: `apps/runtime/src/services/skill-manager.ts`
- Modify: `apps/runtime/src/server.ts`
- Modify: `apps/runtime/src/services/skill-manager.test.ts`
- Modify: `apps/runtime/src/server.test.ts`

**Steps:**
1. Write failing tests proving bootstrap `skills.items[*].path` resolves under `.myClaw/skills`.
2. Remove the default `join(workspaceRoot, "skills")` behavior from runtime startup.
3. Derive the runtime `skills` root from the canonical `.myClaw` layout.
4. Ensure skill detail loading, listing, import, and execution all use the `.myClaw` path.
5. Run `pnpm --dir apps/runtime test -- src/services/skill-manager.test.ts src/server.test.ts`.

### Task 5: Seed built-in skills into `.myClaw/skills` on first launch

**Files:**
- Modify: `apps/runtime/src/services/skill-manager.ts`
- Inspect or modify: `desktop/apps/runtime/skills/code-review/*`
- If needed, modify: packaged resource wiring in desktop shell or runtime bundle
- Add tests covering first-run seeding

**Steps:**
1. Write failing tests for first-run starter-skill seeding into `.myClaw/skills`.
2. Define a seed source strategy:
   - development mode may seed from repo-local `apps/runtime/skills`
   - packaged mode must seed from packaged resources or bundled assets
3. Copy seed skills only when the target skill folder does not already exist.
4. Ensure seeded files are UTF-8 and readable after copy.
5. Run targeted runtime skill tests.

### Task 6: Keep `workspaceRoot` only for user project execution

**Files:**
- Modify: `apps/runtime/src/server.ts`
- Modify: `apps/runtime/src/services/directory-service.ts`
- Modify: `apps/runtime/src/services/tool-executor.ts`
- Modify relevant runtime tests

**Steps:**
1. Write failing tests proving `workspaceRoot` still controls shell `cwd` and attached-directory file access.
2. Confirm no app-private path derives from `workspaceRoot` anymore.
3. Keep `DirectoryService` and shell execution semantics intact for attached projects.
4. Run targeted tool-execution tests.

### Task 7: Surface `.myClaw` paths in bootstrap and Settings

**Files:**
- Modify: `apps/runtime/src/routes.ts`
- Modify: `apps/runtime/src/server.ts`
- Modify: `apps/desktop/src/services/runtime-client.ts`
- Modify: `apps/desktop/src/stores/workspace.ts`
- Modify: `apps/desktop/src/views/SettingsView.vue`
- Modify: `apps/desktop/src/tests/views/SettingsView.test.ts`

**Steps:**
1. Add failing tests for bootstrap payloads reporting `.myClaw` paths.
2. Extend bootstrap to expose:
   - `runtimeStateFilePath`
   - `skillsRootPath`
   - `sessionsRootPath`
   - optionally the full `myClawRootPath`
3. Update Settings to show the `.myClaw` root and major child directories.
4. Remove UI assumptions about choosing a different app-private storage root.
5. Run `pnpm --dir apps/desktop test -- SettingsView`.

### Task 8: Replace old naming and compatibility checks

**Files:**
- Modify: `apps/runtime/src/store/runtime-state-store.test.ts`
- Modify: `apps/runtime/src/server.test.ts`
- Modify: `apps/desktop/src/tests/views/SettingsView.test.ts`
- Modify: `apps/desktop/src/test-utils/workspace-fixture.ts`
- Inspect: docs or tests that still teach `.openclaw-desktop`

**Steps:**
1. Replace fresh-install assertions that still expect `.openclaw-desktop`.
2. Decide whether old `.openclaw-desktop` data should be migrated or explicitly ignored in this refactor.
3. If migration is included, add narrow compatibility tests.
4. Update fixtures to use `.myClaw` paths.
5. Run targeted tests for bootstrap and Settings.

### Task 9: Verify packaged-app assumptions

**Files:**
- Modify only files touched by packaging-related fixes
- Inspect: `apps/desktop/src-tauri/src/runtime_supervisor.rs`
- Inspect: packaged runtime startup assumptions

**Steps:**
1. Verify that sending the packaged app to another machine does not require the repo tree.
2. Ensure runtime startup no longer expects repo-local `skills` or other storage folders.
3. If necessary, add seed-resource or bundle-copy logic for packaged mode.
4. Add or adapt tests around packaged assumptions where feasible.

### Task 10: Full verification and mojibake gate

**Files:**
- Inspect only touched files from Tasks 1-9

**Steps:**
1. Run `pnpm --dir packages/shared build`.
2. Run `pnpm --dir apps/runtime test`.
3. Run `pnpm --dir apps/runtime build`.
4. Run `pnpm --dir apps/desktop test`.
5. Run `pnpm --dir apps/desktop build`.
6. Run the mojibake gate against touched runtime and desktop files.
7. Re-open touched Chinese files and confirm UTF-8 readability.
8. Manually verify:
   - first launch creates `~/.myClaw`
   - starter skills appear under `~/.myClaw/skills`
   - session creation creates a folder under `~/.myClaw/sessions`
   - restart reloads sessions from disk
   - workflow and memory paths resolve under `~/.myClaw`
   - no runtime bootstrap path points into the repo

## Suggested Subagent Dispatch

1. **Subagent A: Layout worker**
   - Owns Task 1 and the `.myClaw` portions of Task 8.
   - Must not edit `apps/runtime/src/server.ts`.

2. **Subagent B: Session worker**
   - Owns Tasks 2 and 3.
   - Must not edit `apps/runtime/src/services/skill-manager.ts`.

3. **Subagent C: Skills worker**
   - Owns Tasks 4 and 5.
   - Must not edit session persistence files.

4. **Subagent D: Desktop contract worker**
   - Owns desktop type scaffolding for Task 7.
   - Must not edit `apps/desktop/src/views/SettingsView.vue`.

5. **Main runtime integration agent**
   - Sole owner of `apps/runtime/src/server.ts` and `apps/runtime/src/routes.ts`.
   - Integrates outputs from Subagents A, B, and C.

6. **Desktop integration agent**
   - Sole owner of `apps/desktop/src/stores/workspace.ts`.
   - Integrates runtime bootstrap changes into the desktop store.

7. **Desktop UI agent**
   - Sole owner of `apps/desktop/src/views/SettingsView.vue`.
   - Renders `.myClaw` visibility without redefining storage rules.

8. **Main agent**
   - Owns Task 9, Task 10, cross-agent conflict resolution, encoding checks, and final review.

## Notes For Reviewers

- The refactor is only correct if everything user-private now resolves inside `~/.myClaw`.
- `skills` must not come from `workspaceRoot`.
- `sessions` must be inspectable as dedicated folders under `~/.myClaw/sessions`.
- Sending the app to another user must work without any repo checkout or development folders present.
