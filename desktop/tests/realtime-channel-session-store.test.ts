import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RealtimeChannelSessionStore } from "../src/main/services/realtime-channel-session-store";

const createMapping = (index: number) => ({
  localSessionKey: `dingtalk:direct:cid-${index}:user:user-1`,
  localSessionId: `session-${index}`,
  provider: "dingtalk" as const,
  externalConversationId: `cid-${index}`,
  conversationType: "direct" as const,
  updatedAt: new Date(index).toISOString(),
});

describe("RealtimeChannelSessionStore", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("preserves concurrent upserts to the same mapping file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-realtime-store-"));
    const store = new RealtimeChannelSessionStore(join(tempDir, "realtime-channel-sessions.json"));

    await Promise.all([
      store.upsert(createMapping(1)),
      store.upsert(createMapping(2)),
    ]);

    const raw = await readFile(join(tempDir, "realtime-channel-sessions.json"), "utf8");
    const parsed = JSON.parse(raw) as { mappings: Array<{ localSessionKey: string }> };

    expect(parsed.mappings.map((item) => item.localSessionKey).sort()).toEqual([
      "dingtalk:direct:cid-1:user:user-1",
      "dingtalk:direct:cid-2:user:user-1",
    ]);
  });
});
