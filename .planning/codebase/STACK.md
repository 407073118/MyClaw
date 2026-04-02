# Technology Stack

**Analysis Date:** 2026-03-31

## Languages

**Primary:**
- TypeScript 5.8.x - All application code across desktop, cloud, and newApp workspaces
- Rust (edition 2021) - Tauri native shell in `desktop/apps/desktop/src-tauri/`

**Secondary:**
- JavaScript (ESM) - Workspace-level test scripts in `cloud/tests/` and `cloud/packages/shared/tests/`
- SQL (Prisma schema) - Database definitions in `cloud/apps/cloud-api/prisma/schema.prisma`

## Runtime

**Environment:**
- Node.js 18+ (target for `pkg` sidecar bundling; TypeScript targets ES2022)
- Electron 33.2.x (newApp desktop runtime) - `newApp/package.json`
- Tauri 2.2.5 (original desktop shell) - `desktop/apps/desktop/src-tauri/Cargo.toml`
- Browser (Nuxt SSR/CSR for cloud-web)

**Package Manager:**
- pnpm 9.11.0 - declared in `desktop/package.json` and `cloud/package.json` via `packageManager` field
- npm (newApp only) - `newApp/package-lock.json` present, no pnpm workspace
- Lockfiles: `desktop/pnpm-lock.yaml`, `cloud/pnpm-lock.yaml`, `newApp/package-lock.json`

## Monorepo Structure

The repository contains **three independent workspaces**, not a single unified monorepo:

| Workspace | Manager | Config |
|-----------|---------|--------|
| `desktop/` | pnpm workspaces | `desktop/pnpm-workspace.yaml` |
| `cloud/` | pnpm workspaces | `cloud/pnpm-workspace.yaml` |
| `newApp/` | npm (standalone) | `newApp/package.json` |

Each pnpm workspace follows the same layout: `apps/*` + `packages/*`.

## Frameworks

**Core:**
- Vue 3.5.x - Desktop frontend UI (`desktop/apps/desktop/package.json`)
- React 18.3.x - New Electron renderer (`newApp/package.json`)
- Nuxt 4.4.x - Cloud web frontend (`cloud/apps/cloud-web/package.json`)
- NestJS 11.x - Cloud API backend (`cloud/apps/cloud-api/package.json`)
- Tauri 2.x - Original desktop native shell (`desktop/apps/desktop/src-tauri/`)
- Electron 33.x - New desktop shell (`newApp/package.json`)

**State Management:**
- Pinia 3.x - Vue store for desktop app (`desktop/apps/desktop/package.json`)
- Zustand 5.x - React store for newApp (`newApp/package.json`)

**Routing:**
- vue-router 4.5.x - Desktop app (`desktop/apps/desktop/package.json`)
- react-router-dom 6.28.x - newApp (`newApp/package.json`, uses `HashRouter`)
- Nuxt built-in file-based routing - Cloud web

**Testing:**
- Vitest 3.0.x - Unit tests across all workspaces
- @vue/test-utils 2.4.x - Vue component testing (`desktop/apps/desktop/`)
- @testing-library/react 16.1.x - React component testing (`newApp/`)
- jsdom 26.x - DOM simulation for tests
- Plain Node.js `node:assert` test scripts - Cloud workspace-level tests (`cloud/tests/`)

**Build/Dev:**
- Vite 6.2.x - Frontend bundling for all three workspaces
- @vitejs/plugin-vue 5.2.x - Vue SFC support (`desktop/apps/desktop/`)
- @vitejs/plugin-react 4.3.x - React JSX support (`newApp/`)
- esbuild 0.25.x - Runtime sidecar bundling (`desktop/apps/runtime/`)
- tsc (TypeScript compiler) - Type checking and cloud-shared package builds
- @tauri-apps/cli 2.1.x - Tauri dev/build commands (`desktop/apps/desktop/`)
- electron-builder 25.x - Electron packaging (`newApp/`)
- pkg 5.8.x - Node.js single-binary bundling for runtime sidecar (`desktop/apps/runtime/`)
- tsx 4.x - Dev-time TypeScript execution (`desktop/apps/runtime/`, `cloud/apps/cloud-api/`)
- concurrently 9.x - Parallel dev process runner (`newApp/`)
- NestJS CLI 11.x - `nest start --watch` for cloud API dev (`cloud/apps/cloud-api/`)

