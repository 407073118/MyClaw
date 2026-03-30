import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatSession } from "@myclaw-desktop/shared";

import { postSessionMessageStream } from "./runtime-client";

function createStreamSession(): ChatSession {
  return {
    id: "session-default",
    title: "欢迎会话",
    modelProfileId: "model-default",
    attachedDirectory: null,
    createdAt: "2026-03-10T10:00:00.000Z",
    messages: [
      {
        id: "msg-user-1",
        role: "user",
        content: "请继续分析。",
        createdAt: "2026-03-10T10:00:01.000Z",
      },
      {
        id: "msg-assistant-stream",
        role: "assistant",
        content: "",
        reasoning: "",
        createdAt: "2026-03-10T10:00:02.000Z",
      },
    ],
  };
}

describe("postSessionMessageStream", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses SSE snapshots and returns the final payload", async () => {
    const firstSession = createStreamSession();
    firstSession.messages[1] = {
      ...firstSession.messages[1],
      reasoning: "先检查配置。",
    };

    const secondSession = createStreamSession();
    secondSession.messages[1] = {
      ...secondSession.messages[1],
      reasoning: "先检查配置。",
      content: "现在开始输出结果。",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          [
            "event: snapshot",
            `data: ${JSON.stringify({ session: firstSession })}`,
            "",
            "event: snapshot",
            `data: ${JSON.stringify({ session: secondSession })}`,
            "",
            "event: complete",
            `data: ${JSON.stringify({ session: secondSession, approvalRequests: [] })}`,
            "",
          ].join("\n"),
          {
            status: 200,
            headers: {
              "content-type": "text/event-stream; charset=utf-8",
            },
          },
        ),
      ),
    );

    const seenSnapshots: ChatSession[] = [];
    const payload = await postSessionMessageStream(
      "http://127.0.0.1:43110",
      "session-default",
      "请继续分析。",
      {
        onSnapshot(snapshot) {
          seenSnapshots.push(snapshot.session);
        },
      },
    );

    expect(seenSnapshots).toHaveLength(2);
    expect(seenSnapshots[0]?.messages.at(-1)?.reasoning).toBe("先检查配置。");
    expect(seenSnapshots[1]?.messages.at(-1)?.content).toBe("现在开始输出结果。");
    expect(payload.session.messages.at(-1)?.content).toBe("现在开始输出结果。");
  });
});
