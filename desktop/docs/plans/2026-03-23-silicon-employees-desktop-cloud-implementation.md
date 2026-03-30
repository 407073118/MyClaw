# Silicon Employees Desktop + Cloud Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add platform-level `Employees` and `Workflows` capabilities to OpenClaw so desktop users can create, activate, run, remember, follow up, publish, and install silicon employees while cloud remains the Hub, release, and install control plane.

**Architecture:** Keep execution local and packaging remote. `apps/runtime` owns live employee instances, workflow definitions, memory, pending work, heartbeat, and run history; `apps/desktop` owns top-level navigation, studios, and publish/install UX; `cloud/` owns package metadata, releases, manifests, and install logs for employee/workflow assets, not live execution state.

**Tech Stack:** Vue 3, Vue Router, Pinia, Node HTTP runtime, SQLite via sql.js, NestJS, Prisma, Nuxt 3, TypeScript

---

## Subagent Waves

**Wave 1: Foundation, sequential**
- Task 1
- Task 2
- Task 3

**Wave 2: Parallel-safe after Task 3**
- Worker A: Task 4
- Worker B: Task 7

**Wave 3: Parallel-safe after Tasks 4 and 7**
- Worker A: Task 5
- Worker B: Task 8

**Wave 4: Integration, sequential**
- Task 6
- Task 9
- Task 10

**Write-scope rule:** do not let two subagents edit the same file set at once. `apps/runtime/**` and `cloud/**` are safe to split after the shared contract checkpoint lands.

### Task 1: Freeze platform taxonomy and top-level navigation

**Files:**
- Create: `packages/shared/src/contracts/employee.ts`
- Create: `packages/shared/src/contracts/workflow.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/contracts/contracts.test.ts`
- Modify: `apps/desktop/src/router/index.ts`
- Modify: `apps/desktop/src/layouts/AppShell.vue`
- Create: `apps/desktop/src/views/EmployeesView.vue`
- Create: `apps/desktop/src/views/WorkflowsView.vue`
- Create: `apps/desktop/src/tests/views/EmployeesView.test.ts`
- Create: `apps/desktop/src/tests/views/WorkflowsView.test.ts`
- Modify: `apps/desktop/src/tests/views/AppShell.test.ts`

**Step 1: Write the failing tests**

Add failing assertions for:
- root shared contracts exporting employee and workflow types
- sidebar entries for `Employees` and `Workflows`
- routes for `/employees` and `/workflows`
- `Employees` and `Workflows` appearing as platform-level peers to `Skills`, `MCP`, and `Hub`

**Step 2: Run tests to verify they fail**

Run:
- `pnpm --dir packages/shared test`
- `pnpm --dir apps/desktop test`

Expected: FAIL because the new contracts, routes, and views do not exist yet.

**Step 3: Write minimal implementation**

Implement:
- minimal contract files for `LocalEmployeeSummary`, `WorkflowDefinitionSummary`, and package/source enums
- desktop router entries and sidebar links
- placeholder `EmployeesView.vue` and `WorkflowsView.vue` with stable test markers

**Step 4: Run tests to verify they pass**

Run:
- `pnpm --dir packages/shared test`
- `pnpm --dir apps/desktop test`

Expected: PASS for the new taxonomy and navigation assertions.

### Task 2: Add runtime persistence and local workspace layout for employees and workflows

**Files:**
- Create: `apps/runtime/src/services/runtime-layout.ts`
- Modify: `apps/runtime/src/store/runtime-state-store.ts`
- Modify: `apps/runtime/src/store/runtime-state-store.test.ts`
- Create: `apps/runtime/src/store/employee-store.ts`
- Create: `apps/runtime/src/store/workflow-store.ts`
- Create: `apps/runtime/src/store/pending-work-store.ts`
- Create: `apps/runtime/src/store/memory-store.ts`

**Step 1: Write the failing tests**

Cover:
- runtime state bootstrap includes empty collections for employees, workflows, pending work, and memory
- new SQLite tables are created and reloaded correctly
- runtime layout resolves local folders for `employees`, `workflows`, `employee-packages`, `memory`, `pending-work`, `runs`, and `publish-drafts`

**Step 2: Run tests to verify they fail**

Run:
- `pnpm --dir apps/runtime test`

Expected: FAIL because runtime state and layout do not yet model the new entities.

**Step 3: Write minimal implementation**

Implement:
- runtime layout helpers rooted under the existing runtime state directory
- new runtime state collections and SQLite schema extensions
- focused store helpers for employee, workflow, memory, and pending-work serialization

