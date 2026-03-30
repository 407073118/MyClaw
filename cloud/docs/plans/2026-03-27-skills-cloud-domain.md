# Skills Cloud Domain Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an independent cloud-backed `skills` domain that stores skill metadata and release artifact metadata in the database while uploading zip artifacts to FastDFS.

**Architecture:** Add shared skill contracts, create `Skill` and `SkillRelease` Prisma models, implement a dedicated `skills` module in `cloud-api`, and make `cloud-web` proxy and render that API. `hub` remains a separate browse/install surface and does not own skill creation or publishing.

**Tech Stack:** Nuxt 3, NestJS 11, Prisma, PostgreSQL, FastDFS, shared TypeScript contracts

---

### Task 1: Shared contracts

**Files:**
- Create: `packages/shared/src/contracts/skills.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/tests/contracts.test.mjs`

**Step 1: Write the failing test**
- Assert shared exports now include `skills` contracts and `hub` still excludes skill item types.

**Step 2: Run test to verify it fails**
- Run: `pnpm --dir packages/shared test`

**Step 3: Write minimal implementation**
- Add independent `skills` DTOs for list/detail/create/publish responses.

**Step 4: Run test to verify it passes**
- Run: `pnpm --dir packages/shared test`

### Task 2: Database models

**Files:**
- Modify: `apps/cloud-api/prisma/schema.prisma`

**Step 1: Write the failing test**
- Add API tests that expect `skills` data to come from independent Prisma models rather than local files or hub releases.

**Step 2: Run test to verify it fails**
- Run: `pnpm --dir apps/cloud-api test`

**Step 3: Write minimal implementation**
- Add `Skill` and `SkillRelease` models with persisted artifact metadata and release manifest JSON.

**Step 4: Run test to verify it passes**
- Run: `pnpm --dir apps/cloud-api test`

### Task 3: Cloud API skills module

**Files:**
- Create: `apps/cloud-api/src/modules/skills/*`
- Modify: `apps/cloud-api/src/app.module.ts`
- Modify: `apps/cloud-api/src/modules/artifact/artifact.service.ts`
- Test: `apps/cloud-api/src/modules/skills/*.test.ts`
- Test: `apps/cloud-api/src/modules/artifact/artifact.service.test.ts`

**Step 1: Write the failing test**
- Cover listing skills, reading skill detail, creating a skill, publishing a release, and loading artifact metadata from either skill releases or hub releases.

**Step 2: Run test to verify it fails**
- Run: `pnpm --dir apps/cloud-api test`

**Step 3: Write minimal implementation**
- Add controller/service/repository/module for skills.
- Reuse `ArtifactService.storeSkillArtifact` for FastDFS upload.
- Persist artifact path, download URL, and manifest metadata to `SkillRelease`.

**Step 4: Run test to verify it passes**
- Run: `pnpm --dir apps/cloud-api test`

### Task 4: Cloud web proxy and pages

**Files:**
- Create: `apps/cloud-web/server/api/skills/[id].get.ts`
- Create: `apps/cloud-web/server/api/skills/[id]/releases.post.ts`
- Modify: `apps/cloud-web/server/api/skills.get.ts`
- Modify: `apps/cloud-web/server/api/skills.post.ts`
- Modify: `apps/cloud-web/pages/skills/index.vue`
- Modify: `apps/cloud-web/pages/skills/[id].vue`
- Modify: `apps/cloud-web/pages/skills/publish.vue`
- Modify: `apps/cloud-web/types/skills.ts`
- Test: `apps/cloud-web/tests/pages.test.mjs`

**Step 1: Write the failing test**
- Assert skills pages call `/api/skills` proxies, no local filesystem writes remain, and publish uses zip upload flow.

**Step 2: Run test to verify it fails**
- Run: `pnpm --dir apps/cloud-web test`

**Step 3: Write minimal implementation**
- Proxy all skills calls to cloud-api.
- Replace local file browser DTOs with cloud skill DTOs.
- Show DB-backed skill and release information instead of repo files.

**Step 4: Run test to verify it passes**
- Run: `pnpm --dir apps/cloud-web test`

### Task 5: Verification

**Files:**
- Verify only

**Step 1: Run targeted verification**
- `pnpm --dir packages/shared test`
- `pnpm --dir apps/cloud-api test`
- `pnpm --dir apps/cloud-web test`

**Step 2: Run build verification**
- `pnpm --dir packages/shared build`
- `pnpm --dir apps/cloud-api build`
- `pnpm --dir apps/cloud-web build`
