# Coding Conventions

**Analysis Date:** 2026-04-04

## Naming Patterns

**Files:**
- Match the local workspace instead of forcing one repo-wide formatter style.
- In `desktop/src/renderer/pages` and `desktop/src/renderer/components`, React page/component files use `PascalCase.tsx`, such as `desktop/src/renderer/pages/WorkflowsPage.tsx` and `desktop/src/renderer/components/ErrorBoundary.tsx`.
- In `desktop/src/renderer/hooks`, hooks use `useX.ts`, such as `desktop/src/renderer/hooks/useAuth.ts`.
- In `desktop/src/renderer/stores`, Zustand stores use short lowercase nouns, such as `desktop/src/renderer/stores/auth.ts` and `desktop/src/renderer/stores/workspace.ts`.
- In `desktop/src/main/services`, service and utility files use kebab-case, such as `desktop/src/main/services/mcp-server-manager.ts` and `desktop/src/main/services/tool-output-sanitizer.ts`.
- In `cloud/apps/cloud-api/src/modules`, NestJS files follow `<domain>.<role>.ts` plus `tests/`, such as `cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts`, `cloud/apps/cloud-api/src/modules/hub/services/hub.service.ts`, and `cloud/apps/cloud-api/src/modules/hub/tests/hub.controller.test.ts`.
- In `cloud/apps/cloud-web/server/api`, Nuxt server handlers follow route-based filenames such as `cloud/apps/cloud-web/server/api/auth/login.post.ts` and `cloud/apps/cloud-web/server/api/hub/items/[id]/workflow-releases.post.ts`.
- In `cloud/packages/shared/src/contracts`, contract files use lowercase kebab-case domain names such as `cloud/packages/shared/src/contracts/mcp.ts`.

**Functions:**
- Use `camelCase` for functions and methods across all workspaces, such as `buildToolSchemas` in `desktop/src/main/services/tool-schemas.ts`, `captureOriginalMeta` in `cloud/apps/cloud-web/pages/skills/publish.vue`, and `resolveLoginCredentials` in `cloud/apps/cloud-api/src/modules/auth/services/auth.service.ts`.
- Use verb-first handler names for UI and route actions, such as `handlePublish` in `cloud/apps/cloud-web/pages/skills/publish.vue`, `handleExecute` in `desktop/src/renderer/pages/WorkflowsPage.tsx`, and `loadRuntimeEnv` in `cloud/apps/cloud-api/src/runtime/load-runtime-env.ts`.
- Use `createX`, `buildX`, `resolveX`, `normalizeX`, and `parseX` for helpers, as seen in `desktop/src/renderer/stores/auth.ts`, `desktop/src/main/services/tool-schemas.ts`, and `cloud/apps/cloud-web/server/lib/cloud-api.ts`.

**Variables:**
- Use `camelCase` for local variables and object properties, including longer intent-revealing names such as `accessTokenExpiresAt` in `cloud/apps/cloud-api/src/modules/auth/services/auth.service.ts`, `showCategoryPicker` in `cloud/apps/cloud-web/pages/skills/publish.vue`, and `filteredWorkflows` in `desktop/src/renderer/pages/WorkflowsPage.tsx`.
- Use `UPPER_SNAKE_CASE` for constants and tokens, such as `AUTH_STORAGE_KEY` in `desktop/src/renderer/stores/auth.ts`, `ACCESS_TOKEN_EXPIRES_IN_SECONDS` in `cloud/apps/cloud-api/src/modules/auth/services/auth.service.ts`, and `SESSION_COOKIE_KEY` in `cloud/apps/cloud-web/server/lib/cloud-api.ts`.

**Types:**
- Use `PascalCase` for types, interfaces, and classes, such as `WorkflowLibraryFilterState` in `desktop/src/renderer/pages/WorkflowsPage.tsx`, `AuthService` in `cloud/apps/cloud-api/src/modules/auth/services/auth.service.ts`, and `McpServerConfig` in `cloud/packages/shared/src/contracts/mcp.ts`.
- Use suffixes that describe role: `Props`, `State`, `Response`, `Input`, `Repository`, `Provider`, and `Module` are all active patterns in `desktop/src/renderer/pages/WorkflowsPage.tsx`, `cloud/packages/shared/src/contracts/*.ts`, and `cloud/apps/cloud-api/src/modules/*`.

## Code Style

