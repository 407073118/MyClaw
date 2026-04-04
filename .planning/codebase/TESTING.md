# Testing Patterns

**Analysis Date:** 2026-04-04

## Test Framework

**Runner:**
- `Vitest` is the executable runner for `desktop/` via `desktop/package.json` and `desktop/vitest.config.ts`.
- `Vitest` is also the executable runner for `cloud/apps/cloud-api` via `cloud/apps/cloud-api/package.json` and `cloud/apps/cloud-api/vitest.config.ts`.
- `Node` script execution is the runner for `cloud/apps/cloud-web`, `cloud/packages/shared`, and `cloud/tests` via `node *.test.mjs` commands in `cloud/apps/cloud-web/package.json`, `cloud/packages/shared/package.json`, and `cloud/package.json`.
- Config: `desktop/vitest.config.ts`, `cloud/apps/cloud-api/vitest.config.ts`

**Assertion Library:**
- `expect`, `describe`, `it`, `vi`, and lifecycle hooks from Vitest are used in `desktop/tests/*.test.ts` and `cloud/apps/cloud-api/src/**/*.test.ts`.
- `node:assert/strict` is used for static and scaffold verification tests in `cloud/apps/cloud-web/tests/pages.test.mjs`, `cloud/packages/shared/tests/contracts.test.mjs`, and `cloud/tests/*.test.mjs`.

**Run Commands:**
```bash
pnpm --dir desktop test                 # Run desktop Vitest suite
pnpm --dir cloud/apps/cloud-api test    # Run cloud-api Vitest suite
pnpm --dir cloud/apps/cloud-web test    # Run cloud-web Node assertion suite
pnpm --dir cloud/packages/shared test   # Run shared package Node assertion suite
pnpm --dir cloud test                   # Run cloud workspace verification scripts
pnpm --dir desktop typecheck            # Desktop verification companion command
pnpm --dir cloud build                  # Cloud verification companion command
```

## Test File Organization

**Location:**
- `desktop/` keeps tests in a separate top-level `desktop/tests/` directory, not co-located with sources.
- `cloud/apps/cloud-api` keeps tests close to domain code under `src/modules/*/tests/` and `src/runtime/tests/`.
- `cloud/apps/cloud-web`, `cloud/packages/shared`, and `cloud/tests` keep script-based checks in top-level `tests/` directories.

**Naming:**
- Use `*.test.ts` for Vitest suites, such as `desktop/tests/workflow-ipc.test.ts` and `cloud/apps/cloud-api/src/modules/auth/tests/auth.service.test.ts`.
- Use `*.test.mjs` for Node assertion scripts, such as `cloud/apps/cloud-web/tests/pages.test.mjs` and `cloud/tests/infrastructure.test.mjs`.

**Structure:**
```
desktop/
  tests/*.test.ts

cloud/apps/cloud-api/
  src/modules/<domain>/tests/*.test.ts
  src/runtime/tests/*.test.ts

cloud/apps/cloud-web/
  tests/*.test.mjs

cloud/packages/shared/
  tests/*.test.mjs

cloud/
  tests/*.test.mjs
```

## Test Structure

**Suite Organization:**
```typescript
describe("workflow IPC handlers", () => {
  beforeEach(() => {
    handleMock.mockClear();
    saveWorkflowMock.mockClear();
  });

  it("keeps stateSchema defined after creating and updating a workflow", async () => {
    const { registerWorkflowHandlers } = await import("../src/main/ipc/workflows");
    registerWorkflowHandlers(ctx);

    const createHandler = findHandler("workflow:create");
    const updateHandler = findHandler("workflow:update");
    const getHandler = findHandler("workflow:get");

    await createHandler(null, { name: "新建工作流", description: "..." });
    await updateHandler(null, "workflow-id", { nodes: [], edges: [] });

    await expect(getHandler(null, "workflow-id")).resolves.toMatchObject({
      stateSchema: [],
    });
  });
});
```

