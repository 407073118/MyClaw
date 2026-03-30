# Inline Approval Messages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move approval prompts into the chat timeline and drive them from runtime/bootstrap data instead of hardcoded frontend placeholders.

**Architecture:** Extend the shared approval contract with session-scoped pending approval requests, include them in runtime bootstrap, store them in the desktop workspace store, and render the matching request inside the active chat session timeline.

**Tech Stack:** Vue 3, Pinia, Vitest, Node HTTP runtime, TypeScript

---

### Task 1: Shared/runtime approval request data

**Files:**
- Modify: `packages/shared/src/contracts/approval.ts`
- Modify: `apps/runtime/src/routes.ts`
- Modify: `apps/runtime/src/store/settings-store.ts`
- Modify: `apps/runtime/src/server.ts`
- Test: `apps/runtime/src/server.test.ts`

**Step 1: Write the failing test**

Add a runtime test that expects `GET /api/bootstrap` to return a non-empty `approvalRequests` array and that each request is scoped to a session id.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test -- server`
Expected: FAIL because bootstrap does not include `approvalRequests`.

**Step 3: Write minimal implementation**

Add `sessionId` to approval requests, create a default pending request in runtime settings, and return it from bootstrap.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test -- server`
Expected: PASS

### Task 2: Desktop store and timeline rendering

**Files:**
- Modify: `apps/desktop/src/services/runtime-client.ts`
- Modify: `apps/desktop/src/stores/workspace.ts`
- Modify: `apps/desktop/src/test-utils/workspace-fixture.ts`
- Modify: `apps/desktop/src/views/ChatView.vue`
- Test: `apps/desktop/src/views/ChatView.test.ts`

**Step 1: Write the failing test**

Add a desktop test that hydrates two sessions plus two approval requests and expects only the active session's approval card to render.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test -- ChatView`
Expected: FAIL because the timeline still uses hardcoded approval content.

**Step 3: Write minimal implementation**

Store `approvalRequests` in workspace state, pass them through bootstrap hydration, and render the active session's requests inline.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test -- ChatView`
Expected: PASS

### Task 3: Verification

**Files:**
- Verify only

**Step 1: Run test/build**

Run:
- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/desktop test`
- `pnpm test`
- `pnpm build`

Expected: all pass
