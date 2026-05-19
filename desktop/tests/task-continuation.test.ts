import { describe, expect, it } from "vitest";
import type { Task } from "../shared/contracts/task";
import {
  canAutoContinueTaskChain,
  getContinuableTasks,
  isAssistantWaitingForUserInput,
  markActiveTasksWaitingForUser,
} from "../src/main/services/task-continuation";

describe("task continuation gating", () => {
  it("detects clarification replies that should wait for the user instead of continuing tasks", () => {
    const content = [
      "为了设计一个符合您实际需求的自动化测试平台，请您帮我澄清几个关键问题：",
      "1. 测试对象",
      "您的自动化测试平台主要针对什么类型的应用？",
      "- Web应用",
      "- API接口",
      "请告诉我您的选择。",
    ].join("\n");

    expect(isAssistantWaitingForUserInput(content)).toBe(true);
  });

  it("detects explicit waiting-for-instruction replies without a question mark", () => {
    expect(isAssistantWaitingForUserInput("等待你的指示...")).toBe(true);
    expect(isAssistantWaitingForUserInput("等你回复后我再继续。")).toBe(true);
    expect(isAssistantWaitingForUserInput("这里需要你回复后我再继续。")).toBe(true);
    expect(isAssistantWaitingForUserInput("需要用户确认发布窗口。")).toBe(true);
  });

  it("moves active tasks into a user-waiting state and excludes them from auto continuation", () => {
    const tasks: Task[] = [
      {
        id: "task-1",
        subject: "设计自动化测试平台",
        description: "收集需求并输出平台设计",
        activeForm: "正在设计自动化测试平台",
        status: "in_progress",
        blocks: [],
        blockedBy: [],
      },
    ];

    const result = markActiveTasksWaitingForUser(tasks, "等待用户选择测试对象");

    expect(result.changed).toBe(true);
    expect(result.tasks[0]?.status).toBe("waiting_user");
    expect(result.tasks[0]?.activeForm).toBe("需要你回复：设计自动化测试平台");
    expect(getContinuableTasks(result.tasks)).toEqual([]);
  });

  it("pauses auto continuation for pending and in-progress tasks while any task waits for the user", () => {
    const tasks: Task[] = [
      {
        id: "task-1",
        subject: "分析需求",
        description: "等待用户确认是否执行任务链",
        activeForm: "需要你回复：分析需求",
        status: "waiting_user",
        blocks: ["task-2"],
        blockedBy: [],
      },
      {
        id: "task-2",
        subject: "编写代码",
        description: "在用户确认后继续执行",
        status: "pending",
        blocks: [],
        blockedBy: ["task-1"],
      },
      {
        id: "task-3",
        subject: "测试验证",
        description: "等待用户确认后再验证",
        status: "in_progress",
        blocks: [],
        blockedBy: ["task-2"],
      },
    ];

    expect(getContinuableTasks(tasks)).toEqual([]);
  });

  it("uses one runtime gate for every auto-continuation blocker", () => {
    const baseOptions = {
      isWaitingForUserInput: false,
      isBackgroundHandoff: false,
      isPlanModeManagingExecution: false,
      continuationCount: 0,
      maxContinuations: 3,
    };
    const runnable: Task[] = [
      { id: "t1", subject: "继续执行", description: "有可执行任务", status: "pending", blocks: [], blockedBy: [] },
    ];

    expect(canAutoContinueTaskChain(runnable, baseOptions)).toEqual({ allowed: true, reason: "runnable_task_available" });
    expect(canAutoContinueTaskChain([{ ...runnable[0]!, status: "waiting_user" }], baseOptions).allowed).toBe(false);
    expect(canAutoContinueTaskChain([{ ...runnable[0]!, status: "blocked" }], baseOptions).allowed).toBe(false);
    expect(canAutoContinueTaskChain([{ ...runnable[0]!, status: "failed" }], baseOptions).allowed).toBe(false);
    expect(canAutoContinueTaskChain([{ ...runnable[0]!, status: "cancelled" }], baseOptions).allowed).toBe(false);
    expect(canAutoContinueTaskChain(runnable, { ...baseOptions, isWaitingForUserInput: true }).allowed).toBe(false);
    expect(canAutoContinueTaskChain(runnable, { ...baseOptions, continuationCount: 3 }).allowed).toBe(false);
    expect(canAutoContinueTaskChain(runnable, {
      ...baseOptions,
      taskInterrupts: [{
        requestId: "req-1",
        taskId: "t1",
        status: "active",
        reason: "需要用户确认",
        question: "继续吗？",
        resumeToken: "token-1",
        schemaVersion: 1,
        createdAt: "2026-05-19T00:00:00.000Z",
      }],
    }).allowed).toBe(false);
  });
});
