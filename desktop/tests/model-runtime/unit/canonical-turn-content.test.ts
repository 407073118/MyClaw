import { describe, expect, it } from "vitest";

import { buildCanonicalTurnContent, materializeLegacyMessages } from "../../../src/main/services/model-runtime/canonical-turn-content";

describe("canonical turn content", () => {
  it("preserves multimodal parts, reasoning, and tool ledger", () => {
    const content = buildCanonicalTurnContent({
      systemSections: [{ id: "identity", layer: "identity", title: "Identity", content: "You are MyClaw." }],
      sessionMessages: [{
        id: "msg-1",
        role: "assistant",
        content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: "https://example.com/image.png", detail: "high" } },
        ],
        reasoning: "because",
        tool_calls: [{ id: "tool-1", type: "function", function: { name: "fs_read", arguments: "{}" } }],
        createdAt: "2026-04-10T00:00:00.000Z",
      }],
    });

    expect(content.messages[0]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: "look" }),
      expect.objectContaining({ type: "image_url", imageUrl: "https://example.com/image.png" }),
    ]));
    expect(content.messages[0]?.reasoning).toBe("because");
    expect(content.messages[0]?.toolCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "tool-1", name: "fs_read" }),
    ]));
    const legacyMessages = materializeLegacyMessages(content);
    expect(legacyMessages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("You are MyClaw."),
    });
    expect(legacyMessages[1]?.reasoning).toBe("because");
  });

  it("keeps tool result names aligned with the originating tool call ledger", () => {
    const content = buildCanonicalTurnContent({
      systemSections: [],
      sessionMessages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "I'll inspect the file.",
          tool_calls: [{ id: "tool-1", type: "function", function: { name: "fs_read", arguments: "{\"path\":\"README.md\"}" } }],
          createdAt: "2026-04-10T00:00:00.000Z",
        },
        {
          id: "tool-2",
          role: "tool",
          content: "README content",
          tool_call_id: "tool-1",
          createdAt: "2026-04-10T00:00:01.000Z",
        },
      ],
    });

    expect(content.toolResults).toEqual([
      expect.objectContaining({
        toolCallId: "tool-1",
        name: "fs_read",
        output: "README content",
        success: true,
      }),
    ]);
  });
});
