# Codebase Structure

**Analysis Date:** 2026-03-31

## Directory Layout

```
MyClaw/
├── desktop/                    # Tauri + Vue 3 desktop app (pnpm workspace)
│   ├── apps/
│   │   ├── desktop/            # Tauri shell + Vue 3 frontend
│   │   │   ├── src/            # Vue 3 SPA source
│   │   │   └── src-tauri/      # Rust Tauri shell + sidecar supervisor
│   │   └── runtime/            # Node.js runtime sidecar (HTTP server)
│   │       └── src/
│   └── packages/
│       └── shared/             # Shared TypeScript contracts (@myclaw-desktop/shared)
│           └── src/contracts/
├── desktop/                     # Electron + React migration (single package)
│   ├── shared/                 # Shared contracts (@shared/contracts)
│   │   └── contracts/
│   └── src/
│       ├── main/               # Electron main process
│       │   ├── ipc/            # IPC handler modules
│       │   └── services/       # Runtime context, tool stubs
│       ├── preload/            # contextBridge preload script
│       └── renderer/           # React 18 SPA
│           ├── components/     # Reusable UI components
│           ├── hooks/          # React hooks
│           ├── layouts/        # Layout wrappers
│           ├── pages/          # Page components (route targets)
│           ├── router/         # React Router config
│           ├── services/       # API client functions
│           ├── stores/         # Zustand stores
│           ├── styles/         # Global CSS
│           ├── types/          # TypeScript type augmentations
│           └── utils/          # Helpers
├── cloud/                      # Cloud platform (pnpm workspace)
│   ├── apps/
│   │   ├── cloud-api/          # NestJS backend API
│   │   │   ├── prisma/         # Prisma schema + migrations
│   │   │   └── src/
│   │   │       ├── modules/    # NestJS domain modules
│   │   │       └── runtime/    # Env loading utilities
│   │   └── cloud-web/          # Nuxt 3 BFF + SSR frontend
│   │       ├── assets/css/     # Stylesheets
│   │       ├── components/     # Vue components
│   │       ├── composables/    # Vue composables
│   │       ├── layouts/        # Nuxt layouts
│   │       ├── middleware/     # Route middleware (auth)
│   │       ├── pages/          # File-based routes
│   │       ├── server/         # Nitro server routes (BFF proxy)
│   │       │   ├── api/        # API route handlers
│   │       │   └── utils/      # Server utilities (cloud-api proxy)
│   │       ├── tests/          # Vitest page tests
│   │       ├── types/          # TypeScript types
│   │       └── utils/          # Client-side utilities
│   ├── packages/
│   │   └── shared/             # Shared contracts (@myclaw-cloud/shared)
│   │       └── src/contracts/
│   ├── infra/                  # Docker compose for dev database
│   ├── docs/                   # Architecture and planning docs
│   └── tests/                  # Workspace-level integration tests
├── docs/                       # Top-level documentation
│   ├── agents/
│   ├── architecture/
│   ├── design/
│   ├── plans/
│   ├── processes/
│   └── product/
├── nothing/                    # Empty/placeholder directory
├── AGENTS.md                   # Agent configuration
└── README.md                   # Project readme
```

## Directory Purposes

**`desktop/apps/desktop/src/`**
- Purpose: Vue 3 single-page application for the desktop UI
- Contains: Views, components, router, Pinia stores, service clients
- Key files:
  - `main.ts` -- app entry, creates Pinia + Router
  - `App.vue` -- root component, renders `AppShell`
  - `router/index.ts` -- all routes with auth guards
  - `stores/workspace.ts` -- central store orchestrating all runtime calls
  - `stores/auth.ts` -- cloud auth session management
  - `stores/shell.ts` -- runtime base URL and attached directory
  - `services/runtime-client.ts` -- typed HTTP client to runtime sidecar (~1200 lines)
  - `services/cloud-hub-client.ts` -- cloud hub browsing APIs
  - `services/cloud-auth-client.ts` -- cloud auth proxy calls

