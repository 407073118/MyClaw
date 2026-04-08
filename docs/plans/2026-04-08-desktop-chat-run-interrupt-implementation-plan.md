# Desktop Chat Run Interrupt Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a real stop/interrupt capability to desktop chat so the send button becomes a clickable stop button while a chat run is active, preserves already streamed partial assistant content, and safely halts further model/tool/approval progression.

**Architecture:** Introduce a stable chat `runId` plus a session-scoped in-flight run registry in main process IPC so cancel requests target a real runtime instance instead of a drifting `messageId`. Drive renderer UI from explicit run lifecycle events rather than local `sending` heuristics, and treat user abort as a first-class terminal state that preserves partial content instead of falling into the generic error branch.

**Tech Stack:** TypeScript, Electron IPC, React, Zustand, Vitest, existing `callModel()` transport abort support, existing `session:stream` event bridge

**Key files to read before starting:**
- `desktop/src/renderer/pages/ChatPage.tsx`
- `desktop/src/renderer/stores/workspace.ts`
- `desktop/src/preload/index.ts`
- `desktop/src/renderer/types/electron.d.ts`
- `desktop/src/main/ipc/sessions.ts`
- `desktop/src/main/services/model-client.ts`
- `desktop/src/main/services/model-transport.ts`
- `desktop/src/main/services/runtime-context.ts`
- `desktop/src/main/services/builtin-tool-executor.ts`
- `desktop/shared/contracts/events.ts`
- `desktop/shared/contracts/session.ts`
- `desktop/shared/contracts/plan.ts`
- `desktop/tests/chat-page-a11y.test.ts`
- `desktop/tests/phase1-session-runtime-integration.test.ts`
- `desktop/tests/phase2-session-orchestration.test.ts`
- `desktop/tests/phase3-session-planning-orchestration.test.ts`
- `desktop/tests/phase3-tool-loop-plan-updates.test.ts`

**Global execution rules:**
- Preserve UTF-8 and existing line ending style.
- Only make minimal changes for chat interrupt support.
- Do not reuse `deny` or generic error handling to represent user stop.
- Treat tool side effects as non-rollbackable.
- Every task below must start with a failing test before implementation.

**Interrupt semantics to preserve through all tasks:**
- `stop` means stop the current chat run from progressing further.
- Already streamed assistant content must remain visible and persisted.
- Already started non-cancelable tool side effects are not rolled back.
- Approval wait should terminate as `canceled`, not `deny`.
- Plan Mode abort should become `canceled`, not `blocked`, when the user explicitly stops.

---

## Multi-Agent Execution Topology

**Wave 1**
- Agent A ownership: renderer + store + preload + renderer tests
- Agent B ownership: shared contracts + runtime context + session IPC + main-process tests
- Agent C ownership: model/tool abort propagation + tool executor edges + transport/unit tests

**Wave 2**
- Main agent ownership: integrate merged changes, resolve event naming consistency, run cross-layer verification, run garble scan

**Hard write boundaries**
- Agent A must not edit `desktop/src/main/**` or `desktop/shared/contracts/**`
- Agent B must not edit `desktop/src/renderer/**`
- Agent C must not edit renderer files or broad IPC orchestration logic
- Main agent is the only one allowed to adjust overlapping contract/event names after all waves return

---

### Task 1: Define Chat Run Interrupt Contracts

**Owner:** Agent B

**Files:**
- Modify: `desktop/shared/contracts/events.ts`
- Modify: `desktop/shared/contracts/session.ts`
- Modify: `desktop/shared/contracts/plan.ts`
- Test: `desktop/tests/phase2-session-orchestration.test.ts`
- Test: `desktop/tests/phase3-session-planning-orchestration.test.ts`

**Step 1: Write the failing contract-oriented tests**

Add or extend tests to assert the runtime emits explicit chat run lifecycle states:
- `running`
- `canceling`
- `canceled`
- `completed`

Add a failing assertion that Plan Mode explicit stop is represented as `canceled` instead of `blocked`.

Run: `cd F:/MyClaw/desktop && npx vitest run tests/phase2-session-orchestration.test.ts tests/phase3-session-planning-orchestration.test.ts`
Expected: FAIL because the new event payload and canceled state do not exist yet.

**Step 2: Extend shared event contracts**

Update `desktop/shared/contracts/events.ts` to support a structured runtime status payload for chat runs. Add event support for:

