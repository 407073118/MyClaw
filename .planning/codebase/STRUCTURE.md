# Codebase Structure

**Analysis Date:** 2026-04-04

## Directory Layout

```text
MyClaw/
├── `AGENTS.md`                        # Repo-wide machine entry and hard rules
├── `docs/`                            # Governance, architecture, process, and product docs
├── `desktop/`                         # Electron + React desktop workspace
│   ├── `src/main/`                    # Electron main process and IPC handlers
│   ├── `src/preload/`                 # Safe bridge from Electron main to renderer
│   ├── `src/renderer/`                # React UI, routes, stores, pages, and components
│   ├── `shared/contracts/`            # Desktop-only shared contracts between main and renderer
│   ├── `config/`                      # Desktop environment selection and app config
│   ├── `tests/`                       # Desktop Vitest and integration-style tests
│   ├── `builtin-skills/`              # Seed skills copied into the user data root
│   └── `dist/`                        # Built output checked into the workspace
├── `cloud/`                           # Cloud pnpm workspace
│   ├── `apps/cloud-api/`              # NestJS backend
│   ├── `apps/cloud-web/`              # Nuxt web console with BFF handlers
│   ├── `packages/shared/`             # Cloud API and cloud web shared contracts
│   ├── `infra/`                       # Local infrastructure definitions
│   ├── `tests/`                       # Workspace-level cloud checks
│   └── `docs/`                        # Cloud workspace overview docs
└── `.planning/codebase/`              # Generated codebase mapping documents
```

## Directory Purposes

**Repository Root:**
- Purpose: Hold repo-wide rules and route work into the correct workspace.
- Contains: `AGENTS.md`, `docs/`, `.planning/`, plus the sibling workspaces `desktop/` and `cloud/`.
- Key files: `AGENTS.md`, `docs/architecture/overview.md`, `docs/architecture/layering-constraints.md`

**`docs/`:**
- Purpose: Store stable governance, architecture, process, design, and product documents for the whole repository.
- Contains: `docs/agents/`, `docs/architecture/`, `docs/processes/`, `docs/design/`, `docs/product/`
- Key files: `docs/agents/context-engineering.md`, `docs/architecture/domain-boundaries.md`, `docs/processes/code-review-checklist.md`

**`desktop/src/main/`:**
- Purpose: Implement the Electron main process and desktop runtime orchestration.
- Contains: `index.ts`, domain IPC handlers under `ipc/`, and runtime services under `services/`.
- Key files: `desktop/src/main/index.ts`, `desktop/src/main/ipc/index.ts`, `desktop/src/main/ipc/sessions.ts`, `desktop/src/main/services/runtime-context.ts`

**`desktop/src/preload/`:**
- Purpose: Expose the bridge API to the renderer.
- Contains: The single preload entry `index.ts`.
- Key files: `desktop/src/preload/index.ts`

**`desktop/src/renderer/`:**
- Purpose: Hold the React application.
- Contains: Router, layout shell, pages, components, hooks, stores, services, styles, and types.
- Key files: `desktop/src/renderer/main.tsx`, `desktop/src/renderer/App.tsx`, `desktop/src/renderer/router/index.tsx`, `desktop/src/renderer/layouts/AppShell.tsx`

**`desktop/shared/contracts/`:**
- Purpose: Define desktop contracts shared between Electron main and the renderer.
- Contains: Contract files grouped by domain such as `approval.ts`, `auth.ts`, `mcp.ts`, `session.ts`, and `workflow.ts`.
- Key files: `desktop/shared/contracts/index.ts`, `desktop/shared/index.ts`

**`desktop/config/`:**
- Purpose: Centralize environment-dependent desktop config.
- Contains: `env.development.ts`, `env.pre.ts`, `env.production.ts`, type definitions, and re-exports.
- Key files: `desktop/config/index.ts`, `desktop/config/types.ts`

