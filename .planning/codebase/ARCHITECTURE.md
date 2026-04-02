# Architecture

**Analysis Date:** 2026-03-31

## Pattern Overview

**Overall:** Multi-platform monorepo with three independent subsystems sharing a common domain model (AI chat, MCP tools, workflows, skills, employees). Each subsystem is a pnpm workspace monorepo.

**Key Characteristics:**
- **Desktop (Tauri):** Two-process model -- Rust shell spawns a Node.js runtime sidecar; Vue 3 frontend communicates with the sidecar over HTTP REST on `127.0.0.1:43110`
- **Desktop (Electron migration -- newApp):** Three-process model -- Electron main process holds in-memory state, exposes it to renderer via IPC (`contextBridge`); React 18 + Zustand renderer
- **Cloud:** BFF pattern -- Nuxt 3 server routes proxy requests to a NestJS API backend; PostgreSQL via Prisma ORM

**No code is shared across the three subsystems at the repository root level.** Each subsystem has its own `packages/shared` (or `shared/`) with independent contract types.

## Subsystem 1 -- Desktop (Tauri + Vue 3)

### Process Model

```
 +-----------------------+          HTTP (127.0.0.1:43110)         +---------------------+
 |  Tauri Shell (Rust)   | ------spawns-sidecar----------------> |  Runtime (Node.js)   |
 |  main.rs              |                                        |  apps/runtime        |
 +-----------------------+                                        +---------------------+
         |                                                                  ^
         |  hosts webview                                                   |  fetch() calls
         v                                                                  |
 +-----------------------+                                                  |
 |  Vue 3 Frontend       | ----- runtime-client.ts --->--------------------+
 |  apps/desktop/src     |
 +-----------------------+
```

**Rust Shell** (`desktop/apps/desktop/src-tauri/src/main.rs`):
- Starts the runtime sidecar via `runtime_supervisor::start_runtime_sidecar()`
- In dev mode, runs `pnpm --dir apps/runtime dev`; in production, looks for a bundled `myclaw-runtime-*` binary
- Performs TCP health checks (`GET /health`) with 20s timeout before declaring ready
- Stops the sidecar on app exit

**Runtime Sidecar** (`desktop/apps/runtime/src/index.ts`):
- Standalone Node.js HTTP server on port 43110
- Entry: `createRuntimeApp()` in `desktop/apps/runtime/src/server/create-runtime-app.ts`
- Custom minimal HTTP router (`desktop/apps/runtime/src/server/http/router.ts`) -- no Express/Koa dependency
- Holds all application state in memory (sessions, models, approval policies, workflows, employees)
- Persists state to JSON files on disk via `desktop/apps/runtime/src/store/runtime-state-store.ts`
- Provides SSE streaming for chat session deltas

**Vue 3 Frontend** (`desktop/apps/desktop/src/`):
- Pinia stores (`shell`, `workspace`, `auth`) drive UI state
- `runtime-client.ts` is the sole HTTP client to the runtime sidecar -- every runtime interaction is a typed `fetch()` call
- `cloud-hub-client.ts` and `cloud-auth-client.ts` call the runtime proxy endpoints for cloud interactions (desktop never hits cloud directly)
- Router guard (`desktop/apps/desktop/src/router/index.ts`) enforces auth before protected routes

### Layers

**Presentation Layer:**
- Purpose: Vue 3 SPA rendered inside Tauri webview
- Location: `desktop/apps/desktop/src/`
- Contains: Views, components, router, Pinia stores
- Depends on: Runtime sidecar via HTTP

**Application/Service Layer:**
- Purpose: All business logic, AI model conversations, tool execution, workflow orchestration
- Location: `desktop/apps/runtime/src/services/`
- Contains: ~40 service files covering model providers, MCP, tools, skills, sessions, workflows, approval gating
- Key services:
  - `model-provider/` -- OpenAI-compatible and Anthropic model adapters
  - `builtin-tool-registry.ts` / `builtin-tool-executor.ts` -- internal tool system
  - `mcp-service.ts` / `mcp-manager.ts` -- MCP server lifecycle
  - `workflow-graph-executor.ts` -- DAG-based workflow engine with checkpoints
  - `approval-gateway.ts` -- tool execution approval/rejection
  - `skill-manager.ts` -- local skill discovery and loading
  - `employee-runner.ts` -- employee (agent) execution
  - `hub-package-installer.ts` -- downloads and installs hub packages
  - `a2ui.ts` -- "Assistant-to-UI" system prompt and reply parsing

