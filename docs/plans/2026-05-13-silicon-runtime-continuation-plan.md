# Silicon Runtime Continuation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Continue developing only the independent `silicon/` runtime until the local employee runtime has a coherent, tested MVP boundary.

**Architecture:** Keep `silicon/` independent from `desktop/`. First stabilize the current heartbeat, approval, and harness semantics; then add explicit execution adapters, durable run history, schema validation, stale lock recovery, and stronger CI/doctor checks. High-risk capabilities such as shell and external network stay fail-closed until a real executor adapter is deliberately introduced.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Vitest, existing JSON/JSONL text stores, no desktop code.

---

## Scope Rules

- Do not modify `desktop/`.
- Do not introduce desktop IPC, renderer, or session dependencies.
- Keep all code changes under `silicon/`.
- Documentation updates may be limited to this plan and silicon-specific docs.
- Preserve UTF-8 Chinese comments and logs.
- Run the repository乱码门禁 against touched files before completion.

## Current Gaps

1. Approval semantics conflict: `shell.execute` can be approved by policy, but the harness still blocks it because no real executor adapter exists.
2. Test gate is unstable: default Vitest timeout is too low for the daemon integration test on Windows.
3. CLI approval wording and tests disagree.
4. Harness has no explicit executor boundary; blocking is hard-coded in `step-runner.ts`.
5. Retry overwrites `runs/run-<taskId>` and artifact/review paths, weakening audit history.
6. JSON stores parse with `JSON.parse as Type` and have limited schema validation.
7. Directory locks have no metadata, TTL, owner, or stale recovery.
8. Policy parsing is a simple line scanner and does not detect malformed or duplicate rules.

---

### Task 1: Stabilize Current Test Gate and Approval Semantics

**Files:**
- Modify: `silicon/vitest.config.ts`
- Modify: `silicon/tests/heartbeat-approval.test.ts`
- Modify: `silicon/tests/cli.test.ts`
- Modify: `silicon/src/cli/main.ts`

**Step 1: Write the expected approval semantics in tests**

Update the approval resume test so approved `shell.execute` enters a run but ends as blocked while there is no shell adapter:

```ts
expect(resumed).toMatchObject({
  processedTaskIds: [],
  approvalTaskIds: [],
  blockedTaskIds: ["task-001"],
  eventCount: 5,
});
await expect(readEmployeeTask(employeeDir, "task-001")).resolves.toMatchObject({
  status: "blocked",
  runId: "run-task-001",
});
```

Update the CLI approval test to expect an explicit approval success message:

```ts
expect(approved.stdout).toContain("审批已通过");
```

**Step 2: Run the focused failing tests**

Run:

```powershell
pnpm --dir silicon exec vitest run tests/heartbeat-approval.test.ts tests/cli.test.ts
```

Expected: FAIL until CLI wording and any blocked-task assertions are aligned.

**Step 3: Implement minimal CLI wording**

In `resolveApprovalFromCli`, return status-specific text:

```ts
const label = approval.status === "approved" ? "审批已通过" : "审批已拒绝";
return ok(`${label}: ${approval.id} status=${approval.status}`);
```

**Step 4: Raise node test timeout for silicon integration tests**

Set Vitest timeout:

```ts
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
  },
});
```

**Step 5: Verify**

Run:

```powershell
pnpm --dir silicon test
pnpm --dir silicon typecheck
```

Expected: PASS.

---

### Task 2: Add an Explicit Harness Executor Boundary

**Files:**
- Create: `silicon/src/harness/executor-adapter.ts`
- Modify: `silicon/src/harness/step-runner.ts`
- Modify: `silicon/src/index.ts`
- Create: `silicon/tests/executor-adapter.test.ts`

**Step 1: Write tests for capability adapter decisions**

Create tests that assert:

- `artifact.write` uses `local_minimal` and succeeds.
- `filesystem.read` uses `local_minimal` and succeeds only inside employee boundary.
- `shell.execute` returns `missing_adapter`.
- `network.external` returns `missing_adapter`.
- `employee.cross_access` returns `forbidden`.

**Step 2: Run the new test**

Run:

```powershell
pnpm --dir silicon exec vitest run tests/executor-adapter.test.ts
```

