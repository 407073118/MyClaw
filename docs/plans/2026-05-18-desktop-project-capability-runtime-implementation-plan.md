# Desktop Project Capability Runtime Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Desktop project binding so project Skills/MCP are stored locally, shown separately from user-owned capabilities, and merged into a per-run `CapabilityBundle` for the model.

**Architecture:** Cloud exposes a project runtime-context contract with resolved releases and artifact metadata. Desktop persists bound project data in local `sql.js` SQLite, installs project Skills into a project capability cache instead of the global skills directory, and resolves a frozen `CapabilityBundle` for each session run. Renderer shows projects as a first-class sidebar concept while keeping “我的 Skills/MCP” and “项目能力” separated.

**Tech Stack:** TypeScript, Electron IPC, React, Zustand, Vitest, `sql.js`, existing Desktop runtime services, existing Cloud NestJS/Prisma/shared contracts.

---

## Execution Notes

- Execute on the current branch. Do not create a worktree.
- Before editing a file with Chinese text, read the target lines with `Get-Content -Encoding UTF8`, then patch only the necessary lines.
- Every new or changed method must have a concise Chinese comment and meaningful Chinese logs where it performs IO, persistence, sync, security gating, or runtime resolution.
- Do not stage, commit, or rewrite unrelated dirty files unless the user explicitly asks.
- Keep project Skills out of the global skills directory and global skills state.
- Keep project MCP out of global MCP registration unless a later phase explicitly designs that migration.

## Phase 0: Baseline Safety

### Task 0: Confirm Current Branch and Dirty State

**Files:**
- Read only: repository status

**Step 1: Inspect branch and dirty files**

Run:

```powershell
git branch --show-current
git status --short
```

Expected: command succeeds. Record any unrelated dirty files and do not modify them.

**Step 2: Confirm plan and design docs are present**

Run:

```powershell
Test-Path "docs\plans\2026-05-18-desktop-project-capability-runtime-design.md"
Test-Path "docs\plans\2026-05-18-desktop-project-capability-runtime-implementation-plan.md"
```

Expected: both return `True`.

## Phase 1: Cloud Runtime Context Contract

### Task 1: Add Runtime Context Types to Cloud Shared Contracts

**Files:**
- Modify: `cloud/packages/shared/src/contracts/projects.ts`
- Verify: `cloud/packages/shared/src/index.ts`
- Test: `cloud/packages/shared/tests/contracts.test.mjs`

**Step 1: Write the failing contract export test**

Add assertions that import these names from `@myclaw/cloud-shared`:

```ts
ProjectRuntimeContext
ProjectRuntimeSkill
ProjectRuntimeMcp
ProjectRuntimeWarning
```

Run:

```powershell
pnpm --dir cloud test
```

Expected: FAIL because the new runtime context exports do not exist yet.

**Step 2: Add shared types**

In `cloud/packages/shared/src/contracts/projects.ts`, add:

```ts
export type ProjectRuntimeWarning = {
  code: string;
  message: string;
  targetType?: "project" | "skill" | "mcp";
  targetId?: string;
};

export type ProjectRuntimeArtifact = {
  downloadUrl: string;
  sha256: string;
  size: number;
  signature?: string;
};

export type ProjectRuntimeSkill = {
  id: string;
  releaseId: string;
  alias: string | null;
  displayName: string;
  description: string | null;
  defaultEnabled: boolean;
  manifest: unknown;
  artifact: ProjectRuntimeArtifact;
  config: unknown;
};

export type ProjectRuntimeMcp = {
  id: string;
  releaseId: string;
  alias: string | null;
  displayName: string;
  description: string | null;
  defaultEnabled: boolean;
  transport: "stdio" | "sse" | "streamable-http" | "http";
  manifest: unknown;
  artifact: ProjectRuntimeArtifact | null;
  config: unknown;
  runtimePolicy: {
    requiresLocalConfirmation: boolean;
    allowAutoExposeToModel: boolean;
    riskLevel: "low" | "medium" | "high";
  };
};

export type ProjectRuntimeContext = {
  project: {
    id: ProjectId;
    code: string;
    tenantId: string;
    name: string;
    description: string | null;
    version: number;
    etag: string;
    policyEpoch: number;
    expiresAt: string | null;
    revokedAt: string | null;
    deletedAt: string | null;
  };
  skills: ProjectRuntimeSkill[];
  mcps: ProjectRuntimeMcp[];
  warnings: ProjectRuntimeWarning[];
};
```

Keep `http` in the MCP transport union for compatibility with the current Desktop MCP import code, but normalize it later in Desktop project MCP policy.

**Step 3: Run the contract test**

Run:

```powershell
pnpm --dir cloud test
```

Expected: shared contract export failure is fixed. Other unrelated existing failures must be recorded, not hidden.

**Step 4: Commit checkpoint**

If the user wants commits:

```powershell
git add cloud/packages/shared/src/contracts/projects.ts cloud/packages/shared/src/index.ts cloud/packages/shared/tests/contracts.test.mjs
git commit -m "feat(cloud): add project runtime context contract"
```

### Task 2: Expose `GET /api/projects/:id/runtime-context`

