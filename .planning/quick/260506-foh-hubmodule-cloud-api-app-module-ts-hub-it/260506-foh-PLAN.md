---
phase: 260506-foh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - cloud/apps/cloud-api/src/app.module.ts
  - cloud/apps/cloud-api/src/modules/hub/services/hub.service.ts
  - cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts
  - cloud/apps/cloud-api/src/modules/hub/tests/hub.controller.test.ts
autonomous: true
requirements:
  - QUICK-FOH-01-mount-hub-module
  - QUICK-FOH-02-fix-icon-endpoint
must_haves:
  truths:
    - "HubModule is registered in AppModule so /api/hub/* routes are reachable"
    - "GET /api/hub/items returns items with iconUrl: null (no dangling icon URL pointing at a missing route)"
    - "GET /api/hub/items/:id/icon returns 404 with code hub_item_icon_not_found instead of Nest's generic 404"
    - "GET /api/hub/releases/:releaseId/download-token resolves so cloud-web /hub and /skills/:id download flows work"
    - "Existing hub controller tests still pass; one new test asserts the icon endpoint throws NotFoundException"
  artifacts:
    - path: "cloud/apps/cloud-api/src/app.module.ts"
      provides: "HubModule registered alongside the other 6 modules"
      contains: "HubModule"
    - path: "cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts"
      provides: "GET items/:id/icon endpoint that throws NotFoundException(hub_item_icon_not_found)"
      contains: "@Get(\"items/:id/icon\")"
    - path: "cloud/apps/cloud-api/src/modules/hub/services/hub.service.ts"
      provides: "list() returns iconUrl: null instead of dead URL"
      contains: "iconUrl: null"
  key_links:
    - from: "cloud/apps/cloud-api/src/app.module.ts"
      to: "cloud/apps/cloud-api/src/modules/hub/hub.module.ts"
      via: "imports array entry"
      pattern: "HubModule"
    - from: "cloud/apps/cloud-web/pages/skills/[id].vue"
      to: "/api/hub/releases/:releaseId/download-token"
      via: "$fetch in handleDownload"
      pattern: "hub/releases/.*download-token"
---