Expected: FAIL because the adapter does not exist.

**Step 3: Implement adapter types**

Add:

```ts
export type HarnessExecutorMode = "local_minimal" | "missing_adapter" | "forbidden";

export type HarnessExecutorDecision = {
  capability: string;
  mode: HarnessExecutorMode;
  canExecute: boolean;
  reason: string;
};
```

Implement `resolveHarnessExecutorDecision(task)`.

**Step 4: Replace hard-coded blocked capability set**

Use the adapter decision in `runHarnessSteps`. If `canExecute` is false, return `blocked` with the adapter reason.

**Step 5: Verify**

Run:

```powershell
pnpm --dir silicon exec vitest run tests/executor-adapter.test.ts tests/heartbeat-approval.test.ts
pnpm --dir silicon test
```

Expected: PASS.

---

### Task 3: Preserve Run History Across Retry

**Files:**
- Modify: `silicon/src/core/task-store.ts`
- Modify: `silicon/src/runtime/heartbeat.ts`
- Modify: `silicon/src/core/todo-store.ts`
- Modify: `silicon/tests/heartbeat.test.ts`
- Create: `silicon/tests/task-retry-history.test.ts`

**Step 1: Write retry history test**

Test flow:

1. Create a task requiring `shell.execute`.
2. Heartbeat requests approval.
3. Approve it.
4. Heartbeat blocks due missing adapter.
5. Retry the task.
6. Heartbeat creates a second run without overwriting the first run directory.

Expected task shape:

```ts
expect(task.runHistory?.length).toBe(2);
expect(task.runHistory?.[0]?.runId).not.toBe(task.runHistory?.[1]?.runId);
```

**Step 2: Run test to verify failure**

Run:

```powershell
pnpm --dir silicon exec vitest run tests/task-retry-history.test.ts
```

Expected: FAIL because current run IDs are stable `run-<taskId>`.

**Step 3: Add run attempt fields**

Extend `EmployeeTask`:

```ts
attempt: number;
runHistory?: Array<{
  runId: string;
  status: "succeeded" | "blocked" | "failed";
  artifactPath?: string;
  reviewPath?: string;
  finishedAt: string;
}>;
```

Keep backward compatibility by defaulting missing `attempt` to `1` when reading/writing.

**Step 4: Generate unique run IDs**

Use:

```ts
const runId = `run-${queuedTask.id}-${String(queuedTask.attempt ?? 1).padStart(2, "0")}`;
```

**Step 5: Update retry**

`retryEmployeeTask` increments `attempt`, clears current run fields, and keeps `runHistory`.

**Step 6: Verify**

Run:

```powershell
pnpm --dir silicon exec vitest run tests/task-retry-history.test.ts tests/task-store.test.ts tests/todo-store.test.ts
pnpm --dir silicon test
```

Expected: PASS.

---

### Task 4: Add Runtime Store Schema Guards

**Files:**
- Create: `silicon/src/core/schema-guards.ts`
- Modify: `silicon/src/core/task-store.ts`
- Modify: `silicon/src/core/approval-store.ts`
- Modify: `silicon/src/core/memory-store.ts`
- Modify: `silicon/src/core/profile-store.ts`
- Modify: `silicon/src/core/schedule-store.ts`
- Create: `silicon/tests/schema-guards.test.ts`

**Step 1: Write tests for malformed JSON**

Cover:

- Bad task JSON is skipped by list and rejected by read.
- Bad approval JSON is skipped by list and rejected by read.
- Missing `schemaVersion` fails closed.
- Unknown task status fails closed.

**Step 2: Implement no-dependency guards**

Use local predicate functions:

```ts
export function assertEmployeeTask(value: unknown): asserts value is EmployeeTask;
export function assertApprovalRequest(value: unknown): asserts value is ApprovalRequest;
```

Do not add external dependencies yet.

**Step 3: Wire guards into read/list functions**

`read*` should throw clear errors. `list*` should skip invalid entries and log Chinese warnings.

**Step 4: Verify**

Run:

```powershell
pnpm --dir silicon exec vitest run tests/schema-guards.test.ts
pnpm --dir silicon test
```

Expected: PASS.

---

### Task 5: Add Stale Lock Detection and Recovery