**Step 4: Run tests to verify they pass**

Run:
- `pnpm --dir apps/runtime test`

Expected: PASS for new persistence and layout coverage.

### Task 3: Add runtime APIs for employee and workflow libraries

**Files:**
- Modify: `packages/shared/src/contracts/employee.ts`
- Modify: `packages/shared/src/contracts/workflow.ts`
- Modify: `apps/runtime/src/routes.ts`
- Modify: `apps/runtime/src/server.ts`
- Modify: `apps/runtime/src/server.test.ts`
- Create: `apps/runtime/src/server.employees.test.ts`
- Create: `apps/runtime/src/server.workflows.test.ts`

**Step 1: Write the failing tests**

Add API coverage for:
- `GET /api/employees`
- `POST /api/employees`
- `GET /api/employees/:id`
- `PATCH /api/employees/:id`
- `GET /api/workflows`
- `POST /api/workflows`
- `GET /api/workflows/:id`
- `PATCH /api/workflows/:id`
- bootstrap payload surfacing employee/workflow summaries for desktop

**Step 2: Run tests to verify they fail**

Run:
- `pnpm --dir apps/runtime test`

Expected: FAIL because the endpoints and bootstrap shape do not exist.

**Step 3: Write minimal implementation**

Implement:
- runtime route contracts for employee and workflow collections
- bootstrap response extensions for `employees` and `workflows`
- CRUD handlers in `server.ts` backed by the new store helpers

**Step 4: Run tests to verify they pass**

Run:
- `pnpm --dir apps/runtime test`

Expected: PASS for employee/workflow library APIs.

### Task 4: Wire desktop store and library pages to runtime APIs

**Files:**
- Modify: `apps/desktop/src/services/runtime-client.ts`
- Modify: `apps/desktop/src/stores/workspace.ts`
- Modify: `apps/desktop/src/test-utils/workspace-fixture.ts`
- Modify: `apps/desktop/src/views/EmployeesView.vue`
- Modify: `apps/desktop/src/views/WorkflowsView.vue`
- Modify: `apps/desktop/src/tests/views/EmployeesView.test.ts`
- Modify: `apps/desktop/src/tests/views/WorkflowsView.test.ts`

**Suggested owner:** Desktop worker

**Step 1: Write the failing tests**

Add assertions for:
- loading employee and workflow libraries from runtime bootstrap
- creating a new local employee from desktop
- creating a new workflow from desktop
- listing source, status, and summary data in each library page

**Step 2: Run tests to verify they fail**

Run:
- `pnpm --dir apps/desktop test`

Expected: FAIL because runtime client and store actions do not exist.

**Step 3: Write minimal implementation**

Implement:
- runtime client calls for employee/workflow list/create/update
- workspace store state for `employees` and `workflows`
- list views with create actions and test-friendly loading/error states

**Step 4: Run tests to verify they pass**

Run:
- `pnpm --dir apps/desktop test`

Expected: PASS for library loading and creation flows.

### Task 5: Build employee studio and workflow studio shells

**Files:**
- Create: `apps/desktop/src/views/EmployeeStudioView.vue`
- Create: `apps/desktop/src/views/WorkflowStudioView.vue`
- Modify: `apps/desktop/src/router/index.ts`
- Modify: `apps/desktop/src/services/runtime-client.ts`
- Modify: `apps/desktop/src/stores/workspace.ts`
- Create: `apps/desktop/src/tests/views/EmployeeStudioView.test.ts`
- Create: `apps/desktop/src/tests/views/WorkflowStudioView.test.ts`

**Suggested owner:** Desktop worker

**Step 1: Write the failing tests**

Add assertions for:
- opening an employee studio from the employee library
- opening a workflow studio from the workflow library
- editing role card fields, workflow bindings, and basic activation data
- binding a workflow to an employee from the studio

**Step 2: Run tests to verify they fail**

Run:
- `pnpm --dir apps/desktop test`

Expected: FAIL because studio routes and forms do not exist.

**Step 3: Write minimal implementation**

Implement:
- new studio routes
- employee studio sections for role, bindings, SOP summary, memory summary, pending work summary
- workflow studio sections for workflow metadata, nodes summary, default harness summary
- store actions to persist employee/workflow edits via runtime

**Step 4: Run tests to verify they pass**

Run:
- `pnpm --dir apps/desktop test`

Expected: PASS for studio navigation and binding flows.

