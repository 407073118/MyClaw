# Architecture

**Analysis Date:** 2026-04-04

## Pattern Overview

**Overall:** Dual-workspace monorepo with a governance root, a local-first desktop runtime, and a separate cloud workspace.

**Key Characteristics:**
- The repository root is a documentation and policy layer only. `AGENTS.md`, `docs/architecture/overview.md`, and `docs/architecture/domain-boundaries.md` define boundaries and route work into `desktop/` or `cloud/`.
- `desktop/` is a self-contained Electron application with three runtime layers: Electron main in `desktop/src/main/`, preload bridge in `desktop/src/preload/`, and React renderer in `desktop/src/renderer/`.
- `cloud/` is a pnpm workspace split into a NestJS API in `cloud/apps/cloud-api/`, a Nuxt web console in `cloud/apps/cloud-web/`, and shared contracts in `cloud/packages/shared/src/`.

## Layers

**Governance Layer:**
- Purpose: Define repo-wide rules, architecture boundaries, and process entry points.
- Location: `AGENTS.md`, `docs/agents/context-engineering.md`, `docs/architecture/overview.md`, `docs/architecture/layering-constraints.md`
- Contains: Machine instructions, architecture boundaries, process rules, and repo navigation.
- Depends on: No runtime code.
- Used by: Agents and developers before entering `desktop/` or `cloud/`.

**Desktop Main Runtime Layer:**
- Purpose: Own the Electron process, local persistence, tool execution, IPC orchestration, and desktop-only integrations.
- Location: `desktop/src/main/`
- Contains: Runtime bootstrap in `desktop/src/main/index.ts`, IPC registration in `desktop/src/main/ipc/index.ts`, and long-lived services in `desktop/src/main/services/`.
- Depends on: `desktop/shared/contracts/`, Node/Electron APIs, and local filesystem state under paths created by `desktop/src/main/services/directory-service.ts`.
- Used by: `desktop/src/preload/index.ts` and indirectly by the React renderer.

**Desktop Bridge Layer:**
- Purpose: Expose a restricted, typed API from Electron main to the renderer.
- Location: `desktop/src/preload/index.ts`
- Contains: `window.myClawAPI` methods for bootstrap, auth, sessions, models, MCP, cloud access, approvals, employees, workflows, and window controls.
- Depends on: Electron `ipcRenderer` and channel names registered in `desktop/src/main/ipc/*.ts`.
- Used by: `desktop/src/renderer/stores/auth.ts`, `desktop/src/renderer/stores/workspace.ts`, and page components.

**Desktop Renderer Layer:**
- Purpose: Render the desktop UI and coordinate client-side state.
- Location: `desktop/src/renderer/`
- Contains: React entrypoint `desktop/src/renderer/main.tsx`, routing in `desktop/src/renderer/router/index.tsx`, shell layout in `desktop/src/renderer/layouts/AppShell.tsx`, Zustand stores in `desktop/src/renderer/stores/`, and pages/components under `desktop/src/renderer/pages/` and `desktop/src/renderer/components/`.
- Depends on: `window.myClawAPI`, `desktop/shared/contracts/`, and browser-side storage.
- Used by: End users interacting with the desktop app.

**Desktop Shared Contract Layer:**
- Purpose: Keep the Electron main process and React renderer on the same contract vocabulary.
- Location: `desktop/shared/contracts/` and re-export `desktop/shared/index.ts`
- Contains: Session, model, skill, MCP, approval, workflow, and UI contract types.
- Depends on: TypeScript only.
- Used by: `desktop/src/main/` and `desktop/src/renderer/` through the `@shared/*` alias in `desktop/tsconfig.main.json`, `desktop/tsconfig.renderer.json`, and `desktop/vite.config.ts`.

**Cloud API Application Layer:**
- Purpose: Serve HTTP APIs for authentication, skills, MCP, artifacts, installs, and related persistence.
- Location: `cloud/apps/cloud-api/src/`
- Contains: Nest bootstrap in `cloud/apps/cloud-api/src/main.ts`, module composition in `cloud/apps/cloud-api/src/app.module.ts`, runtime env loading in `cloud/apps/cloud-api/src/runtime/load-runtime-env.ts`, and feature modules in `cloud/apps/cloud-api/src/modules/`.
- Depends on: `cloud/packages/shared`, Prisma schema in `cloud/apps/cloud-api/prisma/schema.prisma`, and environment variables loaded before Nest starts.
- Used by: `cloud/apps/cloud-web/server/api/*` and desktop cloud IPC handlers in `desktop/src/main/ipc/cloud.ts`.

