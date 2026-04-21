# Desktop Time Orchestration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a desktop-first time orchestration layer for MyClaw that supports local reminders, schedule jobs, calendar events, task commitments, timeboxing, daily briefs, meeting follow-up import, and silicon-person recurring work without introducing any cloud dependency.

**Architecture:** Keep the implementation entirely inside `desktop/`, but separate the system into four layers: shared contracts, a local main-process persistence/runtime layer, IPC/preload/store bindings, and renderer UI. Use a dedicated local `time.db` instead of overloading `sessions.db` or `settings.json`, and keep provider/source fields plus external references on all time-domain objects so later sync adapters can be added without redesigning the model.

**Tech Stack:** TypeScript, Electron main process, React 18, Zustand, sql.js-backed local database, Electron `Notification`, Vitest, existing `desktop/src/main/ipc/**`, `desktop/src/preload/index.ts`, `desktop/src/renderer/**`

---

## Current Repo Truth

The engineer executing this plan should start from these verified facts:

- `desktop/` already has strong patterns for a local-only feature that spans contract -> main service -> IPC -> preload -> renderer. The best current reference is the meeting recorder flow:
  - `desktop/shared/contracts/meeting.ts`
  - `desktop/src/main/services/meeting-recorder.ts`
  - `desktop/src/main/ipc/meetings.ts`
  - `desktop/src/preload/index.ts`
  - `desktop/src/renderer/pages/MeetingsPage.tsx`
- Main-process service registration happens in `desktop/src/main/index.ts`, with shared service references stored in `desktop/src/main/services/runtime-context.ts`.
- Session persistence is already split:
  - chat sessions/messages live in `sessions.db` via `desktop/src/main/services/session-database.ts`
  - settings/models/workflows remain file-based via `desktop/src/main/services/state-persistence.ts`
- `desktop/src/main/ipc/sessions.ts` already contains a specialized tool-family handler for `task_create`, `task_list`, `task_get`, and `task_update`. Time tools should follow that pattern instead of trying to bolt everything onto `builtin-tool-executor.ts`.
- App navigation and routes are controlled by:
  - `desktop/src/renderer/layouts/AppShell.tsx`
  - `desktop/src/renderer/router/index.tsx`
  - `desktop/src/renderer/components/TitleBar.tsx`
- There is currently no calendar/time domain model, no desktop notification service, no schedule runner, no time-center route, and no local store slice for time orchestration.

## Non-Goals For This Plan

This plan intentionally does **not** include:

- cloud sync
- enterprise calendar gateway
- org-level permissions
- multi-user scheduling
- external Google/Outlook/Feishu calendar adapters

This is a strict `desktop-first` plan.

## Implementation Order

The tasks below are ordered so each one builds on the previous one while staying independently reviewable.

---

### Task 1: Define The Desktop Time Contracts

**Files:**
- Create: `desktop/shared/contracts/calendar.ts`
- Create: `desktop/shared/contracts/time-orchestration.ts`
- Modify: `desktop/shared/contracts/index.ts`
- Test: `desktop/tests/time-orchestration-contracts.test.ts`

**Step 1: Write the failing test**

```ts
import {
  CALENDAR_EVENT_STATUS_VALUES,
  REMINDER_STATUS_VALUES,
  SCHEDULE_JOB_KIND_VALUES,
  createDefaultAvailabilityPolicy,
} from "../shared/contracts";

describe("time orchestration contracts", () => {
  it("builds a desktop-friendly default availability policy", () => {
    const policy = createDefaultAvailabilityPolicy("Asia/Shanghai");

    expect(policy.timezone).toBe("Asia/Shanghai");
    expect(policy.workingHours.length).toBeGreaterThan(0);
    expect(policy.quietHours.enabled).toBe(true);
  });

  it("exports stable enum values for reminders and jobs", () => {
    expect(CALENDAR_EVENT_STATUS_VALUES).toContain("confirmed");
    expect(REMINDER_STATUS_VALUES).toContain("scheduled");
    expect(SCHEDULE_JOB_KIND_VALUES).toEqual(["once", "interval", "cron"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-orchestration-contracts.test.ts
```