**Patterns:**
- Group by feature or module using `describe("domain name", ...)`, as in `desktop/tests/browser-service.test.ts`, `desktop/tests/phase8-infrastructure.test.ts`, and `cloud/apps/cloud-api/src/modules/hub/tests/hub.controller.test.ts`.
- Prefer readable behavior sentences in `it(...)`; most tests describe the contract, not the implementation detail.
- Use local inline helpers or factory functions inside the test file rather than a shared fixture directory, for example `findHandler()` in `desktop/tests/workflow-ipc.test.ts` and `createSessionRepository()` in `cloud/apps/cloud-api/src/modules/auth/tests/auth.service.test.ts`.
- Use `afterEach` to restore global mutations when a test patches `process`, `console`, or imported singletons, as in `cloud/apps/cloud-api/src/runtime/tests/load-runtime-env.test.ts`.

## Mocking

**Framework:** `vi.mock`, `vi.fn`, and `vi.spyOn` from Vitest

**Patterns:**
```typescript
const handleMock = vi.fn();
const saveWorkflowMock = vi.fn(() => Promise.resolve());

vi.mock("electron", () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock("../src/main/services/state-persistence", () => ({
  saveWorkflow: saveWorkflowMock,
}));
```

```typescript
const databaseService = {
  mcpServer: {
    findMany: vi.fn(async () => [/* records */]),
  },
};

const repository = new PrismaMcpRepository(databaseService as never);
```

**What to Mock:**
- Electron host APIs and IPC registration, as in `desktop/tests/workflow-ipc.test.ts`.
- File-backed persistence boundaries, as in `desktop/tests/workflow-ipc.test.ts`.
- Console methods for logging assertions, as in `desktop/tests/phase8-infrastructure.test.ts`.
- Prisma/database service methods via lightweight object literals plus `vi.fn`, as in `cloud/apps/cloud-api/src/modules/mcp/tests/prisma-mcp.repository.test.ts` and `cloud/apps/cloud-api/src/modules/hub/tests/prisma-hub.repository.test.ts`.
- Nest service collaborators through plain objects cast to service types, as in `cloud/apps/cloud-api/src/modules/hub/tests/hub.controller.test.ts`.
- Process-level functions and environment variables when testing boot/runtime code, as in `cloud/apps/cloud-api/src/runtime/tests/load-runtime-env.test.ts`.

**What NOT to Mock:**
- Pure data transformation helpers in `desktop/src/main/services/tool-schemas.ts`, `desktop/src/renderer/utils/context-ui-helpers.ts`, and `desktop/src/main/services/model-capability-resolver.ts`; those are tested directly in `desktop/tests/browser-service.test.ts` and `desktop/tests/phase15-context-ui.test.ts`.
- Contract files in `cloud/packages/shared/src/contracts/*.ts`; instead, the shared package uses source-text assertions in `cloud/packages/shared/tests/contracts.test.mjs`.
- Nuxt pages and layouts are not rendered with component mocks; `cloud/apps/cloud-web/tests/pages.test.mjs` verifies file presence and source text patterns directly.

## Fixtures and Factories

**Test Data:**
```typescript
function createSessionRepository() {
  const sessions = [];

  return {
    sessions,
    repo: {
      create: async (input) => {
        const record = { id: `session-${sessions.length + 1}`, ...input, revokedAt: null };
        sessions.push(record);
        return record;
      },
    },
  };
}
```

**Location:**
- Factories live inside the individual test file that uses them, such as `createSessionRepository()` in `cloud/apps/cloud-api/src/modules/auth/tests/auth.service.test.ts`.
- Static test data is usually declared inline near the assertion, such as the mock Hub items in `cloud/apps/cloud-api/src/modules/hub/tests/hub.controller.test.ts` and config payloads in `desktop/tests/browser-service.test.ts`.
- No shared `fixtures/`, `factories/`, or test utility package was detected.

## Coverage

**Requirements:** None enforced. No coverage script, coverage threshold, or reporter config was detected in `desktop/package.json`, `cloud/package.json`, `cloud/apps/cloud-api/package.json`, `cloud/apps/cloud-web/package.json`, or `cloud/packages/shared/package.json`.