<objective>
Wire the existing HubModule into the NestJS application so /api/hub/* routes resolve, and reconcile the icon URL contract mismatch (service returns iconUrl pointing at a non-existent endpoint).

Purpose: Hub routes currently 404 because HubModule is not in AppModule.imports — this breaks cloud-web /hub page (item list, detail, download) AND /skills/:id download (which calls /api/hub/releases/:releaseId/download-token). HubItem schema has no icon column, so the service-constructed iconUrl is dead data. Fix is a wiring + contract-honesty change, not new functionality.

Output: HubModule mounted; hub list returns iconUrl: null; icon endpoint returns clean 404 with stable error code; tests updated to match.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@CLAUDE.md
@cloud/apps/cloud-api/src/app.module.ts
@cloud/apps/cloud-api/src/modules/hub/hub.module.ts
@cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts
@cloud/apps/cloud-api/src/modules/hub/services/hub.service.ts
@cloud/apps/cloud-api/src/modules/hub/tests/hub.controller.test.ts
@cloud/apps/cloud-api/prisma/schema.prisma
@cloud/packages/shared/src/contracts/hub.ts

<interfaces>
<!-- Key contract: HubItem.iconUrl is `string | null` so returning null is contract-compliant. -->
<!-- HubItem schema (prisma) has NO icon column — confirmed. iconUrl was dead data. -->

From cloud/packages/shared/src/contracts/hub.ts:
```typescript
export type HubItem = {
  id: string;
  type: HubItemType;
  name: string;
  summary: string;
  latestVersion: string;
  iconUrl: string | null;   // null is allowed
};
```

From cloud/apps/cloud-api/prisma/schema.prisma (HubItem model):
```prisma
model HubItem {
  id            String   @id @db.VarChar(191)
  type          String   @db.VarChar(50)
  name          String   @db.VarChar(255)
  summary       String   @db.Text
  description   String   @db.Text
  latestVersion String?  @map("latest_version") @db.VarChar(50)
  // NO icon column — confirmed
}
```

Reference style for error codes (cloud/apps/cloud-api/src/modules/auth/services/auth.service.ts):
```typescript
throw new UnauthorizedException("account_or_password_invalid")
```

Existing controller already uses this pattern at L52:
```typescript
throw new NotFoundException("hub_item_not_found")
```
</interfaces>

**Investigation summary (locked decisions):**

- `HubItem` Prisma model has NO icon column (confirmed from schema.prisma). No icon bytes stored anywhere.
- `cloud-web/pages/hub.vue` does NOT render `iconUrl` in any `<img>` tag — the field is currently dead in the UI. Only text-based item cards.
- Shared contract `HubItem.iconUrl` is typed `string | null`, so returning `null` is contract-compliant — no shared package change needed.
- Chosen approach (constraint option a, lower-risk): drop the dead URL from service response (return `null`), AND register an explicit `GET items/:id/icon` route that throws `NotFoundException("hub_item_icon_not_found")` so any cached client or future caller gets a stable error code instead of a generic Nest 404.
- Out of scope: adding icon storage column, uploading/serving real icons, modifying cloud-web hub.vue rendering, modifying shared contracts package.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Mount HubModule in AppModule</name>
  <files>cloud/apps/cloud-api/src/app.module.ts</files>
  <behavior>
    - After change, AppModule.imports contains HubModule alongside the existing 6 modules (DatabaseModule, AuthModule, ArtifactModule, InstallModule, McpModule, SkillsModule).
    - Import statement uses the same relative-path style as the other module imports ("./modules/hub/hub.module").
    - Alphabetical ordering of imports preserved where current code follows it.
  </behavior>
  <action>
    Edit cloud/apps/cloud-api/src/app.module.ts:

    1. Add import line: `import { HubModule } from "./modules/hub/hub.module";` — place it alphabetically between DatabaseModule and InstallModule (so order becomes ArtifactModule, AuthModule, DatabaseModule, HubModule, InstallModule, McpModule, SkillsModule). Match the existing double-quote + semicolon style already used in this file.

    2. Add `HubModule` to the `@Module({ imports: [...] })` array. Place it after `DatabaseModule` to keep the array ordering consistent with import order:
       `imports: [DatabaseModule, AuthModule, ArtifactModule, HubModule, InstallModule, McpModule, SkillsModule]`

    Do NOT touch any other files in this task. Do NOT reorder existing imports beyond inserting HubModule. Do NOT add HubModule to controllers/providers/exports of AppModule — HubModule is self-contained and already declares its own controllers/providers internally.

    Why: cloud-web /hub page issues `GET /api/hub/items`, `GET /api/hub/items/:id`, and cloud-web /skills/[id].vue issues `GET /api/hub/releases/:releaseId/download-token`. All of these resolve to HubController routes, but Nest only registers routes from imported modules — without this import, every hub URL is a dead 404.
  </action>
  <verify>
    <automated>cd cloud/apps/cloud-api && pnpm test -- hub.controller</automated>
  </verify>
  <done>
    `app.module.ts` contains `HubModule` in both the import statement block and the `imports: [...]` array; hub controller tests still pass (this task does not change them yet — Task 2 updates them).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add icon 404 endpoint, drop dead iconUrl, update tests</name>
  <files>
    cloud/apps/cloud-api/src/modules/hub/services/hub.service.ts,
    cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts,
    cloud/apps/cloud-api/src/modules/hub/tests/hub.controller.test.ts
  </files>
  <behavior>
    - HubService.list() returns each item with `iconUrl: null` instead of `/api/hub/items/${id}/icon` (since no icon storage exists, the URL was lying).
    - HubController exposes `@Get("items/:id/icon")` that always throws `NotFoundException("hub_item_icon_not_found")` — guarantees a stable error code rather than Nest's generic 404 if any client (current or future) tries the URL.
    - Existing controller tests updated: the list mock items use `iconUrl: null` (matches new service output); the assertion on the returned items also uses `iconUrl: null`.
    - One NEW test added: calling `controller.icon("any-id")` rejects with NotFoundException whose message is `hub_item_icon_not_found`.
  </behavior>
  <action>
    Make all three edits in this single task — they are tightly coupled (changing service output without updating the test would break the existing assertion).

    **Edit A — `cloud/apps/cloud-api/src/modules/hub/services/hub.service.ts`:**

    On line 44 inside the `.map((item) => ({ ... }))` block in `list()`, change:
    ```ts
    iconUrl: `/api/hub/items/${item.id}/icon`
    ```
    to:
    ```ts
    iconUrl: null
    ```

    Rationale: HubItem prisma model has no icon column, no icon bytes are stored, no cloud-web page renders this URL in an `<img>`. The contract `HubItem.iconUrl: string | null` permits null. Stop fabricating URLs that point at nothing.

    **Edit B — `cloud/apps/cloud-api/src/modules/hub/controllers/hub.controller.ts`:**

    Add a new method `icon` to `HubController`. Place it immediately AFTER the existing `detail` method (around L56) and BEFORE `publishEmployeeRelease`, so route ordering reads list → detail → icon → publish-release → manifest → download-token.

    ```ts
    @Get("items/:id/icon")
    icon(@Param("id") _id: string) {
      throw new NotFoundException("hub_item_icon_not_found");
    }
    ```

    The `_id` underscore prefix signals intentionally unused — matching the pattern used elsewhere in the codebase. Keep the method synchronous (no `async`) since it only throws; that mirrors how other simple Nest handlers in this controller (`manifest`, `downloadToken`) are written without `async` when they only delegate.

    `NotFoundException` is already imported at L7 of this file — no new import needed.

    Why this endpoint exists at all: defensively returning a stable error code `hub_item_icon_not_found` is more useful than relying on Nest's default unmatched-route 404 (which has a generic message). Cloud-web doesn't currently call this URL, but a future renderer or a stale build that constructed the old URL gets a clear, parseable error code instead.

    **Edit C — `cloud/apps/cloud-api/src/modules/hub/tests/hub.controller.test.ts`:**

    1. In the first test (`"awaits the service list..."`), update BOTH the mock list return value (around L17) AND the resolved-value assertion (around L44) so the `iconUrl` field is `null` instead of the string `/api/hub/items/employee-onboarding-assistant/icon`. Both occurrences must be changed; otherwise the assertion will not match.

    2. Add a NEW test case at the end of the `describe("hub controller", ...)` block:

    ```ts
    it("rejects icon requests with a stable not-found code", async () => {
      const controller = new HubController(
        {
          list: async () => [],
          findById: async () => null,
        } as unknown as HubService,
        {
          getManifest: () => {
            throw new Error("not used");
          },
          createDownloadToken: async () => {
            throw new Error("not used");
          },
        } as unknown as ArtifactService,
      );

      try {
        controller.icon("any-id");
        throw new Error("expected NotFoundException");
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).message).toBe("hub_item_icon_not_found");
      }
    });
    ```

    Match the file's existing style: 2-space indent, double quotes, trailing commas inside object literals (the test file already uses them — see lines around 36-46 and 110-117).

    Do NOT modify any other test cases. Do NOT touch the existing `"does not expose skill creation APIs anymore"` test — it asserts negative properties unrelated to icon.
  </action>
  <verify>
    <automated>cd cloud/apps/cloud-api && pnpm test -- hub.controller</automated>
  </verify>
  <done>
    All hub controller tests pass: the original 6 tests (with iconUrl: null in the list test) plus the new icon-not-found test. `pnpm test -- hub.controller` reports 7 passing tests with no failures. Service returns iconUrl: null, controller exposes the icon route, and the test file is consistent with both.
  </done>
</task>

</tasks>

<verification>
After both tasks land:

1. **Module wiring smoke check** — search confirms HubModule appears in app.module.ts imports:
   ```
   grep "HubModule" cloud/apps/cloud-api/src/app.module.ts
   ```
   Should show 2 lines: the import statement and the array entry.

2. **Test suite** — full hub controller test file passes:
   ```
   cd cloud/apps/cloud-api && pnpm test -- hub.controller
   ```
   Expected: 7 tests pass (was 6, added 1 for icon endpoint).

3. **Type check** — no broken types from the iconUrl change (it was already `string | null` in the contract):
   ```
   cd cloud/apps/cloud-api && pnpm exec tsc --noEmit -p tsconfig.json
   ```
   Should complete with zero errors related to hub files.

4. **Manual confirmation (NOT REQUIRED — only if user wants to verify cloud-web flow)** — start cloud-api dev, then:
   - GET /api/hub/items → 200 with items array, every iconUrl is null
   - GET /api/hub/items/some-id/icon → 404 with body containing "hub_item_icon_not_found"
   - GET /api/hub/releases/some-release/download-token → 200 (proves the route is now reachable)
</verification>

<success_criteria>
- HubModule listed in app.module.ts imports array (1 line) and import statement block (1 line).
- hub.service.ts L44 returns `iconUrl: null` (not a constructed URL).
- hub.controller.ts contains a `@Get("items/:id/icon")` handler that throws `NotFoundException("hub_item_icon_not_found")`.
- hub.controller.test.ts: list test mocks/asserts use `iconUrl: null`; new icon-not-found test added; all 7 tests pass via `pnpm test -- hub.controller`.
- No changes to: shared contracts package, prisma schema, hub.module.ts, prisma-hub.repository.ts, cloud-web hub.vue, cloud-web skills/[id].vue. This is a wiring + contract-honesty fix only.
</success_criteria>

<output>
After completion, create `.planning/quick/260506-foh-hubmodule-cloud-api-app-module-ts-hub-it/260506-foh-SUMMARY.md` capturing: what was wired, the iconUrl contract decision (null instead of dead URL), the icon endpoint behavior, and the updated test count.
</output>