**State/Persistence Layer:**
- Purpose: In-memory state containers with JSON file persistence
- Location: `desktop/apps/runtime/src/store/`
- Contains: Settings, sessions, employees, workflows, runtime state, memory, pending work
- Pattern: Mutable objects in memory, periodic JSON serialization

**Shared Contracts:**
- Purpose: TypeScript types shared between runtime and frontend
- Location: `desktop/packages/shared/src/contracts/`
- Contains: Types for approval, auth, builtin-tool, employee, events, mcp, model, session, skill, ui, workflow, workflow-run
- Import alias: `@myclaw-desktop/shared`

### Data Flow -- Chat Message

1. User types message in `ChatView.vue`
2. `workspace` store calls `postSessionMessageStream()` from `runtime-client.ts`
3. HTTP POST to `http://127.0.0.1:43110/api/sessions/:id/messages` with `Accept: text/event-stream`
4. Runtime receives request, resolves model profile, builds tool definitions
5. `runModelConversation()` streams to LLM (OpenAI-compatible or Anthropic)
6. Tool calls go through `approval-gateway.ts` -- if approval required, request pauses
7. SSE snapshots stream back to frontend; `workspace` store updates session reactively
8. Final `complete` event carries the full `PostSessionMessagePayload`

### Data Flow -- Workflow Execution

1. User starts workflow run via `POST /api/workflow-runs`
2. `WorkflowGraphExecutor` loads the workflow definition (DAG of nodes and edges)
3. Execution walks the graph node-by-node, creating `WorkflowRunCheckpoint` records
4. Each node can invoke model conversations, tools, or pause for human input
5. `WorkflowCheckpointStore` persists checkpoints for resume capability
6. Run status and checkpoints returned to frontend; `WorkflowRunPanel.vue` renders timeline

### Data Flow -- Cloud Auth (from Desktop)

1. Desktop frontend calls `loginCloudAuth()` which hits runtime at `/api/auth/login`
2. Runtime proxies to cloud-api's auth endpoint via `CloudHubProxy`
3. Tokens stored in localStorage (`myclaw-desktop-auth-session`) via `auth` Pinia store
4. Subsequent cloud operations (hub browsing, package install) send token through runtime proxy

## Subsystem 2 -- Desktop (Electron + React -- newApp)

### Process Model

```
 +------------------------+         IPC (contextBridge)         +------------------------+
 |  Electron Main Process | <---------------------------------> |  React Renderer        |
 |  newApp/src/main       |                                     |  newApp/src/renderer   |
 +------------------------+                                     +------------------------+
         |
         | preload script
         v
 +------------------------+
 |  Preload Bridge        |
 |  newApp/src/preload    |
 +------------------------+
```

**Main Process** (`newApp/src/main/index.ts`):
- Creates `BrowserWindow` with context isolation and preload script
- Builds a `RuntimeContext` with in-memory state (sessions, models, approvals, workflows)
- Registers all IPC handlers via `registerAllIpcHandlers(ctx)` in `newApp/src/main/ipc/index.ts`
- IPC handler modules: bootstrap, sessions, models, tools, mcp, approvals, workflows, cloud

**Preload Bridge** (`newApp/src/preload/index.ts`):
- Exposes `window.myClawAPI` via `contextBridge.exposeInMainWorld()`
- Typed API surface (exported as `MyClawAPI` type) with `ipcRenderer.invoke()` calls
- Includes event subscription helpers (`onSessionStream`, `onApprovalResolved`) using `ipcRenderer.on()`