## Key Dependencies

**Critical:**
- @tauri-apps/api 2.1.x - Tauri IPC bridge from Vue frontend to Rust backend (`desktop/apps/desktop/`)
- @prisma/client 6.5.x + prisma 6.5.x - PostgreSQL ORM for cloud API (`cloud/apps/cloud-api/`)
- sql.js 1.x - SQLite-in-WASM for local data (used in both `desktop/apps/runtime/` and `newApp/`)
- marked 17.x - Markdown rendering in chat UI (both `desktop/apps/desktop/` and `newApp/`)
- rxjs 7.8.x - NestJS reactive dependency (`cloud/apps/cloud-api/`)
- reflect-metadata 0.2.x - NestJS decorator support (`cloud/apps/cloud-api/`)

**UI:**
- lucide-vue-next 1.x - Icon library for Vue desktop app (`desktop/apps/desktop/`)
- lucide-react 0.468.x - Icon library for React newApp (`newApp/`)

**Shared Packages (workspace internal):**
- `@myclaw-desktop/shared` - Type contracts for desktop workspace (`desktop/packages/shared/`)
- `@myclaw-cloud/shared` - Type contracts for cloud workspace (`cloud/packages/shared/`)
- `@shared/*` (path alias) - Shared contracts in newApp (`newApp/shared/`)

## Configuration

**TypeScript:**
- Base config: `desktop/tsconfig.base.json`, `cloud/tsconfig.base.json`, `newApp/tsconfig.json`
- All target ES2022, moduleResolution "Bundler", strict mode enabled
- Cloud workspace has additional `noUnusedLocals` and `noUnusedParameters`
- Cloud uses path alias: `@myclaw-cloud/shared` -> `packages/shared/src/index.ts`
- newApp uses Vite aliases: `@` -> `src/renderer`, `@shared` -> `shared/`

**Build:**
- `desktop/apps/desktop/src-tauri/tauri.conf.json` - Tauri build configuration
- `newApp/vite.config.ts` - Vite config with React plugin, renderer root at `src/renderer`
- `cloud/apps/cloud-web/nuxt.config.ts` - Nuxt config with runtimeConfig for API base URL

**Environment:**
- `RUNTIME_PORT` - Runtime HTTP server port (default: 43110)
- `RUNTIME_STATE_FILE_PATH` - Runtime state persistence path
- `DATABASE_URL` - PostgreSQL connection for cloud API (Prisma)
- `CLOUD_API_BASE` - Cloud API base URL for Nuxt server proxy (default: `http://127.0.0.1:43210`)
- `MYCLAW_CLOUD_HUB_BASE_URL` - Cloud Hub URL used by desktop runtime proxy (default: `http://127.0.0.1:43210`)
- FastDFS config vars (`FASTDFS_BASE_URL`, `FASTDFS_PROJECT_CODE`, `FASTDFS_TOKEN`, etc.) - Artifact storage

## Platform Requirements

**Development:**
- Node.js 18+
- pnpm 9.11.0 (for desktop and cloud workspaces)
- npm (for newApp)
- Rust toolchain (for Tauri builds in desktop workspace)
- Docker (for local PostgreSQL via `cloud/infra/docker-compose.yml`)
- Windows x64 primary target (sidecar builds target `x86_64-pc-windows-msvc`)

**Production:**
- Desktop: Windows (NSIS installer via Tauri or electron-builder)
- Cloud API: Node.js server (NestJS)
- Cloud Web: Node.js server (Nuxt SSR) or static deployment
- Database: PostgreSQL 16

---

*Stack analysis: 2026-03-31*