Expected: FAIL with missing contract exports or missing files under `desktop/shared/contracts/`.

**Step 3: Write minimal implementation**

Create the two contract files with:

- `CalendarEvent`
- `TaskCommitment`
- `Reminder`
- `ScheduleJob`
- `ExecutionRun`
- `AvailabilityPolicy`
- `TodayBrief`
- stable `*_VALUES` arrays for string unions
- `createDefaultAvailabilityPolicy(timezone: string)`

Keep every object desktop-ready and sync-ready:

```ts
export type TimeEntitySource = "manual" | "meeting" | "agent" | "workflow" | "imported";

export type ReminderStatus = "scheduled" | "delivered" | "dismissed" | "cancelled";
export const REMINDER_STATUS_VALUES = [
  "scheduled",
  "delivered",
  "dismissed",
  "cancelled",
] as const satisfies readonly ReminderStatus[];

export function createDefaultAvailabilityPolicy(timezone: string): AvailabilityPolicy {
  return {
    timezone,
    workingHours: [
      { weekday: 1, start: "09:00", end: "18:00" },
      { weekday: 2, start: "09:00", end: "18:00" },
      { weekday: 3, start: "09:00", end: "18:00" },
      { weekday: 4, start: "09:00", end: "18:00" },
      { weekday: 5, start: "09:00", end: "18:00" },
    ],
    quietHours: { enabled: true, start: "22:00", end: "08:00" },
    notificationWindows: [],
    focusBlocks: [],
  };
}
```

Re-export everything from `desktop/shared/contracts/index.ts`.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-orchestration-contracts.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add desktop/shared/contracts/calendar.ts desktop/shared/contracts/time-orchestration.ts desktop/shared/contracts/index.ts desktop/tests/time-orchestration-contracts.test.ts
git commit -m "feat: add desktop time orchestration contracts"
```

---

### Task 2: Add A Dedicated Local `time.db` And Store

**Files:**
- Modify: `desktop/src/main/services/directory-service.ts`
- Modify: `desktop/src/main/services/runtime-context.ts`
- Modify: `desktop/src/main/index.ts`
- Create: `desktop/src/main/services/time-orchestration-database.ts`
- Create: `desktop/src/main/services/time-orchestration-store.ts`
- Test: `desktop/tests/time-orchestration-store.test.ts`

**Step 1: Write the failing test**

```ts
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { derivePaths } from "../src/main/services/directory-service";
import { TimeOrchestrationStore } from "../src/main/services/time-orchestration-store";