**Files:**
- Modify: `cloud/apps/cloud-api/src/modules/projects/controllers/projects.controller.ts`
- Modify: `cloud/apps/cloud-api/src/modules/projects/services/projects.service.ts`
- Modify: `cloud/apps/cloud-api/src/modules/projects/ports/projects.repository.ts`
- Modify: `cloud/apps/cloud-api/src/modules/projects/repositories/prisma-projects.repository.ts`
- Test: `cloud/apps/cloud-api/src/modules/projects/tests/projects.controller.test.ts`
- Test: `cloud/apps/cloud-api/src/modules/projects/tests/projects.service.test.ts`
- Test: `cloud/apps/cloud-api/src/modules/projects/tests/prisma-projects.repository.test.ts`

**Step 1: Write failing controller test**

Add a test that calls `controller.getRuntimeContext("1")` and expects `projectsService.getRuntimeContext(1)` to be called. Also add an invalid ID test that expects the same bad-request behavior used by the existing detail endpoint.

Run:

```powershell
pnpm --dir cloud test -- apps/cloud-api/src/modules/projects/tests/projects.controller.test.ts
```

Expected: FAIL because `getRuntimeContext` does not exist.

**Step 2: Add controller endpoint**

In `ProjectsController`, add:

```ts
/** 查询项目运行上下文，供 Desktop 绑定项目时缓存到本地。 */
@Get(":id/runtime-context")
async getRuntimeContext(@Param("id") id: string): Promise<ProjectRuntimeContext> {
  const projectId = this.parseProjectId(id);
  console.info("[projects-controller] 收到项目运行上下文查询请求", { projectId });
  return this.projectsService.getRuntimeContext(projectId);
}
```

Use the existing private ID parser if present; otherwise reuse the controller’s current parse method.

**Step 3: Write failing service tests**

Add cases for:

- Returns concrete `releaseId` for enabled project Skill ref.
- Returns concrete `releaseId` for enabled project MCP ref.
- Sets `runtimePolicy.requiresLocalConfirmation = true` and `allowAutoExposeToModel = false` for stdio MCP.
- Does not return disabled refs as executable by default; if the project ref is disabled, it can be omitted or returned with a warning. Choose omit for v1.

Run:

```powershell
pnpm --dir cloud test -- apps/cloud-api/src/modules/projects/tests/projects.service.test.ts
```

Expected: FAIL because service and repository methods do not exist.

**Step 4: Add repository method**

Extend `ProjectsRepository`:

```ts
/** 查询项目运行上下文所需的完整项目、Skill release、MCP release 和工件信息。 */
findRuntimeContextById(id: ProjectId): Promise<ProjectRuntimeContext | null>;
```

In `PrismaProjectsRepository`, implement the method by reading the existing project and joined project Skill/MCP refs. The returned context must include:

- project `id`, `code`, `name`, `description`
- `tenantId`: use existing tenant/org field if available; otherwise use `"default"` and add warning `project_tenant_fallback`
- `version`: use project update/version field if available; otherwise derive from `updatedAt.getTime()`
- `etag`: deterministic string from project id plus updatedAt plus refs updatedAt
- `policyEpoch`: `1` for v1
- resolved Skill release id and artifact hash
- resolved MCP release id and risk policy

If Prisma models do not yet store all artifact fields, return a warning and set placeholder-safe fields only for tests that are already supported by the current schema. Do not invent executable download URLs without an artifact source.

**Step 5: Add service method**

In `ProjectsService`, add:

```ts
/** 获取 Desktop 绑定项目时使用的运行上下文快照。 */
async getRuntimeContext(projectId: ProjectId): Promise<ProjectRuntimeContext> {
  console.info("[projects-service] 查询项目运行上下文", { projectId });
  const context = await this.projectsRepository.findRuntimeContextById(projectId);
  if (!context) {
    console.warn("[projects-service] 项目运行上下文不存在", { projectId });
    throw new NotFoundException("Project not found");
  }
  return context;
}
```

**Step 6: Run Cloud project tests**

Run:

```powershell
pnpm --dir cloud test -- apps/cloud-api/src/modules/projects/tests/projects.controller.test.ts apps/cloud-api/src/modules/projects/tests/projects.service.test.ts apps/cloud-api/src/modules/projects/tests/prisma-projects.repository.test.ts
```

Expected: PASS for project runtime context tests.

**Step 7: Commit checkpoint**

```powershell
git add cloud/apps/cloud-api/src/modules/projects cloud/packages/shared/src/contracts/projects.ts
git commit -m "feat(cloud): expose project runtime context"
```

## Phase 2: Desktop Contracts and Local SQLite

### Task 3: Add Desktop Project Capability Contracts

**Files:**
- Create: `desktop/shared/contracts/project-capability.ts`
- Modify: `desktop/shared/contracts/index.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Test: `desktop/tests/project-capability-contracts.test.ts`

**Step 1: Write failing contract tests**

Create `desktop/tests/project-capability-contracts.test.ts` with tests for:

- `ProjectCapabilityLocalState` only accepts `inherit | enabled | disabled | hidden`.
- `ProjectCapabilityKind` only accepts `skill | mcp`.
- `CapabilityBundle.functionNameMap` can map a tool name to a project Skill ref and a global Skill ref.

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-contracts.test.ts
```

Expected: FAIL because the contract file does not exist.

**Step 2: Add contract types**

Create `desktop/shared/contracts/project-capability.ts` with:

