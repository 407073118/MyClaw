# Chat Session Inheritance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add session creation so new chats inherit the current global default model and can be selected from the Chat page.

**Architecture:** Extend the runtime with a `POST /api/sessions` endpoint that creates a session using the current default model profile. In the desktop app, track an active session id in the workspace store and expose session creation and selection through the Chat page sidebar.

**Tech Stack:** Vue 3, Pinia, Vitest, Node HTTP runtime, TypeScript

---

### Task 1: Runtime session creation

**Files:**
- Modify: `apps/runtime/src/store/session-store.ts`
- Modify: `apps/runtime/src/server.ts`
- Test: `apps/runtime/src/server.test.ts`

**Step 1: Write the failing test**

Add a runtime test that:
- creates a new model profile
- sets it as the global default
- calls `POST /api/sessions`
- expects the created session to use that model profile id

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test -- server`
Expected: FAIL because `/api/sessions` does not exist yet.

**Step 3: Write minimal implementation**

Add a session factory helper and runtime route that:
- validates a default model exists
- creates a new chat session using the current default model id
- prepends it to the in-memory session list

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test -- server`
Expected: PASS

### Task 2: Desktop active session state

**Files:**
- Modify: `apps/desktop/src/services/runtime-client.ts`
- Modify: `apps/desktop/src/stores/workspace.ts`
- Test: `apps/desktop/src/views/ChatView.test.ts`

**Step 1: Write the failing test**

Add a desktop test that:
- creates a second session through the runtime client mock
- asserts the UI shows the new session selected
- asserts the new session inherited the new global default model

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test -- ChatView`
Expected: FAIL because no session creation or selection exists yet.

**Step 3: Write minimal implementation**

Add:
- `createSession()` client API
- `activeSessionId` workspace state
- `selectSession()` and `createSession()` store actions

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test -- ChatView`
Expected: PASS

### Task 3: Chat session rail UI

**Files:**
- Modify: `apps/desktop/src/views/ChatView.vue`
- Test: `apps/desktop/src/views/ChatView.test.ts`

**Step 1: Write the failing test**

Extend the chat test to assert:
- a session list is visible
- clicking a session switches the timeline
- clicking `New chat` creates and activates the session

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test -- ChatView`
Expected: FAIL because the session rail does not exist yet.

**Step 3: Write minimal implementation**

Add a left rail to the chat page with:
- `New chat` button
- session list
- active styling

Keep the composer and timeline behavior unchanged aside from using the active session.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test -- ChatView`
Expected: PASS

### Task 4: Full verification

**Files:**
- Verify only

**Step 1: Run focused suites**

Run:
- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/desktop test`

**Step 2: Run workspace verification**

Run:
- `pnpm test`
- `pnpm build`

Expected: all pass