describe("TimeOrchestrationStore", () => {
  it("persists reminders, jobs, and availability policy in time.db", async () => {
    const root = mkdtempSync(join(tmpdir(), "myclaw-time-"));
    const paths = derivePaths(root);
    const store = await TimeOrchestrationStore.create(paths);

    const reminder = await store.upsertReminder({
      title: "Call doctor",
      triggerAt: "2026-04-20T07:00:00.000Z",
      timezone: "Asia/Shanghai",
    });

    const policy = await store.saveAvailabilityPolicy({
      timezone: "Asia/Shanghai",
      workingHours: [{ weekday: 1, start: "09:00", end: "18:00" }],
      quietHours: { enabled: true, start: "22:00", end: "08:00" },
      notificationWindows: [],
      focusBlocks: [],
    });

    expect((await store.listReminders())[0]?.id).toBe(reminder.id);
    expect((await store.getAvailabilityPolicy()).timezone).toBe(policy.timezone);
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-orchestration-store.test.ts
```

Expected: FAIL because `time-orchestration-store.ts` and `time-orchestration-database.ts` do not exist yet.

**Step 3: Write minimal implementation**

Add `timeDbFile` to `MyClawPaths` in `directory-service.ts`:

```ts
timeDbFile: join(myClawDir, "time.db"),
```

Create a dedicated time database service with tables similar to:

```sql
CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  trigger_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
```

Also add tables for:

- `calendar_events`
- `task_commitments`
- `schedule_jobs`
- `execution_runs`
- `availability_policies`

Create `TimeOrchestrationStore` as the high-level API:

```ts
export class TimeOrchestrationStore {
  static async create(paths: MyClawPaths): Promise<TimeOrchestrationStore> { /* ... */ }
  async listReminders(): Promise<Reminder[]> { /* ... */ }
  async upsertReminder(input: ReminderUpsertInput): Promise<Reminder> { /* ... */ }
  async listScheduleJobs(): Promise<ScheduleJob[]> { /* ... */ }
  async saveAvailabilityPolicy(policy: AvailabilityPolicy): Promise<AvailabilityPolicy> { /* ... */ }
  async getAvailabilityPolicy(): Promise<AvailabilityPolicy> { /* ... */ }
}
```

Wire the store into `runtime-context.ts` and `main/index.ts`.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-orchestration-store.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add desktop/src/main/services/directory-service.ts desktop/src/main/services/runtime-context.ts desktop/src/main/index.ts desktop/src/main/services/time-orchestration-database.ts desktop/src/main/services/time-orchestration-store.ts desktop/tests/time-orchestration-store.test.ts
git commit -m "feat: add local time orchestration database"
```

---

### Task 3: Build The Scheduler And Desktop Notification Layer

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/src/main/services/runtime-context.ts`
- Modify: `desktop/src/main/index.ts`
- Create: `desktop/src/main/services/time-scheduler.ts`
- Create: `desktop/src/main/services/time-notification-service.ts`
- Test: `desktop/tests/time-scheduler.test.ts`
- Test: `desktop/tests/time-notification-service.test.ts`

**Step 1: Write the failing tests**

```ts
import { createDefaultAvailabilityPolicy } from "../shared/contracts";
import { createTimeScheduler } from "../src/main/services/time-scheduler";

describe("time scheduler", () => {
  it("runs a due reminder exactly once and records an execution run", async () => {
    const delivered: string[] = [];
    const scheduler = createTimeScheduler({
      now: () => new Date("2026-04-20T07:00:00.000Z"),
      listDueJobs: async () => [],
      listDueReminders: async () => [{
        id: "rem-1",
        title: "Call doctor",
        triggerAt: "2026-04-20T07:00:00.000Z",
        timezone: "Asia/Shanghai",
        status: "scheduled",
      }],
      notifyReminder: async (reminder) => delivered.push(reminder.id),
      markReminderDelivered: async () => undefined,
      recordExecutionRun: async () => undefined,
      getAvailabilityPolicy: async () => createDefaultAvailabilityPolicy("Asia/Shanghai"),
    });

    await scheduler.tick();
    expect(delivered).toEqual(["rem-1"]);
  });
});
```

```ts
import { createTimeNotificationService } from "../src/main/services/time-notification-service";

describe("time notification service", () => {
  it("suppresses notifications during quiet hours when delivery policy is normal", async () => {
    const sent: string[] = [];
    const service = createTimeNotificationService({
      send: async (title) => sent.push(title),
      now: () => new Date("2026-04-20T23:30:00.000Z"),
    });

    await service.deliverReminder(
      { title: "Late ping", body: "Check deploy" } as any,
      {
        timezone: "Asia/Shanghai",
        workingHours: [],
        quietHours: { enabled: true, start: "22:00", end: "08:00" },
        notificationWindows: [],
        focusBlocks: [],
      },
    );

    expect(sent).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-scheduler.test.ts tests/time-notification-service.test.ts
```

Expected: FAIL because both services are missing.

**Step 3: Write minimal implementation**

Add a cron parser dependency so desktop jobs do not reinvent recurrence math:

```json
"dependencies": {
  "croner": "^10.0.1"
}
```

Create:

- `createTimeNotificationService()` with injected sender for tests and Electron `Notification` in production
- `createTimeScheduler()` with:
  - `start()`
  - `stop()`
  - `tick()`
  - due reminder delivery
  - due schedule-job dispatch
  - execution-run recording
  - quiet-hour suppression logic

Keep the scheduler injectable and testable:

```ts
export function createTimeScheduler(deps: TimeSchedulerDeps) {
  return {
    async tick(): Promise<void> {
      const reminders = await deps.listDueReminders(deps.now());
      for (const reminder of reminders) {
        await deps.notifyReminder(reminder);
        await deps.markReminderDelivered(reminder.id, deps.now().toISOString());
        await deps.recordExecutionRun({ kind: "reminder", entityId: reminder.id, status: "completed" });
      }
    },
  };
}
```

Wire it into `main/index.ts` after the runtime context is created.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-scheduler.test.ts tests/time-notification-service.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add desktop/package.json desktop/src/main/services/runtime-context.ts desktop/src/main/index.ts desktop/src/main/services/time-scheduler.ts desktop/src/main/services/time-notification-service.ts desktop/tests/time-scheduler.test.ts desktop/tests/time-notification-service.test.ts
git commit -m "feat: add desktop time scheduler and notifications"
```

---

### Task 4: Expose Time APIs Through IPC, Preload, And Zustand

**Files:**
- Create: `desktop/src/main/ipc/time-orchestration.ts`
- Modify: `desktop/src/main/ipc/index.ts`
- Modify: `desktop/src/main/ipc/bootstrap.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Modify: `desktop/src/renderer/stores/workspace.ts`
- Test: `desktop/tests/time-orchestration-ipc.test.ts`
- Test: `desktop/tests/workspace-time-store.test.ts`

**Step 1: Write the failing tests**

```ts
describe("time orchestration IPC", () => {
  it("lists reminders and returns today brief payloads", async () => {
    // register handlers against a mocked runtime context
    // invoke "time:list-reminders" and "time:get-today-brief"
    // expect the mocked store methods to be called
  });
});
```

```ts
import { useWorkspaceStore } from "../src/renderer/stores/workspace";

describe("workspace time store", () => {
  it("hydrates reminders and schedule jobs from bootstrap", async () => {
    await useWorkspaceStore.getState().loadBootstrap();

    expect(useWorkspaceStore.getState().time.reminders.length).toBeGreaterThan(0);
    expect(useWorkspaceStore.getState().time.availabilityPolicy).not.toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-orchestration-ipc.test.ts tests/workspace-time-store.test.ts
```

Expected: FAIL because no time IPC or store slice exists.

**Step 3: Write minimal implementation**

Add IPC channels for:

- `time:list-calendar-events`
- `time:create-calendar-event`
- `time:update-calendar-event`
- `time:list-task-commitments`
- `time:create-task-commitment`
- `time:update-task-commitment`
- `time:list-reminders`
- `time:create-reminder`
- `time:update-reminder`
- `time:delete-reminder`
- `time:list-schedule-jobs`
- `time:create-schedule-job`
- `time:update-schedule-job`
- `time:delete-schedule-job`
- `time:get-availability-policy`
- `time:save-availability-policy`
- `time:get-today-brief`

Expose them in preload and electron type declarations.

Add a `time` slice in `workspace.ts`:

```ts
time: {
  calendarEvents: [],
  taskCommitments: [],
  reminders: [],
  scheduleJobs: [],
  executionRuns: [],
  availabilityPolicy: null,
  todayBrief: null,
},
```

Extend bootstrap payload to include a small initial snapshot:

```ts
time: {
  reminders: Reminder[];
  scheduleJobs: ScheduleJob[];
  availabilityPolicy: AvailabilityPolicy;
}
```

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-orchestration-ipc.test.ts tests/workspace-time-store.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add desktop/src/main/ipc/time-orchestration.ts desktop/src/main/ipc/index.ts desktop/src/main/ipc/bootstrap.ts desktop/src/preload/index.ts desktop/src/renderer/types/electron.d.ts desktop/src/renderer/stores/workspace.ts desktop/tests/time-orchestration-ipc.test.ts desktop/tests/workspace-time-store.test.ts
git commit -m "feat: expose desktop time orchestration APIs"
```

---

### Task 5: Add The Time Center Route, Navigation, And Read-Only Shell

**Files:**
- Create: `desktop/src/renderer/pages/TimeCenterPage.tsx`
- Create: `desktop/src/renderer/components/time/TodayBriefPanel.tsx`
- Create: `desktop/src/renderer/components/time/WeekTimeline.tsx`
- Modify: `desktop/src/renderer/router/index.tsx`
- Modify: `desktop/src/renderer/layouts/AppShell.tsx`
- Modify: `desktop/src/renderer/components/TitleBar.tsx`
- Test: `desktop/tests/time-center-page.test.tsx`

**Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TimeCenterPage from "../src/renderer/pages/TimeCenterPage";

describe("TimeCenterPage", () => {
  it("renders today, calendar, tasks, jobs, and rules sections", () => {
    render(
      <MemoryRouter>
        <TimeCenterPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Calendar")).toBeTruthy();
    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.getByText("Jobs")).toBeTruthy();
    expect(screen.getByText("Rules")).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-center-page.test.tsx
```

Expected: FAIL because the page and route do not exist.

**Step 3: Write minimal implementation**

Add route:

```tsx
<Route path="/time" element={<TimeCenterPage />} />
```

Add nav item in `AppShell.tsx` between meetings and files:

```tsx
{ to: "/time", label: "时间中心", icon: IconTime, testId: "nav-time" },
```

Create a shell page that renders:

- `TodayBriefPanel`
- `WeekTimeline`
- task commitments list
- schedule jobs list
- reminders list
- rules summary

Keep the first pass read-only and data-driven from `workspace.time`.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-center-page.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add desktop/src/renderer/pages/TimeCenterPage.tsx desktop/src/renderer/components/time/TodayBriefPanel.tsx desktop/src/renderer/components/time/WeekTimeline.tsx desktop/src/renderer/router/index.tsx desktop/src/renderer/layouts/AppShell.tsx desktop/src/renderer/components/TitleBar.tsx desktop/tests/time-center-page.test.tsx
git commit -m "feat: add desktop time center shell"
```

---

### Task 6: Add Calendar Events, Task Commitments, And A Simple Timebox Planner

**Files:**
- Create: `desktop/src/main/services/timebox-planner.ts`
- Modify: `desktop/src/main/services/time-orchestration-store.ts`
- Create: `desktop/src/renderer/components/time/CalendarEventEditor.tsx`
- Create: `desktop/src/renderer/components/time/TaskCommitmentEditor.tsx`
- Modify: `desktop/src/renderer/components/time/WeekTimeline.tsx`
- Modify: `desktop/src/renderer/pages/TimeCenterPage.tsx`
- Test: `desktop/tests/timebox-planner.test.ts`
- Test: `desktop/tests/time-event-editors.test.tsx`

**Step 1: Write the failing tests**

```ts
import { planTimeboxes } from "../src/main/services/timebox-planner";

describe("planTimeboxes", () => {
  it("places a 120-minute task into the earliest valid free window", () => {
    const result = planTimeboxes({
      events: [
        { startAt: "2026-04-21T01:00:00.000Z", endAt: "2026-04-21T02:00:00.000Z" },
      ] as any,
      commitments: [
        { id: "task-1", estimatedMinutes: 120, deadlineAt: "2026-04-21T10:00:00.000Z" },
      ] as any,
      timezone: "Asia/Shanghai",
    });

    expect(result[0]?.commitmentId).toBe("task-1");
  });
});
```

```tsx
describe("time event editors", () => {
  it("submits a new reminder-free manual calendar event", async () => {
    // render CalendarEventEditor and submit start/end/title
    // assert save callback invoked with normalized payload
  });
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/timebox-planner.test.ts tests/time-event-editors.test.tsx
```

Expected: FAIL because planner and editors do not exist yet.

**Step 3: Write minimal implementation**

Implement `planTimeboxes()` as a simple first-fit planner:

- sort commitments by urgency + priority
- subtract existing fixed events from working-hour windows
- place commitment blocks into the earliest valid free windows
- return suggested blocks without auto-committing them yet

```ts
export function planTimeboxes(input: PlanTimeboxesInput): SuggestedTimebox[] {
  // first-fit planner, not a full optimizer
}
```

Extend the store with:

- `listCalendarEvents()`
- `upsertCalendarEvent()`
- `listTaskCommitments()`
- `upsertTaskCommitment()`
- `suggestTimeboxes()`

Add structured editors for manual event and commitment creation.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/timebox-planner.test.ts tests/time-event-editors.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add desktop/src/main/services/timebox-planner.ts desktop/src/main/services/time-orchestration-store.ts desktop/src/renderer/components/time/CalendarEventEditor.tsx desktop/src/renderer/components/time/TaskCommitmentEditor.tsx desktop/src/renderer/components/time/WeekTimeline.tsx desktop/src/renderer/pages/TimeCenterPage.tsx desktop/tests/timebox-planner.test.ts desktop/tests/time-event-editors.test.tsx
git commit -m "feat: add desktop calendar events and timeboxing"
```

---

### Task 7: Add Reminder, Job, And Rules Editors With Real CRUD Flows

**Files:**
- Create: `desktop/src/renderer/components/time/ReminderEditor.tsx`
- Create: `desktop/src/renderer/components/time/ScheduleJobEditor.tsx`
- Create: `desktop/src/renderer/components/time/AvailabilityPolicyForm.tsx`
- Modify: `desktop/src/renderer/pages/TimeCenterPage.tsx`
- Test: `desktop/tests/time-editors.test.tsx`

**Step 1: Write the failing test**

```tsx
describe("time editors", () => {
  it("creates a recurring schedule job and persists availability rules", async () => {
    // render page/editor with mocked workspace actions
    // submit cron/interval input
    // assert createScheduleJob and saveAvailabilityPolicy were called
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-editors.test.tsx
```

Expected: FAIL because the editors and connected actions are missing.

**Step 3: Write minimal implementation**

Add structured forms for:

- one-time reminder
- interval/cron job
- working hours / quiet hours / notification windows

The page should support:

- create
- edit
- delete
- enable/disable schedule job

Keep all writes routed through `workspace` actions rather than direct component-side IPC.

**Step 4: Run test to verify it passes**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-editors.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add desktop/src/renderer/components/time/ReminderEditor.tsx desktop/src/renderer/components/time/ScheduleJobEditor.tsx desktop/src/renderer/components/time/AvailabilityPolicyForm.tsx desktop/src/renderer/pages/TimeCenterPage.tsx desktop/tests/time-editors.test.tsx
git commit -m "feat: add desktop time center editors"
```

---

### Task 8: Expose Time Operations To The Assistant Through Tool Calls

**Files:**
- Modify: `desktop/src/main/services/tool-schemas.ts`
- Modify: `desktop/src/main/services/builtin-tool-stubs.ts`
- Modify: `desktop/src/main/services/model-runtime/prompt-composer.ts`
- Modify: `desktop/src/main/ipc/sessions.ts`
- Modify: `desktop/tests/shared/builtin-tool-contract.ts`
- Test: `desktop/tests/time-tool-routing.test.ts`
- Test: `desktop/tests/model-runtime/unit/prompt-composer.test.ts`

**Step 1: Write the failing tests**

```ts
describe("time tool routing", () => {
  it("creates reminders through the session tool-family handler", async () => {
    // mock runtime context + time store
    // call the same internal dispatch path used by task tools
    // assert reminder persisted and tool output serialized
  });
});
```

Add expected tool names in `desktop/tests/shared/builtin-tool-contract.ts`:

```ts
"reminder_create",
"reminder_list",
"schedule_job_create",
"schedule_job_list",
"today_brief_get",
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-tool-routing.test.ts tests/model-runtime/unit/prompt-composer.test.ts
```

Expected: FAIL because tool schemas and tool routing do not include time operations.

**Step 3: Write minimal implementation**

Follow the same pattern as `task_*` in `ipc/sessions.ts`.

Add new function-schema names:

```ts
name: "reminder_create"
name: "reminder_list"
name: "schedule_job_create"
name: "schedule_job_list"
name: "today_brief_get"
```

Map them inside `sessions.ts` to the time store:

```ts
case "reminder.create": {
  const reminder = await ctx.services.timeStore.upsertReminder(/* ... */);
  return { success: true, output: JSON.stringify(reminder), mutated: true };
}
```

Update the planning/execution prompt guidance so the assistant knows:

- reminders are for user attention
- schedule jobs are for autonomous time-based execution
- today brief is query-only

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-tool-routing.test.ts tests/model-runtime/unit/prompt-composer.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add desktop/src/main/services/tool-schemas.ts desktop/src/main/services/builtin-tool-stubs.ts desktop/src/main/services/model-runtime/prompt-composer.ts desktop/src/main/ipc/sessions.ts desktop/tests/shared/builtin-tool-contract.ts desktop/tests/time-tool-routing.test.ts desktop/tests/model-runtime/unit/prompt-composer.test.ts
git commit -m "feat: add time orchestration tool calls"
```

---

### Task 9: Turn Meeting Output Into Time Objects

**Files:**
- Create: `desktop/src/main/services/meeting-follow-up-service.ts`
- Modify: `desktop/src/main/services/meeting-recorder.ts`
- Modify: `desktop/src/main/ipc/meetings.ts`
- Modify: `desktop/src/preload/index.ts`
- Modify: `desktop/src/renderer/types/electron.d.ts`
- Modify: `desktop/src/renderer/pages/MeetingsPage.tsx`
- Test: `desktop/tests/meeting-follow-up-service.test.ts`
- Test: `desktop/tests/meetings-page-follow-up.test.tsx`

**Step 1: Write the failing tests**

```ts
describe("meeting follow-up service", () => {
  it("extracts reminders and commitments from meeting summary text", async () => {
    const result = await extractMeetingFollowUps({
      title: "Weekly sync",
      summary: "- Alice Friday前交付方案\n- 下周二 10:00 回看结果",
    });

    expect(result.commitments.length).toBeGreaterThan(0);
    expect(result.suggestedEvents.length).toBeGreaterThanOrEqual(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/meeting-follow-up-service.test.ts tests/meetings-page-follow-up.test.tsx
```

Expected: FAIL because no follow-up import path exists.

**Step 3: Write minimal implementation**

Do **not** auto-create time objects on meeting stop. Keep this explicit and reviewable.

Add:

- a service that converts transcript/summary into suggested:
  - `TaskCommitment[]`
  - `Reminder[]`
  - `CalendarEvent[]`
- a new meeting IPC command like `meeting:build-follow-ups`
- a Meetings page CTA like `导入到时间中心`

The first pass can use lightweight parsing or an LLM-assisted path already available in desktop.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/meeting-follow-up-service.test.ts tests/meetings-page-follow-up.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add desktop/src/main/services/meeting-follow-up-service.ts desktop/src/main/services/meeting-recorder.ts desktop/src/main/ipc/meetings.ts desktop/src/preload/index.ts desktop/src/renderer/types/electron.d.ts desktop/src/renderer/pages/MeetingsPage.tsx desktop/tests/meeting-follow-up-service.test.ts desktop/tests/meetings-page-follow-up.test.tsx
git commit -m "feat: import meeting follow-ups into time center"
```

---

### Task 10: Let Silicon Persons Own Recurring Jobs And Scheduled Workflow Runs

**Files:**
- Create: `desktop/src/main/services/time-job-executor.ts`
- Modify: `desktop/src/main/services/time-scheduler.ts`
- Modify: `desktop/src/main/services/runtime-context.ts`
- Modify: `desktop/src/main/index.ts`
- Modify: `desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx`
- Test: `desktop/tests/time-job-executor.test.ts`
- Test: `desktop/tests/silicon-person-scheduled-jobs.test.tsx`

**Step 1: Write the failing tests**

```ts
describe("time job executor", () => {
  it("starts a workflow run when a silicon-person schedule job becomes due", async () => {
    const started: string[] = [];
    const executor = createTimeJobExecutor({
      startWorkflowRun: async ({ workflowId }) => started.push(workflowId),
      sendSiliconPersonMessage: async () => undefined,
    });

    await executor.execute({
      payloadKind: "workflow",
      payload: { workflowId: "wf-1" },
      targetType: "silicon_person",
      targetId: "sp-1",
    } as any);

    expect(started).toEqual(["wf-1"]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-job-executor.test.ts tests/silicon-person-scheduled-jobs.test.tsx
```

Expected: FAIL because scheduled workflow execution does not exist yet.

**Step 3: Write minimal implementation**

Create a dedicated executor that maps `ScheduleJob.payloadKind` to actual work:

- `reminder`
- `today_brief`
- `workflow`
- `silicon_person_message`

Keep the scheduler generic and the executor specific:

```ts
export function createTimeJobExecutor(deps: TimeJobExecutorDeps) {
  return {
    async execute(job: ScheduleJob): Promise<void> {
      switch (job.payloadKind) {
        case "workflow":
          await deps.startWorkflowRun({ workflowId: job.payload.workflowId, targetType: job.targetType, targetId: job.targetId });
          return;
      }
    },
  };
}
```

Add a small time section to `SiliconPersonWorkspacePage.tsx` so a silicon person can:

- view its working hours
- view its recurring jobs
- create a recurring workflow job

Use the same `workspace.time` APIs; do not add a separate silicon-person-only schedule system.

**Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir desktop exec vitest run tests/time-job-executor.test.ts tests/silicon-person-scheduled-jobs.test.tsx
```

Expected: PASS.

**Step 5: Commit**

```bash
git add desktop/src/main/services/time-job-executor.ts desktop/src/main/services/time-scheduler.ts desktop/src/main/services/runtime-context.ts desktop/src/main/index.ts desktop/src/renderer/pages/SiliconPersonWorkspacePage.tsx desktop/tests/time-job-executor.test.ts desktop/tests/silicon-person-scheduled-jobs.test.tsx
git commit -m "feat: add silicon person scheduled jobs"
```

---

## Final Verification

After all tasks are complete, run the full targeted verification:

```bash
pnpm --dir desktop exec vitest run tests/time-orchestration-contracts.test.ts tests/time-orchestration-store.test.ts tests/time-scheduler.test.ts tests/time-notification-service.test.ts tests/time-orchestration-ipc.test.ts tests/workspace-time-store.test.ts tests/time-center-page.test.tsx tests/timebox-planner.test.ts tests/time-event-editors.test.tsx tests/time-editors.test.tsx tests/time-tool-routing.test.ts tests/meeting-follow-up-service.test.ts tests/meetings-page-follow-up.test.tsx tests/time-job-executor.test.ts tests/silicon-person-scheduled-jobs.test.tsx
pnpm --dir desktop typecheck
pnpm --dir desktop build
```

Expected:

- all targeted time-orchestration tests PASS
- `typecheck` PASS
- `build` PASS

## Release Notes Checklist

Before claiming the desktop time layer is complete, confirm:

- no cloud dependency was introduced
- no enterprise-only abstractions leaked into renderer UX
- all new methods/logs/comments in code are Chinese where required by repo rules
- new files are UTF-8
- the time center still works when no reminders/jobs/events exist
- notifications respect quiet hours
- schedule jobs survive app restart via `time.db`

Plan complete and saved to `desktop/docs/plans/2026-04-18-time-orchestration-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