```ts
export type ProjectCapabilityKind = "skill" | "mcp";
export type ProjectCapabilityLocalState = "inherit" | "enabled" | "disabled" | "hidden";
export type ProjectCapabilityInstallStatus = "missing" | "installing" | "ready" | "failed" | "revoked";
export type ProjectSyncStatus = "never" | "synced" | "stale" | "failed" | "revoked" | "deleted";

export type CloudProjectBinding = {
  id: string;
  cloudProjectId: string;
  tenantId: string;
  accountId: string;
  code: string;
  name: string;
  description: string | null;
  cloudVersion: number;
  etag: string;
  policyEpoch: number;
  syncedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  deletedAt: string | null;
  lastSyncStatus: ProjectSyncStatus;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectCapabilityRef = {
  id: string;
  localProjectId: string;
  kind: ProjectCapabilityKind;
  cloudCapabilityId: string;
  cloudReleaseId: string | null;
  alias: string | null;
  displayName: string;
  description: string | null;
  defaultEnabled: boolean;
  manifestJson: unknown;
  artifactJson: unknown;
  artifactHash: string | null;
  runtimePolicyJson: unknown;
  cloudConfigJson: unknown;
  syncStatus: ProjectSyncStatus;
  syncWarning: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectCapabilityPref = {
  id: string;
  localProjectId: string;
  capabilityRefId: string;
  localState: ProjectCapabilityLocalState;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string;
};

export type CapabilityInstallation = {
  id: string;
  sourceType: "project_skill" | "project_mcp" | "global_skill" | "global_mcp";
  localProjectId: string | null;
  capabilityRefId: string | null;
  installDir: string | null;
  manifestHash: string | null;
  artifactHash: string | null;
  installedReleaseId: string | null;
  installedAt: string | null;
  verifiedAt: string | null;
  installStatus: ProjectCapabilityInstallStatus;
  lastError: string | null;
};

export type RuntimeCapabilitySource = "global" | "project";

export type RuntimeCapabilityRef = {
  source: RuntimeCapabilitySource;
  kind: ProjectCapabilityKind;
  id: string;
  localProjectId?: string;
  capabilityRefId?: string;
  installDir?: string | null;
  releaseId?: string | null;
};

export type CapabilityBundle = {
  id: string;
  hash: string;
  sessionId: string;
  project: CloudProjectBinding | null;
  skills: RuntimeCapabilityRef[];
  mcpTools: RuntimeCapabilityRef[];
  functionNameMap: Record<string, RuntimeCapabilityRef>;
  createdAt: string;
};
```

Export it from `desktop/shared/contracts/index.ts`.

**Step 3: Extend renderer API type**

In `desktop/src/renderer/types/electron.d.ts`, add project payload types to the top import list and add `projects` APIs under `window.myClawAPI`.

**Step 4: Run contract tests**

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-contracts.test.ts
```

Expected: PASS.

**Step 5: Commit checkpoint**

```powershell
git add desktop/shared/contracts/project-capability.ts desktop/shared/contracts/index.ts desktop/src/renderer/types/electron.d.ts desktop/tests/project-capability-contracts.test.ts
git commit -m "feat(desktop): add project capability contracts"
```

### Task 4: Add Project Capability SQLite Store

**Files:**
- Modify: `desktop/src/main/services/directory-service.ts`
- Create: `desktop/src/main/services/project-capability-database.ts`
- Test: `desktop/tests/project-capability-database.test.ts`

**Step 1: Write failing database tests**

Create tests for:

- Creates all six tables.
- Upserts a bound project.
- Upserts refs without overwriting existing prefs.
- Local `disabled` survives a second sync with Cloud `defaultEnabled = true`.
- Stores and reads `run_capability_snapshots`.

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-database.test.ts
```

Expected: FAIL because the database service does not exist.

**Step 2: Extend `MyClawPaths`**

In `desktop/src/main/services/directory-service.ts`, add:

```ts
/** `<rootDir>/myClaw/project-capabilities` 项目能力缓存目录。 */
projectCapabilitiesDir: string;
/** `<rootDir>/myClaw/project-capabilities.db` 项目能力本地数据库。 */
projectCapabilitiesDbFile: string;
```

When building paths, set:

```ts
projectCapabilitiesDir: join(myClawDir, "project-capabilities"),
projectCapabilitiesDbFile: join(myClawDir, "project-capabilities.db"),
```

Ensure the directory is created with the same mkdir path setup as other root directories.

**Step 3: Implement `ProjectCapabilityDatabase`**

Create a `sql.js` sidecar similar to `SessionDatabase`. Required methods:

- `static create(paths: MyClawPaths): Promise<ProjectCapabilityDatabase>`
- `listProjects(): CloudProjectBinding[]`
- `getProject(id: string): CloudProjectBinding | null`
- `upsertProject(project: CloudProjectBinding): void`
- `upsertCapabilityRefs(projectId: string, refs: ProjectCapabilityRef[]): void`
- `getProjectCapabilityView(projectId: string): { project; refs; prefs; installations }`
- `setCapabilityLocalState(refId: string, state: ProjectCapabilityLocalState, reason?: string): void`
- `upsertInstallation(installation: CapabilityInstallation): void`
- `bindSessionToProject(sessionId: string, localProjectId: string | null): void`
- `getSessionProjectBinding(sessionId: string): string | null`
- `saveRunCapabilitySnapshot(input: { runId; sessionId; localProjectId; bundleHash; bundleJson }): void`

