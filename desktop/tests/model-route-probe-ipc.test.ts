import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { handleMock, saveModelProfileMock, deleteModelProfileFileMock, saveSettingsMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  saveModelProfileMock: vi.fn(() => Promise.resolve()),
  deleteModelProfileFileMock: vi.fn(() => Promise.resolve()),
  saveSettingsMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

vi.mock("../src/main/services/state-persistence", () => ({
  saveModelProfile: saveModelProfileMock,
  deleteModelProfileFile: deleteModelProfileFileMock,
  saveSettings: saveSettingsMock,
}));

function findHandler(channel: string) {
  const matched = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  if (!matched) {
    throw new Error(`handler not found: ${channel}`);
  }
  return matched[1] as (...args: unknown[]) => Promise<unknown>;
}

describe("model route probe ipc", () => {
  beforeEach(() => {
    handleMock.mockClear();
    saveModelProfileMock.mockClear();
    deleteModelProfileFileMock.mockClear();
    saveSettingsMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recommends the highest-priority available route for openai-compatible configs", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/responses")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { registerModelHandlers } = await import("../src/main/ipc/models");
    registerModelHandlers({
      state: {
        models: [],
        sessions: [],
        getDefaultModelProfileId: () => null,
        setDefaultModelProfileId: () => {},
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      },
      runtime: {
        paths: { myClawDir: "/tmp" },
      },
    } as any);

    const handler = findHandler("model:probe-routes-by-config");
    const result = await handler(null, {
      provider: "openai-compatible",
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com",
      baseUrlMode: "provider-root",
      apiKey: "test-key",
      model: "gpt-4.1",
      headers: {},
      requestBody: {},
    }) as {
      recommendedProtocolTarget: string | null;
      availableProtocolTargets: string[];
      entries: Array<{ protocolTarget: string; ok: boolean }>;
    };

    expect(result.recommendedProtocolTarget).toBe("openai-responses");
    expect(result.availableProtocolTargets).toEqual([
      "openai-responses",
      "openai-chat-compatible",
    ]);
    expect(result.entries.map((entry) => entry.protocolTarget)).toEqual([
      "openai-responses",
      "openai-chat-compatible",
    ]);
  });

  it("limits anthropic configs to anthropic-native probing", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const { registerModelHandlers } = await import("../src/main/ipc/models");
    registerModelHandlers({
      state: {
        models: [],
        sessions: [],
        getDefaultModelProfileId: () => null,
        setDefaultModelProfileId: () => {},
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      },
      runtime: {
        paths: { myClawDir: "/tmp" },
      },
    } as any);

    const handler = findHandler("model:probe-routes-by-config");
    const result = await handler(null, {
      provider: "anthropic",
      providerFlavor: "anthropic",
      baseUrl: "https://api.anthropic.com",
      baseUrlMode: "provider-root",
      apiKey: "test-key",
      model: "claude-3-7-sonnet",
      headers: {},
      requestBody: {},
    }) as {
      recommendedProtocolTarget: string | null;
      availableProtocolTargets: string[];
      entries: Array<{ protocolTarget: string; ok: boolean }>;
    };

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.recommendedProtocolTarget).toBe("anthropic-messages");
    expect(result.availableProtocolTargets).toEqual(["anthropic-messages"]);
    expect(result.entries).toEqual([
      expect.objectContaining({
        protocolTarget: "anthropic-messages",
        ok: true,
      }),
    ]);
  });

  it("probes Kimi with anthropic first while preserving chat-compatible fallback routes", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrls.push(String(input));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { registerModelHandlers } = await import("../src/main/ipc/models");
    registerModelHandlers({
      state: {
        models: [],
        sessions: [],
        getDefaultModelProfileId: () => null,
        setDefaultModelProfileId: () => {},
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      },
      runtime: {
        paths: { myClawDir: "/tmp" },
      },
    } as any);

    const handler = findHandler("model:probe-routes-by-config");
    const result = await handler(null, {
      provider: "openai-compatible",
      providerFlavor: "moonshot",
      baseUrl: "https://api.moonshot.cn",
      baseUrlMode: "provider-root",
      apiKey: "test-key",
      model: "kimi-k2-0905-preview",
      headers: {},
      requestBody: {},
    }) as {
      recommendedProtocolTarget: string | null;
      availableProtocolTargets: string[];
      entries: Array<{ protocolTarget: string; ok: boolean }>;
    };

    expect(result.entries.map((entry) => entry.protocolTarget)).toEqual([
      "anthropic-messages",
      "openai-chat-compatible",
    ]);
    expect(result.recommendedProtocolTarget).toBe("anthropic-messages");
    expect(result.availableProtocolTargets).toEqual([
      "anthropic-messages",
      "openai-chat-compatible",
    ]);
    expect(requestedUrls).toContain("https://api.moonshot.cn/v1/messages");
    expect(requestedUrls).toContain("https://api.moonshot.cn/v1/chat/completions");
  });

  it("falls back to Kimi chat-compatible probing when the anthropic route is unavailable", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/v1/messages")) {
        return new Response("not found", { status: 404 });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { registerModelHandlers } = await import("../src/main/ipc/models");
    registerModelHandlers({
      state: {
        models: [],
        sessions: [],
        getDefaultModelProfileId: () => null,
        setDefaultModelProfileId: () => {},
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      },
      runtime: {
        paths: { myClawDir: "/tmp" },
      },
    } as any);

    const handler = findHandler("model:probe-routes-by-config");
    const result = await handler(null, {
      provider: "openai-compatible",
      providerFlavor: "moonshot",
      baseUrl: "https://api.moonshot.cn",
      baseUrlMode: "provider-root",
      apiKey: "test-key",
      model: "kimi-k2-0905-preview",
      headers: {},
      requestBody: {},
    }) as {
      recommendedProtocolTarget: string | null;
      availableProtocolTargets: string[];
      entries: Array<{ protocolTarget: string; ok: boolean }>;
    };

    expect(result.entries.map((entry) => entry.protocolTarget)).toEqual([
      "anthropic-messages",
      "openai-chat-compatible",
    ]);
    expect(result.recommendedProtocolTarget).toBe("openai-chat-compatible");
    expect(result.availableProtocolTargets).toEqual([
      "openai-chat-compatible",
    ]);
    expect(requestedUrls).toContain("https://api.moonshot.cn/v1/messages");
    expect(requestedUrls).toContain("https://api.moonshot.cn/v1/chat/completions");
  });

  it("probes Qwen with responses first while preserving compatible fallback routes", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/v1/responses")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/chat/completions")) {
        return new Response("validation", { status: 422 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { registerModelHandlers } = await import("../src/main/ipc/models");
    registerModelHandlers({
      state: {
        models: [],
        sessions: [],
        getDefaultModelProfileId: () => null,
        setDefaultModelProfileId: () => {},
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      },
      runtime: {
        paths: { myClawDir: "/tmp" },
      },
    } as any);

    const handler = findHandler("model:probe-routes-by-config");
    const result = await handler(null, {
      provider: "openai-compatible",
      providerFlavor: "qwen",
      baseUrl: "https://dashscope.aliyuncs.com",
      baseUrlMode: "provider-root",
      apiKey: "test-key",
      model: "qwen-max",
      headers: {},
      requestBody: {},
    }) as {
      recommendedProtocolTarget: string | null;
      availableProtocolTargets: string[];
      entries: Array<{ protocolTarget: string; ok: boolean }>;
    };

    expect(result.entries.map((entry) => entry.protocolTarget)).toEqual([
      "openai-responses",
      "openai-chat-compatible",
      "anthropic-messages",
    ]);
    expect(result.recommendedProtocolTarget).toBe("openai-responses");
    expect(result.availableProtocolTargets).toEqual([
      "openai-responses",
      "openai-chat-compatible",
    ]);
    expect(requestedUrls).toContain("https://dashscope.aliyuncs.com/compatible-mode/v1/responses");
    expect(requestedUrls).toContain("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  });

  it("lets coding.dashscope fall back to chat-compatible when responses route is unavailable", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/v1/responses")) {
        return new Response("not found", { status: 404 });
      }
      if (url.endsWith("/v1/chat/completions")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { registerModelHandlers } = await import("../src/main/ipc/models");
    registerModelHandlers({
      state: {
        models: [],
        sessions: [],
        getDefaultModelProfileId: () => null,
        setDefaultModelProfileId: () => {},
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      },
      runtime: {
        paths: { myClawDir: "/tmp" },
      },
    } as any);

    const handler = findHandler("model:probe-routes-by-config");
    const result = await handler(null, {
      provider: "openai-compatible",
      providerFlavor: "qwen",
      baseUrl: "https://coding.dashscope.aliyuncs.com",
      baseUrlMode: "provider-root",
      apiKey: "test-key",
      model: "qwen3.5-plus",
      headers: {},
      requestBody: {},
    }) as {
      recommendedProtocolTarget: string | null;
      availableProtocolTargets: string[];
      entries: Array<{ protocolTarget: string; ok: boolean }>;
    };

    expect(result.entries.map((entry) => entry.protocolTarget)).toEqual([
      "openai-responses",
      "openai-chat-compatible",
      "anthropic-messages",
    ]);
    expect(result.recommendedProtocolTarget).toBe("openai-chat-compatible");
    expect(result.availableProtocolTargets).toEqual([
      "openai-chat-compatible",
    ]);
    expect(requestedUrls).toContain("https://coding.dashscope.aliyuncs.com/v1/responses");
    expect(requestedUrls).toContain("https://coding.dashscope.aliyuncs.com/v1/chat/completions");
    expect(requestedUrls).toContain("https://coding.dashscope.aliyuncs.com/apps/anthropic/messages");
  });

  it("probes all project-supported routes for manual custom gateways", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/responses")) {
        return new Response("not found", { status: 404 });
      }
      if (url.endsWith("/v1/messages")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { registerModelHandlers } = await import("../src/main/ipc/models");
    registerModelHandlers({
      state: {
        models: [],
        sessions: [],
        getDefaultModelProfileId: () => null,
        setDefaultModelProfileId: () => {},
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      },
      runtime: {
        paths: { myClawDir: "/tmp" },
      },
    } as any);

    const handler = findHandler("model:probe-routes-by-config");
    const result = await handler(null, {
      provider: "openai-compatible",
      providerFlavor: "generic-openai-compatible",
      baseUrl: "https://gateway.example.com/v1",
      baseUrlMode: "manual",
      apiKey: "test-key",
      model: "custom-model",
      headers: {},
      requestBody: {},
    }) as {
      recommendedProtocolTarget: string | null;
      availableProtocolTargets: string[];
      entries: Array<{ protocolTarget: string }>;
    };

    expect(result.entries.map((entry) => entry.protocolTarget)).toEqual([
      "openai-responses",
      "anthropic-messages",
      "openai-chat-compatible",
    ]);
    expect(result.availableProtocolTargets).toEqual([
      "anthropic-messages",
      "openai-chat-compatible",
    ]);
    expect(result.recommendedProtocolTarget).toBe("anthropic-messages");
  });

  it("falls back to compatible route when responses probing returns 404", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/responses")) {
        return new Response("not found", { status: 404 });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { registerModelHandlers } = await import("../src/main/ipc/models");
    registerModelHandlers({
      state: {
        models: [],
        sessions: [],
        getDefaultModelProfileId: () => null,
        setDefaultModelProfileId: () => {},
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      },
      runtime: {
        paths: { myClawDir: "/tmp" },
      },
    } as any);

    const handler = findHandler("model:probe-routes-by-config");
    const result = await handler(null, {
      provider: "openai-compatible",
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com",
      baseUrlMode: "provider-root",
      apiKey: "test-key",
      model: "gpt-4.1",
      headers: {},
      requestBody: {},
    }) as {
      recommendedProtocolTarget: string | null;
      availableProtocolTargets: string[];
      entries: Array<{ protocolTarget: string; ok: boolean; reason?: string | null }>;
    };

    expect(result.recommendedProtocolTarget).toBe("openai-chat-compatible");
    expect(result.availableProtocolTargets).toEqual(["openai-chat-compatible"]);
    expect(result.entries).toEqual([
      expect.objectContaining({
        protocolTarget: "openai-responses",
        ok: false,
      }),
      expect.objectContaining({
        protocolTarget: "openai-chat-compatible",
        ok: true,
      }),
    ]);
  });

  it("passes through safe requestBody overrides during probing", async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === "string") {
        requestBodies.push(JSON.parse(init.body));
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { registerModelHandlers } = await import("../src/main/ipc/models");
    registerModelHandlers({
      state: {
        models: [],
        sessions: [],
        getDefaultModelProfileId: () => null,
        setDefaultModelProfileId: () => {},
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      },
      runtime: {
        paths: { myClawDir: "/tmp" },
      },
    } as any);

    const handler = findHandler("model:probe-routes-by-config");
    await handler(null, {
      provider: "openai-compatible",
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com",
      baseUrlMode: "provider-root",
      apiKey: "test-key",
      model: "gpt-4.1",
      headers: {},
      requestBody: {
        temperature: 0.2,
      },
    });

    expect(requestBodies[0]).toEqual(expect.objectContaining({
      temperature: 0.2,
    }));
  });

  it("treats 400 and 422 as reachable compatible endpoints", async () => {
    const responses = [
      new Response("bad request", { status: 400 }),
      new Response("unprocessable", { status: 422 }),
    ];
    const fetchMock = vi.fn(async () => responses.shift()!);
    vi.stubGlobal("fetch", fetchMock);

    const { registerModelHandlers } = await import("../src/main/ipc/models");
    registerModelHandlers({
      state: {
        models: [],
        sessions: [],
        getDefaultModelProfileId: () => null,
        setDefaultModelProfileId: () => {},
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      },
      runtime: {
        paths: { myClawDir: "/tmp" },
      },
    } as any);

    const handler = findHandler("model:probe-routes-by-config");
    const result = await handler(null, {
      provider: "openai-compatible",
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com",
      baseUrlMode: "provider-root",
      apiKey: "test-key",
      model: "gpt-4.1",
      headers: {},
      requestBody: {},
    }) as {
      availableProtocolTargets: string[];
      recommendedProtocolTarget: string | null;
    };

    expect(result.availableProtocolTargets).toEqual([
      "openai-responses",
      "openai-chat-compatible",
    ]);
    expect(result.recommendedProtocolTarget).toBe("openai-responses");
  });

  it("does not recommend routes that fail authentication or timeout", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/responses")) {
        return new Response("forbidden", { status: 403 });
      }
      throw new Error("network timeout");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { registerModelHandlers } = await import("../src/main/ipc/models");
    registerModelHandlers({
      state: {
        models: [],
        sessions: [],
        getDefaultModelProfileId: () => null,
        setDefaultModelProfileId: () => {},
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      },
      runtime: {
        paths: { myClawDir: "/tmp" },
      },
    } as any);

    const handler = findHandler("model:probe-routes-by-config");
    const result = await handler(null, {
      provider: "openai-compatible",
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com",
      baseUrlMode: "provider-root",
      apiKey: "test-key",
      model: "gpt-4.1",
      headers: {},
      requestBody: {},
    }) as {
      recommendedProtocolTarget: string | null;
      availableProtocolTargets: string[];
      entries: Array<{ protocolTarget: string; ok: boolean; reason?: string | null }>;
    };

    expect(result.recommendedProtocolTarget).toBeNull();
    expect(result.availableProtocolTargets).toEqual([]);
    expect(result.entries).toEqual([
      expect.objectContaining({
        protocolTarget: "openai-responses",
        ok: false,
        reason: "认证失败 (HTTP 403)",
      }),
      expect.objectContaining({
        protocolTarget: "openai-chat-compatible",
        ok: false,
      }),
    ]);
  });
});