```ts
type ChatRunPhase = "planning" | "model" | "approval" | "tools" | "persisting";
type ChatRunStatus = "running" | "canceling" | "canceled" | "completed" | "failed";
```

Reuse `EventType.RuntimeStatus` instead of inventing another channel. The payload must carry:

```ts
{
  sessionId: string;
  runId: string;
  status: ChatRunStatus;
  phase: ChatRunPhase;
  messageId?: string;
  reason?: string;
}
```

**Step 3: Extend chat session metadata carefully**

Add optional session-scoped runtime metadata in `desktop/shared/contracts/session.ts` for persisted or bridged UI awareness:

```ts
chatRunState?: {
  runId: string;
  status: "running" | "canceling" | "canceled" | "completed" | "failed";
  phase: "planning" | "model" | "approval" | "tools" | "persisting";
  activeMessageId?: string;
  lastReason?: string | null;
} | null;
```

Keep all fields optional/backward-compatible.

**Step 4: Extend plan state enum for explicit user stop**

Add `canceled` into the relevant plan mode status union in `desktop/shared/contracts/plan.ts`, but do not change existing `blocked` semantics.

**Step 5: Run tests to verify they pass**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/phase2-session-orchestration.test.ts tests/phase3-session-planning-orchestration.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add desktop/shared/contracts/events.ts desktop/shared/contracts/session.ts desktop/shared/contracts/plan.ts desktop/tests/phase2-session-orchestration.test.ts desktop/tests/phase3-session-planning-orchestration.test.ts
git commit -m "feat(chat): add run interrupt contracts and canceled plan state"
```

---

### Task 2: Add Session-Scoped In-Flight Run Registry

**Owner:** Agent B

**Files:**
- Modify: `desktop/src/main/services/runtime-context.ts`
- Modify: `desktop/src/main/index.ts`
- Test: `desktop/tests/phase1-session-runtime-integration.test.ts`

**Step 1: Write the failing runtime registry test**

Add a test that bootstrapped runtime context exposes an `activeSessionRuns` map and that its lifecycle is safe for concurrent lookup/removal.

Run: `cd F:/MyClaw/desktop && npx vitest run tests/phase1-session-runtime-integration.test.ts`
Expected: FAIL because the map does not exist.

**Step 2: Add active session run state**

Extend runtime context with:

```ts
activeSessionRuns: Map<string, {
  runId: string;
  abortController: AbortController;
  status: "running" | "canceling";
  phase: "planning" | "model" | "approval" | "tools" | "persisting";
  currentMessageId: string;
  pendingApprovalIds: string[];
  cancelRequested: boolean;
}>;
```

Key the map by `sessionId`.

**Step 3: Initialize the map during runtime boot**

Wire map creation into runtime initialization in `desktop/src/main/index.ts` without disturbing workflow runtime maps.

**Step 4: Run the test**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/phase1-session-runtime-integration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/services/runtime-context.ts desktop/src/main/index.ts desktop/tests/phase1-session-runtime-integration.test.ts
git commit -m "feat(chat): add active session run registry to runtime context"
```

---

### Task 3: Add Cancel IPC and Abort-Aware Session Loop Skeleton

**Owner:** Agent B