Every public method needs a Chinese comment and logs for writes.

**Step 4: Run database tests**

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-database.test.ts
```

Expected: PASS.

**Step 5: Commit checkpoint**

```powershell
git add desktop/src/main/services/directory-service.ts desktop/src/main/services/project-capability-database.ts desktop/tests/project-capability-database.test.ts
git commit -m "feat(desktop): persist project capabilities locally"
```

### Task 5: Initialize Project Capability Service in Runtime Context

**Files:**
- Create: `desktop/src/main/services/project-capability-service.ts`
- Modify: `desktop/src/main/services/runtime-context.ts`
- Modify: `desktop/src/main/index.ts`
- Test: `desktop/tests/project-capability-service.test.ts`

**Step 1: Write failing service tests**

Test:

- Service lists local projects from DB.
- Service binds a session to a project.
- Service refuses binding a revoked/deleted project.

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-service.test.ts
```

Expected: FAIL because the service does not exist.

**Step 2: Implement service**

`ProjectCapabilityService` wraps `ProjectCapabilityDatabase` and exposes:

- `listProjects()`
- `getProjectDetail(localProjectId)`
- `bindSessionProject(sessionId, localProjectId | null)`
- `setCapabilityLocalState(refId, state)`
- `saveRunCapabilitySnapshot(...)`

Add logs such as:

```ts
console.info("[project-capability-service] 绑定会话项目", { sessionId, localProjectId });
```

**Step 3: Wire runtime context**

Add `projectCapabilities: ProjectCapabilityService` to `RuntimeContext.services`.

In `desktop/src/main/index.ts`, create the DB and service after `paths` are available:

```ts
const projectCapabilityDatabase = await ProjectCapabilityDatabase.create(paths);
const projectCapabilities = new ProjectCapabilityService(projectCapabilityDatabase);
```

Pass it into `createRuntimeContext`.

**Step 4: Run service tests**

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-service.test.ts
```

Expected: PASS.

**Step 5: Commit checkpoint**

```powershell
git add desktop/src/main/services/project-capability-service.ts desktop/src/main/services/runtime-context.ts desktop/src/main/index.ts desktop/tests/project-capability-service.test.ts
git commit -m "feat(desktop): register project capability service"
```

## Phase 3: Desktop Project Sync and IPC

### Task 6: Add Project Binding and Sync IPC

**Files:**
- Create: `desktop/src/main/ipc/projects.ts`
- Modify: `desktop/src/main/ipc/index.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/project-capability-ipc.test.ts`

**Step 1: Write failing IPC tests**

Test handlers for:

- `projects:list-local`
- `projects:get-detail`
- `projects:bind-session`
- `projects:set-capability-state`

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-ipc.test.ts
```

Expected: FAIL because handlers are missing.

**Step 2: Add IPC handlers**

Create handlers:

- `projects:list-local` returns `{ items }`
- `projects:get-detail` returns `{ project, refs, prefs, installations }`
- `projects:bind-session` accepts `{ sessionId, localProjectId }`
- `projects:set-capability-state` accepts `{ capabilityRefId, localState }`

Each handler logs in Chinese and validates required string fields.

**Step 3: Expose preload API**

Add:

```ts
projects: {
  listLocal: () => ipcRenderer.invoke("projects:list-local"),
  getDetail: (localProjectId: string) => ipcRenderer.invoke("projects:get-detail", localProjectId),
  bindSession: (input) => ipcRenderer.invoke("projects:bind-session", input),
  setCapabilityState: (input) => ipcRenderer.invoke("projects:set-capability-state", input),
}
```

Update `electron.d.ts` accordingly.

**Step 4: Add workspace store state**

Add:

- `projects: CloudProjectBinding[]`
- `projectDetails: Record<string, ProjectCapabilityDetail>`
- `currentProjectBinding: CloudProjectBinding | null`
- actions for list, load detail, bind session, set capability state.

Do not merge project Skills into `skills`.

**Step 5: Run IPC tests**

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-ipc.test.ts
```

Expected: PASS.

**Step 6: Commit checkpoint**

```powershell
git add desktop/src/main/ipc/projects.ts desktop/src/main/ipc/index.ts desktop/src/preload/index.ts desktop/src/renderer/types/electron.d.ts desktop/src/renderer/stores/workspace.ts desktop/tests/project-capability-ipc.test.ts
git commit -m "feat(desktop): add project capability IPC"
```

### Task 7: Add Cloud Project Runtime Sync

**Files:**
- Modify: `desktop/src/main/ipc/projects.ts`
- Create: `desktop/src/main/services/project-runtime-context-client.ts`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/project-runtime-context-sync.test.ts`

**Step 1: Write failing sync tests**

Test:

- Binding a Cloud project stores `cloud_projects`, refs, and inherit prefs.
- A second sync updates refs but preserves local disabled prefs.
- Revoked/deleted context marks local project unavailable.

Run:

```powershell
pnpm --dir desktop test -- tests/project-runtime-context-sync.test.ts
```

Expected: FAIL because sync client and handler are missing.

**Step 2: Implement runtime context client**

Create `ProjectRuntimeContextClient` with:

- `fetchRuntimeContext(projectId: string | number, accessToken?: string): Promise<ProjectRuntimeContext>`

Use the same Cloud base URL convention as `desktop/src/main/ipc/cloud.ts`.

**Step 3: Add sync handler**

