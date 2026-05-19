import { describe, expect, it } from "vitest";
import type { ChatSession, TaskResumeInput } from "../shared/contracts";
import {
  createTaskInterruptRequest,
  resolveTaskInterruptRequest,
  TaskInterruptExpiredError,
} from "../src/main/services/task-interrupt-store";

/** 构造带单个任务的会话，专注测试 Task interrupt 状态迁移。 */
function session(): ChatSession {
  return {
    id: "session-1",
    title: "Task interrupt",
    modelProfileId: "model-1",
    attachedDirectory: null,
    createdAt: "2026-05-19T00:00:00.000Z",
    messages: [],
    tasks: [
      {
        id: "task-1",
        subject: "确认发布窗口",
        description: "需要用户确认是否发布",
        status: "in_progress",
        blocks: [],
        blockedBy: [],
      },
    ],
  };
}

describe("task interrupt store", () => {
  it("creates one active interrupt request and marks the task waiting_user", () => {
    const result = createTaskInterruptRequest(session(), {
      taskId: "task-1",
      question: "今晚发布吗？",
      reason: "需要用户确认发布窗口",
      now: "2026-05-19T01:00:00.000Z",
      requestId: "req-1",
      resumeToken: "token-1",
    });

    expect(result.request).toMatchObject({
      requestId: "req-1",
      taskId: "task-1",
      status: "active",
      question: "今晚发布吗？",
      resumeToken: "token-1",
      schemaVersion: 1,
    });
    expect(result.session.taskInterrupts).toHaveLength(1);
    expect(result.session.tasks?.[0]?.status).toBe("waiting_user");
    expect(result.session.tasks?.[0]?.metadata?.interruptRequestId).toBe("req-1");
  });

  it("rejects duplicate active interrupts for the same task", () => {
    const first = createTaskInterruptRequest(session(), {
      taskId: "task-1",
      question: "今晚发布吗？",
      reason: "需要用户确认发布窗口",
      requestId: "req-1",
      resumeToken: "token-1",
    });

    expect(() => createTaskInterruptRequest(first.session, {
      taskId: "task-1",
      question: "重复确认",
      reason: "重复",
      requestId: "req-2",
      resumeToken: "token-2",
    })).toThrow("Task already has an active interrupt request");
  });

  it("resolves only with a matching active token", () => {
    const created = createTaskInterruptRequest(session(), {
      taskId: "task-1",
      question: "今晚发布吗？",
      reason: "需要用户确认发布窗口",
      requestId: "req-1",
      resumeToken: "token-1",
    });

    const badInput: TaskResumeInput = {
      requestId: "req-1",
      taskId: "task-1",
      resumeToken: "wrong-token",
      action: "approve",
    };
    expect(() => resolveTaskInterruptRequest(created.session, badInput)).toThrow("Invalid task resume token");

    const resolved = resolveTaskInterruptRequest(created.session, {
      ...badInput,
      resumeToken: "token-1",
    });

    expect(resolved.request.status).toBe("resolved");
    expect(resolved.task.status).toBe("in_progress");
    expect(resolved.session.messages.at(-1)?.content).toContain("task_resume");
  });

  it("marks rejected interrupts as blocked and cancelled interrupts as cancelled", () => {
    const rejected = createTaskInterruptRequest(session(), {
      taskId: "task-1",
      question: "今晚发布吗？",
      reason: "需要用户确认发布窗口",
      requestId: "req-1",
      resumeToken: "token-1",
    });
    const rejectedResult = resolveTaskInterruptRequest(rejected.session, {
      requestId: "req-1",
      taskId: "task-1",
      resumeToken: "token-1",
      action: "reject",
      payload: { reason: "今晚不发" },
    });
    expect(rejectedResult.task.status).toBe("blocked");

    const cancelled = createTaskInterruptRequest(session(), {
      taskId: "task-1",
      question: "今晚发布吗？",
      reason: "需要用户确认发布窗口",
      requestId: "req-2",
      resumeToken: "token-2",
    });
    const cancelledResult = resolveTaskInterruptRequest(cancelled.session, {
      requestId: "req-2",
      taskId: "task-1",
      resumeToken: "token-2",
      action: "cancel",
    });
    expect(cancelledResult.task.status).toBe("cancelled");
  });

  it("rejects invalid resume actions without mutating the request", () => {
    const created = createTaskInterruptRequest(session(), {
      taskId: "task-1",
      question: "今晚发布吗？",
      reason: "需要用户确认发布窗口",
      requestId: "req-1",
      resumeToken: "token-1",
    });

    expect(() => resolveTaskInterruptRequest(created.session, {
      requestId: "req-1",
      taskId: "task-1",
      resumeToken: "token-1",
      action: "bogus" as TaskResumeInput["action"],
    })).toThrow("Invalid task resume action");
    expect(created.session.taskInterrupts?.[0]?.status).toBe("active");
  });

  it("uses task-store in_progress semantics when resuming", () => {
    const base = session();
    base.tasks = [
      {
        id: "other",
        subject: "其他任务",
        description: "已经在执行",
        status: "in_progress",
        blocks: [],
        blockedBy: [],
      },
      ...(base.tasks ?? []),
    ];
    const created = createTaskInterruptRequest(base, {
      taskId: "task-1",
      question: "今晚发布吗？",
      reason: "需要用户确认发布窗口",
      requestId: "req-1",
      resumeToken: "token-1",
    });

    const resolved = resolveTaskInterruptRequest(created.session, {
      requestId: "req-1",
      taskId: "task-1",
      resumeToken: "token-1",
      action: "approve",
    });

    expect(resolved.session.tasks?.filter((task) => task.status === "in_progress").map((task) => task.id)).toEqual(["task-1"]);
    expect(resolved.session.tasks?.find((task) => task.id === "other")?.status).toBe("pending");
  });

  it("keeps unresolved requests active when blockers still prevent resume", () => {
    const base = session();
    base.tasks = [
      {
        id: "blocker",
        subject: "前置任务",
        description: "尚未完成",
        status: "pending",
        blocks: [],
        blockedBy: [],
      },
      {
        ...base.tasks![0]!,
        blockedBy: ["blocker"],
      },
    ];
    const created = createTaskInterruptRequest(base, {
      taskId: "task-1",
      question: "今晚发布吗？",
      reason: "需要用户确认发布窗口",
      requestId: "req-1",
      resumeToken: "token-1",
    });

    expect(() => resolveTaskInterruptRequest(created.session, {
      requestId: "req-1",
      taskId: "task-1",
      resumeToken: "token-1",
      action: "approve",
    })).toThrow("前置任务未完成");
    expect(created.session.taskInterrupts?.[0]?.status).toBe("active");
  });

  it("marks expired requests as expired for persistence by the caller", () => {
    const created = createTaskInterruptRequest(session(), {
      taskId: "task-1",
      question: "今晚发布吗？",
      reason: "需要用户确认发布窗口",
      requestId: "req-1",
      resumeToken: "token-1",
      expiresAt: "2026-05-19T00:30:00.000Z",
    });

    expect(() => resolveTaskInterruptRequest(created.session, {
      requestId: "req-1",
      taskId: "task-1",
      resumeToken: "token-1",
      action: "approve",
    }, "2026-05-19T01:00:00.000Z")).toThrow(TaskInterruptExpiredError);
    try {
      resolveTaskInterruptRequest(created.session, {
        requestId: "req-1",
        taskId: "task-1",
        resumeToken: "token-1",
        action: "approve",
      }, "2026-05-19T01:00:00.000Z");
    } catch (error) {
      expect(error).toBeInstanceOf(TaskInterruptExpiredError);
      expect((error as TaskInterruptExpiredError).result.request.status).toBe("expired");
      expect((error as TaskInterruptExpiredError).result.task.status).toBe("blocked");
    }
  });

  it("rejects invalid expiresAt values when creating interrupts", () => {
    expect(() => createTaskInterruptRequest(session(), {
      taskId: "task-1",
      question: "今晚发布吗？",
      reason: "需要用户确认发布窗口",
      expiresAt: "not-a-date",
    })).toThrow("Invalid task interrupt expiresAt");
  });
});