**Files:**
- Modify: `desktop/src/main/ipc/sessions.ts`
- Test: `desktop/tests/phase2-session-orchestration.test.ts`
- Test: `desktop/tests/phase3-tool-loop-plan-updates.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- `session:cancel-run` handler registration
- repeated cancel returns idempotent response
- cancel during approval wait resolves as canceled, not deny
- cancel during active run switches runtime status to `canceling`

Run: `cd F:/MyClaw/desktop && npx vitest run tests/phase2-session-orchestration.test.ts tests/phase3-tool-loop-plan-updates.test.ts`
Expected: FAIL because no cancel IPC exists.

**Step 2: Register stable runId at send start**

At the start of `session:send-message`, generate:

```ts
const runId = randomUUID();
```

Store it in `ctx.state.activeSessionRuns` together with the newly created `AbortController`.

Broadcast runtime status:

```ts
status: "running"
phase: "planning" | "model"
```

Persist `session.chatRunState` with `runId`, `status`, `phase`, and `currentMessageId`.

**Step 3: Thread abort controller through model calls**

Pass `abortController.signal` into every `callModel()` inside `sessions.ts`, including Plan Mode planning branch and normal agentic loop branch.

**Step 4: Add `session:cancel-run`**

Add a new IPC handler with shape:

```ts
ipcMain.handle("session:cancel-run", async (_event, sessionId: string, input?: { runId?: string }) => { ... })
```

Return:

```ts
{ success: boolean; state: "canceling" | "already_completed" | "not_found" | "stale_run" }
```

On successful cancellation:
- mark run entry `cancelRequested = true`
- mark status `canceling`
- broadcast `RuntimeStatus`
- abort the controller
- resolve all pending approval waits associated with the run as canceled

**Step 5: Keep cleanup centralized**

When a run exits through completed/canceled/failed, remove it from `activeSessionRuns` in one place only.

**Step 6: Run tests**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/phase2-session-orchestration.test.ts tests/phase3-tool-loop-plan-updates.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add desktop/src/main/ipc/sessions.ts desktop/tests/phase2-session-orchestration.test.ts desktop/tests/phase3-tool-loop-plan-updates.test.ts
git commit -m "feat(chat): add cancel-run ipc and in-flight run orchestration"
```

---

### Task 4: Preserve Partial Assistant Content on User Abort

**Owner:** Agent B

**Files:**
- Modify: `desktop/src/main/ipc/sessions.ts`
- Modify: `desktop/src/main/services/model-sse-parser.ts`
- Test: `desktop/tests/phase2-session-orchestration.test.ts`

**Step 1: Write the failing tests**

Add a test that simulates:
1. user message sent
2. `message.delta` produced for assistant
3. abort triggered before completion
4. final persisted session still contains the partial assistant content
5. no `[模型调用失败] AbortError...` message is appended

Run: `cd F:/MyClaw/desktop && npx vitest run tests/phase2-session-orchestration.test.ts`
Expected: FAIL because abort still falls into generic error branch.

**Step 2: Special-case user abort in session loop**

In `sessions.ts`, detect `AbortError` or controller-aborted branch before generic error formatting. On user abort:
- do not append synthetic failure assistant message
- preserve current `currentMessageId` content if already streamed
- mark `session.chatRunState.status = "canceled"`
- set plan mode status to `canceled` when user explicitly stopped
- emit runtime status `canceled`

If no assistant partial exists yet, do not invent placeholder prose.

**Step 3: Ensure final save keeps partial**

Persist the authoritative `session` after cancel handling, then emit `session.updated`.

Do not overwrite the partial message with an empty assistant stub.

**Step 4: Keep parser behavior minimal**

Only touch `model-sse-parser.ts` if needed to make partial content capture deterministic under abort; avoid broad parser changes.

**Step 5: Run the test**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/phase2-session-orchestration.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add desktop/src/main/ipc/sessions.ts desktop/src/main/services/model-sse-parser.ts desktop/tests/phase2-session-orchestration.test.ts
git commit -m "feat(chat): preserve partial assistant output when user aborts run"
```

---

### Task 5: Best-Effort Cancellation for Approval and Tool Phases

**Owner:** Agent C

**Files:**
- Modify: `desktop/src/main/ipc/sessions.ts`
- Modify: `desktop/src/main/services/builtin-tool-executor.ts`
- Test: `desktop/tests/phase3-tool-loop-plan-updates.test.ts`
- Test: `desktop/tests/phase4-tool-exec-timeout.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- cancel while waiting for approval ends the run without converting to tool deny
- cancel during `http.fetch`/`web.search` uses caller signal when available
- cancel during non-cancelable tool leaves side effect semantics unchanged but stops future rounds

Run: `cd F:/MyClaw/desktop && npx vitest run tests/phase3-tool-loop-plan-updates.test.ts tests/phase4-tool-exec-timeout.test.ts`
Expected: FAIL

**Step 2: Thread optional caller signal into built-in network tools**

Extend the tool executor APIs minimally so `http.fetch` and `web.search` can accept an external signal in addition to their internal timeout controller.

Use signal composition rather than replacing internal timeout safety.

**Step 3: Respect cancelRequested after tool completion boundaries**

In `sessions.ts`, before starting a new model round or the next tool batch, short-circuit if `cancelRequested` is true.

That is the first-version guarantee for non-cancelable sync tools.

**Step 4: Keep side-effect semantics explicit**