Add IPC:

- `projects:bind-cloud-project`
- `projects:sync`

Both write to SQLite via `ProjectCapabilityService`. `bind-cloud-project` should bind the current session only when `sessionId` is provided.

**Step 4: Preserve local overrides**

When syncing refs:

- New refs get implicit `inherit`.
- Existing prefs remain untouched.
- Deleted or missing refs become `syncStatus = "deleted"` or `revoked`.

**Step 5: Run sync tests**

Run:

```powershell
pnpm --dir desktop test -- tests/project-runtime-context-sync.test.ts
```

Expected: PASS.

**Step 6: Commit checkpoint**

```powershell
git add desktop/src/main/services/project-runtime-context-client.ts desktop/src/main/ipc/projects.ts desktop/src/renderer/stores/workspace.ts desktop/tests/project-runtime-context-sync.test.ts
git commit -m "feat(desktop): sync cloud project runtime context"
```

## Phase 4: Project Skill Installation

### Task 8: Install Project Skills into Project Cache

**Files:**
- Create: `desktop/src/main/services/project-skill-installer.ts`
- Modify: `desktop/src/main/services/project-capability-service.ts`
- Modify: `desktop/src/main/ipc/projects.ts`
- Test: `desktop/tests/project-skill-installer.test.ts`

**Step 1: Write failing installer tests**

Test:

- Downloads and extracts a Skill into `paths.projectCapabilitiesDir`.
- Rejects archives without `SKILL.md`.
- Verifies artifact hash when provided.
- Does not write to `paths.skillsDir`.
- Writes installation status `ready` or `failed`.

Run:

```powershell
pnpm --dir desktop test -- tests/project-skill-installer.test.ts
```

Expected: FAIL because installer does not exist.

**Step 2: Implement installer**

Create `ProjectSkillInstaller`:

- Constructor takes `MyClawPaths` and `ProjectCapabilityDatabase`.
- `installProjectSkill(project, ref)` downloads artifact, extracts to temp, validates, copies to:

```text
{projectCapabilitiesDir}/{tenantId}/{cloudProjectId}/skills/{cloudCapabilityId}/{cloudReleaseId}
```

- It never calls `ctx.services.refreshSkills()`.
- It writes `capability_installations`.

Use `JSZip` if available in process context, otherwise keep the same extraction strategy as `cloud:import-skill` but scoped to the project cache.

**Step 3: Add IPC trigger**

Add `projects:install-capability` that accepts `{ capabilityRefId }`. For v1 only support Skill refs; MCP refs return a clear error: `Project MCP installation is not supported yet`.

**Step 4: Run installer tests**

Run:

```powershell
pnpm --dir desktop test -- tests/project-skill-installer.test.ts
```

Expected: PASS.

**Step 5: Commit checkpoint**

```powershell
git add desktop/src/main/services/project-skill-installer.ts desktop/src/main/services/project-capability-service.ts desktop/src/main/ipc/projects.ts desktop/tests/project-skill-installer.test.ts
git commit -m "feat(desktop): install project skills into local cache"
```

## Phase 5: Capability Bundle Runtime

### Task 9: Add Capability Bundle Resolver

**Files:**
- Create: `desktop/src/main/services/capability-bundle-resolver.ts`
- Modify: `desktop/src/main/services/runtime-context.ts`
- Test: `desktop/tests/capability-bundle-resolver.test.ts`

**Step 1: Write failing resolver tests**

Test:

- Unbound session returns global enabled Skills only.
- Bound session returns global enabled Skills plus project ready Skills.
- Local disabled project Skill is excluded.
- Missing/failed/revoked installation is excluded.
- Same-name global and project Skills produce distinct function names.
- `functionNameMap` points to the exact project install dir.
- Project MCP is excluded unless locally confirmed and policy allows model exposure.

Run:

```powershell
pnpm --dir desktop test -- tests/capability-bundle-resolver.test.ts
```

Expected: FAIL because resolver does not exist.

**Step 2: Implement resolver**

Create `CapabilityBundleResolver` with:

```ts
/** 解析指定会话本轮运行可见的冻结能力包。 */
resolveForSession(input: {
  sessionId: string;
  globalSkills: SkillDefinition[];
  globalMcpTools: RuntimeResolvedMcpTool[];
}): CapabilityBundle
```

Rules:

- Global Skills use source `global`.
- Project Skills use source `project` and `installDir`.
- `hidden` and `disabled` are excluded.
- `inherit` uses `defaultEnabled`.
- Only `installStatus = "ready"` project Skills are included.
- Tool names are stable and collision-safe.

**Step 3: Generate hash**

Bundle hash must be deterministic from:

- sessionId
- localProjectId
- capability source/kind/id/releaseId/toolName

Do not include timestamps in the hash.

**Step 4: Run resolver tests**

Run:

```powershell
pnpm --dir desktop test -- tests/capability-bundle-resolver.test.ts
```

Expected: PASS.

**Step 5: Commit checkpoint**

```powershell
git add desktop/src/main/services/capability-bundle-resolver.ts desktop/src/main/services/runtime-context.ts desktop/tests/capability-bundle-resolver.test.ts
git commit -m "feat(desktop): resolve per-run capability bundles"
```

### Task 10: Make Tool Schema Generation Bundle-Aware

