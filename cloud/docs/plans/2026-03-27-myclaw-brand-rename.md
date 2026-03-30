# MyClaw Brand Rename Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace remaining `MyClaw` / `myclaw` branding and naming across the cloud workspace with `MyClaw`, including package names, imports, UI copy, and database identifiers.

**Architecture:** Treat this as a repo-wide consistency refactor rooted in shared contracts and workspace configuration, then update API and Web consumers to match. Since old data can be deleted, rename storage/database identifiers directly instead of carrying compatibility aliases.

**Tech Stack:** pnpm workspace, Nuxt 4, NestJS, Prisma, Vitest, TypeScript

---

### Task 1: Capture rename surface

**Files:**
- Modify: `package.json`
- Modify: `packages/shared/package.json`
- Modify: `apps/cloud-api/package.json`
- Modify: `apps/cloud-web/package.json`
- Modify: `tsconfig.base.json`
- Modify: `apps/cloud-api/tsconfig.json`
- Modify: `README.md`
- Modify: `docs/database-setup.md`

**Step 1: Search for remaining brand references**

Run: `rg -n --hidden --glob '!**/node_modules/**' --glob '!**/.nuxt/**' --glob '!**/.output/**' --glob '!**/dist/**' --glob '!**/*.log' "MyClaw|myclaw|myclaw-cloud|MyClaw Cloud|myclaw_cloud|@myclaw-cloud" .`

**Step 2: Update workspace/package names**

Replace package and alias names with `myclaw-cloud` / `@myclaw-cloud/*`.

**Step 3: Update docs/config naming**

Replace visible product copy and database identifiers with `MyClaw` / `myclaw_cloud`.

### Task 2: Align API and Web code

**Files:**
- Modify: `apps/cloud-api/src/modules/**/*`
- Modify: `apps/cloud-web/**/*`
- Modify: `packages/shared/**/*`
- Test: `apps/cloud-web/tests/pages.test.mjs`
- Test: `tests/shared-package-consumption.test.mjs`

**Step 1: Update imports and runtime keys**

Rename imports, session/cookie keys, and UI strings to `MyClaw`.

**Step 2: Remove obsolete `MyClaw` copy**

Update page titles, labels, and helper text.

**Step 3: Update tests**

Adjust assertions and package-consumption checks to match renamed packages and UI copy.

### Task 3: Verify workspace integrity

**Files:**
- Modify: `pnpm-lock.yaml`
- Modify: `apps/cloud-api/.env`
- Modify: `apps/cloud-api/.env.example`
- Modify: `infra/docker-compose.yml`

**Step 1: Re-scan for leftover references**

Run the same `rg` command and confirm only intentional/generated leftovers remain.

**Step 2: Refresh lockfile if package names changed**

Run: `pnpm install`

**Step 3: Run verification**

Run:
- `pnpm --dir packages/shared test`
- `pnpm --dir packages/shared build`
- `pnpm --dir apps/cloud-api test`
- `pnpm --dir apps/cloud-api build`
- `pnpm --dir apps/cloud-web test`
- `pnpm --dir apps/cloud-web build`