If a non-cancelable tool already started, stop only after the current tool/batch returns.

Do not attempt fake rollback logic.

**Step 5: Run tests**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/phase3-tool-loop-plan-updates.test.ts tests/phase4-tool-exec-timeout.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add desktop/src/main/ipc/sessions.ts desktop/src/main/services/builtin-tool-executor.ts desktop/tests/phase3-tool-loop-plan-updates.test.ts desktop/tests/phase4-tool-exec-timeout.test.ts
git commit -m "feat(chat): add best-effort cancellation across approval and tool phases"
```

---

### Task 6: Expose Cancel API to Renderer Bridge and Store

**Owner:** Agent A

**Files:**
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/chat-page-a11y.test.ts`

**Step 1: Write the failing tests**

Add failing tests that assert:
- `window.myClawAPI.cancelSessionRun` exists
- workspace exposes `cancelSessionRun()`
- stop click routes through the bridge

Run: `cd F:/MyClaw/desktop && npx vitest run tests/chat-page-a11y.test.ts`
Expected: FAIL

**Step 2: Add preload bridge**

Expose:

```ts
cancelSessionRun: (sessionId: string, input?: { runId?: string }) =>
  ipcRenderer.invoke("session:cancel-run", sessionId, input ?? {})
```

**Step 3: Align electron typings**

Mirror the exact bridge signature in `electron.d.ts`.

**Step 4: Add workspace action**

Add store action:

```ts
cancelSessionRun: (input?: { runId?: string }) => Promise<{ success: boolean; state: string }>
```

Resolve `currentSession.id` internally.

Do not mix this with `cancelPlanMode`.

**Step 5: Run test**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/chat-page-a11y.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add desktop/src/preload/index.ts desktop/src/renderer/types/electron.d.ts desktop/src/renderer/stores/workspace.ts desktop/tests/chat-page-a11y.test.ts
git commit -m "feat(chat): expose cancel-session-run bridge to renderer"
```

---

### Task 7: Replace Local Sending Heuristic with Run Lifecycle UI

**Owner:** Agent A

**Files:**
- Modify: `desktop/src/renderer/pages/ChatPage.tsx`
- Test: `desktop/tests/chat-page-a11y.test.ts`
- Test: `desktop/tests/phase3-plan-ui.test.ts`

**Step 1: Write the failing tests**

Add tests for:
- send button becomes clickable stop button during active run
- clicking stop requests cancel and shows canceling feedback
- after runtime status `canceled`, input re-enables immediately
- partial assistant content remains rendered after canceled terminal state
- Plan Mode entry points using `sendMessageToRuntime()` still behave correctly

Run: `cd F:/MyClaw/desktop && npx vitest run tests/chat-page-a11y.test.ts tests/phase3-plan-ui.test.ts`
Expected: FAIL

**Step 2: Add explicit run state to ChatPage**

Replace the single local `sending` heuristic with explicit state such as:

```ts
type LocalRunPhase = "idle" | "running" | "canceling";
```

Track:
- `activeRunId`
- `activeRunMessageId`
- `runPhase`
- `lastTerminalReason`

Source these from `RuntimeStatus` and `run.started`, not just from awaiting `workspace.sendMessage()`.

**Step 3: Make stop button clickable**

When `runPhase !== "idle"`, render an enabled stop button:

```tsx
<button data-testid="composer-stop" ... onClick={() => void handleStopRun()} />
```

During `canceling`, disable repeated clicks and change title/aria label appropriately.

**Step 4: Preserve current UX details**

Keep:
- slash menu disabled while run active
- form submit guards
- plan entry points

But restore composer input as soon as terminal canceled/completed/failed status arrives.

**Step 5: Run tests**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/chat-page-a11y.test.ts tests/phase3-plan-ui.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add desktop/src/renderer/pages/ChatPage.tsx desktop/tests/chat-page-a11y.test.ts desktop/tests/phase3-plan-ui.test.ts
git commit -m "feat(chat): drive composer stop state from runtime lifecycle events"
```

---

### Task 8: Integrate Cross-Layer Event Semantics

**Owner:** Main agent