**Files:**
- Modify: `desktop/src/main/services/tool-schemas.ts`
- Test: `desktop/tests/project-capability-tool-schemas.test.ts`
- Test: `desktop/tests/phase1-skill-tool.test.ts`

**Step 1: Write failing tool schema tests**

Test:

- Bundle-provided project Skill produces the exact function name in `functionNameMap`.
- Same sanitized Skill IDs do not collide.
- Existing global Skill schema behavior remains unchanged when no bundle is supplied.

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-tool-schemas.test.ts tests/phase1-skill-tool.test.ts
```

Expected: FAIL for new bundle-specific behavior.

**Step 2: Add bundle-aware option**

Extend `buildToolSchemas` options with:

```ts
capabilityBundle?: CapabilityBundle;
```

When present:

- Generate Skill tools from bundle function names, not by re-sanitizing `skill.id`.
- Generate project MCP tools only if present in bundle.
- Preserve existing behavior for callers without a bundle.

**Step 3: Run tool schema tests**

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-tool-schemas.test.ts tests/phase1-skill-tool.test.ts
```

Expected: PASS.

**Step 4: Commit checkpoint**

```powershell
git add desktop/src/main/services/tool-schemas.ts desktop/tests/project-capability-tool-schemas.test.ts desktop/tests/phase1-skill-tool.test.ts
git commit -m "feat(desktop): build tool schemas from capability bundles"
```

### Task 11: Make Prompt Composer Bundle-Aware

**Files:**
- Modify: `desktop/src/main/services/model-runtime/prompt-composer.ts`
- Test: `desktop/tests/model-runtime/unit/prompt-composer.test.ts`
- Test: `desktop/tests/project-capability-prompt.test.ts`

**Step 1: Write failing prompt tests**

Test:

- Project Skills appear under “Project Skills”.
- Global Skills appear under “User Skills”.
- The prompt tells the model to use the bundle function name.
- Project Skills are absent when not in the bundle.

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-prompt.test.ts tests/model-runtime/unit/prompt-composer.test.ts
```

Expected: FAIL for project grouping.

**Step 2: Extend prompt input**

Add optional `capabilityBundle` to prompt composer input. When present, build Skills content from bundle metadata and keep the current prompt section for legacy callers.

**Step 3: Run prompt tests**

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-prompt.test.ts tests/model-runtime/unit/prompt-composer.test.ts
```

Expected: PASS.

**Step 4: Commit checkpoint**

```powershell
git add desktop/src/main/services/model-runtime/prompt-composer.ts desktop/tests/project-capability-prompt.test.ts desktop/tests/model-runtime/unit/prompt-composer.test.ts
git commit -m "feat(desktop): describe project skills in prompts"
```

### Task 12: Make Builtin Tool Executor Use Per-Call Bundle

**Files:**
- Modify: `desktop/src/main/services/builtin-tool-executor.ts`
- Modify: `desktop/src/main/ipc/sessions.ts`
- Test: `desktop/tests/project-capability-tool-executor.test.ts`
- Test: `desktop/tests/phase4-tool-executor.test.ts`

**Step 1: Write failing executor tests**

Test:

- A project Skill tool call resolves via `bundle.functionNameMap`.
- Two bundles with same tool label but different install dirs execute against their own dirs.
- Existing global `skill_invoke__id` still works for legacy calls.

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-tool-executor.test.ts tests/phase4-tool-executor.test.ts
```

Expected: FAIL because executor only has mutable `this.skills`.

**Step 2: Add execution option**

Extend executor `execute` options with:

```ts
capabilityBundle?: CapabilityBundle;
```

For `skill_invoke__*`, first check `capabilityBundle.functionNameMap[toolId]`. If found:

- If source is `project`, read `installDir/SKILL.md`.
- If source is `global`, use the referenced global Skill.

Fallback to legacy `this.skills` only when no bundle map entry exists.

**Step 3: Reduce shared mutable state usage**

Keep `setSkills` for legacy compatibility, but update `sessions.ts` so the main send-message path passes the bundle into executor calls. Do not rely on `setSkills(allSkills)` for project Skills.

**Step 4: Run executor tests**

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-tool-executor.test.ts tests/phase4-tool-executor.test.ts
```

Expected: PASS.

**Step 5: Commit checkpoint**

```powershell
git add desktop/src/main/services/builtin-tool-executor.ts desktop/src/main/ipc/sessions.ts desktop/tests/project-capability-tool-executor.test.ts desktop/tests/phase4-tool-executor.test.ts
git commit -m "feat(desktop): execute skill tools from capability bundle"
```

### Task 13: Wire Bundle Resolution into `session:send-message`

**Files:**
- Modify: `desktop/src/main/ipc/sessions.ts`
- Modify: `desktop/src/main/services/runtime-context.ts`
- Test: `desktop/tests/project-capability-session-send.test.ts`
- Test: `desktop/tests/model-runtime/integration/session-workflow-outcome-roundtrip.test.ts`

**Step 1: Write failing send-message tests**

Test:

