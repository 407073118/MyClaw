import { beforeEach, describe, expect, it } from "vitest";

import { useWorkspaceStore } from "../src/renderer/stores/workspace";

describe("workspace session patch store", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      currentSession: {
        id: "session-1",
        title: "旧标题",
        createdAt: "2026-05-21T00:00:00.000Z",
        messages: [{
          id: "m1",
          role: "user",
          content: "你好",
          createdAt: "2026-05-21T00:00:00.000Z",
        }],
      },
      sessions: [{
        id: "session-1",
        title: "旧标题",
        createdAt: "2026-05-21T00:00:00.000Z",
        messages: [{
          id: "m1",
          role: "user",
          content: "你好",
          createdAt: "2026-05-21T00:00:00.000Z",
        }],
      }],
    } as any);
  });

  it("appends messages without replacing unrelated session fields", () => {
    useWorkspaceStore.getState().applySessionPatch({
      sessionId: "session-1",
      revision: 2,
      kind: "messages.append",
      messages: [{
        id: "m2",
        role: "assistant",
        content: "已收到",
        createdAt: "2026-05-21T00:00:01.000Z",
      }],
    });

    expect(useWorkspaceStore.getState().currentSession?.title).toBe("旧标题");
    expect(useWorkspaceStore.getState().currentSession?.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("updates one message by id", () => {
    useWorkspaceStore.getState().applySessionPatch({
      sessionId: "session-1",
      revision: 2,
      kind: "messages.update",
      messageId: "m1",
      fields: { content: "你好，更新后" },
    });

    expect(useWorkspaceStore.getState().currentSession?.messages[0]?.content).toBe("你好，更新后");
  });
});
