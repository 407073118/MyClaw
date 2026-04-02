# Coding Conventions

**Analysis Date:** 2026-03-31

## Project Layout

The repo contains three top-level products, each with distinct UI frameworks:

| Product | UI Framework | State Mgmt | Path |
|---------|-------------|------------|------|
| desktop (Tauri app) | Vue 3 + SFC | Pinia | `desktop/apps/desktop/` |
| newApp (Electron app) | React 18 + TSX | Zustand | `newApp/src/renderer/` |
| cloud-web (Nuxt 4) | Vue 3 + SFC | Nuxt composables | `cloud/apps/cloud-web/` |
| cloud-api (NestJS) | N/A | N/A | `cloud/apps/cloud-api/` |
| runtime (Node service) | N/A | N/A | `desktop/apps/runtime/` |

Both `desktop/` and `cloud/` are pnpm workspaces with `packages/shared/` sub-packages.

## Naming Patterns

**Files:**
- Vue SFC components: PascalCase (`WorkflowCanvas.vue`, `McpLibraryCard.vue`)
- React TSX components: PascalCase (`WorkflowCanvas.tsx`, `ChatPage.tsx`)
- Pure TS modules: kebab-case (`workflow-canvas-geometry.ts`, `cloud-hub-client.ts`, `runtime-client.ts`)
- Test files: co-located `*.test.ts` for runtime/api; separate `src/tests/` tree for desktop Vue tests
- NestJS modules: kebab-case with dot-separated role suffix (`auth.service.ts`, `auth.controller.ts`, `auth.module.ts`)
- Nuxt server routes: follow file-based routing with HTTP-method suffix (`skills.get.ts`, `[id].put.ts`, `login.post.ts`)

**Vue views vs pages:**
- desktop: `src/views/` with `*View.vue` suffix (`ChatView.vue`, `HubView.vue`, `McpDetailView.vue`)
- newApp: `src/renderer/pages/` with `*Page.tsx` suffix (`ChatPage.tsx`, `HubPage.tsx`)
- cloud-web: `pages/` with lowercase filenames per Nuxt convention (`login.vue`, `console.vue`, `skills/[id].vue`)

**Functions:**
- Use camelCase for all functions and methods
- Store action names are verb-first: `hydrateFromStorage()`, `persistSession()`, `applyLoginSession()`
- Service client functions are verb-prefixed: `fetchCloudHubItems()`, `loginCloudAuth()`, `createSession()`
- In workspace store, imported request functions are aliased to avoid collisions: `createEmployee as createEmployeeRequest`

**Variables:**
- Use camelCase for variables and parameters
- Constants use UPPER_SNAKE_CASE for module-level values: `AUTH_STORAGE_KEY`, `ACCESS_TOKEN_EXPIRES_IN_SECONDS`
- Exported const tokens for DI use UPPER_SNAKE_CASE Symbols: `HUB_REPOSITORY`, `INTERNAL_AUTH_PROVIDER`, `SKILLS_REPOSITORY`

**Types:**
- PascalCase for all types and interfaces
- Prefer `type` over `interface` for data shapes; use `interface` for repository/provider contracts
- Use `as const` for union-generating arrays: `BUILTIN_TOOL_GROUPS`, `BUILTIN_TOOL_APPROVAL_MODES`
- Derive union types from const arrays: `type BuiltinToolGroup = (typeof BUILTIN_TOOL_GROUPS)[number]`

## Code Style

**Formatting:**
- No ESLint or Prettier configuration detected in any workspace
- Consistent 2-space indentation across all TypeScript and Vue files
- Double-quoted strings throughout all workspaces
- Trailing commas on multiline arrays, objects, and function parameters
- Semicolons required at end of statements

**TypeScript:**
- All workspaces use `strict: true` in tsconfig
- Target ES2022, module ESNext, moduleResolution Bundler
- cloud tsconfig additionally enables `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`
- Explicit type annotations on function parameters; return types inferred unless complex
- Use `type` imports with `import type { ... }` syntax consistently

## Import Organization

**Order:**
1. Node built-ins (`node:http`, `node:fs`, `node:path`)
2. Framework/library imports (`vue`, `pinia`, `@nestjs/common`, `vitest`)
3. Workspace package imports (`@myclaw-desktop/shared`, `@myclaw-cloud/shared`)
4. Path-aliased local imports (`@/services/...`, `@/stores/...`)
5. Relative imports (`./auth.service`, `../artifact/artifact.service`)

**Path Aliases:**
- desktop: `@` maps to `src/` (configured in `desktop/apps/desktop/vite.config.ts`)
- newApp: `@` maps to `src/renderer/`, `@shared` maps to `shared/` (configured in `newApp/vite.config.ts`)
- cloud-api: `@myclaw-cloud/shared` mapped via tsconfig paths
- cloud-web: auto-imports via Nuxt (composables, utils)

**Type-only imports:**
- Always use `import type { ... }` for type-only imports, separated from value imports

## State Management

