# Testing Patterns

**Analysis Date:** 2026-03-31

## Test Framework

**Runner:**
- Vitest 3.0.8 across all workspaces (desktop, runtime, cloud-api)
- Node `assert` module for cloud workspace-level structural tests (`.mjs` files)

**Assertion Library:**
- Vitest built-in `expect` for all Vitest tests
- `node:assert/strict` for cloud structural tests

**Run Commands:**
```bash
# desktop workspace (runs all sub-packages)
cd desktop && pnpm test

# desktop app only
cd desktop/apps/desktop && pnpm test          # vitest run

# runtime only
cd desktop/apps/runtime && pnpm test          # vitest run

# cloud-api only
cd cloud/apps/cloud-api && pnpm test          # vitest run

# cloud workspace structural tests
cd cloud && pnpm test                          # node tests/*.test.mjs

# cloud-web page structure tests
cd cloud/apps/cloud-web && pnpm test          # node tests/pages.test.mjs

# desktop
cd desktop && pnpm test                         # vitest run
```

## Test File Organization

**desktop/apps/desktop:**
- Vue view tests: `src/tests/views/*.test.ts` (separate directory, mirrors view names)
- Component tests: `src/tests/components/workflow/*.test.ts`
- Service tests: `src/tests/services/*.test.ts`
- Store tests: `src/tests/stores/*.test.ts`
- Co-located unit tests for non-Vue modules: `src/services/runtime-client.test.ts`, `src/settings/provider-presets.test.ts`
- Test fixtures: `src/test-utils/workspace-fixture.ts`

**desktop/apps/runtime:**
- Co-located integration tests: `src/server.test.ts`, `src/server.*.test.ts` (topic-specific splits)
- Co-located service tests: `src/services/*.test.ts`
- Structured test tree: `tests/unit/`, `tests/integration/`, `tests/contract/`
  - `tests/unit/services/model-provider/*.test.ts`
  - `tests/unit/store/*.test.ts`
  - `tests/integration/server/*.test.ts`
  - `tests/integration/services/*.test.ts`
  - `tests/contract/runtime-api/*.test.ts`

**cloud/apps/cloud-api:**
- Co-located with source: `src/modules/{domain}/{name}.test.ts`
- Example: `src/modules/auth/auth.service.test.ts`, `src/modules/hub/hub.controller.test.ts`
- One test file per testable unit (service, controller, repository, provider)

**cloud workspace level:**
- `cloud/tests/*.test.mjs` - structural smoke tests (file existence, config shape)
- `cloud/apps/cloud-web/tests/pages.test.mjs` - page file/route existence verification

**desktop:**
- No test files detected (no `*.test.ts` or `*.test.tsx` files in `desktop/src/`)

## Vitest Configuration

**desktop/apps/desktop** (`desktop/apps/desktop/vitest.config.ts`):
```typescript
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "@": "./src" } },
  test: { environment: "jsdom" },
});
```

**desktop/apps/runtime** (`desktop/apps/runtime/vitest.config.ts`):
```typescript
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
```

**cloud/apps/cloud-api** (`cloud/apps/cloud-api/vitest.config.ts`):
```typescript
export default defineConfig({
  test: {
    api: { host: "127.0.0.1" },
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

## Test Structure

**Suite Organization (desktop Vue views):**
```typescript
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "@/stores/workspace";
import { createWorkspaceFixture } from "@/test-utils/workspace-fixture";
import SomeView from "@/views/SomeView.vue";

describe("SomeView", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it("renders expected elements when workspace is hydrated", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const workspace = useWorkspaceStore();
    workspace.hydrate(createWorkspaceFixture());

    const wrapper = mount(SomeView, {
      global: { plugins: [pinia] },
    });

    expect(wrapper.find("[data-testid='...']").exists()).toBe(true);
  });
});
```

**Suite Organization (cloud-api services):**
```typescript
import { describe, expect, it, vi } from "vitest";
import { SomeService } from "./some.service";

describe("some service", () => {
  it("does something with injected dependencies", async () => {
    const repository = { /* inline mock object */ };
    const service = new SomeService(repository);

    const result = await service.someMethod();
    expect(result).toEqual(/* expected */);
  });
});
```

**Suite Organization (runtime server integration):**
```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRuntimeApp } from "./server";

describe("runtime server - topic", () => {
  let app: Awaited<ReturnType<typeof createRuntimeApp>>;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-"));
    app = await createRuntimeApp({ port: 0, stateFilePath: join(tempDir, "state.json") });
  });

  afterEach(async () => {
    await app.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns expected HTTP response", async () => {
    const response = await fetch(`${app.baseUrl}/api/endpoint`);
    expect(response.status).toBe(200);
  });
});
```

## Mocking

**Framework:** Vitest built-in `vi.fn()`, `vi.spyOn()`, `vi.mock()`

**Patterns - Module Spying (desktop):**
```typescript
import * as runtimeClient from "@/services/runtime-client";