**`desktop/tests/`:**
- Purpose: Hold desktop runtime and UI-facing tests.
- Contains: Feature-oriented test files such as `desktop/tests/workflow-ipc.test.ts` and multiple `phase*.test.ts` suites.
- Key files: `desktop/tests/workflow-ipc.test.ts`, `desktop/tests/platform-config.test.ts`, `desktop/tests/browser-service.test.ts`

**`desktop/builtin-skills/`:**
- Purpose: Ship built-in skill templates that are copied to the user's runtime data on first start.
- Contains: Seed skills and starter assets.
- Key files: `desktop/builtin-skills/skill-starter/SKILL.md`

**`cloud/apps/cloud-api/src/`:**
- Purpose: Hold the NestJS backend source tree.
- Contains: `main.ts`, `app.module.ts`, runtime helpers, and feature modules in `modules/`.
- Key files: `cloud/apps/cloud-api/src/main.ts`, `cloud/apps/cloud-api/src/app.module.ts`, `cloud/apps/cloud-api/src/runtime/load-runtime-env.ts`

**`cloud/apps/cloud-api/src/modules/`:**
- Purpose: Group backend behavior by domain.
- Contains: Feature folders such as `auth/`, `artifact/`, `install/`, `mcp/`, `skills/`, `hub/`, and `database/`.
- Key files: `cloud/apps/cloud-api/src/modules/auth/auth.module.ts`, `cloud/apps/cloud-api/src/modules/skills/skills.module.ts`, `cloud/apps/cloud-api/src/modules/database/database.module.ts`

**`cloud/apps/cloud-api/prisma/`:**
- Purpose: Define database schema and seed behavior for the backend.
- Contains: Prisma schema and seed scripts.
- Key files: `cloud/apps/cloud-api/prisma/schema.prisma`, `cloud/apps/cloud-api/prisma/seed.ts`

**`cloud/apps/cloud-web/`:**
- Purpose: Hold the Nuxt web console.
- Contains: Pages, layouts, components, composables, middleware, server-side BFF endpoints, assets, tests, and generated Nuxt directories.
- Key files: `cloud/apps/cloud-web/app.vue`, `cloud/apps/cloud-web/nuxt.config.ts`, `cloud/apps/cloud-web/pages/login.vue`, `cloud/apps/cloud-web/server/lib/cloud-api.ts`

**`cloud/apps/cloud-web/server/api/`:**
- Purpose: Provide a server-side proxy boundary between browser pages and the cloud API.
- Contains: Path-based H3 handlers mirroring backend routes under `auth/`, `hub/`, `mcp/`, and `skills/`.
- Key files: `cloud/apps/cloud-web/server/api/auth/login.post.ts`, `cloud/apps/cloud-web/server/api/hub/items.get.ts`, `cloud/apps/cloud-web/server/api/mcp/items.post.ts`

**`cloud/packages/shared/src/`:**
- Purpose: Define shared contracts for the cloud workspace.
- Contains: `contracts/` modules re-exported through `index.ts`.
- Key files: `cloud/packages/shared/src/index.ts`, `cloud/packages/shared/src/contracts/auth.ts`, `cloud/packages/shared/src/contracts/hub.ts`

**`cloud/infra/`:**
- Purpose: Hold infrastructure definitions used for local cloud development.
- Contains: Docker Compose assets referenced by root cloud scripts.
- Key files: `cloud/infra/docker-compose.yml`

**`cloud/tests/`:**
- Purpose: Run workspace-level guardrails that span multiple cloud packages.
- Contains: Runtime format, infrastructure, seed, workspace, and shared-package consumption tests.
- Key files: `cloud/tests/workspace.test.mjs`, `cloud/tests/infrastructure.test.mjs`, `cloud/tests/shared-package-consumption.test.mjs`

