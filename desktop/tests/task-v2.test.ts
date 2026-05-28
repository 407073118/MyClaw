import { describe, it, expect } from "vitest";
import { createTask, listTasks, getTask, updateTask, clearCompletedTasks } from "../src/main/services/task-store";
import type { TaskCreateInput, TaskUpdateInput } from "../src/main/services/task-store";
import type { Task } from "../shared/contracts/task";

describe("Task V2 CRUD (task-store)", () => {
  // -------------------------------------------------------------------------
  // createTask
  // -------------------------------------------------------------------------

  it("creates a task with default status=pending", () => {
    const input: TaskCreateInput = {
      subject: "Read the file",
      description: "Read foo.ts before editing",
    };
    const result = createTask([], input);
    expect(result.tasks).toHaveLength(1);
    expect(result.created.subject).toBe("Read the file");
    expect(result.created.description).toBe("Read foo.ts before editing");
    expect(result.created.status).toBe("pending");
    expect(result.created.id).toBeTruthy();
    expect(result.created.blocks).toEqual([]);
    expect(result.created.blockedBy).toEqual([]);
  });

  it("creates a task with explicit status", () => {
    const result = createTask([], {
      subject: "Start work",
      description: "Begin the implementation",
      status: "in_progress",
    });
    expect(result.created.status).toBe("in_progress");
  });

  it("appends to existing tasks", () => {
    let tasks: Task[] = [];
    const r1 = createTask(tasks, { subject: "A", description: "desc A" });
    tasks = r1.tasks;
    const r2 = createTask(tasks, { subject: "B", description: "desc B" });
    tasks = r2.tasks;
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.subject).toBe("A");
    expect(tasks[1]!.subject).toBe("B");
  });

  it("deduplicates unfinished logical tasks even when numbering prefixes differ", () => {
    const existing: Task[] = [
      { id: "t1", subject: "1. Read foo.ts", description: "Read foo.ts before editing", status: "pending", blocks: [], blockedBy: [] },
    ];

    const result = createTask(existing, {
      subject: "Read foo.ts",
      description: "Read foo.ts before editing",
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.created.id).toBe("t1");
    expect(result.created.subject).toBe("1. Read foo.ts");
  });

  it("does not reuse cancelled failed or blocked logical tasks", () => {
    const existing: Task[] = [
      { id: "t1", subject: "Read foo.ts", description: "Read foo.ts before editing", status: "cancelled", blocks: [], blockedBy: [] },
      { id: "t2", subject: "Run tests", description: "Run tests before submit", status: "failed", blocks: [], blockedBy: [] },
      { id: "t3", subject: "Review PR", description: "Review the active pull request", status: "blocked", blocks: [], blockedBy: [] },
    ];

    const result = createTask(existing, {
      subject: "Read foo.ts",
      description: "Read foo.ts before editing",
    });

    expect(result.tasks).toHaveLength(4);
    expect(result.created.id).not.toBe("t1");
    expect(result.created.blockedBy).toEqual([]);
  });

  it("evicts completed tasks when exceeding max limit", () => {
    // Fill up to 200
    let tasks: Task[] = [];
    for (let i = 0; i < 200; i++) {
      const r = createTask(tasks, {
        subject: `Task ${i}`,
        description: `desc ${i}`,
        status: i < 5 ? "completed" : "pending",
      });
      tasks = r.tasks;
    }
    expect(tasks).toHaveLength(200);

    // Add one more — should evict the first completed task
    const r = createTask(tasks, { subject: "Overflow", description: "overflow desc" });
    expect(r.tasks).toHaveLength(200);
    // The first completed task (Task 0) should be evicted
    expect(r.tasks.find((t) => t.subject === "Task 0")).toBeUndefined();
    expect(r.tasks.find((t) => t.subject === "Overflow")).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // listTasks
  // -------------------------------------------------------------------------

  it("lists all tasks (returns the same array)", () => {
    const tasks: Task[] = [
      { id: "a", subject: "A", description: "d", status: "pending", blocks: [], blockedBy: [] },
      { id: "b", subject: "B", description: "d", status: "completed", blocks: [], blockedBy: [] },
    ];
    const result = listTasks(tasks);
    expect(result).toEqual(tasks);
  });

  it("coalesces duplicate logical tasks and keeps the furthest progress", () => {
    const tasks: Task[] = [
      { id: "a", subject: "1. Run tests", description: "Run the desktop test suite", status: "pending", blocks: [], blockedBy: [] },
      { id: "b", subject: "Run tests", description: "Run the desktop test suite", status: "completed", blocks: [], blockedBy: [] },
    ];

    const result = listTasks(tasks);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "a",
      status: "completed",
      subject: "1. Run tests",
    });
  });

  // -------------------------------------------------------------------------
  // getTask
  // -------------------------------------------------------------------------

  it("gets a task by ID", () => {
    const tasks: Task[] = [
      { id: "abc", subject: "Found", description: "d", status: "pending", blocks: [], blockedBy: [] },
    ];
    expect(getTask(tasks, "abc")?.subject).toBe("Found");
  });

  it("returns null for unknown ID", () => {
    expect(getTask([], "nope")).toBeNull();
  });

  it("resolves duplicate task aliases when querying by ID", () => {
    const tasks: Task[] = [
      { id: "a", subject: "Review PR", description: "Review the active pull request", status: "pending", blocks: [], blockedBy: [] },
      { id: "b", subject: "Review PR", description: "Review the active pull request", status: "completed", blocks: [], blockedBy: [] },
    ];

    expect(getTask(tasks, "b")).toMatchObject({
      id: "a",
      status: "completed",
    });
  });

  // -------------------------------------------------------------------------
  // updateTask
  // -------------------------------------------------------------------------

  it("updates task fields partially", () => {
    const tasks: Task[] = [
      { id: "t1", subject: "Old", description: "old desc", status: "pending", blocks: [], blockedBy: [] },
    ];
    const result = updateTask(tasks, "t1", { subject: "New", status: "in_progress" });
    expect(result.updated.subject).toBe("New");
    expect(result.updated.status).toBe("in_progress");
    expect(result.updated.description).toBe("old desc"); // unchanged
  });

  it("auto-demotes other in_progress tasks when setting in_progress", () => {
    const tasks: Task[] = [
      { id: "t1", subject: "A", description: "d", status: "in_progress", blocks: [], blockedBy: [] },
      { id: "t2", subject: "B", description: "d", status: "pending", blocks: [], blockedBy: [] },
    ];
    const result = updateTask(tasks, "t2", { status: "in_progress" });
    expect(result.tasks.find((t) => t.id === "t1")!.status).toBe("pending");
    expect(result.tasks.find((t) => t.id === "t2")!.status).toBe("in_progress");
  });

  it("throws for unknown task ID", () => {
    expect(() => updateTask([], "nope", { status: "completed" })).toThrow("Task not found: nope");
  });

  it("merges metadata instead of replacing", () => {
    const tasks: Task[] = [
      { id: "t1", subject: "A", description: "d", status: "pending", blocks: [], blockedBy: [], metadata: { a: 1, b: 2 } },
    ];
    const result = updateTask(tasks, "t1", { metadata: { b: 99, c: 3 } });
    expect(result.updated.metadata).toEqual({ a: 1, b: 99, c: 3 });
  });

  it("clears stale user-wait metadata when a task resumes execution", () => {
    const tasks: Task[] = [
      {
        id: "t1",
        subject: "搜索云南天气",
        description: "查询天气数据",
        activeForm: "需要你回复：搜索云南天气",
        status: "waiting_user",
        blocks: [],
        blockedBy: [],
        metadata: {
          awaitingUser: true,
          waitingReason: "误判等待用户",
          interruptRequestId: "req-1",
          previousActiveForm: "正在搜索云南天气",
          keep: "value",
        },
      },
    ];

    const result = updateTask(tasks, "t1", { status: "in_progress" });

    expect(result.updated.status).toBe("in_progress");
    expect(result.updated.activeForm).toBe("正在搜索云南天气");
    expect(result.updated.metadata).toEqual({ keep: "value" });
  });

  it("drops stale user-wait activeForm when no previous active form exists", () => {
    const tasks: Task[] = [
      {
        id: "t1",
        subject: "汇总天气",
        description: "整理表格",
        activeForm: "需要你回复：汇总天气",
        status: "waiting_user",
        blocks: [],
        blockedBy: [],
        metadata: { awaitingUser: true, waitingReason: "误判等待用户" },
      },
    ];

    const result = updateTask(tasks, "t1", { status: "completed" });

    expect(result.updated.status).toBe("completed");
    expect(result.updated.activeForm).toBeUndefined();
    expect(result.updated.metadata).toBeUndefined();
  });

  it("updates the canonical task when the caller passes a duplicate alias ID", () => {
    const tasks: Task[] = [
      { id: "t1", subject: "Run lint", description: "Run lint before submit", status: "pending", blocks: [], blockedBy: [] },
      { id: "t2", subject: "Run lint", description: "Run lint before submit", status: "pending", blocks: [], blockedBy: [] },
    ];

    const result = updateTask(tasks, "t2", { status: "completed" });
    expect(result.tasks).toHaveLength(1);
    expect(result.updated.id).toBe("t1");
    expect(result.updated.status).toBe("completed");
  });

  it("clears coalesced completed tasks so duplicate leftovers do not keep progress stuck", () => {
    const tasks: Task[] = [
      { id: "t1", subject: "Summarize findings", description: "Summarize findings for the user", status: "completed", blocks: [], blockedBy: [] },
      { id: "t2", subject: "Summarize findings", description: "Summarize findings for the user", status: "pending", blocks: [], blockedBy: [] },
    ];

    const result = clearCompletedTasks(tasks);
    expect(result.tasks).toEqual([]);
    expect(result.cleared).toBe(1);
  });

  it("clears non-runnable terminal tasks at the start of a new turn", () => {
    const tasks: Task[] = [
      { id: "t1", subject: "Cancelled", description: "d", status: "cancelled", blocks: [], blockedBy: [] },
      { id: "t2", subject: "Failed", description: "d", status: "failed", blocks: [], blockedBy: [] },
      { id: "t3", subject: "Blocked", description: "d", status: "blocked", blocks: [], blockedBy: [] },
      { id: "t4", subject: "Pending", description: "d", status: "pending", blocks: [], blockedBy: [] },
    ];

    const result = clearCompletedTasks(tasks);
    expect(result.tasks.map((task) => task.id)).toEqual(["t4"]);
    expect(result.cleared).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Immutability
  // -------------------------------------------------------------------------

  it("does not mutate the original task array", () => {
    const tasks: Task[] = [
      { id: "t1", subject: "A", description: "d", status: "pending", blocks: [], blockedBy: [] },
    ];
    const original = [...tasks];
    createTask(tasks, { subject: "B", description: "d" });
    expect(tasks).toEqual(original);
    updateTask(tasks, "t1", { status: "completed" });
    expect(tasks).toEqual(original);
  });
});
