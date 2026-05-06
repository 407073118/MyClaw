# Deferred Items — 260506-foh

## Pre-existing TypeScript errors in prisma-hub.repository.ts

Discovered during Task 2 verification (`pnpm exec tsc --noEmit -p tsconfig.json`):

```
src/modules/hub/repositories/prisma-hub.repository.ts(18,46): error TS2339: Property 'hubItem' does not exist on type 'DatabaseService'.
src/modules/hub/repositories/prisma-hub.repository.ts(35,23): error TS7006: Parameter 'item' implicitly has an 'any' type.
src/modules/hub/repositories/prisma-hub.repository.ts(42,36): error TS7006: Parameter 'release' implicitly has an 'any' type.
src/modules/hub/repositories/prisma-hub.repository.ts(52,45): error TS2339: Property 'hubItem' does not exist on type 'DatabaseService'.
src/modules/hub/repositories/prisma-hub.repository.ts(74,36): error TS7006: Parameter 'release' implicitly has an 'any' type.
src/modules/hub/repositories/prisma-hub.repository.ts(91,45): error TS2339: Property 'hubItem' does not exist on type 'DatabaseService'.
src/modules/hub/repositories/prisma-hub.repository.ts(116,36): error TS7006: Parameter 'release' implicitly has an 'any' type.
src/modules/hub/repositories/prisma-hub.repository.ts(139,25): error TS2339: Property 'hubItem' does not exist on type 'Omit<PrismaClient ...
src/modules/hub/repositories/prisma-hub.repository.ts(154,25): error TS2339: Property 'hubItem' does not exist on type 'Omit<PrismaClient ...
```

**Root cause:** Prisma client has not been regenerated after `HubItem`/`HubRelease` models were added to `prisma/schema.prisma`. Running `pnpm prisma generate` (or the equivalent build script) inside `cloud/apps/cloud-api/` should refresh `@prisma/client` types so `databaseService.hubItem` / `tx.hubRelease` resolve.

**Why deferred:** These errors existed before this quick task (last edit on `prisma-hub.repository.ts` was commit `819b316`, pre-dating 260506-foh). They are unrelated to the iconUrl change or HubModule wiring. Vitest passes (mocked services), and the plan's success criterion ("no broken types from the iconUrl change") is met.

**Recommended next step:** A separate quick task to run `pnpm prisma generate` and verify `pnpm exec tsc --noEmit` is clean across cloud-api.
