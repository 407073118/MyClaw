# Session History Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist chat sessions and message history so runtime restarts do not wipe the conversation list.

**Architecture:** Extend the runtime state file to include sessions alongside model profiles and the default model id. Load persisted sessions on startup, fall back to a generated welcome session when no saved sessions exist, and rewrite the state file whenever sessions change.

**Tech Stack:** Node HTTP runtime, TypeScript, Vitest

---

### Task 1: Persist sessions in runtime state

**Files:**
- Modify: `apps/runtime/src/store/runtime-state-store.ts`
- Modify: `apps/runtime/src/store/session-store.ts`
- Modify: `apps/runtime/src/server.ts`
- Test: `apps/runtime/src/server.test.ts`

**Step 1: Write the failing test**

Add a runtime test that:
- creates a new session
- sends a message into that session
- restarts the runtime with the same state file
- expects the created session and appended messages to still exist in bootstrap

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test -- server`
Expected: FAIL because only model state is currently persisted.

**Step 3: Write minimal implementation**

Update runtime state handling to:
- store `sessions`
- sanitize older state files that do not include sessions
- save sessions after model changes, new session creation, and message appends

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test -- server`
Expected: PASS

### Task 2: Full verification

**Files:**
- Verify only

**Step 1: Run focused runtime suite**

Run: `pnpm --dir apps/runtime test`

**Step 2: Run workspace verification**

Run:
- `pnpm test`
- `pnpm build`

Expected: all pass