**View Coverage:**
```bash
Not detected
```

## CI & Verification Assumptions

**CI pipeline:**
- Not detected. No `.github/workflows/*` or `.gitlab-ci.yml` file was found in the repository root, `desktop/`, or `cloud/`.

**Verification assumptions:**
- Local command execution is the current verification contract.
- `cloud/AGENTS.md` treats `pnpm --dir packages/shared test`, `pnpm --dir apps/cloud-api test`, `pnpm --dir apps/cloud-web test`, `pnpm test`, and `pnpm build` as the expected workspace checks.
- `cloud/apps/cloud-api/AGENTS.md`, `cloud/apps/cloud-web/AGENTS.md`, and `cloud/packages/shared/AGENTS.md` each pair `test` with `build`, which indicates tests are expected to be run together with type/build verification.
- `desktop/package.json` exposes `test` and `typecheck`, but no dedicated lint or coverage commands.

## Test Types

**Unit Tests:**
- `desktop/tests/*.test.ts` are mostly unit and contract tests around pure helpers, IPC registration, approval logic, model capability resolution, token budgeting, and service glue. Representative files: `desktop/tests/browser-service.test.ts`, `desktop/tests/phase8-infrastructure.test.ts`, and `desktop/tests/workflow-ipc.test.ts`.
- `cloud/apps/cloud-api/src/modules/*/tests/*.test.ts` are unit-style tests around controllers, services, repositories, and schema assumptions using fakes instead of a live Nest application. Representative files: `cloud/apps/cloud-api/src/modules/auth/tests/auth.service.test.ts`, `cloud/apps/cloud-api/src/modules/hub/tests/hub.controller.test.ts`, and `cloud/apps/cloud-api/src/modules/mcp/tests/prisma-mcp.repository.test.ts`.

**Integration Tests:**
- `cloud/tests/*.test.mjs` act as workspace integration and scaffold checks. They verify package wiring, Prisma schema presence, runtime module format, seed expectations, and shared package consumption without spinning up services.
- `cloud/apps/cloud-api/src/runtime/tests/load-runtime-env.test.ts` is a process-level integration-style test around environment bootstrapping.

**E2E Tests:**
- Not used.
- `desktop/package.json` depends on `playwright-core`, but no Playwright config or browser E2E suite was detected.
- `cloud/apps/cloud-web` has no rendered component tests or browser-driven workflow tests; its current suite is static source verification in `cloud/apps/cloud-web/tests/pages.test.mjs`.

## Common Patterns

**Async Testing:**
```typescript
await expect(
  service.login({
    account: "admin",
    password: "wrong-password",
  }),
).rejects.toMatchObject({
  message: "account_or_password_invalid",
});
```

```typescript
await expect(Promise.resolve(controller.list("employee-package"))).resolves.toEqual({
  items: [/* ... */],
});
```

**Error Testing:**
```typescript
await expect(controller.detail("missing")).rejects.toBeInstanceOf(NotFoundException);
await expect(controller.publishEmployeeRelease("employee-onboarding-assistant", {
  version: "1.1.0",
  releaseNotes: "x",
})).rejects.toBeInstanceOf(BadRequestException);
```

**Static Structure Testing:**
```javascript
const login = readFileSync(join(root, "pages/login.vue"), "utf8");
assert.match(login, /\/api\/auth\/login/);
assert.match(login, /handleLogin/);
assert.doesNotMatch(login, /hero-grid/);
```

**Current gaps to respect when adding tests:**
- `desktop/vitest.config.ts` runs with `environment: "node"`, so desktop component tests should stay logic-focused unless you first add a jsdom-oriented setup.
- `desktop/tests/phase15-context-ui.test.ts` explicitly documents that UI data logic is tested without `@testing-library/react`.
- Cloud web tests are source-level smoke tests; if behavior matters, a new runtime harness is required rather than extending regex-only checks indefinitely.

---

*Testing analysis: 2026-04-04*
