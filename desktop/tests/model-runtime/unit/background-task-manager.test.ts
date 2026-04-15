import { describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("../../../src/main/services/model-client", () => ({
  buildRequestHeaders: vi.fn(() => ({
    "content-type": "application/json",
    authorization: "Bearer key",
  })),
}));

import { createBackgroundTaskManager } from "../../../src/main/services/model-runtime/background-task-manager";
import { makeProfile } from "../contracts/test-helpers";

describe("background task manager", () => {
  it("retrieves the latest OpenAI background response status", async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({
        id: "resp_123",
        status: "in_progress",
        output: [],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    ));

    const manager = createBackgroundTaskManager({ fetchImpl: fetchMock as typeof fetch });
    const profile = makeProfile({
      providerFlavor: "openai",
      providerFamily: "openai-native",
      protocolTarget: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
    });

    const result = await manager.retrieve({
      profile,
      task: {
        id: "resp_123",
        providerFamily: "openai-native",
        protocolTarget: "openai-responses",
        providerResponseId: "resp_123",
        status: "queued",
        pollAfterMs: 2000,
        startedAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:00:00.000Z",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses/resp_123",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(result).toEqual({
      id: "resp_123",
      status: "in_progress",
      outputText: "",
      result: expect.objectContaining({
        responseId: "resp_123",
        finishReason: "background",
      }),
      task: expect.objectContaining({
        providerResponseId: "resp_123",
        status: "in_progress",
      }),
    });
  });

  it("cancels an active OpenAI background response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({
        id: "resp_123",
        status: "cancelled",
        output: [],
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    ));

    const manager = createBackgroundTaskManager({ fetchImpl: fetchMock as typeof fetch });
    const profile = makeProfile({
      providerFlavor: "openai",
      providerFamily: "openai-native",
      protocolTarget: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
    });

    const result = await manager.cancel({
      profile,
      task: {
        id: "resp_123",
        providerFamily: "openai-native",
        protocolTarget: "openai-responses",
        providerResponseId: "resp_123",
        status: "in_progress",
        pollAfterMs: 2000,
        startedAt: "2026-04-14T00:00:00.000Z",
        updatedAt: "2026-04-14T00:00:00.000Z",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses/resp_123/cancel",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(result).toEqual({
      id: "resp_123",
      status: "cancelled",
      outputText: "",
      result: expect.objectContaining({
        responseId: "resp_123",
        finishReason: "cancelled",
      }),
      task: null,
    });
  });
});