**Renderer** (`newApp/src/renderer/`):
- React 18 with Zustand state management
- Pages mirror the desktop Vue views (Chat, Hub, MCP, Skills, Workflows, etc.)
- `runtime-client.ts` provides typed fetch helpers for workflow run APIs
- Router: React Router DOM v6

### Key Difference from Tauri Desktop

| Aspect | Tauri Desktop | Electron newApp |
|--------|---------------|-----------------|
| Runtime process | Separate Node.js sidecar (HTTP) | In-process (Electron main) |
| IPC mechanism | HTTP REST + SSE over localhost | Electron IPC (invoke/handle) |
| Frontend framework | Vue 3 + Pinia | React 18 + Zustand |
| State persistence | JSON files via runtime store | Stub (in-memory only currently) |

### Shared Contracts (newApp)

- Location: `newApp/shared/contracts/`
- Contains: Same domain types as desktop shared -- approval, auth, builtin-tool, employee, events, mcp, model, session, skill, ui, workflow, workflow-run
- Import alias: `@shared/contracts`
- These are **duplicated** from `desktop/packages/shared/` -- not symlinked or shared

## Subsystem 3 -- Cloud Platform

### Process Model

```
 +---------------------+        $fetch proxy         +---------------------+      Prisma       +-------------+
 |  Nuxt 3 Web (BFF)   | -------------------------> |  NestJS API          | ----------------> | PostgreSQL  |
 |  cloud/apps/cloud-web|                            |  cloud/apps/cloud-api|                   |             |
 +---------------------+                            +---------------------+                   +-------------+
       port: dynamic                                      port: 43210
```

**Nuxt 3 BFF** (`cloud/apps/cloud-web/`):
- Server-side routes in `server/api/` proxy all requests to cloud-api
- Proxy utility: `cloud/apps/cloud-web/server/utils/cloud-api.ts` -- `proxyCloudApi()` forwards auth via cookie (`myclaw-cloud-session`)
- Pages: hub, skills, mcp, login, console
- Global auth middleware: `cloud/apps/cloud-web/middleware/platform-auth.global.ts`
- No direct database access -- all data comes through cloud-api

**NestJS API** (`cloud/apps/cloud-api/`):
- Modular architecture with 7 domain modules:
  - `DatabaseModule` (global) -- Prisma client wrapper
  - `AuthModule` -- login/introspect with internal auth provider, session repository
  - `HubModule` -- marketplace items and releases (MCP, employee packages, workflow packages)
  - `ArtifactModule` -- file storage for release artifacts (FastDFS integration)
  - `InstallModule` -- tracks install actions per account
  - `McpModule` -- MCP server registry
  - `SkillsModule` -- skill CRUD with category/tag filtering, release publishing with zip upload
- Each module follows: Controller -> Service -> Repository (interface) -> PrismaRepository (impl)
- Repository interfaces use NestJS `@Inject()` tokens for DI

**Prisma Schema** (`cloud/apps/cloud-api/prisma/schema.prisma`):
- Models: `LoginSession`, `HubItem`, `HubRelease`, `Skill`, `SkillRelease`, `InstallLog`
- Provider: PostgreSQL

**Cloud Shared Contracts** (`cloud/packages/shared/`):
- Types for: auth, employee-package, hub, install, mcp, skills
- Import alias: `@myclaw-cloud/shared`

## Key Abstractions

**RuntimeContext:**
- Purpose: Dependency container for the runtime process, holding state accessors and service references
- Desktop (Tauri): `desktop/apps/runtime/src/server/runtime-context.ts`
- Desktop (Electron): `newApp/src/main/services/runtime-context.ts`
- Pattern: Plain object with typed fields; created once at startup, passed to all route/IPC handlers

**ModelProfile:**
- Purpose: Represents a configured AI model endpoint (provider, base URL, API key, model name)
- Defined in: `desktop/packages/shared/src/contracts/model.ts`
- Used by: Model provider service to create appropriate client (OpenAI-compatible or Anthropic)

**ChatSession:**
- Purpose: A conversation with message history, attached model, and approval state
- Defined in: `desktop/packages/shared/src/contracts/session.ts`
- Lifecycle: Created -> messages added -> model responses streamed -> persisted to disk

