import { describe, expect, it } from "vitest";

import { createAgentTaskRecord } from "../src/main/services/agent-task-store";

describe("agent task store", () => {
  it("creates a queued agent task linked to the leader session and assignees", () => {
    const task = createAgentTaskRecord(
      {
        sourceSessionId: "main-session-1",
        instruction: "整理客户需求风险，输出结论",
        mode: "delegate",
        assigneeIds: ["sp-1", "sp-2"],
      },
      {
        now: "2026-04-15T00:06:00.000Z",
        id: "task-1",
      }
    );

    expect(task).toMatchObject({
      id: "task-1",
      sourceSessionId: "main-session-1",
      title: "整理客户需求风险，输出结论",
      instruction: "整理客户需求风险，输出结论",
      mode: "delegate",
      status: "queued",
      assigneeIds: ["sp-1", "sp-2"],
      childSessionIds: {},
      createdAt: "2026-04-15T00:06:00.000Z",
      updatedAt: "2026-04-15T00:06:00.000Z",
    });
  });
});