### Task 6: Implement local runs, memory, pending work, and heartbeat

**Files:**
- Modify: `packages/shared/src/contracts/employee.ts`
- Modify: `packages/shared/src/contracts/workflow.ts`
- Create: `apps/runtime/src/services/employee-runner.ts`
- Create: `apps/runtime/src/services/runtime-heartbeat.ts`
- Create: `apps/runtime/src/services/memory-writer.ts`
- Create: `apps/runtime/src/services/pending-work-manager.ts`
- Modify: `apps/runtime/src/server.ts`
- Create: `apps/runtime/src/server.pending-work.test.ts`
- Create: `apps/runtime/src/services/runtime-heartbeat.test.ts`
- Modify: `apps/runtime/src/store/runtime-state-store.ts`

**Step 1: Write the failing tests**

Cover:
- starting a workflow run for an employee
- writing episodic summaries into memory when required
- creating pending work items with `waiting`, `ready`, `resolved`, and `expired` transitions
- heartbeat only revives eligible pending work items and never loops `running` work

**Step 2: Run tests to verify they fail**

Run:
- `pnpm --dir apps/runtime test`

Expected: FAIL because run, memory, pending work, and heartbeat services do not exist.

**Step 3: Write minimal implementation**

Implement:
- local employee run orchestration
- memory write decision helper
- pending work state machine with `resumePolicy`, freshness, and attempt limits
- heartbeat scanner exposed through runtime internals or a lightweight endpoint for manual triggering in tests

**Step 4: Run tests to verify they pass**

Run:
- `pnpm --dir apps/runtime test`

Expected: PASS for local execution continuity.

### Task 7: Extend cloud shared contracts and Hub API for employee/workflow packages

**Files:**
- Modify: `cloud/packages/shared/src/contracts/hub.ts`
- Create: `cloud/packages/shared/src/contracts/employee-package.ts`
- Modify: `cloud/packages/shared/src/index.ts`
- Modify: `cloud/apps/cloud-api/prisma/schema.prisma`
- Modify: `cloud/apps/cloud-api/src/modules/hub/hub.repository.ts`
- Modify: `cloud/apps/cloud-api/src/modules/hub/prisma-hub.repository.ts`
- Modify: `cloud/apps/cloud-api/src/modules/hub/hub-seed-data.ts`
- Modify: `cloud/apps/cloud-api/src/modules/hub/hub.service.ts`
- Modify: `cloud/apps/cloud-api/src/modules/hub/hub.controller.ts`
- Modify: `cloud/apps/cloud-api/src/modules/hub/hub.service.test.ts`
- Modify: `cloud/apps/cloud-api/src/modules/hub/hub.controller.test.ts`

**Suggested owner:** Cloud API worker

**Step 1: Write the failing tests**

Add coverage for:
- `HubItemType` supporting `employee-package` and `workflow-package`
- manifests for employee and workflow packages
- listing, detail, and manifest retrieval for the new item types
- release publication endpoints for employee/workflow packages

**Step 2: Run tests to verify they fail**

Run:
- `pnpm --dir cloud/packages/shared test`
- `pnpm --dir cloud/apps/cloud-api test`

Expected: FAIL because cloud shared types and Hub API only know `skill` and `mcp`.

**Step 3: Write minimal implementation**

Implement:
- new Hub item type unions and manifest contracts
- Prisma model updates if needed for typed package metadata
- Hub service/controller support for employee/workflow package listing and release publishing
- seed data entries so the desktop Hub can browse example employee/workflow assets immediately

**Step 4: Run tests to verify they pass**

Run:
- `pnpm --dir cloud/packages/shared test`
- `pnpm --dir cloud/apps/cloud-api test`

Expected: PASS for new Hub asset types.

### Task 8: Add desktop Hub install and local publish-draft flow for employee/workflow packages

**Files:**
- Modify: `apps/desktop/src/services/cloud-hub-client.ts`
- Modify: `apps/desktop/src/views/HubView.vue`
- Modify: `apps/desktop/src/stores/workspace.ts`
- Modify: `apps/desktop/src/services/runtime-client.ts`
- Create: `apps/desktop/src/views/PublishDraftView.vue`
- Modify: `apps/desktop/src/router/index.ts`
- Create: `apps/desktop/src/tests/views/PublishDraftView.test.ts`
- Modify: `apps/desktop/src/tests/views/HubView.test.ts`
- Modify: `apps/runtime/src/server.ts`
- Create: `apps/runtime/src/services/publish-draft-manager.ts`
- Create: `apps/runtime/src/services/publish-draft-manager.test.ts`