**desktop (Pinia):**
- Stores in `desktop/apps/desktop/src/stores/`
- Use `defineStore("store-id", { state, getters, actions })` (Options API style)
- Large central `workspace` store acts as single source of truth, hydrated from runtime bootstrap
- Auth store is separate: `desktop/apps/desktop/src/stores/auth.ts`
- Shell store holds runtime connection info: `desktop/apps/desktop/src/stores/shell.ts`

**newApp (Zustand):**
- Stores in `newApp/src/renderer/stores/`
- Use `create<State>()((set, get) => ({ ... }))` pattern
- Same domain structure mirrored from desktop: `workspace.ts`, `auth.ts`, `shell.ts`

**cloud-web (Nuxt composables):**
- Session composable in `cloud/apps/cloud-web/composables/useCloudSession.ts`
- Uses `useState()` for SSR-safe reactive state, `useCookie()` for persistence
- No Pinia dependency in cloud-web

## Error Handling

**cloud-api (NestJS):**
- Throw NestJS HTTP exceptions directly: `throw new UnauthorizedException("account_or_password_invalid")`
- Error messages are snake_case string codes: `"account_or_password_required"`, `"skill_already_exists"`
- Catch provider errors by exception type and re-throw with semantic codes
- Service methods validate inputs and throw `BadRequestException` / `NotFoundException` for domain rules

**cloud-web server routes:**
- Use `createError()` from h3 to throw HTTP errors
- Forward cloud-api error responses with status code and message

**desktop/runtime:**
- Console-based logging with structured context objects: `console.info("[desktop-auth] message", { key: value })`
- Async actions wrap errors in try/catch and log before propagating
- No centralized error boundary; each store action handles its own errors

## Logging

**Framework:** `console` (no external logging framework)

**Patterns:**
- Prefix log messages with a bracketed tag: `[desktop-auth]`, `[desktop-router]`
- Log structured context as second argument: `console.info("[tag] message", { key: value })`
- Use `console.info` for normal flow, `console.warn` for recoverable errors, `console.error` sparingly
- Log messages are in Chinese for user-facing desktop flows

## Comments

**When to Comment:**
- JSDoc-style comments (`/** ... */`) on store actions and service methods
- Comments are written in Chinese for desktop and cloud code
- No inline `//` comments for obvious code; use them for non-obvious logic

**JSDoc/TSDoc:**
- Used on Pinia store actions and getters: `/** 从本地存储恢复桌面登录态... */`
- Used on exported functions in router/service modules
- Not used on type definitions (types are self-documenting)

## Repository/Provider Pattern (cloud-api)

**Pattern:** Interface + Symbol token + Prisma implementation

- Define the interface in a dedicated file: `hub.repository.ts` exports `interface HubRepository` and `const HUB_REPOSITORY = Symbol("HUB_REPOSITORY")`
- Implement with Prisma: `prisma-hub.repository.ts` exports `class PrismaHubRepository implements HubRepository`
- Wire in the module: `{ provide: HUB_REPOSITORY, useExisting: PrismaHubRepository }`
- Services inject via `@Inject(HUB_REPOSITORY) private readonly hubRepository: HubRepository`

Apply this pattern for all new cloud-api domain modules.

## NestJS Module Organization

Each domain is a self-contained module directory under `cloud/apps/cloud-api/src/modules/`:

```
modules/auth/
  auth.module.ts          # Module definition
  auth.controller.ts      # HTTP endpoints
  auth.service.ts         # Business logic
  auth.service.test.ts    # Unit tests
  auth-session.repository.ts        # Interface
  prisma-auth-session.repository.ts # Prisma impl
  internal-auth-provider.ts         # Port interface
  mock-internal-auth.provider.ts    # Test double
  cas-internal-auth.provider.ts     # Production impl
```

## Shared Package Conventions

**desktop shared:** `desktop/packages/shared/src/`
- Contract types per domain: `contracts/session.ts`, `contracts/mcp.ts`, `contracts/workflow.ts`
- Re-exported from `src/index.ts`
- Referenced as `@myclaw-desktop/shared`

**cloud shared:** `cloud/packages/shared/src/`
- Contract types: `contracts/auth.ts`, `contracts/hub.ts`, `contracts/skills.ts`
- Re-exported from `src/index.ts`
- Referenced as `@myclaw-cloud/shared`

## Component Conventions (Vue)

**Template:**
- Use `data-testid` attributes on interactive and verifiable elements
- Use kebab-case for custom events
- Inline SVG icons (no icon library in desktop)
- lucide-vue-next for cloud-web icons

**Script:**
- `<script setup lang="ts">` for all Vue SFCs
- Import stores with `useXxxStore()` composables
- Destructure store into local refs as needed

## Function Design

**Size:** Functions are generally kept short (under 30 lines). Large orchestration functions exist in stores.

**Parameters:** Use typed objects for functions with more than 2 parameters. Single responsibility per function.

**Return Values:** Explicit return types on complex functions. Boolean returns for auth/validation operations.

## Module Design

**Exports:** Named exports only. No default exports except for Vue SFC components and Vite config.

**Barrel Files:** Shared packages use `src/index.ts` barrel files. Application code does not use barrel files.

---

*Convention analysis: 2026-03-31*
