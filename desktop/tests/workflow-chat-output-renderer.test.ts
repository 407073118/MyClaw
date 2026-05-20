import { beforeEach, describe, expect, it } from "vitest";

import type { ChatSession } from "@shared/contracts";
import { useWorkspaceStore } from "../src/renderer/stores/workspace";

describe("workflow chat output renderer state", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      sessions: [],
      currentSession: null,
      siliconPersons: [],
    } as any);
  });

  it("session.updated with workflow assistant message becomes visible in workspace state", () => {
    const session: ChatSession = {
      id: "session-1",
      title: "天气查询",
      modelProfileId: "profile-1",
      attachedDirectory: null,
      siliconPersonId: "sp-1",
      createdAt: "2026-05-19T00:00:00.000Z",
      messages: [{
        id: "message-1",
        role: "assistant",
        content: "今天上海小雨，建议带伞。",
        createdAt: "2026-05-19T00:01:00.000Z",
      }],
    };

    useWorkspaceStore.getState().applySessionUpdate(session);

    expect(useWorkspaceStore.getState().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "session-1",
        messages: expect.arrayContaining([
          expect.objectContaining({ content: "今天上海小雨，建议带伞。" }),
        ]),
      }),
    ]));
  });
});
