import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeApp } from "./server";

describe("runtime server streaming assistant deltas", () => {
  let dispose: (() => Promise<void>) | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await dispose?.();
    dispose = undefined;

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("pushes provider assistant deltas to session SSE before completion", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-"));
    const stateFilePath = join(tempDir, "runtime-state.json");

    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      modelConversationRunner: async ({ onAssistantDelta }) => {
        await onAssistantDelta?.({ reasoning: "先检查配置。" });
        await new Promise((resolve) => setTimeout(resolve, 300));
        await onAssistantDelta?.({ content: "正在整理答案。" });
        await new Promise((resolve) => setTimeout(resolve, 300));

        return {
          content: "正在整理答案。",
          reasoning: "先检查配置。",
        };
      },
    });
    dispose = app.close;

    const response = await fetch(`${app.baseUrl}/api/sessions/session-default/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify({
        content: "继续分析这个问题",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.body).toBeTruthy();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let rawBody = "";

    while (true) {
      const chunk = await reader.read();
      rawBody += decoder.decode(chunk.value ?? new Uint8Array(), {
        stream: !chunk.done,
      });
      if (chunk.done) {
        break;
      }
    }

    expect(rawBody).toContain("event: snapshot");
    expect(rawBody).toContain("先检查配置。");
    expect(rawBody).toContain("event: complete");
    expect(rawBody.indexOf("先检查配置。")).toBeLessThan(rawBody.indexOf("event: complete"));
  }, 15000);
});