**Cloud API Module Layer:**
- Purpose: Isolate business capabilities by feature with explicit module-local ports and repositories.
- Location: `cloud/apps/cloud-api/src/modules/*`
- Contains: Feature folders such as `auth/`, `artifact/`, `install/`, `mcp/`, `skills/`, `hub/`, and `database/`, each organized into `controllers/`, `services/`, `ports/`, `repositories/`, `providers/`, and `tests/` as needed.
- Depends on: `cloud/apps/cloud-api/src/modules/database/services/database.service.ts`, `cloud/packages/shared`, and Nest dependency injection.
- Used by: `cloud/apps/cloud-api/src/app.module.ts` for active modules and by sibling modules through exported services.

**Cloud Web Application Layer:**
- Purpose: Render the cloud console and proxy browser requests through a local server layer.
- Location: `cloud/apps/cloud-web/`
- Contains: Nuxt entry `cloud/apps/cloud-web/app.vue`, route pages in `cloud/apps/cloud-web/pages/`, route middleware in `cloud/apps/cloud-web/middleware/platform-auth.global.ts`, composables such as `cloud/apps/cloud-web/composables/useCloudSession.ts`, and BFF handlers in `cloud/apps/cloud-web/server/api/`.
- Depends on: `cloud/packages/shared`, runtime config from `cloud/apps/cloud-web/nuxt.config.ts`, and the proxy helper in `cloud/apps/cloud-web/server/lib/cloud-api.ts`.
- Used by: Browser clients visiting the cloud console.

**Cloud Shared Contract Layer:**
- Purpose: Keep the API and web console aligned on payload types and feature contracts.
- Location: `cloud/packages/shared/src/`
- Contains: Contract files such as `cloud/packages/shared/src/contracts/auth.ts`, `cloud/packages/shared/src/contracts/hub.ts`, `cloud/packages/shared/src/contracts/mcp.ts`, and `cloud/packages/shared/src/contracts/skills.ts`, re-exported by `cloud/packages/shared/src/index.ts`.
- Depends on: TypeScript only.
- Used by: `cloud/apps/cloud-api/` and `cloud/apps/cloud-web/` through the workspace package `@myclaw-cloud/shared`.

## Data Flow

**Desktop Bootstrap Flow:**

1. `desktop/src/main/index.ts` redirects Electron `userData`, initializes portable directories with `desktop/src/main/services/directory-service.ts`, seeds builtin skills, builds a `RuntimeContext`, and registers every IPC handler through `desktop/src/main/ipc/index.ts`.
2. `desktop/src/preload/index.ts` exposes `bootstrap()` and other methods on `window.myClawAPI`.
3. `desktop/src/renderer/layouts/AppShell.tsx` triggers `useWorkspaceStore().loadBootstrap()` from `desktop/src/renderer/stores/workspace.ts`.
4. `desktop/src/main/ipc/bootstrap.ts` returns persisted sessions, models, tools, skills, approvals, MCP servers, and path metadata assembled from in-memory state and disk-backed state loaded by `desktop/src/main/services/state-persistence.ts`.
5. `desktop/src/renderer/stores/workspace.ts` hydrates renderer state and routes the user into setup or the main shell.

**Desktop Chat And Tool Execution Flow:**

1. `desktop/src/renderer/pages/ChatPage.tsx` calls `useWorkspaceStore().sendMessage()`.
2. `desktop/src/renderer/stores/workspace.ts` sends the message through `window.myClawAPI.sendMessage()`.
3. `desktop/src/main/ipc/sessions.ts` appends the user message, assembles context with `desktop/src/main/services/context-assembler.ts`, resolves tool schemas, and calls the model through `desktop/src/main/services/model-client.ts`.
4. `desktop/src/main/ipc/sessions.ts` executes built-in tools through `desktop/src/main/services/builtin-tool-executor.ts`, emits approval requests when needed, and broadcasts stream events back to renderer windows.
5. `desktop/src/main/services/state-persistence.ts` saves session updates to disk under the portable data root described in `desktop/src/main/services/directory-service.ts`.

**Desktop Cloud Import Flow:**

1. Renderer pages load cloud data through `useWorkspaceStore()` methods in `desktop/src/renderer/stores/workspace.ts`.
2. The preload bridge forwards those requests into IPC channels defined in `desktop/src/main/ipc/cloud.ts`.
3. `desktop/src/main/ipc/cloud.ts` talks to the remote cloud API with `fetch`, downloads packages or manifests, and then writes imported employees, workflows, skills, or MCP configs into the local desktop runtime state.
4. Imported artifacts become part of local desktop persistence through helpers such as `saveEmployee()` and `saveWorkflow()` in `desktop/src/main/services/state-persistence.ts`.

**Cloud Web Request Flow:**

