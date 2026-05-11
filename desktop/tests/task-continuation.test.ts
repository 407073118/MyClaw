import { describe, expect, it } from "vitest";
import type { Task } from "../shared/contracts/task";
import {
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
    expect(result.tasks[0]?.activeForm).toBe("等待用户补充：设计自动化测试平台");
    expect(getContinuableTasks(result.tasks)).toEqual([]);
  });
});