vi.spyOn(runtimeClient, "fetchBootstrap").mockResolvedValue(/* fixture */);
vi.spyOn(cloudAuthClient, "loginCloudAuth").mockResolvedValue(createLoginPayload());
```

**Patterns - Inline Mock Objects (cloud-api):**
```typescript
// Services are constructed with plain objects implementing the interface
const repository = {
  list: async () => [/* test data */],
  findById: async () => null,
  createItem: async () => { throw new Error("not used"); },
};
const service = new HubService(repository, createArtifactServiceMock() as any);
```

**Patterns - Mock Factory Functions (cloud-api):**
```typescript
function createArtifactServiceMock() {
  return {
    storeSkillArtifact: vi.fn(async ({ releaseId }) => ({
      fileName: `${releaseId}.zip`,
      fileSize: 128,
      storageKey: `/group1/M00/${releaseId}.zip`,
      storageUrl: `http://127.0.0.1:8080/group1/M00/${releaseId}.zip`,
    })),
    createDownloadToken: vi.fn(async (releaseId) => ({
      downloadUrl: `/api/artifacts/download/${releaseId}`,
      expiresIn: 300,
    })),
  };
}
```

**Patterns - DOM Mocking (desktop components):**
```typescript
vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
  x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 720,
  width: 1200, height: 720, toJSON: () => ({}),
});
```

**What to Mock:**
- External HTTP clients (`cloud-auth-client`, `runtime-client`)
- Repository implementations (use inline objects conforming to the interface)
- DOM APIs when testing canvas/geometry logic
- File system operations in runtime tests (use real temp directories)

**What NOT to Mock:**
- The service/component under test
- Pure functions (test directly)
- Pinia stores (create fresh instances per test with `createPinia()`)

## Fixtures and Factories

**Central Workspace Fixture** (`desktop/apps/desktop/src/test-utils/workspace-fixture.ts`):
```typescript
export type WorkspaceFixture = {
  sessions: ChatSession[];
  models: ModelProfile[];
  builtinTools: ResolvedBuiltinTool[];
  mcpServers: McpServer[];
  skills: SkillDefinition[];
  employees: LocalEmployeeSummary[];
  workflows: WorkflowDefinitionSummary[];
  workflowDefinitions: WorkflowDefinition[];
  cloudHubItems: CloudHubItem[];
  approvals: ApprovalPolicy;
  approvalRequests: ApprovalRequest[];
  // ... other fields
};

