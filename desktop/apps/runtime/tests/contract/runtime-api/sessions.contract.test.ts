import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeApp } from "../../../src/server/index";

describe("runtime sessions api contract", () => {
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

  it("keeps sessions creation and message append contract stable", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-runtime-sessions-contract-"));
    const stateFilePath = join(tempDir, "runtime-state.json");
    const app = await createRuntimeApp({
      port: 0,
      stateFilePath,
      chatCompletion: async () => "contract assistant reply",
    });
    dispose = app.close;

    const createResponse = await fetch(`${app.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Contract Session" }),
    });
    const createPayload = await createResponse.json();

    const messageResponse = await fetch(`${app.baseUrl}/api/sessions/${createPayload.session.id}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: "Contract ping" }),
    });
    const messagePayload = await messageResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createPayload.session.title).toBe("Contract Session");
    expect(createPayload.session.id).toBeTypeOf("string");
    expect(messageResponse.status).toBe(200);
    expect(messagePayload.session.id).toBe(createPayload.session.id);
    expect(messagePayload.session.messages.at(-2)?.content).toBe("Contract ping");
    expect(messagePayload.session.messages.at(-1)?.content).toBe("contract assistant reply");
  }, 15000);
});