**Suggested owner:** Cross-surface worker after Task 7

**Step 1: Write the failing tests**

Add coverage for:
- Hub filters showing employees and workflows alongside skills and MCP
- installing an employee package from cloud into the local employee package store
- installing a workflow package from cloud into the local workflow library
- generating a publish draft from a local employee instance without exporting memory, pending work, or run history

**Step 2: Run tests to verify they fail**

Run:
- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/desktop test`

Expected: FAIL because desktop Hub and runtime publish-draft APIs do not support the new assets.

**Step 3: Write minimal implementation**

Implement:
- cloud desktop client unions for new Hub asset kinds
- Hub page tabs or filters for employee/workflow packages
- runtime install endpoints for package activation
- publish-draft generation UI and runtime endpoint

**Step 4: Run tests to verify they pass**

Run:
- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/desktop test`

Expected: PASS for install and publish-draft flows.

### Task 9: Extend cloud web management UI for employee/workflow packages

**Files:**
- Modify: `cloud/apps/cloud-web/pages/hub.vue`
- Modify: `cloud/apps/cloud-web/server/api/hub/items.get.ts`
- Modify: `cloud/apps/cloud-web/server/api/hub/items/[id].get.ts`
- Modify: `cloud/apps/cloud-web/server/api/hub/releases/[releaseId]/manifest.get.ts`
- Create: `cloud/apps/cloud-web/server/api/hub/items/[id]/employee-releases.post.ts`
- Create: `cloud/apps/cloud-web/server/api/hub/items/[id]/workflow-releases.post.ts`
- Create: `cloud/apps/cloud-web/tests/hub-employees.test.ts`

**Step 1: Write the failing tests**

Add coverage for:
- cloud web Hub filters showing employee/workflow packages
- detail pages rendering their manifest metadata
- management actions for uploading new employee/workflow releases

**Step 2: Run tests to verify they fail**

Run:
- `pnpm --dir cloud/apps/cloud-web test`

Expected: FAIL because cloud web still assumes only skills and MCP.

**Step 3: Write minimal implementation**

Implement:
- hub filters and detail rendering for the new package kinds
- server API proxies for new release publication routes
- basic release upload UX reusing the current Hub management surface

**Step 4: Run tests to verify they pass**

Run:
- `pnpm --dir cloud/apps/cloud-web test`

Expected: PASS for cloud web Hub management.

### Task 10: Verification, docs, and encoding safety

**Files:**
- Modify: `README.startup.md`
- Modify: `cloud/README.md`
- Modify: `cloud/docs/project-overview.md`
- Modify: `docs/plans/2026-03-23-silicon-employees-desktop-cloud-implementation.md`

**Step 1: Run project verification**

Run:
- `pnpm --dir packages/shared build`
- `pnpm --dir apps/runtime build`
- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/desktop test`
- `pnpm --dir apps/desktop build`
- `pnpm --dir cloud/packages/shared test`
- `pnpm --dir cloud/apps/cloud-api test`
- `pnpm --dir cloud/apps/cloud-web test`
- `pnpm --dir cloud build`

Expected: PASS, or explicit notes for any environment-specific failures.

**Step 2: Update docs**

Document:
- top-level `Employees` and `Workflows` desktop navigation
- local runtime ownership of instances, memory, pending work, and heartbeat
- cloud ownership of package manifests, releases, and install logs

**Step 3: Run garble scan**

Run:
- `rg -n "�|锟|Ã|Ð|\\?/h[1-6]>" apps packages docs *.md`
- `rg -n "�|锟|Ã|Ð|\\?/h[1-6]>" cloud`

Expected: no matches in modified files.

**Step 4: Commit in reviewable slices**

Suggested commit order:
- `feat: add employee and workflow platform contracts`
- `feat: add local employee and workflow runtime state`
- `feat: add desktop employee and workflow libraries`
- `feat: add local memory pending-work heartbeat flow`
- `feat: extend cloud hub for employee and workflow packages`
- `feat: add employee publish and install flows`

Plan complete and saved to `docs/plans/2026-03-23-silicon-employees-desktop-cloud-implementation.md`. Two execution options:

**1. Subagent-Driven (this session)** - dispatch fresh subagent per task, review between tasks, fastest guided iteration

**2. Parallel Session (separate)** - open a new session with `executing-plans` and implement task-by-task in an isolated flow