**`desktop/apps/desktop/src-tauri/`**
- Purpose: Rust Tauri application shell that hosts webview and manages runtime sidecar
- Contains: Rust source, Cargo config, binary assets, icons
- Key files:
  - `src/main.rs` -- Tauri entry point, starts/stops sidecar
  - `src/runtime_supervisor.rs` -- sidecar lifecycle: spawn, health check, stop
  - `binaries/` -- bundled runtime sidecar executables (production)

**`desktop/apps/runtime/src/`**
- Purpose: Node.js HTTP runtime server -- all business logic lives here
- Contains: Server framework, route handlers, services, stores
- Key files:
  - `index.ts` -- process entry, creates server on port 43110
  - `server.ts` -- re-export shim for `create-runtime-app.ts`
  - `server/create-runtime-app.ts` -- main server setup (~1500+ lines, large file)
  - `server/http/router.ts` -- minimal HTTP router (method + path matching)
  - `server/http/session-stream.ts` -- SSE streaming for chat sessions
  - `server/routes/bootstrap.ts` -- `/api/bootstrap` endpoint
  - `server/routes/sessions.ts` -- session CRUD endpoints
  - `server/runtime-context.ts` -- shared context container type
  - `routes.ts` -- bootstrap response shape definition

**`desktop/apps/runtime/src/services/`**
- Purpose: All runtime business logic services
- Contains: ~40+ service files
- Key files:
  - `model-provider/` -- LLM provider adapters (OpenAI-compatible, Anthropic)
  - `model-provider/facade.ts` -- unified model conversation interface
  - `model-provider/tool-definitions.ts` -- tool schema for model conversations
  - `builtin-tool-registry.ts` -- registers and resolves built-in tools
  - `builtin-tool-executor.ts` -- executes built-in tool calls
  - `tool-executor.ts` -- unified tool execution (builtin + MCP)
  - `mcp-service.ts` -- MCP server management and tool discovery
  - `mcp-manager.ts` -- MCP connection lifecycle
  - `workflow-graph-executor.ts` -- DAG workflow engine
  - `workflow-checkpoint-store.ts` -- checkpoint persistence for workflow runs
  - `workflow-definition-validator.ts` -- validates workflow graph structure
  - `approval-gateway.ts` -- tool execution approval logic
  - `skill-manager.ts` -- local skill file discovery
  - `employee-runner.ts` -- agent/employee execution
  - `session-persistence.ts` -- session snapshot save/load
  - `a2ui.ts` -- assistant-to-UI prompt system
  - `directory-service.ts` -- file system operations
  - `process-executor.ts` -- shell command execution
  - `hub-package-installer.ts` -- hub package download and install
  - `publish-draft-manager.ts` -- creates publish drafts for hub
  - `cloud-hub-proxy.ts` -- proxies cloud hub requests
  - `mcporter-adapter.ts` -- MCP import adapter interface
  - `live-mcporter-adapter.ts` -- live MCP import implementation
  - `runtime-heartbeat.ts` -- periodic health signaling

**`desktop/apps/runtime/src/store/`**
- Purpose: In-memory state containers with file-based persistence
- Contains: Store modules for each domain entity
- Key files:
  - `runtime-state-store.ts` -- top-level state load/save
  - `settings-store.ts` -- model profiles, approval policy, MCP configs
  - `session-store.ts` -- chat session mutations
  - `employee-store.ts` -- employee state
  - `workflow-definition-store.ts` -- workflow CRUD on disk
  - `workflow-store.ts` -- workflow run state
  - `memory-store.ts` -- conversation memory
  - `pending-work-store.ts` -- pending work items

**`desktop/packages/shared/src/contracts/`**
- Purpose: TypeScript type definitions shared between desktop frontend and runtime
- Contains: 12 contract files covering all domain types
- Key files:
  - `session.ts` -- ChatSession, ChatMessage types
  - `model.ts` -- ModelProfile type
  - `workflow.ts` -- WorkflowDefinition, nodes, edges
  - `workflow-run.ts` -- WorkflowRunStatus, WorkflowRunSummary
  - `approval.ts` -- ApprovalPolicy, ApprovalRequest, ApprovalDecision
  - `mcp.ts` -- McpServer, McpServerConfig, McpToolPreference
  - `builtin-tool.ts` -- BuiltinToolDefinition, ToolRiskCategory
  - `employee.ts` -- LocalEmployeeSummary
  - `skill.ts` -- SkillDefinition, SkillDetail
  - `auth.ts` -- AuthLoginRequest, AuthLoginResponse, AuthUser
  - `events.ts` -- event type definitions
  - `ui.ts` -- UI-specific types

