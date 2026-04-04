import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelProfile } from "@shared/contracts";
import { callModel } from "../src/main/services/model-client";

function buildProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "profile-1",
    name: "Profile",
    provider: "openai-compatible",
    providerFlavor: "openai",
    baseUrl: "https://api.example.com",
    baseUrlMode: "provider-root",
    apiKey: "test-key",
    model: "gpt-5.4",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("phase 9 provider reasoning mapper", () => {
  it("merges a supported reasoning patch into the request body", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response("data: [DONE]\n\n", {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callModel({
      profile: buildProfile(),
      messages: [{ role: "user", content: "Hello" }],
      bodyPatch: {
        reasoning: {
          effort: "medium",
        },
      },
    } as any);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.reasoning).toEqual({
      effort: "medium",
    });
  });

  it("keeps unsupported providers on the empty-patch path", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response("data: [DONE]\n\n", {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callModel({
      profile: buildProfile({
        providerFlavor: "generic-openai-compatible",
        requestBody: {
          temperature: 0.2,
        },
      }),
      messages: [{ role: "user", content: "Hello" }],
      bodyPatch: {},
    } as any);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.reasoning).toBeUndefined();
    expect(requestBody.temperature).toBe(0.2);
  });
});
