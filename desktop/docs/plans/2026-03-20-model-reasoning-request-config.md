# Model Reasoning And Request Config Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add provider extra request-body configuration and a visible model reasoning chain to chat sessions.

**Architecture:** Extend `ModelProfile` so the desktop can persist custom headers plus extra JSON request body fields, then merge those fields into runtime provider requests. Extend `ChatMessage` so assistant replies can carry provider-returned reasoning text, persist it in runtime state, and render it in the chat UI as a visible reasoning block without fabricating any hidden chain-of-thought.

**Tech Stack:** TypeScript, Vue 3, Pinia, Vitest, Node HTTP runtime, SQLite via `sql.js`

---

### Task 1: Extend Shared Contracts For Request Body And Reasoning

**Files:**
- Modify: `packages/shared/src/contracts/model.ts`
- Modify: `packages/shared/src/contracts/session.ts`
- Test: `packages/shared/src/contracts/contracts.test.ts`

**Step 1: Write the failing test**

Add assertions that `ModelProfile` accepts a string-map `requestBody` field and `ChatMessage` accepts an optional `reasoning` string.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/shared build`
Expected: type usage fails until contracts are updated.

**Step 3: Write minimal implementation**

Add:
- `requestBody?: Record<string, string | number | boolean | null | Record<string, unknown> | unknown[]>` style JSON-compatible shape
- `reasoning?: string | null` on `ChatMessage`

**Step 4: Run test to verify it passes**

Run: `pnpm --dir packages/shared build`
Expected: PASS

### Task 2: Persist New Fields In Runtime State

**Files:**
- Modify: `apps/runtime/src/store/runtime-state-store.ts`
- Test: `apps/runtime/src/store/runtime-state-store.test.ts`

**Step 1: Write the failing test**

Persist a profile with `requestBody` and a message with `reasoning`, reload state, and assert both survive restart.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test -- src/store/runtime-state-store.test.ts`
Expected: FAIL because fields are not stored/read yet.

**Step 3: Write minimal implementation**

Add DB columns and serialization:
- `model_profiles.request_body_json`
- `messages.reasoning`

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test -- src/store/runtime-state-store.test.ts`
Expected: PASS

### Task 3: Support Provider Extra Request Body Fields

**Files:**
- Modify: `apps/runtime/src/server.ts`
- Modify: `apps/runtime/src/services/model-provider.ts`
- Test: `apps/runtime/src/server.test.ts`
- Test: `apps/runtime/src/services/model-provider.test.ts`

**Step 1: Write the failing tests**

Add tests that:
- create/update model profile accepts and returns `requestBody`
- OpenAI-compatible and Anthropic requests merge `profile.requestBody` into the request JSON

**Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/runtime test -- src/server.test.ts`
Run: `pnpm --dir apps/runtime test -- src/services/model-provider.test.ts`
Expected: FAIL because request body config is ignored.

**Step 3: Write minimal implementation**

Add JSON validation in server profile create/update handlers and merge `requestBody` into runtime provider request bodies for chat and connectivity calls.

**Step 4: Run tests to verify they pass**

Run the same two commands.
Expected: PASS

### Task 4: Extract Provider Reasoning Separately From Assistant Content

**Files:**
- Modify: `apps/runtime/src/services/model-provider.ts`
- Test: `apps/runtime/src/services/model-provider.test.ts`

**Step 1: Write the failing tests**

Add tests that:
- Responses containing `reasoning_content`/`thinking` produce `reasoning`
- assistant `content` no longer incorrectly swallows reasoning text

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test -- src/services/model-provider.test.ts`
Expected: FAIL because reasoning is currently mixed into content.

**Step 3: Write minimal implementation**

Refactor payload parsing into two channels:
- visible answer text
- reasoning text

Update `ChatCompletionOutput` and conversation loops to carry both.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test -- src/services/model-provider.test.ts`
Expected: PASS

### Task 5: Attach Reasoning To Assistant Messages

**Files:**
- Modify: `apps/runtime/src/server.ts`
- Modify: `apps/runtime/src/store/session-store.ts`
- Test: `apps/runtime/src/server.test.ts`

**Step 1: Write the failing test**

Mock a model response with `content` plus `reasoning`, send a chat message, and assert the final assistant message includes `reasoning`.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/runtime test -- src/server.test.ts`
Expected: FAIL because assistant messages currently only store content/ui.

**Step 3: Write minimal implementation**

Update assistant append path so it stores `reasoning` along with `content` and `ui`.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/runtime test -- src/server.test.ts`
Expected: PASS

### Task 6: Expose Request Body Editing In Settings UI

**Files:**
- Modify: `apps/desktop/src/views/SettingsView.vue`
- Test: `apps/desktop/src/tests/views/SettingsView.test.ts`

**Step 1: Write the failing test**

Add a test that creates/edits a profile with request-body JSON and verifies the runtime client receives that payload.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test -- src/tests/views/SettingsView.test.ts`
Expected: FAIL because the field does not exist.

**Step 3: Write minimal implementation**

Add a JSON textarea plus validation mirroring the headers field and include `requestBody` in create/update requests.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test -- src/tests/views/SettingsView.test.ts`
Expected: PASS

### Task 7: Render Reasoning Chain In Chat UI

**Files:**
- Modify: `apps/desktop/src/views/ChatView.vue`
- Test: `apps/desktop/src/tests/views/ChatView.test.ts`

**Step 1: Write the failing test**

Mount a chat fixture with an assistant message containing `reasoning` and assert the page renders a visible “思考链路” block for that reply.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop test -- src/tests/views/ChatView.test.ts`
Expected: FAIL because reasoning is not rendered.

**Step 3: Write minimal implementation**

Render a dedicated reasoning section under assistant messages when `message.reasoning` exists. Keep existing system/tool execution chain grouping unchanged.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop test -- src/tests/views/ChatView.test.ts`
Expected: PASS

### Task 8: Full Verification

**Files:**
- Modify: none

**Step 1: Run targeted tests**

Run:
- `pnpm --dir packages/shared build`
- `pnpm --dir apps/runtime test`
- `pnpm --dir apps/runtime build`
- `pnpm --dir apps/desktop test`
- `pnpm --dir apps/desktop build`

**Step 2: Run encoding gate**

Run:
- `rg -n "�|锟|Ã|Ð|\\?/h[1-6]>" apps packages docs *.md`

**Step 3: Review changed files**

Check that Chinese text remains readable and no unrelated behavior changed.