**Formatting:**
- No checked-in formatter config was detected in the repo root, `desktop/`, or `cloud/`: no `eslint.config.*`, `.eslintrc*`, `.prettierrc*`, or `biome.json`.
- Preserve file-local style instead of normalizing unrelated files.
- Use double-quoted strings everywhere; this is consistent in `desktop/src/**`, `cloud/apps/cloud-api/src/**`, and `cloud/packages/shared/src/**`.
- Use 2-space indentation throughout sampled files.
- In `desktop/src/**`, keep semicolons and trailing commas, matching files such as `desktop/src/preload/index.ts`, `desktop/src/renderer/stores/auth.ts`, and `desktop/src/main/services/logger.ts`.
- In `cloud/apps/cloud-api/src/**`, most files omit semicolons and use decorator-friendly Nest formatting, matching `cloud/apps/cloud-api/src/app.module.ts` and `cloud/apps/cloud-api/src/modules/auth/services/auth.service.ts`.
- In `cloud/apps/cloud-web/pages/*.vue` and `cloud/packages/shared/src/contracts/*.ts`, semicolons are common; match the target file, for example `cloud/apps/cloud-web/pages/skills/publish.vue` and `cloud/packages/shared/src/contracts/mcp.ts`.

**Linting:**
- No runnable lint command or config is checked in for the sampled workspaces.
- Existing files still contain ESLint suppression comments, especially React hook dependency suppressions such as `// eslint-disable-next-line react-hooks/exhaustive-deps` in `desktop/src/renderer/pages/WorkflowsPage.tsx` and `desktop/src/renderer/pages/SettingsPage.tsx`.
- When touching React effects in `desktop/src/renderer/**`, preserve existing dependency-suppression intent unless you can safely rewrite the effect.

## Import Organization

**Order:**
1. External packages first, often with `type` imports split from value imports, as in `desktop/src/preload/index.ts` and `cloud/apps/cloud-api/src/modules/auth/services/auth.service.ts`.
2. A blank line, then internal aliases or local modules, such as `@shared/contracts` in `desktop/src/renderer/pages/WorkflowsPage.tsx` and `@myclaw-cloud/shared` in `cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts`.
3. Relative same-folder imports last when no alias exists, such as `../services/hub.service` in `cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts`.

**Path Aliases:**
- `desktop/tsconfig.json` defines `@/*` for `desktop/src/renderer/*`.
- `desktop/tsconfig.json` and `desktop/vitest.config.ts` define `@shared/*` and `@shared` for `desktop/shared/*`.
- `cloud/tsconfig.base.json` defines `@myclaw-cloud/shared` for `cloud/packages/shared/src/index.ts`, while `cloud/apps/cloud-api/tsconfig.json` remaps the same alias to built declarations in `cloud/packages/shared/dist/index.d.ts`.
- Nuxt uses project-relative aliases such as `~/assets/css/main.css` in `cloud/apps/cloud-web/nuxt.config.ts`.

## Error Handling

**Patterns:**
- In `desktop/src/preload/index.ts`, renderer-facing IPC wrappers often catch failures and return safe fallback payloads instead of rethrowing, for example `{ modelIds: [] }`, `{ items: [] }`, or `{ workflow: null }`.
- In `desktop/src/renderer/**`, UI handlers convert exceptions to end-user messages through local state or `alert`, as in `desktop/src/renderer/pages/WorkflowsPage.tsx`.
- In `cloud/apps/cloud-api/src/**`, throw Nest exceptions with stable string codes rather than ad hoc text, such as `new UnauthorizedException("account_or_password_invalid")` in `cloud/apps/cloud-api/src/modules/auth/services/auth.service.ts` and `new BadRequestException("hub_package_must_be_zip")` in `cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts`.
- In `cloud/apps/cloud-api/src/modules/auth/services/auth.service.ts`, normalize upstream provider failures into domain-safe exceptions before returning control to controllers.
- In `cloud/apps/cloud-web/server/lib/cloud-api.ts`, wrap upstream `$fetch` failures with `createError({ statusCode, statusMessage, data })` so route handlers expose uniform HTTP errors.

## Logging

**Framework:** mixed `console` logging plus a local logger helper.