- Unbound session still sends global Skills.
- Bound session sends project + global Skills.
- Run snapshot is saved with bundle hash.
- Concurrent sessions with different project bindings do not share tool maps.

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-session-send.test.ts
```

Expected: FAIL because send-message does not resolve a bundle.

**Step 2: Inject resolver**

In `sessions.ts`, after resolving `workingDir`, `allSkills`, and `mcpTools`, call:

```ts
const capabilityBundle = ctx.services.capabilityBundles.resolveForSession({
  sessionId,
  globalSkills: allSkills,
  globalMcpTools: mcpTools,
});
```

Then:

- Use bundle skills for schema generation.
- Use bundle in prompt composition.
- Pass bundle into executor execution.
- Save snapshot after bundle creation with `runId`.

**Step 3: Add logs**

Add a summary log:

```ts
console.info("[session:send-message] 项目能力包解析完成", {
  sessionId,
  runId,
  bundleHash: capabilityBundle.hash,
  projectId: capabilityBundle.project?.id ?? null,
  skillCount: capabilityBundle.skills.length,
  mcpToolCount: capabilityBundle.mcpTools.length,
});
```

**Step 4: Run session tests**

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-session-send.test.ts tests/model-runtime/integration/session-workflow-outcome-roundtrip.test.ts
```

Expected: PASS.

**Step 5: Commit checkpoint**

```powershell
git add desktop/src/main/ipc/sessions.ts desktop/src/main/services/runtime-context.ts desktop/tests/project-capability-session-send.test.ts
git commit -m "feat(desktop): use capability bundles during chat runs"
```

## Phase 6: Renderer Project UX

### Task 14: Add Projects Page and Sidebar Entry

**Files:**
- Create: `desktop/src/renderer/pages/ProjectsPage.tsx`
- Modify: `desktop/src/renderer/router/index.tsx`
- Modify: `desktop/src/renderer/layouts/AppShell.tsx`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/project-sidebar-ui.test.tsx`
- Test: `desktop/tests/app-shell-footer.test.ts`

**Step 1: Write failing UI tests**

Test:

- Sidebar renders a Projects nav item.
- Projects page lists bound projects.
- Project page shows sync status and disabled counts.
- Project capabilities are not rendered as global skills.

Run:

```powershell
pnpm --dir desktop test -- tests/project-sidebar-ui.test.tsx tests/app-shell-footer.test.ts
```

Expected: FAIL because Projects UI does not exist.

**Step 2: Add route**

Add route:

```tsx
<Route path="/projects" element={<ProjectsPage />} />
```

**Step 3: Add nav item**

In `AppShell.tsx`, add a Projects nav entry near Hub/Tools:

```ts
{ to: "/projects", label: "Projects", icon: IconProjects, testId: "nav-projects" }
```

Use a lucide icon if the current file already imports lucide icons; otherwise follow local inline icon style.

**Step 4: Implement Projects page**

The page should have three practical sections:

- 已绑定项目
- 当前项目能力
- 本机运行设置

Do not create a marketing hero. Use dense operational UI consistent with existing Desktop pages.

**Step 5: Run UI tests**

Run:

```powershell
pnpm --dir desktop test -- tests/project-sidebar-ui.test.tsx tests/app-shell-footer.test.ts
```

Expected: PASS.

**Step 6: Commit checkpoint**

```powershell
git add desktop/src/renderer/pages/ProjectsPage.tsx desktop/src/renderer/router/index.tsx desktop/src/renderer/layouts/AppShell.tsx desktop/src/renderer/stores/workspace.ts desktop/tests/project-sidebar-ui.test.tsx
git commit -m "feat(desktop): add project sidebar and page"
```

### Task 15: Add Chat Project Pill and Effective Capability Panel

**Files:**
- Modify: `desktop/src/renderer/pages/ChatPage.tsx`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/chat-project-capabilities.test.tsx`
- Test: `desktop/tests/chat-page-a11y.test.ts`

**Step 1: Write failing Chat tests**

Test:

- Unbound session shows “无项目”.
- Bound session shows project name.
- Effective capability panel groups by 项目 Skills / 我的 Skills / 项目 MCP / 全局 MCP.
- Project Skill names do not appear in global Skills-only controls.

Run:

```powershell
pnpm --dir desktop test -- tests/chat-project-capabilities.test.tsx tests/chat-page-a11y.test.ts
```

Expected: FAIL because Chat project UI does not exist.

**Step 2: Add project pill**

Add a compact pill in the existing chat header controls. It should show:

- `无项目` when no binding exists.
- Project name and sync state when bound.
- Warning count if any refs/installations are failed, revoked, missing, or deleted.

**Step 3: Add effective capability panel**

Create a small panel or popover inside `ChatPage.tsx` for v1. It must be easy to scan and grouped:

- 项目 Skills
- 我的 Skills
- 项目 MCP
- 全局 MCP

Use the local project detail state plus global `workspace.skills` and `workspace.mcpServers`.

**Step 4: Keep slash grouping**

Update the current skill entries computed around `workspace.skills` so project Skills are separate entries and labeled by source. Do not append project Skills into `workspace.skills`.

**Step 5: Run Chat tests**

Run:

```powershell
pnpm --dir desktop test -- tests/chat-project-capabilities.test.tsx tests/chat-page-a11y.test.ts
```

Expected: PASS.

**Step 6: Commit checkpoint**

```powershell
git add desktop/src/renderer/pages/ChatPage.tsx desktop/src/renderer/stores/workspace.ts desktop/tests/chat-project-capabilities.test.tsx desktop/tests/chat-page-a11y.test.ts
git commit -m "feat(desktop): show project capabilities in chat"
```

## Phase 7: MCP Safety Gate

### Task 16: Enforce Project MCP Safe Defaults