**WorkflowDefinition / WorkflowGraphExecutor:**
- Purpose: DAG-based workflow with typed nodes, edges, state schema, and execution checkpoints
- Definition: `desktop/packages/shared/src/contracts/workflow.ts`
- Executor: `desktop/apps/runtime/src/services/workflow-graph-executor.ts`
- Pattern: Graph traversal with checkpoint-based resume after interruption

**ApprovalGateway:**
- Purpose: Intercepts tool execution intents and applies approval policy (auto-approve, always-ask, per-tool override)
- Location: `desktop/apps/runtime/src/services/approval-gateway.ts`
- Pattern: Request -> policy check -> approve/queue for human decision -> resume

## Entry Points

**Desktop Tauri Shell:**
- Location: `desktop/apps/desktop/src-tauri/src/main.rs`
- Triggers: OS launches the application
- Responsibilities: Start runtime sidecar, create Tauri webview, stop sidecar on exit

**Desktop Runtime Sidecar:**
- Location: `desktop/apps/runtime/src/index.ts`
- Triggers: Spawned by Tauri shell or manually via `pnpm dev`
- Responsibilities: HTTP server with all business logic, state management, model conversations

**Desktop Vue Frontend:**
- Location: `desktop/apps/desktop/src/main.ts`
- Triggers: Loaded in Tauri webview
- Responsibilities: UI rendering, routing, auth hydration, runtime client calls

**Electron Main:**
- Location: `newApp/src/main/index.ts`
- Triggers: `electron dist/main/index.js`
- Responsibilities: Window creation, IPC handler registration, runtime context bootstrap

**Cloud API:**
- Location: `cloud/apps/cloud-api/src/main.ts`
- Triggers: `pnpm dev` or production deploy
- Responsibilities: NestJS HTTP server on port 43210, all cloud data operations

**Cloud Web:**
- Location: `cloud/apps/cloud-web/nuxt.config.ts` (Nuxt auto-discovers pages/server)
- Triggers: `pnpm dev` or production deploy
- Responsibilities: SSR web UI, BFF proxy to cloud-api

## Error Handling

**Strategy:** Error-boundary at service boundaries with typed error responses

**Patterns:**
- Runtime HTTP handlers: Try/catch wrapping with JSON `{ error, detail }` response bodies; `throwHttpError()` in `runtime-client.ts` normalizes all non-2xx responses
- NestJS cloud-api: Standard NestJS exception filters (`UnauthorizedException`, `NotFoundException`, `BadRequestException`); custom error codes as string messages
- Cloud-web proxy: `proxyCloudApi()` catches `$fetch` errors and re-throws as `createError()` with status forwarding
- Frontend: Workspace store actions catch and surface errors to UI; router guards wrap auth checks in try/catch with fallback to login

## Cross-Cutting Concerns

**Logging:** `console.info` / `console.warn` / `console.error` with `[tag]` prefixes (e.g., `[desktop-router]`, `[cloud-api]`). No structured logging framework.

**Validation:** NestJS decorators on cloud-api controllers; runtime validates workflow definitions via `workflow-definition-validator.ts`; frontend relies on TypeScript types.

**Authentication:**
- Desktop: Token-based auth via `cloud-auth-client.ts` -> runtime proxy -> cloud-api `AuthService`; tokens stored in localStorage
- Cloud web: Cookie-based session (`myclaw-cloud-session`); global Nuxt middleware enforces auth
- Cloud API: `AuthService` with `InternalAuthProvider` DI token; bcrypt-style password hashing; JWT-like access/refresh token pairs with hash-based storage in `LoginSession` table

**State Persistence (Desktop):**
- Runtime state serialized to `~/.myclaw/runtime-state.json` (configurable via `RUNTIME_STATE_FILE_PATH`)
- Sessions, workflow definitions, and settings each have dedicated store files
- Workspace root resolved from `MYCLAW_WORKSPACE_ROOT` env var

---

*Architecture analysis: 2026-03-31*
