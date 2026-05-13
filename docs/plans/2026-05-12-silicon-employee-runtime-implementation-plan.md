# Silicon Employee Runtime Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first independent `silicon/` workspace that can scaffold local silicon employee folder bodies and verify them with employee CI foundations.

**Architecture:** Add a new root-level `silicon/` workspace that is independent from `desktop/` and `cloud/`. The first slice creates a TypeScript package, a tested employee folder generator, core contracts, and a CLI-ready entry surface without connecting to MyClaw Desktop.

**Tech Stack:** TypeScript, Node.js, pnpm, Vitest, JSON/YAML-like text files, append-only JSONL conventions.

---

### Task 1: Workspace Skeleton

**Files:**
- Create: `silicon/package.json`
- Create: `silicon/tsconfig.json`
- Create: `silicon/vitest.config.ts`
- Create: `silicon/src/index.ts`
- Create: `silicon/tests/smoke.test.ts`

**Step 1: Write the failing test**

Create `silicon/tests/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SILICON_RUNTIME_NAME } from "../src/index";

describe("silicon runtime package", () => {
  it("exports the stable runtime name", () => {
    expect(SILICON_RUNTIME_NAME).toBe("silicon-employee-runtime");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --dir silicon test`

Expected: FAIL because `silicon/package.json` and `silicon/src/index.ts` do not exist yet.

**Step 3: Write minimal implementation**

Create package config and export:

```ts
export const SILICON_RUNTIME_NAME = "silicon-employee-runtime";
```

**Step 4: Run test to verify it passes**

Run: `pnpm --dir silicon test`

Expected: PASS.

### Task 2: Employee Folder Body Generator

**Files:**
- Create: `silicon/src/core/employee-scaffold.ts`
- Modify: `silicon/src/index.ts`
- Create: `silicon/tests/employee-scaffold.test.ts`

**Step 1: Write the failing test**

Test that creating employee `ada` under a temporary runtime root creates:

```text
employees/ada/soul/current.md
employees/ada/soul/changelog.md
employees/ada/profile.json
employees/ada/policy.yaml
employees/ada/heartbeat/state.json
employees/ada/heartbeat/events.jsonl
employees/ada/inbox/
employees/ada/todos/
employees/ada/runs/
employees/ada/memory/
employees/ada/skills/
employees/ada/tools/
employees/ada/loadouts/
employees/ada/approvals/
employees/ada/artifacts/
employees/ada/reviews/
employees/ada/logs/
employees/ada/tests/
```

Also assert that `profile.json` contains `employeeId`, `displayName`, `definitionId`, and `status: "idle"`.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir silicon test`

Expected: FAIL because the generator does not exist.

**Step 3: Write minimal implementation**

Implement `scaffoldEmployeeFolder(input)` using Node filesystem APIs. The method must:

- validate `employeeId` with a conservative slug pattern.
- create only the expected directories.
- write UTF-8 files.
- avoid overwriting an existing employee unless `overwrite` is explicitly true.
- log Chinese structured messages through an injected logger.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir silicon test`

Expected: PASS.

### Task 3: Policy and Soul Defaults

**Files:**
- Modify: `silicon/src/core/employee-scaffold.ts`
- Create: `silicon/tests/employee-defaults.test.ts`

**Step 1: Write failing tests**

Assert generated `soul/current.md` includes:

- 身份
- 职责
- 工作原则
- 行为边界
- 汇报标准
- 记忆规则
- 测试标准

Assert generated `policy.yaml` includes default conservative rules:

- read workspace allowed
- write artifacts allowed
- shell requires approval
- external network requires approval
- cross employee access forbidden

**Step 2: Run test to verify it fails**

Run: `pnpm --dir silicon test`

Expected: FAIL until defaults are implemented.

**Step 3: Implement defaults**

Add default soul and policy builders with Chinese comments and Chinese log messages.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir silicon test`

Expected: PASS.

### Task 4: Minimal CLI Surface

**Files:**
- Create: `silicon/src/cli/main.ts`
- Modify: `silicon/package.json`
- Create: `silicon/tests/cli.test.ts`

**Step 1: Write failing tests**

Test that CLI parser supports:

```text
employee create --id ada --name Ada --template document-organizer --runtime-root <tmp>
```

and creates the same folder body.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir silicon test`

Expected: FAIL because CLI does not exist.

**Step 3: Implement minimal CLI**

Implement a small argument parser with no external dependencies.

**Step 4: Run test to verify it passes**

Run: `pnpm --dir silicon test`

Expected: PASS.

### Task 5: Employee CI Skeleton

**Files:**
- Create: `silicon/src/testing/employee-ci.ts`
- Create: `silicon/tests/employee-ci.test.ts`

**Step 1: Write failing tests**

Assert `validateEmployeeFolder(path)` checks:

- required directories exist.
- required files exist.
- `profile.json` parses.
- `soul/current.md` contains required headings.
- `policy.yaml` contains conservative default policy lines.

**Step 2: Run test to verify it fails**

Run: `pnpm --dir silicon test`

Expected: FAIL because validator does not exist.

**Step 3: Implement validator**

Return structured result:

```ts
type EmployeeCiResult = {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; message: string }>;
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm --dir silicon test`

Expected: PASS.

### Task 6: Verification

**Files:**
- Verify all files touched in `silicon/`
- Verify plan docs in `docs/plans/`

**Step 1: Run tests**

Run: `pnpm --dir silicon test`

Expected: PASS.

**Step 2: Run typecheck**

Run: `pnpm --dir silicon typecheck`

Expected: PASS.

**Step 3: Run乱码门禁**

Run:

```powershell
$pattern = ([string][char]0xFFFD) + "|" + ([string][char]0x951F) + "|" + ([string][char]0x00C3) + "|" + ([string][char]0x00D0) + "|\\?/h[1-6]>"
rg -n $pattern silicon docs/plans/2026-05-12-silicon-employee-runtime-implementation-plan.md
```

Expected: no matches.
