---
phase: 260506-foh
plan: 01
subsystem: cloud-api/hub
tags: [hub, nestjs, wiring, contract-honesty]
requires: []
provides:
  - "HubModule registered in AppModule (routes /api/hub/* now resolve)"
  - "Honest iconUrl contract (null instead of dead URL)"
  - "Stable 404 code (hub_item_icon_not_found) for icon route"
affects:
  - "cloud-web /hub list/detail (now reachable)"
  - "cloud-web /skills/:id download (now reachable via /api/hub/releases/:id/download-token)"
tech_stack:
  added: []
  patterns:
    - "Defensive 404 endpoint with stable error code (mirrors auth.service.ts UnauthorizedException(account_or_password_invalid) pattern)"
key_files:
  created: []
  modified:
    - cloud/apps/cloud-api/src/app.module.ts
    - cloud/apps/cloud-api/src/modules/hub/services/hub.service.ts
    - cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts
    - cloud/apps/cloud-api/src/modules/hub/tests/hub.controller.test.ts
decisions:
  - "Return iconUrl: null instead of constructing dead URL — HubItem prisma model has no icon column, contract HubItem.iconUrl is string | null, no UI renders it"
  - "Add explicit @Get(items/:id/icon) that always throws NotFoundException(hub_item_icon_not_found) — gives stable error code for any cached client/future caller instead of Nest's generic 404"
metrics:
  duration_min: 13
  completed_at: "2026-05-06T03:36:16Z"
  tasks: 2
  files_modified: 4
  tests: "7 passed (was 6, added 1)"
---

# Quick Task 260506-foh: Mount HubModule + Reconcile iconUrl Summary

Wired HubModule into NestJS AppModule so /api/hub/* routes resolve, and stopped fabricating dead icon URLs by returning null while exposing a stable 404 endpoint for the legacy icon path.

## What Was Wired

`cloud/apps/cloud-api/src/app.module.ts` now imports `HubModule` alongside the existing 6 modules (Database, Auth, Artifact, Install, Mcp, Skills). Before this change, every `/api/hub/*` URL returned 404 because Nest only registers routes from imported modules — this broke cloud-web's `/hub` list/detail pages and `/skills/:id` download flow (which calls `/api/hub/releases/:releaseId/download-token`).

Module ordering: `[DatabaseModule, AuthModule, ArtifactModule, HubModule, InstallModule, McpModule, SkillsModule]`. Import statement inserted alphabetically between `DatabaseModule` and `InstallModule`, matching the existing import ordering style.

## iconUrl Contract Decision

`HubService.list()` now returns `iconUrl: null` for every item.

**Why:** Investigation confirmed:
- `HubItem` Prisma model has NO icon column (no bytes stored anywhere)
- Shared contract `HubItem.iconUrl` is typed `string | null` — null is contract-compliant
- `cloud-web/pages/hub.vue` does not render `iconUrl` in any `<img>` tag

The previously-returned `/api/hub/items/${item.id}/icon` URL pointed at a non-existent route — it was lying about a resource we never had. Stop fabricating dead URLs.

## Icon Endpoint Behavior

Added `@Get("items/:id/icon")` to `HubController` placed between `detail` and `publishEmployeeRelease` (route order: list → detail → icon → publish-release → manifest → download-token).

```ts
@Get("items/:id/icon")
icon(@Param("id") _id: string) {
  throw new NotFoundException("hub_item_icon_not_found");
}
```

**Why this exists at all:** Nest's default unmatched-route 404 has a generic message. By registering the route explicitly and throwing `NotFoundException("hub_item_icon_not_found")`, any cached client or future caller that constructs the legacy URL gets a stable, parseable error code instead of a no-route 404. Mirrors the existing pattern (e.g. `throw new NotFoundException("hub_item_not_found")` at `hub.controller.ts:52`).

`NotFoundException` was already imported — no new imports needed.

## Test Updates

`cloud/apps/cloud-api/src/modules/hub/tests/hub.controller.test.ts`:

1. The first test (`"awaits the service list..."`) updated in two places: mock list return value and the resolved-value assertion both now use `iconUrl: null`.
2. New test added at the end of the describe block: `"rejects icon requests with a stable not-found code"` — constructs a `HubController`, calls `controller.icon("any-id")`, asserts the thrown error is a `NotFoundException` with message `"hub_item_icon_not_found"`.

**Result:** `pnpm test -- hub.controller` reports `7 passed (was 6, added 1)` — verified locally.

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| Module wiring | `grep "HubModule" cloud/apps/cloud-api/src/app.module.ts` | 2 matches (import + array entry) |
| Hub tests | `pnpm test -- hub.controller` | 7/7 passing |

## Deviations from Plan

None — plan executed exactly as written. Both tasks committed atomically. No auto-fixes triggered.

## Deferred Issues

`pnpm exec tsc --noEmit -p tsconfig.json` reports 9 pre-existing TypeScript errors in `cloud/apps/cloud-api/src/modules/hub/repositories/prisma-hub.repository.ts` (Property 'hubItem' does not exist on type 'DatabaseService' / implicit 'any' types). These are NOT introduced by this task — root cause is a stale Prisma client (the `HubItem`/`HubRelease` models are in `prisma/schema.prisma` but `pnpm prisma generate` has not been run). Documented in `deferred-items.md` alongside this summary. Recommended fix: a separate quick task to regenerate Prisma client and verify cloud-api typechecks clean.

The plan's verification criterion ("no broken types from the iconUrl change") is met — these errors are unrelated to iconUrl, controllers, services, or any file this task touched.

## Commits

- `764d329` — feat(260506-foh-01): mount HubModule in cloud-api AppModule
- `01c8fa8` — feat(260506-foh-02): add icon 404 endpoint, drop dead iconUrl

## Self-Check: PASSED

- File `cloud/apps/cloud-api/src/app.module.ts` — modified, 2 HubModule references confirmed via grep.
- File `cloud/apps/cloud-api/src/modules/hub/services/hub.service.ts` — modified (iconUrl: null).
- File `cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts` — modified (icon endpoint added).
- File `cloud/apps/cloud-api/src/modules/hub/tests/hub.controller.test.ts` — modified (test updated + new test added; 7/7 pass).
- Commit `764d329` — exists in git log.
- Commit `01c8fa8` — exists in git log.
- Vitest verification command in plan passed: 7 tests passing.