**`desktop/src/main/`**
- Purpose: Electron main process with IPC handlers
- Contains: App lifecycle, IPC registration, runtime context
- Key files:
  - `index.ts` -- Electron app entry, window creation, IPC setup
  - `ipc/index.ts` -- registers all IPC handler modules
  - `ipc/bootstrap.ts` -- `app:bootstrap` handler
  - `ipc/sessions.ts` -- session CRUD handlers
  - `ipc/models.ts` -- model CRUD handlers
  - `ipc/tools.ts` -- tool listing/execution handlers
  - `ipc/mcp.ts` -- MCP server management handlers
  - `ipc/approvals.ts` -- approval policy/resolution handlers
  - `ipc/workflows.ts` -- workflow handlers
  - `ipc/cloud.ts` -- cloud hub and auth handlers
  - `services/runtime-context.ts` -- runtime context type and factory
  - `services/builtin-tool-stubs.ts` -- tool definition stubs

**`desktop/src/preload/`**
- Purpose: Electron preload script exposing typed API to renderer
- Contains: Single file
- Key file: `index.ts` -- `contextBridge.exposeInMainWorld("myClawAPI", ...)` with full typed API

**`desktop/src/renderer/`**
- Purpose: React 18 SPA for the Electron renderer process
- Contains: Pages, components, stores, hooks, services
- Key files:
  - `main.tsx` -- React entry, Zustand auth hydration
  - `App.tsx` -- root component with router
  - `pages/*.tsx` -- one page per route (mirrors desktop views)
  - `stores/workspace.ts` -- central Zustand store
  - `stores/auth.ts` -- auth state
  - `stores/shell.ts` -- shell configuration
  - `services/runtime-client.ts` -- workflow run fetch helpers
  - `hooks/useAuth.ts` -- auth hook

**`desktop/shared/contracts/`**
- Purpose: TypeScript domain types for the Electron app
- Contains: Duplicated contract files from desktop shared
- Key file: `index.ts` -- barrel export