**`.planning/codebase/`:**
- Purpose: Store generated architecture, structure, stack, convention, testing, and concern maps.
- Contains: Mapper output only.
- Key files: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`

## Key File Locations

**Entry Points:**
- `desktop/src/main/index.ts`: Electron main process composition root.
- `desktop/src/preload/index.ts`: Electron preload bridge.
- `desktop/src/renderer/main.tsx`: Desktop renderer bootstrap.
- `cloud/apps/cloud-api/src/main.ts`: Cloud API bootstrap.
- `cloud/apps/cloud-web/app.vue`: Cloud web app entry.
- `cloud/apps/cloud-web/server/api/`: Cloud web BFF HTTP entry surface.

**Configuration:**
- `desktop/package.json`: Desktop scripts and Electron packaging configuration.
- `desktop/vite.config.ts`: Renderer build config and aliases.
- `desktop/tsconfig.main.json`: Desktop main-process TypeScript config and `@shared/*` path mapping.
- `desktop/tsconfig.renderer.json`: Desktop renderer TypeScript config and renderer aliases.
- `cloud/package.json`: Cloud workspace scripts and orchestration.
- `cloud/pnpm-workspace.yaml`: Cloud package graph.
- `cloud/apps/cloud-web/nuxt.config.ts`: Nuxt runtime config, CSS, and compatibility date.
- `cloud/apps/cloud-api/prisma/schema.prisma`: Cloud data model.

**Core Logic:**
- `desktop/src/main/ipc/`: Desktop domain handlers.
- `desktop/src/main/services/`: Desktop runtime services and helpers.
- `desktop/src/renderer/stores/workspace.ts`: Desktop client-side orchestrator store.
- `cloud/apps/cloud-api/src/modules/`: Cloud feature modules.
- `cloud/apps/cloud-web/server/lib/cloud-api.ts`: Cloud web proxy boundary.
- `cloud/packages/shared/src/contracts/`: Shared cloud payload contracts.

**Testing:**
- `desktop/tests/`: Desktop tests.
- `cloud/apps/cloud-api/src/modules/*/tests/`: Cloud API module tests.
- `cloud/apps/cloud-api/src/runtime/tests/`: Cloud runtime helper tests.
- `cloud/apps/cloud-web/tests/`: Cloud web tests.
- `cloud/tests/`: Cloud workspace-level tests.

## Naming Conventions

**Files:**
- Desktop React pages and larger UI components use PascalCase filenames such as `desktop/src/renderer/pages/ChatPage.tsx`, `desktop/src/renderer/pages/HubPage.tsx`, and `desktop/src/renderer/components/WebPanel.tsx`.
- Desktop main-process service and IPC files use kebab-case such as `desktop/src/main/services/state-persistence.ts`, `desktop/src/main/services/model-capability-resolver.ts`, and `desktop/src/main/ipc/skill-files.ts`.
- Desktop contract files under `desktop/shared/contracts/` use lower-kebab domain names such as `workflow-run.ts` and `builtin-tool.ts`.
- Cloud API Nest files follow Nest suffix naming with lowercase domain prefixes, for example `cloud/apps/cloud-api/src/modules/auth/auth.module.ts`, `cloud/apps/cloud-api/src/modules/auth/controllers/auth.controller.ts`, and `cloud/apps/cloud-api/src/modules/hub/repositories/prisma-hub.repository.ts`.
- Cloud web page files use route-driven lowercase names or Nuxt dynamic segment names such as `cloud/apps/cloud-web/pages/login.vue`, `cloud/apps/cloud-web/pages/hub.vue`, and `cloud/apps/cloud-web/pages/skills/[id].vue`.
- Cloud web BFF handlers use route-path filenames with HTTP verb suffixes such as `cloud/apps/cloud-web/server/api/skills.get.ts` and `cloud/apps/cloud-web/server/api/hub/releases/[releaseId]/manifest.get.ts`.

**Directories:**
- Desktop renderer directories are capability-based: `desktop/src/renderer/pages/`, `desktop/src/renderer/components/`, `desktop/src/renderer/stores/`, and `desktop/src/renderer/services/`.
- Desktop main directories are runtime-role based: `desktop/src/main/ipc/` for transport handlers and `desktop/src/main/services/` for reusable logic.
- Cloud API module directories are domain-based and then layer-based inside each domain: `controllers/`, `services/`, `ports/`, `repositories/`, `providers/`, and `tests/`.
- Cloud web directories separate page rendering from server transport: `pages/` for route components and `server/api/` for proxy handlers.

## Where to Add New Code

**New Desktop Feature:**
- Primary code: Put Electron-side logic in `desktop/src/main/services/` and transport registration in `desktop/src/main/ipc/`.
- Renderer UI: Add routes under `desktop/src/renderer/pages/`, layout or reusable UI under `desktop/src/renderer/components/`, and state wiring in `desktop/src/renderer/stores/`.
- Contracts: Add or extend types in `desktop/shared/contracts/` when the main/preload/renderer boundary changes.
- Tests: Add desktop tests under `desktop/tests/`.

**New Desktop IPC Surface:**
- Implementation: Add a domain registrar or extend an existing file under `desktop/src/main/ipc/`.
- Bridge exposure: Mirror the new channel in `desktop/src/preload/index.ts`.
- Renderer consumption: Call it from `desktop/src/renderer/stores/` or the specific page/component that owns the interaction.

**New Cloud API Endpoint:**
- Contracts first: Update `cloud/packages/shared/src/contracts/` when request or response shapes change.
- Module code: Add controller, service, port, repository, or provider code in the relevant `cloud/apps/cloud-api/src/modules/<domain>/` subtree.
- Runtime wiring: Register the module in `cloud/apps/cloud-api/src/app.module.ts` if it is a new top-level module.
- Tests: Add unit or module tests in `cloud/apps/cloud-api/src/modules/<domain>/tests/`.

**New Cloud Web Page Or Flow:**
- Page route: Add the page file under `cloud/apps/cloud-web/pages/`.
- Server proxy: Add or extend the matching handler under `cloud/apps/cloud-web/server/api/`.
- Shared state or auth behavior: Use `cloud/apps/cloud-web/composables/` and `cloud/apps/cloud-web/middleware/`.
- Shared types: Import from `cloud/packages/shared/src/` through the workspace package instead of redefining payloads locally.

**Utilities:**
- Desktop runtime helper: `desktop/src/main/services/`
- Desktop renderer helper: `desktop/src/renderer/utils/` or `desktop/src/renderer/services/`
- Cloud API cross-module helper: Prefer module-local helpers first; shared infrastructure belongs under `cloud/apps/cloud-api/src/modules/database/` or a clearly named module-local utility file.
- Cloud web shared helper: `cloud/apps/cloud-web/utils/` or `cloud/apps/cloud-web/server/utils/` depending on browser or server ownership.

## Special Directories

**`desktop/dist/`:**
- Purpose: Built desktop output for main, preload, renderer, config, and shared contracts.
- Generated: Yes
- Committed: Yes

**`cloud/apps/cloud-api/dist/`:**
- Purpose: Compiled cloud API output.
- Generated: Yes
- Committed: Yes

**`cloud/apps/cloud-api/bundle/`:**
- Purpose: Packaged cloud API deployment bundle produced by `cloud/apps/cloud-api/scripts/bundle.mjs`.
- Generated: Yes
- Committed: Yes

**`cloud/apps/cloud-web/.output/`:**
- Purpose: Nuxt production build output.
- Generated: Yes
- Committed: Yes

**`cloud/apps/cloud-web/.nuxt/`:**
- Purpose: Nuxt development/build cache and generated type artifacts.
- Generated: Yes
- Committed: Yes

**`desktop/builtin-skills/`:**
- Purpose: Seed content copied into the user data root on first desktop startup.
- Generated: No
- Committed: Yes

**`cloud/node_modules/` and `desktop/node_modules/`:**
- Purpose: Installed dependencies inside each workspace.
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-04-04*
