# OpenClaw Cloud MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone cloud project under the current repository that provides MVP authentication, Hub catalog, artifact metadata, and install logging for the desktop client.

**Architecture:** Create a new `cloud/` workspace inside the repo root. The workspace contains a NestJS-based `cloud-api`, a Nuxt 3 `cloud-web`, a shared TypeScript package for contracts, and `infra` files for local PostgreSQL bootstrapping. MVP keeps identity minimal by relying on the internal auth interface and persisting only stable `account` traces locally.

**Tech Stack:** TypeScript, pnpm workspace, NestJS, Nuxt 3, Prisma, PostgreSQL, Vitest, FastDFS adapter abstraction

---

### Task 1: Create the cloud workspace skeleton

**Files:**
- Create: `cloud/package.json`
- Create: `cloud/pnpm-workspace.yaml`
- Create: `cloud/tsconfig.base.json`
- Create: `cloud/README.md`

**Step 1: Write the failing test**

Add a workspace-level validation test after the packages exist and assert the root scripts and workspace globs are present.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir cloud test`
Expected: FAIL because the workspace packages do not exist yet.

**Step 3: Write minimal implementation**

Add the root package, workspace config, base tsconfig, and README with MVP module descriptions.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir cloud test`
Expected: PASS for the workspace-level validation test.

### Task 2: Scaffold shared contracts

**Files:**
- Create: `cloud/packages/shared/package.json`
- Create: `cloud/packages/shared/tsconfig.json`
- Create: `cloud/packages/shared/src/index.ts`
- Create: `cloud/packages/shared/src/contracts/auth.ts`
- Create: `cloud/packages/shared/src/contracts/hub.ts`
- Create: `cloud/packages/shared/src/contracts/install.ts`
- Create: `cloud/packages/shared/src/contracts/contracts.test.ts`

**Step 1: Write the failing test**

Write a contract test asserting the auth, hub, and install DTOs compile and expose the expected discriminated unions for `skill` and `mcp`.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir cloud/packages/shared test`
Expected: FAIL because the contracts do not exist yet.

**Step 3: Write minimal implementation**

Define the DTOs required by the desktop-cloud integration.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir cloud/packages/shared test`
Expected: PASS.

### Task 3: Scaffold cloud-api

**Files:**
- Create: `cloud/apps/cloud-api/package.json`
- Create: `cloud/apps/cloud-api/tsconfig.json`
- Create: `cloud/apps/cloud-api/vitest.config.ts`
- Create: `cloud/apps/cloud-api/src/main.ts`
- Create: `cloud/apps/cloud-api/src/app.module.ts`
- Create: `cloud/apps/cloud-api/src/modules/auth/*`
- Create: `cloud/apps/cloud-api/src/modules/hub/*`
- Create: `cloud/apps/cloud-api/src/modules/install/*`
- Create: `cloud/apps/cloud-api/src/modules/artifact/*`
- Create: `cloud/apps/cloud-api/src/tests/*.test.ts`

**Step 1: Write the failing test**

Write minimal service/controller tests:
- auth login returns a stable account payload
- hub list returns seeded `skill` and `mcp` entries
- install log accepts a trace payload

**Step 2: Run test to verify it fails**

Run: `pnpm --dir cloud/apps/cloud-api test`
Expected: FAIL because services and controllers are missing.

**Step 3: Write minimal implementation**

Implement an in-memory MVP API with module boundaries that can later swap to Prisma and the internal auth adapter.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir cloud/apps/cloud-api test`
Expected: PASS.

### Task 4: Scaffold cloud-web

**Files:**
- Create: `cloud/apps/cloud-web/package.json`
- Create: `cloud/apps/cloud-web/nuxt.config.ts`
- Create: `cloud/apps/cloud-web/app.vue`
- Create: `cloud/apps/cloud-web/pages/index.vue`
- Create: `cloud/apps/cloud-web/pages/hub.vue`
- Create: `cloud/apps/cloud-web/pages/login.vue`

**Step 1: Write the failing test**

Add a lightweight component or rendering test for the landing page and Hub page shell.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir cloud/apps/cloud-web test`
Expected: FAIL because the pages do not exist yet.

**Step 3: Write minimal implementation**

Create a management UI shell with links to login and Hub management.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir cloud/apps/cloud-web test`
Expected: PASS.

### Task 5: Add infra and onboarding docs

**Files:**
- Create: `cloud/infra/docker-compose.yml`
- Create: `cloud/apps/cloud-api/.env.example`
- Modify: `cloud/README.md`

**Step 1: Write the failing test**

Add a validation test that checks required env keys and that the docker compose file defines PostgreSQL.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir cloud test`
Expected: FAIL because infra files are missing.

**Step 3: Write minimal implementation**

Add local infra bootstrapping docs and environment templates.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir cloud test`
Expected: PASS.
