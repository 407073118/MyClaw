/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task, TaskInterruptRequest } from "@shared/contracts";
import { PlanStatePanel } from "../src/renderer/components/plan-state-panel";

afterEach(() => {
  cleanup();
});

describe("PlanStatePanel", () => {
  it("shows numbered logical tasks and ignores duplicate leftovers in progress", () => {
    const tasks: Task[] = [
      { id: "t1", subject: "Read repo docs", description: "Read repo docs", status: "completed", blocks: [], blockedBy: [] },
      { id: "t2", subject: "Fix task dedupe", description: "Fix task dedupe", status: "completed", blocks: [], blockedBy: [] },
      { id: "t3", subject: "Update task UI", description: "Update task UI", status: "completed", blocks: [], blockedBy: [] },
      { id: "t4", subject: "Update task UI", description: "Update task UI", status: "pending", blocks: [], blockedBy: [] },
    ];

    render(React.createElement(PlanStatePanel, { tasks }));

    expect(screen.getByText("3/3 已完成")).toBeTruthy();
    expect(screen.getByText("1.")).toBeTruthy();
    expect(screen.getByText("2.")).toBeTruthy();
    expect(screen.getByText("3.")).toBeTruthy();
    expect(screen.getAllByText("Update task UI")).toHaveLength(1);
  });

  it("labels tasks that are waiting for user input", () => {
    const tasks: Task[] = [
      {
        id: "t1",
        subject: "设计自动化测试平台",
        description: "等待用户选择测试范围",
        activeForm: "需要你回复：设计自动化测试平台",
        status: "waiting_user",
        blocks: [],
        blockedBy: [],
      },
    ];

    render(React.createElement(PlanStatePanel, { tasks }));

    expect(screen.getByText("0/1 已完成")).toBeTruthy();
    expect(screen.getByText("需要你回复")).toBeTruthy();
    expect(screen.getByText("需要你回复：设计自动化测试平台")).toBeTruthy();
  });

  it("renders an active interrupt card and submits structured resume input", () => {
    const tasks: Task[] = [
      {
        id: "t1",
        subject: "确认发布窗口",
        description: "等待用户确认",
        activeForm: "需要你回复：确认发布窗口",
        status: "waiting_user",
        blocks: [],
        blockedBy: [],
        metadata: { interruptRequestId: "req-1" },
      },
    ];
    const interrupt: TaskInterruptRequest = {
      requestId: "req-1",
      taskId: "t1",
      status: "active",
      reason: "需要确认发布窗口",
      question: "今晚发布吗？",
      choices: [{ label: "今晚发布", value: "yes" }],
      resumeToken: "token-1",
      schemaVersion: 1,
      createdAt: "2026-05-19T01:00:00.000Z",
    };
    const onResume = vi.fn();

    render(React.createElement(PlanStatePanel, {
      tasks,
      interrupts: [interrupt],
      onResumeInterrupt: onResume,
    }));

    expect(screen.getByTestId("task-v2-interrupt-card")).toBeTruthy();
    expect(screen.getByText("今晚发布吗？")).toBeTruthy();
    expect(screen.getByText("今晚发布")).toBeTruthy();
    expect(screen.getByText("批准并继续")).toBeTruthy();
    expect(screen.getByText("拒绝并停止")).toBeTruthy();
    expect(screen.getByText("取消任务")).toBeTruthy();

    fireEvent.click(screen.getByText("批准并继续"));

    expect(onResume).toHaveBeenCalledWith({
      requestId: "req-1",
      taskId: "t1",
      resumeToken: "token-1",
      action: "approve",
      payload: { choice: "yes" },
    });
  });

  it("renders inputSchema fields and disables duplicate submit while resume is pending", () => {
    const tasks: Task[] = [
      {
        id: "t1",
        subject: "补充发布说明",
        description: "等待用户输入",
        activeForm: "需要你回复：补充发布说明",
        status: "waiting_user",
        blocks: [],
        blockedBy: [],
        metadata: { interruptRequestId: "req-2" },
      },
    ];
    const interrupt: TaskInterruptRequest = {
      requestId: "req-2",
      taskId: "t1",
      status: "active",
      reason: "需要发布说明",
      question: "请输入发布说明",
      inputSchema: {
        fields: [
          { name: "notes", label: "发布说明", type: "text", required: true },
        ],
      },
      resumeToken: "token-2",
      schemaVersion: 1,
      createdAt: "2026-05-19T01:00:00.000Z",
    };
    let resolveResume: () => void = () => {};
    const onResume = vi.fn(() => new Promise<void>((resolve) => {
      resolveResume = resolve;
    }));

    render(React.createElement(PlanStatePanel, {
      tasks,
      interrupts: [interrupt],
      onResumeInterrupt: onResume,
    }));

    const input = screen.getByLabelText("发布说明") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "今晚发布修复版本" } });
    fireEvent.click(screen.getByText("提交并继续"));
    fireEvent.click(screen.getByText("提交并继续"));

    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledWith({
      requestId: "req-2",
      taskId: "t1",
      resumeToken: "token-2",
      action: "submit",
      payload: { notes: "今晚发布修复版本" },
    });
    expect(screen.getByText("提交并继续")).toHaveProperty("disabled", true);
    resolveResume();
  });

  it("shows the first active interrupt even when the first waiting task has no request", () => {
    const tasks: Task[] = [
      {
        id: "stale",
        subject: "旧等待任务",
        description: "缺少请求",
        status: "waiting_user",
        blocks: [],
        blockedBy: [],
      },
      {
        id: "t2",
        subject: "真实等待任务",
        description: "有请求",
        status: "waiting_user",
        blocks: [],
        blockedBy: [],
        metadata: { interruptRequestId: "req-2" },
      },
    ];
    const interrupt: TaskInterruptRequest = {
      requestId: "req-2",
      taskId: "t2",
      status: "active",
      reason: "需要确认",
      question: "继续真实任务吗？",
      resumeToken: "token-2",
      schemaVersion: 1,
      createdAt: "2026-05-19T01:00:00.000Z",
    };

    render(React.createElement(PlanStatePanel, {
      tasks,
      interrupts: [interrupt],
      onResumeInterrupt: vi.fn(),
    }));

    expect(screen.getByText("继续真实任务吗？")).toBeTruthy();
  });
});