1. Nuxt pages such as `cloud/apps/cloud-web/pages/hub.vue` and `cloud/apps/cloud-web/pages/login.vue` call `/api/*` endpoints with `$fetch`, `useLazyFetch`, or `useAsyncData`.
2. Route handlers in `cloud/apps/cloud-web/server/api/` map those browser calls to backend paths, for example `cloud/apps/cloud-web/server/api/hub/items.get.ts` and `cloud/apps/cloud-web/server/api/auth/login.post.ts`.
3. `cloud/apps/cloud-web/server/lib/cloud-api.ts` builds the backend URL from `cloud/apps/cloud-web/nuxt.config.ts` runtime config, forwards auth headers or session cookies, and normalizes failures into H3 errors.
4. The browser session layer in `cloud/apps/cloud-web/composables/useCloudSession.ts` stores login state in both Nuxt cookie state and `localStorage`, while `cloud/apps/cloud-web/middleware/platform-auth.global.ts` guards routes.

**Cloud API Request Flow:**

1. `cloud/apps/cloud-api/src/main.ts` loads runtime env files with `cloud/apps/cloud-api/src/runtime/load-runtime-env.ts` before creating the Nest app.
2. `cloud/apps/cloud-api/src/app.module.ts` wires feature modules into the active HTTP runtime.
3. Feature controllers such as `cloud/apps/cloud-api/src/modules/auth/controllers/auth.controller.ts` and `cloud/apps/cloud-api/src/modules/skills/controllers/skills.controller.ts` receive HTTP requests.
4. Services such as `cloud/apps/cloud-api/src/modules/auth/services/auth.service.ts` and `cloud/apps/cloud-api/src/modules/hub/services/hub.service.ts` implement business rules and rely on injected ports.
5. Repository implementations such as `cloud/apps/cloud-api/src/modules/auth/repositories/prisma-auth-session.repository.ts` and `cloud/apps/cloud-api/src/modules/hub/repositories/prisma-hub.repository.ts` persist data through the global Prisma client in `cloud/apps/cloud-api/src/modules/database/services/database.service.ts`.

**State Management:**
- Desktop persistent state lives on disk under paths derived by `desktop/src/main/services/directory-service.ts` and loaded/saved through `desktop/src/main/services/state-persistence.ts`.
- Desktop renderer state is centralized in Zustand stores: auth session in `desktop/src/renderer/stores/auth.ts` and workspace state in `desktop/src/renderer/stores/workspace.ts`.
- Cloud API state is mostly request-scoped and database-backed through Prisma models in `cloud/apps/cloud-api/prisma/schema.prisma`.
- Cloud web session state is browser-local and cookie-backed through `cloud/apps/cloud-web/composables/useCloudSession.ts`.

## Key Abstractions

**RuntimeContext:**
- Purpose: Hold the desktop runtime's long-lived state references, services, and tool resolvers.
- Examples: `desktop/src/main/services/runtime-context.ts`, `desktop/src/main/index.ts`
- Pattern: Explicit dependency container passed into every IPC registration function.

**IPC Handler Registry:**
- Purpose: Keep desktop features grouped by capability instead of one large Electron main file.
- Examples: `desktop/src/main/ipc/index.ts`, `desktop/src/main/ipc/bootstrap.ts`, `desktop/src/main/ipc/sessions.ts`, `desktop/src/main/ipc/cloud.ts`
- Pattern: One registrar per domain, all wired from a single composition root.

**Portable Data Root:**
- Purpose: Separate packaged-app storage, Electron cache storage, and business data.
- Examples: `desktop/src/main/services/directory-service.ts`, `desktop/src/main/services/state-persistence.ts`
- Pattern: Derived path object plus disk-backed JSON persistence.

**Cloud Module Slice:**
- Purpose: Keep each cloud API domain internally layered with a controller/service/repository split.
- Examples: `cloud/apps/cloud-api/src/modules/auth/`, `cloud/apps/cloud-api/src/modules/skills/`, `cloud/apps/cloud-api/src/modules/hub/`
- Pattern: Nest module per feature, DI tokens in `ports/`, Prisma or provider implementations under `repositories/` and `providers/`.

**BFF Proxy Helper:**
- Purpose: Prevent Nuxt pages from depending directly on backend URLs or auth header assembly.
- Examples: `cloud/apps/cloud-web/server/lib/cloud-api.ts`, `cloud/apps/cloud-web/server/api/skills.get.ts`, `cloud/apps/cloud-web/server/api/mcp/items.post.ts`
- Pattern: Thin server-side proxy layer with shared URL building and error normalization.

**Shared Contract Package:**
- Purpose: Stabilize the boundary between runtime layers without sharing implementation code.
- Examples: `desktop/shared/contracts/index.ts`, `cloud/packages/shared/src/index.ts`
- Pattern: Type-only contract modules re-exported from a single index file and consumed through aliases or workspace packages.