**Patterns:**
- Use bracketed subsystem prefixes, such as `[desktop-auth]` in `desktop/src/renderer/stores/auth.ts`, `[workflow]` in `desktop/src/renderer/components/workflow/*.tsx`, `[Skills 发布]` in `cloud/apps/cloud-web/pages/skills/publish.vue`, and `[hub-repository]` in `cloud/apps/cloud-api/src/modules/hub/repositories/prisma-hub.repository.ts`.
- Use Chinese business messages for user-facing or operational flow logs in most app code, especially under `desktop/src/renderer/**`, `desktop/src/main/services/directory-service.ts`, `cloud/apps/cloud-web/pages/*.vue`, and `cloud/apps/cloud-api/src/runtime/load-runtime-env.ts`.
- Use structured context objects as the second argument instead of string concatenation where possible, as in `desktop/src/main/services/mcp-server-manager.ts`, `desktop/src/renderer/stores/auth.ts`, and `cloud/apps/cloud-api/src/modules/hub/repositories/prisma-hub.repository.ts`.
- In `desktop/src/main/services/logger.ts`, create scoped loggers through `createLogger(module)` for main-process services that need file-backed logging.
- In `cloud/apps/cloud-api/src/modules/auth/providers/*.ts`, Nest `Logger` is used inside providers; elsewhere in the API, direct `console.info/warn/error` is still common.

## Comments

**When to Comment:**
- Prefer Chinese JSDoc or line comments for public helpers, UI handlers, and bridge methods, matching `desktop/src/preload/index.ts`, `desktop/src/renderer/pages/WorkflowsPage.tsx`, `cloud/apps/cloud-web/pages/skills/publish.vue`, and `cloud/packages/shared/src/contracts/mcp.ts`.
- Use section dividers to chunk large files, especially in desktop React/Electron code. Common patterns include dashed banners in `desktop/src/preload/index.ts` and box-drawing separators in `desktop/src/renderer/pages/WorkflowsPage.tsx`.
- Keep comments close to invariants or compatibility rules, such as the bridge synchronization note in `desktop/src/preload/index.ts` and the getter-reset note in `desktop/src/renderer/stores/auth.ts`.
- When touching English-commented utility files like `desktop/src/main/services/logger.ts`, preserve the surrounding style unless you intentionally normalize the whole file.

**JSDoc/TSDoc:**
- TSDoc is common on contract fields and exported helpers, especially in `cloud/packages/shared/src/contracts/mcp.ts`, `cloud/apps/cloud-api/src/modules/hub/ports/hub.repository.ts`, `desktop/src/renderer/hooks/useAuth.ts`, and `desktop/src/renderer/pages/SettingsPage.tsx`.
- Keep field-level docs on shared types; consumers in `cloud-api` and `cloud-web` rely on those contracts.

## Function Design

**Size:** application pages and preload bridges can be large, but helper logic is still extracted above the main export. Follow the same split used in `desktop/src/renderer/pages/WorkflowsPage.tsx`, `desktop/src/preload/index.ts`, and `cloud/apps/cloud-web/pages/skills/publish.vue`.

**Parameters:**
- Prefer typed object parameters for multi-field inputs, such as `buildToolSchemas(cwd, skills, mcpTools)` in `desktop/src/main/services/tool-schemas.ts`, `proxyCloudApi(event, path, options)` in `cloud/apps/cloud-web/server/lib/cloud-api.ts`, and repository/service input types in `cloud/apps/cloud-api/src/modules/**/ports/*.ts`.
- Use local type aliases for route bodies and uploaded files inside controllers when the shape is endpoint-specific, as in `cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts`.

**Return Values:**
- Return explicit object shapes rather than tuples. Examples include preload wrappers in `desktop/src/preload/index.ts`, proxy handlers in `cloud/apps/cloud-web/server/api/*.ts`, and service responses typed from `cloud/packages/shared/src/contracts/*.ts`.
- For renderer safety, prefer deterministic fallback objects over throwing from bridge methods; for API code, prefer throwing typed Nest exceptions.

## Module Design

**Exports:** use named exports for services, helpers, stores, and contracts, such as `createLogger` in `desktop/src/main/services/logger.ts` and `proxyCloudApi` in `cloud/apps/cloud-web/server/lib/cloud-api.ts`. Use default exports for React pages and Nuxt handlers, such as `desktop/src/renderer/pages/WorkflowsPage.tsx` and `cloud/apps/cloud-web/server/api/auth/login.post.ts`.

**Barrel Files:** use barrels sparingly. `cloud/packages/shared/src/index.ts` is the primary barrel and re-exports contract modules for both `cloud-api` and `cloud-web`. Most other directories import concrete files directly rather than adding extra barrel layers.

---

*Convention analysis: 2026-04-04*