**Files:**
- Modify: `desktop/src/main/ipc/sessions.ts`
- Modify: `desktop/src/renderer/pages/ChatPage.tsx`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/phase2-session-orchestration.test.ts`
- Test: `desktop/tests/chat-page-a11y.test.ts`

**Step 1: Write or refine failing integration assertions**

Add a focused test path covering:
- user sends message
- run enters `running`
- partial content streams
- user stops
- run enters `canceling` then `canceled`
- renderer preserves partial content
- session final snapshot matches rendered state

Run: `cd F:/MyClaw/desktop && npx vitest run tests/phase2-session-orchestration.test.ts tests/chat-page-a11y.test.ts`
Expected: FAIL until event names and lifecycle are consistent.

**Step 2: Normalize event naming and payloads**

Make sure main and renderer use the same payload keys for:
- `runId`
- `status`
- `phase`
- `messageId`
- `reason`

Do not leave mixed naming like `activeMessageId/currentMessageId/messageId` unresolved.

**Step 3: Remove duplicate terminal transitions**

Ensure renderer does not drop back to idle too early from `session.updated` if runtime still says `canceling`.

Likewise ensure `message.completed` does not incorrectly reset stop button state.

**Step 4: Run tests**

Run: `cd F:/MyClaw/desktop && npx vitest run tests/phase2-session-orchestration.test.ts tests/chat-page-a11y.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add desktop/src/main/ipc/sessions.ts desktop/src/renderer/pages/ChatPage.tsx desktop/src/renderer/stores/workspace.ts desktop/tests/phase2-session-orchestration.test.ts desktop/tests/chat-page-a11y.test.ts
git commit -m "fix(chat): normalize interrupt lifecycle events across main and renderer"
```

---

### Task 9: Full Regression Sweep and Safety Checks

**Owner:** Main agent

**Files:**
- Modify only if required by failing tests
- Test: `desktop/tests/phase1-session-runtime-integration.test.ts`
- Test: `desktop/tests/phase2-session-orchestration.test.ts`
- Test: `desktop/tests/phase3-plan-ui.test.ts`
- Test: `desktop/tests/phase3-session-planning-orchestration.test.ts`
- Test: `desktop/tests/phase3-tool-loop-plan-updates.test.ts`
- Test: `desktop/tests/chat-page-a11y.test.ts`
- Test: `desktop/tests/phase4-tool-exec-timeout.test.ts`

**Step 1: Run targeted regression suite**

Run:

```bash
cd F:/MyClaw/desktop && npx vitest run tests/phase1-session-runtime-integration.test.ts tests/phase2-session-orchestration.test.ts tests/phase3-plan-ui.test.ts tests/phase3-session-planning-orchestration.test.ts tests/phase3-tool-loop-plan-updates.test.ts tests/chat-page-a11y.test.ts tests/phase4-tool-exec-timeout.test.ts
```

Expected: PASS

**Step 2: Run full desktop test suite if targeted tests pass**

Run:

```bash
cd F:/MyClaw/desktop && pnpm test
```

Expected: PASS or only known unrelated failures already present before branch.

**Step 3: Run typecheck**

Run:

```bash
cd F:/MyClaw/desktop && pnpm typecheck
```

Expected: PASS

**Step 4: Execute乱码检查**

Run:

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern desktop/src desktop/tests docs/plans *.md
```

Expected: no matches in newly changed files.

**Step 5: Commit**

```bash
git add desktop/src desktop/tests docs/plans
git commit -m "test(chat): verify interrupt flow across renderer, ipc, and runtime"
```

---

## Integration Notes For The Main Agent

- Merge Agent B before Agent A, because renderer lifecycle depends on final event payload names.
- Merge Agent C before final regression, because cancel semantics during tool/network phases affect end-to-end stop timing.
- If Agent B adds `canceled` to Plan Mode contract, Agent A must update any renderer status labels that assume only `blocked`.
- Do not broaden this effort into generic “pause/resume”; only implement stop/interrupt.
- Do not retrofit rollback for file edits, shell commands, git writes, or browser clicks.
- If a current sync tool cannot be interrupted, surface cancel-requested state and stop after the current step boundary.

## Done Criteria

- Send button becomes clickable stop button during active chat run.
- Stop request can target a stable `runId`.
- Model streaming abort preserves already streamed assistant text.
- Session persistence keeps partial content after user stop.
- Approval wait stops as canceled, not deny.
- Plan Mode explicit user stop is represented as canceled, not blocked.
- Renderer returns to editable state after canceled terminal event.
- Cross-layer tests and乱码检查 pass.