## Entry Points

**Desktop Main Process:**
- Location: `desktop/src/main/index.ts`
- Triggers: Electron process startup from `desktop/package.json` `main` and `start` scripts.
- Responsibilities: Initialize directories, seed skills, build the runtime context, register IPC, create the browser window, and coordinate shutdown.

**Desktop Preload Bridge:**
- Location: `desktop/src/preload/index.ts`
- Triggers: BrowserWindow `preload` configuration in `desktop/src/main/index.ts`.
- Responsibilities: Expose the safe IPC surface to the renderer and subscribe to push events.

**Desktop Renderer:**
- Location: `desktop/src/renderer/main.tsx`
- Triggers: Vite renderer bundle loading `desktop/src/renderer/index.html`.
- Responsibilities: Hydrate auth from storage, mount React, and start routing.

**Desktop Route Shell:**
- Location: `desktop/src/renderer/layouts/AppShell.tsx`
- Triggers: Authenticated renderer routes in `desktop/src/renderer/router/index.tsx`.
- Responsibilities: Bootstrap workspace state, redirect into setup when needed, render shell navigation, and own logout flow.

**Cloud API Bootstrap:**
- Location: `cloud/apps/cloud-api/src/main.ts`
- Triggers: Nest CLI `dev` script or packaged runtime execution.
- Responsibilities: Load env files, create the Nest application, and start listening on the configured port.

**Cloud API Composition Root:**
- Location: `cloud/apps/cloud-api/src/app.module.ts`
- Triggers: Nest module resolution during bootstrap.
- Responsibilities: Register the active API modules. Current imports are `DatabaseModule`, `AuthModule`, `ArtifactModule`, `InstallModule`, `McpModule`, and `SkillsModule`. Source code for `HubModule` exists in `cloud/apps/cloud-api/src/modules/hub/`, but it is outside the active import list in `cloud/apps/cloud-api/src/app.module.ts`.

**Cloud Web Nuxt App:**
- Location: `cloud/apps/cloud-web/app.vue`
- Triggers: Nuxt application startup from `cloud/apps/cloud-web/package.json`.
- Responsibilities: Mount the selected layout and route page tree.

**Cloud Web Server Proxy Layer:**
- Location: `cloud/apps/cloud-web/server/api/`
- Triggers: Browser calls to `/api/*`.
- Responsibilities: Proxy requests into the cloud API, forward auth state, and keep frontend pages decoupled from backend transport details.

## Error Handling

**Strategy:** Boundary-local error handling with transport-specific translation.

**Patterns:**
- Desktop renderer wraps the app in `desktop/src/renderer/components/ErrorBoundary.tsx`.
- Desktop auth and workspace stores catch bridge errors and convert them into store flags in `desktop/src/renderer/stores/auth.ts` and `desktop/src/renderer/stores/workspace.ts`.
- Desktop IPC handlers throw regular errors, while approval and stream updates are pushed over Electron channels from `desktop/src/main/ipc/sessions.ts`.
- Cloud API controllers and services use Nest exceptions such as `UnauthorizedException`, `BadRequestException`, and `NotFoundException`, for example in `cloud/apps/cloud-api/src/modules/auth/services/auth.service.ts` and `cloud/apps/cloud-api/src/modules/skills/controllers/skills.controller.ts`.
- Cloud web server handlers normalize backend failures through `createError` in `cloud/apps/cloud-web/server/lib/cloud-api.ts`.

## Cross-Cutting Concerns

**Logging:** Desktop main services log through `desktop/src/main/services/logger.ts` and direct console output in IPC/services. Cloud API and cloud web use direct `console.info`, `console.warn`, and `console.error` in runtime code such as `cloud/apps/cloud-api/src/runtime/load-runtime-env.ts`, `cloud/apps/cloud-api/src/main.ts`, and `cloud/apps/cloud-web/pages/hub.vue`.

**Validation:** Desktop validation is mostly imperative in IPC and store code. Cloud API validates request shapes inside controllers and services, for example `cloud/apps/cloud-api/src/modules/skills/controllers/skills.controller.ts` and `cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts`.

**Authentication:** Desktop stores tokens locally in `desktop/src/renderer/stores/auth.ts` and forwards them through preload IPC methods to cloud handlers in `desktop/src/main/ipc/cloud.ts`. Cloud web uses `cloud/apps/cloud-web/composables/useCloudSession.ts` plus `cloud/apps/cloud-web/middleware/platform-auth.global.ts`. Cloud API resolves and persists auth sessions through `cloud/apps/cloud-api/src/modules/auth/`.

---

*Architecture analysis: 2026-04-04*