**Files:**
- Modify: `desktop/src/main/services/capability-bundle-resolver.ts`
- Modify: `desktop/src/main/services/project-capability-service.ts`
- Modify: `desktop/src/main/ipc/projects.ts`
- Test: `desktop/tests/project-mcp-safety.test.ts`

**Step 1: Write failing safety tests**

Test:

- Project stdio MCP is excluded by default.
- Project HTTP/SSE MCP is excluded until locally confirmed.
- Local disabled excludes MCP even when Cloud default is enabled.
- Confirmed MCP with safe runtime policy can enter the bundle.

Run:

```powershell
pnpm --dir desktop test -- tests/project-mcp-safety.test.ts
```

Expected: FAIL for MCP confirmation behavior.

**Step 2: Add local MCP confirmation state**

Extend `project_capability_prefs` or `runtime_policy_json` handling to store:

```ts
{
  localConfirmed: boolean;
  secretsConfigured: boolean;
  allowExposeToModel: boolean;
}
```

Do not store secrets in this table.

**Step 3: Add IPC confirmation action**

Add `projects:confirm-mcp-capability` that only toggles local confirmation and expose permission. It does not create a global MCP server.

**Step 4: Enforce resolver gate**

Resolver includes project MCP only when:

- ref is valid
- local state is not disabled/hidden
- local confirmation is true
- policy allows model exposure
- required secrets are configured

**Step 5: Run MCP safety tests**

Run:

```powershell
pnpm --dir desktop test -- tests/project-mcp-safety.test.ts
```

Expected: PASS.

**Step 6: Commit checkpoint**

```powershell
git add desktop/src/main/services/capability-bundle-resolver.ts desktop/src/main/services/project-capability-service.ts desktop/src/main/ipc/projects.ts desktop/tests/project-mcp-safety.test.ts
git commit -m "feat(desktop): gate project mcp exposure"
```

## Phase 8: Integration Verification

### Task 17: Full Desktop Verification

**Files:**
- Read/verify all Desktop files changed in Phases 2-7

**Step 1: Run targeted tests**

Run:

```powershell
pnpm --dir desktop test -- tests/project-capability-contracts.test.ts tests/project-capability-database.test.ts tests/project-capability-service.test.ts tests/project-capability-ipc.test.ts tests/project-runtime-context-sync.test.ts tests/project-skill-installer.test.ts tests/capability-bundle-resolver.test.ts tests/project-capability-tool-schemas.test.ts tests/project-capability-prompt.test.ts tests/project-capability-tool-executor.test.ts tests/project-capability-session-send.test.ts tests/project-sidebar-ui.test.tsx tests/chat-project-capabilities.test.tsx tests/project-mcp-safety.test.ts
```

Expected: PASS.

**Step 2: Run Desktop typecheck**

Run:

```powershell
pnpm --dir desktop typecheck
```

Expected: PASS.

**Step 3: Run Desktop lint**

Run:

```powershell
pnpm --dir desktop lint
```

Expected: PASS or only pre-existing unrelated lint failures. Any touched-file lint failures must be fixed.

### Task 18: Full Cloud Verification

**Files:**
- Read/verify all Cloud files changed in Phases 1-2

**Step 1: Run Cloud tests**

Run:

```powershell
pnpm --dir cloud test
```

Expected: PASS or only pre-existing unrelated failures. Any project runtime context failure must be fixed.

### Task 19: Encoding and Garbled Text Gate

**Files:**
- All files modified by this plan

**Step 1: Run repository garbled check**

Run:

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\?/h[1-6]>"
rg -n $pattern apps packages docs *.md desktop cloud
```

Expected: no matches in touched files. If the command finds old unrelated garbling, record it separately and run the same pattern against the touched file list.

**Step 2: Run whitespace check**

Run:

```powershell
git diff --check
```

Expected: PASS.

**Step 3: Review diff**

Run:

```powershell
git diff --stat
git diff -- docs/plans/2026-05-18-desktop-project-capability-runtime-design.md
git diff -- docs/plans/2026-05-18-desktop-project-capability-runtime-implementation-plan.md
```

Expected: no accidental edits to unrelated docs. For implementation files, verify only the scoped project capability work changed.

## Acceptance Checklist

- Desktop sidebar has a Projects entry and shows project state.
- Bound project metadata is persisted in local SQLite.
- Project Skill installation path is under `projectCapabilitiesDir`, not `skillsDir`.
- Project Skills/MCP are not added to global `workspace.skills` or global MCP server list.
- Chat shows project pill and final available capability panel.
- `CapabilityBundle` is created per run and saved as a snapshot.
- Prompt composer, tool schema builder, and tool executor consume the same bundle.
- Local disabled always beats Cloud default enabled.
- Project MCP is not exposed to the model until locally confirmed.
- Concurrent sessions with different project bindings do not share project capability tool maps.
- Cloud runtime context returns concrete release and artifact metadata.
- UTF-8 Chinese checks pass for all touched files.

## Final Commit Option

If the user wants one final feature commit after all checkpoints are verified:

```powershell
git status --short
git add cloud/packages/shared/src/contracts/projects.ts cloud/apps/cloud-api/src/modules/projects desktop/shared/contracts desktop/src/main desktop/src/preload desktop/src/renderer desktop/tests docs/plans
git commit -m "feat: add desktop project capability runtime"
```