export function createWorkspaceFixture(): WorkspaceFixture { /* ... */ }
```

This fixture provides a fully populated workspace snapshot used by nearly all desktop view/component tests. Override specific fields by spreading:
```typescript
workspace.hydrate({
  ...createWorkspaceFixture(),
  sessions: [customSession],
});
```

**Inline Factory Functions (cloud-api):**
- `createLoginPayload()` for auth test data
- `createArtifactServiceMock()` for artifact service doubles
- `createSession()`, `createIntent()` for runtime test data

**Runtime Test Setup:**
- Tests that need a real runtime app use `createRuntimeApp({ port: 0, stateFilePath })` with a temp directory
- Cloud hub proxy tests spin up an inline `createServer()` to simulate cloud API responses

**Location:**
- desktop fixture: `desktop/apps/desktop/src/test-utils/workspace-fixture.ts`
- runtime/cloud-api: factory functions defined inline within each test file (no shared fixture directory)

## Coverage

**Requirements:** None enforced. No coverage thresholds configured in any vitest.config.ts.

**View Coverage:**
```bash
cd desktop/apps/desktop && npx vitest run --coverage
cd desktop/apps/runtime && npx vitest run --coverage
cd cloud/apps/cloud-api && npx vitest run --coverage
```

## Test Types

**Unit Tests:**
- Pure function tests (geometry calculations, data parsing, tool definitions)
- Pinia store tests (auth flows, state mutations)
- NestJS service tests (business logic with mocked repositories)
- NestJS controller tests (request/response mapping)

**Integration Tests:**
- Runtime server tests (`src/server.test.ts` and topic-specific `src/server.*.test.ts`): spin up a real HTTP server, send real fetch requests
- `tests/integration/server/bootstrap-route.test.ts`: full route integration
- `tests/contract/runtime-api/*.test.ts`: contract tests for runtime API shape

**Component Tests (desktop):**
- Mount Vue components with `@vue/test-utils`
- Hydrate Pinia stores with fixtures
- Assert DOM structure via `data-testid` selectors
- Test user interactions (click, input) via wrapper methods

**Structural Tests (cloud):**
- `cloud/tests/workspace.test.mjs`: verifies required files exist (scaffold integrity)
- `cloud/tests/infrastructure.test.mjs`: verifies infra config
- `cloud/tests/shared-package-consumption.test.mjs`: verifies shared package wiring
- `cloud/apps/cloud-web/tests/pages.test.mjs`: verifies all page files exist and contain expected patterns

**E2E Tests:**
- Not used. No Playwright, Cypress, or similar framework detected.

## Common Patterns

**Async Testing (stores):**
```typescript
it("refreshes an expired session", async () => {
  vi.spyOn(cloudAuthClient, "refreshCloudAuth").mockResolvedValue({
    accessToken: "access-2",
    expiresIn: 7200,
  });

  const store = useDesktopAuthStore();
  const authenticated = await store.ensureAuthenticated("http://127.0.0.1:43110");

  expect(authenticated).toBe(true);
  expect(store.session.accessToken).toBe("access-2");
});
```

**Error Testing (cloud-api):**
```typescript
it("rejects when password is incorrect", async () => {
  await expect(
    service.login({ account: "admin", password: "wrong" }),
  ).rejects.toMatchObject({
    message: "account_or_password_invalid",
  });
});
```

**Router Testing (desktop):**
```typescript
function createTestRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/mcp/new", component: McpDetailView },
      { path: "/mcp/:id", component: McpDetailView },
    ],
  });
}

async function mountDetail(path = "/mcp/mcp-filesystem") {
  const pinia = createPinia();
  setActivePinia(pinia);
  const workspace = useWorkspaceStore();
  workspace.hydrate(createWorkspaceFixture());

  const router = createTestRouter();
  router.push(path);
  await router.isReady();

  return mount(McpDetailView, {
    global: { plugins: [pinia, router] },
  });
}
```

**`data-testid` Assertion Pattern:**
```typescript
expect(wrapper.find("[data-testid='mcp-detail-view']").exists()).toBe(true);
expect(wrapper.get("[data-testid='workflow-canvas-node-node-start']").text()).toContain("Start");
```

## Test Coverage by Module

### Well-Tested Areas

**desktop/apps/desktop:**
- All views have corresponding test files in `src/tests/views/` (16+ view tests)
- Workflow components: `WorkflowCanvas.test.ts`, `WorkflowCanvas.drag.test.ts`, `WorkflowNodeEditor.join.test.ts`, `WorkflowGraphInspector.test.ts`, `WorkflowRunPanel.test.ts`, `WorkflowLibraryCard.test.ts`
- Auth store thoroughly tested with login, refresh, introspect flows
- Services: `cloud-auth-client.test.ts`, `cloud-hub-client.test.ts`, `runtime-client.test.ts`
- Geometry and factory utilities: `workflow-canvas-geometry.test.ts`, `workflow-node-factory.test.ts`

**desktop/apps/runtime:**
- Server integration tests for every major feature area (9 test files: `server.test.ts`, `server.employees.test.ts`, `server.workflows.test.ts`, `server.streaming.test.ts`, `server.pending-approval.test.ts`, etc.)
- Service-level tests: `model-provider.test.ts`, `a2ui.test.ts`, `mcp-service.test.ts`, `tool-executor.test.ts`, `skill-manager.test.ts`, `session-persistence.test.ts`, `workflow-checkpoint-store.test.ts`, `workflow-definition-validator.test.ts`, `publish-draft-manager.test.ts`, `runtime-heartbeat.test.ts`
- Layered tests: `tests/unit/` (tool definitions, state codecs, schema), `tests/integration/` (bootstrap route, model provider facade, state facade), `tests/contract/` (runtime API shape)

**cloud/apps/cloud-api:**
- All modules tested: auth (service + provider), hub (controller + service + repository + seed), artifact (controller + service + storage), install (service), mcp (controller + service + repository), skills (controller + service)
- Runtime env loading tested: `runtime/load-runtime-env.test.ts`

### Coverage Gaps

**desktop (Electron/React):**
- **Zero test files.** The entire `desktop/` directory has no tests. This is the highest-risk gap.
- No test framework configured (though `vitest` is in `devDependencies` of the root `desktop/package.json`)
- Stores (`workspace.ts`, `auth.ts`, `shell.ts`), pages, and components are all untested.

**cloud/apps/cloud-web:**
- Only structural file-existence tests (`tests/pages.test.mjs`)
- No component rendering tests, no composable tests, no server-route logic tests
- `useCloudSession.ts` composable has complex session/cookie logic with no unit tests
- Server utils (`cloud-api.ts` proxy) has no tests

**desktop/apps/desktop - untested areas:**
- `src/stores/workspace.ts` - the largest and most critical store has no dedicated test file (only exercised indirectly via view tests that hydrate it)
- `src/stores/shell.ts` - no tests
- `src/utils/tool-output.ts` - no tests
- Non-workflow components: `ToolLogContent.vue`, `McpServerForm.vue`, `McpLibraryCard.vue` have no dedicated tests

**Shared packages:**
- `desktop/packages/shared/` has `contracts.test.ts` and `mcp-contracts-usage.test.ts` (basic shape tests)
- `cloud/packages/shared/` has no tests

---

*Testing analysis: 2026-03-31*
