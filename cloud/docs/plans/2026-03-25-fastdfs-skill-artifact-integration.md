# FastDFS Skill Artifact Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep the existing cloud download API stable while moving released skill zip artifacts from local disk storage to FastDFS-backed storage with persisted artifact metadata.

**Architecture:** `HubRelease` keeps business metadata and gains artifact metadata fields. `ArtifactStoragePort` remains the storage boundary. `ArtifactController` continues to expose `/api/artifacts/download/:releaseId`, but the implementation proxies FastDFS instead of serving local files.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Vitest, FastDFS HTTP API.

---

### Task 1: Persist artifact metadata on releases

**Files:**
- Modify: `cloud/apps/cloud-api/prisma/schema.prisma`
- Modify: `cloud/apps/cloud-api/src/modules/hub/hub.repository.ts`
- Modify: `cloud/apps/cloud-api/src/modules/hub/prisma-hub.repository.ts`
- Modify: `cloud/apps/cloud-api/prisma/seed.ts`
- Test: `cloud/apps/cloud-api/src/modules/hub/hub.service.test.ts`

**Step 1: Write or update failing tests**

- Make release creation assertions require persisted artifact metadata fields.

**Step 2: Run targeted tests to verify failure**

- Run: `pnpm --dir cloud/apps/cloud-api test -- src/modules/hub/hub.service.test.ts`

**Step 3: Add minimal schema fields**

- Add `artifactUrl`, `artifactFileName`, `artifactFileSize`, and optional `artifactStorageType` to `HubRelease`.

**Step 4: Update repository contracts**

- Extend release creation input so repository receives artifact metadata.
- Persist those fields in Prisma repository and return them in response payloads.

**Step 5: Update seed data**

- Seed rows should write deterministic placeholder artifact metadata for existing Hub releases.

**Step 6: Re-run targeted tests**

- Run: `pnpm --dir cloud/apps/cloud-api test -- src/modules/hub/hub.service.test.ts src/modules/hub/hub.controller.test.ts`

### Task 2: Replace local artifact storage with FastDFS-backed storage

**Files:**
- Modify: `cloud/apps/cloud-api/src/modules/artifact/artifact-storage.port.ts`
- Modify: `cloud/apps/cloud-api/src/modules/artifact/fastdfs-artifact-storage.ts`
- Modify: `cloud/apps/cloud-api/src/modules/artifact/artifact.service.ts`
- Modify: `cloud/apps/cloud-api/src/modules/artifact/artifact.controller.ts`
- Test: `cloud/apps/cloud-api/src/modules/artifact/*.test.ts`
- Modify: `cloud/apps/cloud-api/.env.example`

**Step 1: Write or update failing tests**

- Cover upload result parsing, download descriptor generation, and download proxy behavior.

**Step 2: Run targeted tests to verify failure**

- Run: `pnpm --dir cloud/apps/cloud-api test -- src/modules/artifact`

**Step 3: Implement FastDFS config loading**

- Read base URL and auth parameters from env with safe defaults.

**Step 4: Implement upload**

- POST multipart zip bytes to FastDFS upload API.
- Parse returned `result.url`, `name`, `fileSizeByte`.

**Step 5: Implement download proxy**

- Resolve persisted artifact metadata by `releaseId`.
- Download bytes from FastDFS and stream through Nest response with original filename.

**Step 6: Re-run artifact tests**

- Run: `pnpm --dir cloud/apps/cloud-api test -- src/modules/artifact`

### Task 3: Integrate and apply schema to local database

**Files:**
- Modify only if needed after integration

**Step 1: Sync service wiring**

- Ensure `HubService` passes artifact metadata into repository.
- Ensure `ArtifactService` resolves release metadata from DB when downloading.

**Step 2: Update local Prisma client and database**

- Run: `pnpm --dir cloud/apps/cloud-api prisma:generate`
- Run: `pnpm --dir cloud/apps/cloud-api prisma:push`
- Run: `pnpm --dir cloud/apps/cloud-api prisma:seed`

**Step 3: Run focused cloud-api verification**

- Run: `pnpm --dir cloud/apps/cloud-api test`
- Run: `pnpm --dir cloud/apps/cloud-api build`

**Step 4: Check encoding and user-facing strings**

- Re-open touched files with UTF-8 and verify no mojibake.
