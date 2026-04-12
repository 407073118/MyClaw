import { describe, expect, it } from "vitest";

import { buildCanonicalTurnContent, materializeLegacyMessages } from "../../../src/main/services/model-runtime/canonical-turn-content";

describe("continuity e2e", () => {
  it("preserves reasoning and tool ledger through canonical/legacy transforms", () => {
    const content = buildCanonicalTurnContent({
      systemSections: [],
      sessionMessages: [
        { id: "assistant-1", role: "assistant", content: "answer", reasoning: "why", tool_calls: [{ id: "tool-1", type: "function", function: { name: "fs_read", arguments: "{}" } }], createdAt: "2026-04-10T00:00:00.000Z" },
        { id: "tool-2", role: "tool", content: "done", tool_call_id: "tool-1", createdAt: "2026-04-10T00:00:01.000Z" },
      ],
      replayPolicy: "assistant-turn-with-reasoning",
    });

    const legacyMessages = materializeLegacyMessages(content);
    expect(content.replayHints.preserveReasoning).toBe(true);
    expect(legacyMessages[0]?.reasoning).toBe("why");
    expect(legacyMessages[1]?.tool_call_id).toBe("tool-1");
  });
});