**`cloud/apps/cloud-api/src/modules/`**
- Purpose: NestJS domain modules -- each is a self-contained feature
- Contains: 7 modules
- Structure per module: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.repository.ts` (interface), `prisma-*.repository.ts` (implementation)
- Modules:
  - `auth/` -- login, token management, session repository
  - `hub/` -- marketplace items and releases
  - `artifact/` -- file storage (FastDFS adapter)
  - `database/` -- global Prisma client (DatabaseService)
  - `install/` -- install log tracking
  - `mcp/` -- MCP server items
  - `skills/` -- skill CRUD, release publishing, zip upload

**`cloud/apps/cloud-web/server/api/`**
- Purpose: Nuxt server routes that proxy to cloud-api
- Contains: File-based API routes organized by domain
- Key routes:
  - `auth/login.post.ts`, `auth/introspect.post.ts`
  - `hub/items.get.ts`, `hub/items/[id]/[id].get.ts`
  - `hub/releases/[releaseId]/[releaseId].get.ts` (pattern unclear -- nested dynamic segments)
  - `skills.get.ts`, `skills.post.ts`
  - `skills/[id]/[id].get.ts`, `skills/[id].put.ts`
  - `mcp/items.get.ts`, `mcp/items/[id]/[id].get.ts`

**`cloud/apps/cloud-web/pages/`**
- Purpose: Nuxt file-based page routes
- Contains: Vue SFC pages
- Pages:
  - `index.vue` -- landing/redirect
  - `login.vue` -- authentication
  - `hub.vue` -- marketplace browse
  - `console.vue` -- admin console
  - `skills/index.vue` -- skill listing
  - `skills/[id].vue` -- skill detail
  - `skills/publish.vue` -- skill publishing
  - `mcp/` -- MCP pages

**`cloud/packages/shared/src/contracts/`**
- Purpose: TypeScript types shared between cloud-web and cloud-api
- Contains: 6 contract files
- Key files:
  - `auth.ts` -- AuthLoginRequest, AuthLoginResponse, AuthIntrospectResponse
  - `hub.ts` -- HubItem, HubRelease types
  - `skills.ts` -- Skill, SkillRelease, CreateSkillInput, SkillCategory
  - `mcp.ts` -- MCP contract types
  - `employee-package.ts` -- employee package manifest
  - `install.ts` -- install log types

## Key File Locations

**Entry Points:**
- `desktop/apps/desktop/src/main.ts`: Desktop Vue app bootstrap
- `desktop/apps/desktop/src-tauri/src/main.rs`: Tauri shell entry
- `desktop/apps/runtime/src/index.ts`: Runtime sidecar entry
- `desktop/src/main/index.ts`: Electron main process entry
- `desktop/src/renderer/main.tsx`: Electron renderer entry
- `cloud/apps/cloud-api/src/main.ts`: NestJS API bootstrap
- `cloud/apps/cloud-web/nuxt.config.ts`: Nuxt app config (auto-discovers pages/server)

**Configuration:**
- `desktop/pnpm-workspace.yaml`: Desktop monorepo workspace config
- `cloud/pnpm-workspace.yaml`: Cloud monorepo workspace config
- `cloud/apps/cloud-api/prisma/schema.prisma`: Database schema
- `cloud/apps/cloud-web/nuxt.config.ts`: Nuxt runtime config (cloudApiBase)
- `cloud/infra/docker-compose.yml`: Dev database container
- `desktop/package.json`: Electron app config with electron-builder settings

**Core Logic:**
- `desktop/apps/runtime/src/server/create-runtime-app.ts`: Main runtime server setup (largest file)
- `desktop/apps/runtime/src/services/model-provider/facade.ts`: Model provider abstraction
- `desktop/apps/runtime/src/services/workflow-graph-executor.ts`: Workflow engine
- `desktop/apps/runtime/src/services/approval-gateway.ts`: Tool approval system
- `desktop/apps/runtime/src/services/mcp-service.ts`: MCP tool management
- `cloud/apps/cloud-api/src/modules/auth/auth.service.ts`: Cloud auth logic
- `cloud/apps/cloud-api/src/modules/skills/skills.service.ts`: Skills business logic

**Testing:**
- `desktop/apps/runtime/src/services/*.test.ts`: Unit tests co-located with services
- `desktop/apps/runtime/src/store/*.test.ts`: Store unit tests
- `desktop/apps/runtime/tests/`: Additional test directory
- `desktop/apps/desktop/src/tests/`: Frontend component/view tests
- `cloud/apps/cloud-web/tests/pages.test.mjs`: Cloud web page tests
- `cloud/apps/cloud-api/src/modules/*/test files`: API module tests
- `cloud/tests/`: Workspace-level integration tests

## Naming Conventions

**Files:**
- kebab-case for all TypeScript/Vue/React files: `runtime-client.ts`, `ChatView.vue`, `ChatPage.tsx`
- Vue views use PascalCase with `View` suffix: `ChatView.vue`, `HubView.vue`
- React pages use PascalCase with `Page` suffix: `ChatPage.tsx`, `HubPage.tsx`
- Vue components use PascalCase: `WorkflowCanvas.vue`, `McpServerForm.vue`
- Test files use `.test.ts` or `.test.mjs` suffix, co-located with source
- NestJS follows: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `*.repository.ts`
- Prisma repositories prefixed: `prisma-*.repository.ts`

**Directories:**
- All lowercase kebab-case: `cloud-api`, `cloud-web`, `model-provider`
- Plural for collections: `services`, `stores`, `contracts`, `modules`, `pages`, `components`

## Where to Add New Code

**New Desktop Feature (Tauri):**
- Add runtime service: `desktop/apps/runtime/src/services/[feature-name].ts`
- Add runtime store (if stateful): `desktop/apps/runtime/src/store/[feature-name]-store.ts`
- Add HTTP routes in `desktop/apps/runtime/src/server/create-runtime-app.ts` (or extract to `server/routes/`)
- Add shared types: `desktop/packages/shared/src/contracts/[feature-name].ts` and re-export from `index.ts`
- Add frontend service call: `desktop/apps/desktop/src/services/runtime-client.ts`
- Add store actions: `desktop/apps/desktop/src/stores/workspace.ts`
- Add view: `desktop/apps/desktop/src/views/[FeatureName]View.vue`
- Add route: `desktop/apps/desktop/src/router/index.ts`
- Add tests: Co-locate `*.test.ts` next to source files

**New Desktop Feature (Electron/desktop):**
- Add IPC handler module: `desktop/src/main/ipc/[feature-name].ts`
- Register in `desktop/src/main/ipc/index.ts`
- Add shared contract types: `desktop/shared/contracts/[feature-name].ts`
- Add preload API methods: `desktop/src/preload/index.ts`
- Add renderer page: `desktop/src/renderer/pages/[FeatureName]Page.tsx`
- Add route: `desktop/src/renderer/router/`
- Add Zustand store: `desktop/src/renderer/stores/[feature-name].ts`

**New Cloud API Module:**
- Create module directory: `cloud/apps/cloud-api/src/modules/[feature-name]/`
- Create files: `[feature-name].module.ts`, `[feature-name].controller.ts`, `[feature-name].service.ts`, `[feature-name].repository.ts`, `prisma-[feature-name].repository.ts`
- Register module in `cloud/apps/cloud-api/src/app.module.ts`
- Add Prisma models: `cloud/apps/cloud-api/prisma/schema.prisma`
- Add shared types: `cloud/packages/shared/src/contracts/[feature-name].ts`

**New Cloud Web Page:**
- Add page: `cloud/apps/cloud-web/pages/[feature-name].vue` (or `[feature-name]/index.vue` for directory)
- Add BFF proxy route: `cloud/apps/cloud-web/server/api/[feature-name].get.ts` (or other method)
- Add component: `cloud/apps/cloud-web/components/[ComponentName].vue`
- Add composable: `cloud/apps/cloud-web/composables/use[FeatureName].ts`

**New Desktop UI Component:**
- Vue component: `desktop/apps/desktop/src/components/[domain]/[ComponentName].vue`
- React component: `desktop/src/renderer/components/[domain]/[ComponentName].tsx`

**New Utility:**
- Desktop runtime: `desktop/apps/runtime/src/services/[utility-name].ts`
- Desktop frontend: `desktop/apps/desktop/src/utils/`
- Cloud web: `cloud/apps/cloud-web/utils/`
- Electron renderer: `desktop/src/renderer/utils/`

## Special Directories

**`desktop/apps/desktop/src-tauri/target/`**
- Purpose: Rust build artifacts (debug/release)
- Generated: Yes
- Committed: No (should be gitignored)

**`desktop/apps/desktop/src-tauri/binaries/`**
- Purpose: Bundled runtime sidecar executables for production
- Generated: By build process
- Committed: Varies (placeholder or built artifacts)

**`cloud/apps/cloud-web/.nuxt/`**
- Purpose: Nuxt build cache and generated types
- Generated: Yes
- Committed: No

**`cloud/apps/cloud-web/.output/`**
- Purpose: Nuxt production build output
- Generated: Yes
- Committed: No

**`desktop/.pnpm-store/`**
- Purpose: Local pnpm package store cache
- Generated: Yes
- Committed: No

**`cloud/infra/`**
- Purpose: Infrastructure configuration (Docker Compose for dev PostgreSQL)
- Generated: No
- Committed: Yes

**`.planning/`**
- Purpose: GSD planning and codebase analysis documents
- Generated: By analysis tools
- Committed: Yes

---

*Structure analysis: 2026-03-31*