**Files:**
- Modify: `silicon/src/core/lock-store.ts`
- Modify: `silicon/src/runtime/supervisor.ts`
- Create: `silicon/tests/lock-store.test.ts`

**Step 1: Write stale lock tests**

Test:

- Acquiring a fresh lock writes `ownerPid`, `lockName`, `acquiredAt`, `expiresAt`.
- A second acquire before expiry fails.
- A second acquire after expiry removes stale lock and succeeds.

**Step 2: Implement lock metadata**

Write `lock.json` inside the lock directory:

```ts
{
  "schemaVersion": 1,
  "lockName": "heartbeat",
  "ownerPid": 1234,
  "acquiredAt": "...",
  "expiresAt": "..."
}
```

Default TTL: 5 minutes for heartbeat, 1 minute for tests through optional input.

**Step 3: Update supervisor platform lock**

Reuse the same metadata behavior for `platform/daemon.lock`, or extract shared helpers if duplication becomes real.

**Step 4: Verify**

Run:

```powershell
pnpm --dir silicon exec vitest run tests/lock-store.test.ts tests/daemon.test.ts
pnpm --dir silicon test
```

Expected: PASS.

---

### Task 6: Harden Policy Parsing and CI Checks

**Files:**
- Modify: `silicon/src/policy/policy-engine.ts`
- Modify: `silicon/src/testing/employee-ci.ts`
- Create: `silicon/tests/policy-parser.test.ts`
- Modify: `silicon/tests/employee-ci.test.ts`

**Step 1: Write parser tests**

Cover:

- Valid default policy returns expected decisions.
- Duplicate policy key fails closed.
- Unknown decision value fails closed.
- Missing required rule fails closed.
- Comments and blank lines are ignored.

**Step 2: Implement parse result with errors**

Add:

```ts
export type ParsedPolicy = {
  rules: Map<string, PolicyDecision>;
  errors: string[];
};
```

If a required key has parse errors, return `forbid` with a reason that names the parse error.

**Step 3: Extend employee CI**

CI should fail when policy has duplicate keys, invalid decisions, or missing required rules.

**Step 4: Verify**

Run:

```powershell
pnpm --dir silicon exec vitest run tests/policy-parser.test.ts tests/employee-ci.test.ts
pnpm --dir silicon test
```

Expected: PASS.

---

### Task 7: Extend CLI Doctor for Real Runtime Health

**Files:**
- Modify: `silicon/src/cli/main.ts`
- Modify: `silicon/src/testing/employee-ci.ts`
- Create: `silicon/tests/cli-doctor.test.ts`

**Step 1: Write CLI doctor tests**

Test `runtime doctor --runtime-root <dir>` reports:

- employee count
- invalid employee folders
- stale locks
- malformed JSON records
- policy parse failures

**Step 2: Implement doctor summary**

Return a concise CLI line:

```text
runtime doctor: employees=2 passed=1 failed=1 staleLocks=1 malformedRecords=1
```

**Step 3: Verify**

Run:

```powershell
pnpm --dir silicon exec vitest run tests/cli-doctor.test.ts
pnpm --dir silicon test
```

Expected: PASS.

---

### Task 8: Final Silicon-Only Verification

**Files:**
- Verify all touched `silicon/**`
- Verify this plan if edited

**Step 1: Run full silicon checks**

Run:

```powershell
pnpm --dir silicon test
pnpm --dir silicon typecheck
```

Expected: PASS.

**Step 2: Run乱码门禁**

Run:

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern silicon docs/plans/2026-05-13-silicon-runtime-continuation-plan.md
```

Expected: no matches.

**Step 3: Check git scope**

Run:

```powershell
git status --short
```

Expected: only intentional `silicon/**` and silicon plan/docs changes are present. No `desktop/**` changes.

---

## Recommended Execution Order

1. Task 1 first: it makes the current gate coherent.
2. Task 2 next: it turns a hard-coded block list into an explicit architecture boundary.
3. Task 3 after that: it protects audit history before more executor behavior is added.
4. Tasks 4-7 are hardening work and can be done one by one.

Do not start real shell or network execution until Tasks 1-7 are green and a separate design explicitly defines sandboxing, command allowlists, output capture, timeout, cancellation, and approval persistence.
