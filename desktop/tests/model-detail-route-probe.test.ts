/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBrMiniMaxProfile } from "@shared/br-minimax";
import type { ModelCatalogItem, ModelProfile, ModelRouteProbeResult } from "@shared/contracts";
import ModelDetailPage from "../src/renderer/pages/ModelDetailPage";

function buildProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: "profile-1",
    name: "OpenAI Profile",
    provider: "openai-compatible",
    providerFlavor: "openai",
    baseUrl: "https://api.openai.com",
    baseUrlMode: "provider-root",
    apiKey: "test-key",
    model: "gpt-4.1",
    headers: {},
    requestBody: {},
    ...overrides,
  };
}

const mocks = vi.hoisted(() => {
  const probeResult: ModelRouteProbeResult = {
    recommendedProtocolTarget: "openai-responses",
    availableProtocolTargets: ["openai-responses", "openai-chat-compatible"],
    testedAt: "2026-04-11T00:00:00.000Z",
    entries: [
      {
        protocolTarget: "openai-responses",
        ok: true,
        latencyMs: 128,
        notes: ["原生 Responses 事件流"],
      },
      {
        protocolTarget: "openai-chat-compatible",
        ok: true,
        latencyMs: 214,
        notes: ["兼容模式，可作为回退路线"],
      },
    ],
  };

  const catalogItems: ModelCatalogItem[] = [
    {
      id: "gpt-4.1",
      name: "GPT-4.1",
      provider: "openai-compatible",
      providerFlavor: "openai",
      vendorFamily: "openai",
      protocolTarget: "openai-responses",
      contextWindowTokens: 1047576,
      maxOutputTokens: 32768,
      supportsTools: true,
      supportsStreaming: true,
      source: "provider-catalog",
    },
    {
      id: "gpt-4.1-mini",
      name: "GPT-4.1 Mini",
      provider: "openai-compatible",
      providerFlavor: "openai",
      vendorFamily: "openai",
      protocolTarget: "openai-responses",
      contextWindowTokens: 1047576,
      maxOutputTokens: 16384,
      supportsTools: true,
      supportsStreaming: true,
      source: "provider-catalog",
    },
  ];

  const workspace = {
    models: [buildProfile()],
    deleteModelProfile: vi.fn(),
    createModelProfile: vi.fn(async (input: Omit<ModelProfile, "id">) => ({ ...input, id: "created-profile" })),
    updateModelProfile: vi.fn(async (_profileId: string, input: Omit<ModelProfile, "id">) => ({ ...input, id: "profile-1" })),
    setDefaultModelProfile: vi.fn(),
    fetchModelCatalog: vi.fn(async () => catalogItems),
    fetchAvailableModelIds: vi.fn(async () => ["gpt-4.1", "gpt-4.1-mini"]),
    probeModelRoutes: vi.fn(async () => probeResult),
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) =>
      (typeof selector === "function" ? selector(workspace) : workspace),
    {
      getState: () => workspace,
    },
  );

  return {
    catalogItems,
    probeResult,
    workspace,
    useWorkspaceStoreMock,
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: mocks.useWorkspaceStoreMock,
}));

function renderModelDetail(route: string) {
  return render(
    React.createElement(
      MemoryRouter,
      { initialEntries: [route] },
      React.createElement(
        Routes,
        undefined,
        React.createElement(Route, {
          path: "/settings/models/new",
          element: React.createElement(ModelDetailPage),
        }),
        React.createElement(Route, {
          path: "/settings/models/:id",
          element: React.createElement(ModelDetailPage),
        }),
        React.createElement(Route, {
          path: "/settings",
          element: React.createElement("div", undefined, "settings-root"),
        }),
        React.createElement(Route, {
          path: "/settings/models",
          element: React.createElement("div", undefined, "models-list"),
        }),
      ),
    ),
  );
}

function NavigationHarness() {
  const navigate = useNavigate();
  return React.createElement(
    React.Fragment,
    undefined,
    React.createElement("button", {
      type: "button",
      onClick: () => navigate("/settings/models/profile-2"),
    }, "go-profile-2"),
    React.createElement("button", {
      type: "button",
      onClick: () => navigate("/settings/models/new"),
    }, "go-new"),
    React.createElement(
      Routes,
      undefined,
      React.createElement(Route, {
        path: "/settings/models/new",
        element: React.createElement(ModelDetailPage),
      }),
      React.createElement(Route, {
        path: "/settings/models/:id",
        element: React.createElement(ModelDetailPage),
      }),
      React.createElement(Route, {
          path: "/settings",
          element: React.createElement("div", undefined, "settings-root"),
        }),
        React.createElement(Route, {
          path: "/settings/models",
          element: React.createElement("div", undefined, "models-list"),
        }),
    ),
  );
}

describe("ModelDetailPage route probe", () => {
  beforeEach(() => {
    mocks.workspace.models = [buildProfile(), buildProfile({
      id: "profile-2",
      name: "Claude Profile",
      provider: "anthropic",
      providerFlavor: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "claude-3-7-sonnet",
      protocolTarget: "anthropic-messages",
    })];
    mocks.workspace.deleteModelProfile.mockReset();
    mocks.workspace.createModelProfile.mockReset();
    mocks.workspace.updateModelProfile.mockReset();
    mocks.workspace.setDefaultModelProfile.mockReset();
    mocks.workspace.fetchModelCatalog.mockReset();
    mocks.workspace.fetchAvailableModelIds.mockReset();
    mocks.workspace.probeModelRoutes.mockReset();
    mocks.workspace.fetchModelCatalog.mockResolvedValue(mocks.catalogItems);
    mocks.workspace.fetchAvailableModelIds.mockResolvedValue(["gpt-4.1", "gpt-4.1-mini"]);
    mocks.workspace.probeModelRoutes.mockResolvedValue(mocks.probeResult);
  });

  afterEach(() => {
    cleanup();
  });

  it("disables route probing until a custom model is chosen", () => {
    renderModelDetail("/settings/models/new");

    fireEvent.change(screen.getByTestId("model-preset-select"), {
      target: { value: "custom" },
    });

    expect(screen.getByRole("button", { name: "探测路线" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("请先选择模型，再进行路线探测。")).toBeTruthy();
  });

  it("shows recommendation, available routes, and route details after probing", async () => {
    renderModelDetail("/settings/models/profile-1");

    fireEvent.click(screen.getByRole("button", { name: "探测路线" }));

    await waitFor(() => expect(mocks.workspace.probeModelRoutes).toHaveBeenCalledTimes(1));
    expect(mocks.workspace.probeModelRoutes).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai-compatible",
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com",
      baseUrlMode: "provider-root",
      apiKey: "test-key",
      model: "gpt-4.1",
    }));
    expect(screen.getAllByText(/推荐路线：OpenAI Responses/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("执行路线")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看路线详情" })).toBeTruthy();

    const detailButton = screen.getByRole("button", { name: "查看路线详情" });
    expect(detailButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(detailButton);
    expect(detailButton.getAttribute("aria-expanded")).toBe("true");

    expect(screen.getAllByText("OpenAI Responses").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OpenAI Compatible").length).toBeGreaterThan(0);
    expect(screen.getByText(/原生 Responses 事件流/)).toBeTruthy();
  });

  it("loads rich catalog metadata with providerFlavor and shows capability hints", async () => {
    renderModelDetail("/settings/models/profile-1");

    fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));

    await waitFor(() => expect(mocks.workspace.fetchModelCatalog).toHaveBeenCalledTimes(1));
    expect(mocks.workspace.fetchModelCatalog).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai-compatible",
      providerFlavor: "openai",
      baseUrl: "https://api.openai.com",
      baseUrlMode: "provider-root",
      apiKey: "test-key",
    }));
    expect(screen.getByText("GPT-4.1")).toBeTruthy();
    expect(screen.getAllByText("1M").length).toBeGreaterThan(0);
    expect(screen.getAllByText("工具调用").length).toBeGreaterThan(0);
  });

  it("persists discoveredCapabilities from the selected catalog item on save", async () => {
    renderModelDetail("/settings/models/profile-1");

    fireEvent.click(screen.getByRole("button", { name: "获取模型列表" }));
    await waitFor(() => expect(mocks.workspace.fetchModelCatalog).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByTestId("model-id-select"), {
      target: { value: "gpt-4.1-mini" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() =>
      expect(mocks.workspace.updateModelProfile).toHaveBeenCalledWith(
        "profile-1",
        expect.objectContaining({
          model: "gpt-4.1-mini",
          discoveredCapabilities: expect.objectContaining({
            contextWindowTokens: 1047576,
            maxOutputTokens: 16384,
            supportsTools: true,
            supportsStreaming: true,
            source: "provider-catalog",
          }),
        }),
      ),
    );
  });

  it("loads and persists structured native file search settings for OpenAI profiles", async () => {
    mocks.workspace.models = [buildProfile({
      responsesApiConfig: {
        fileSearch: {
          vectorStoreIds: ["vs_existing_1", "vs_existing_2"],
          maxNumResults: 12,
          includeSearchResults: true,
        },
      },
    })];
    renderModelDetail("/settings/models/profile-1");

    const enableCheckbox = screen.getByTestId("native-file-search-enabled") as HTMLInputElement;
    const vectorStoreInput = screen.getByTestId("native-file-search-vector-stores") as HTMLInputElement;
    const maxResultsInput = screen.getByTestId("native-file-search-max-results") as HTMLInputElement;
    const includeResultsCheckbox = screen.getByTestId("native-file-search-include-results") as HTMLInputElement;

    expect(enableCheckbox.checked).toBe(true);
    expect(vectorStoreInput.value).toBe("vs_existing_1, vs_existing_2");
    expect(maxResultsInput.value).toBe("12");
    expect(includeResultsCheckbox.checked).toBe(true);

    fireEvent.change(vectorStoreInput, {
      target: { value: "vs_handbook_1, vs_handbook_2" },
    });
    fireEvent.change(maxResultsInput, {
      target: { value: "6" },
    });
    fireEvent.click(includeResultsCheckbox);
    fireEvent.click(screen.getByTestId("model-save-profile"));

    await waitFor(() =>
      expect(mocks.workspace.updateModelProfile).toHaveBeenCalledWith(
        "profile-1",
        expect.objectContaining({
          responsesApiConfig: expect.objectContaining({
            fileSearch: {
              vectorStoreIds: ["vs_handbook_1", "vs_handbook_2"],
              maxNumResults: 6,
              includeSearchResults: false,
            },
          }),
        }),
      ),
    );
  });

  it("loads and persists advanced model tuning settings", async () => {
    mocks.workspace.models = [buildProfile({
      defaultReasoningEffort: "xhigh",
      contextWindowOverride: 1000000,
      compactTriggerTokens: 900000,
      capabilityOverrides: {
        maxOutputTokens: 32768,
      },
      responsesApiConfig: {
        disableResponseStorage: true,
        useServerState: true,
        backgroundMode: "always",
        backgroundPollIntervalMs: 4500,
      },
    })];
    renderModelDetail("/settings/models/profile-1");

    expect((screen.getByTestId("model-default-reasoning-effort") as HTMLSelectElement).value).toBe("xhigh");
    expect((screen.getByTestId("model-context-window-override") as HTMLInputElement).value).toBe("1000000");
    expect((screen.getByTestId("model-max-output-tokens-override") as HTMLInputElement).value).toBe("32768");
    expect((screen.getByTestId("model-compact-trigger-tokens") as HTMLInputElement).value).toBe("900000");
    expect((screen.getByTestId("model-disable-response-storage") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("model-use-server-state") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("model-background-mode") as HTMLSelectElement).value).toBe("always");
    expect((screen.getByTestId("model-background-poll-interval") as HTMLInputElement).value).toBe("4500");

    fireEvent.change(screen.getByTestId("model-default-reasoning-effort"), {
      target: { value: "high" },
    });
    fireEvent.change(screen.getByTestId("model-context-window-override"), {
      target: { value: "750000" },
    });
    fireEvent.change(screen.getByTestId("model-max-output-tokens-override"), {
      target: { value: "16000" },
    });
    fireEvent.change(screen.getByTestId("model-compact-trigger-tokens"), {
      target: { value: "700000" },
    });
    fireEvent.click(screen.getByTestId("model-disable-response-storage"));
    fireEvent.click(screen.getByTestId("model-use-server-state"));
    fireEvent.change(screen.getByTestId("model-background-mode"), {
      target: { value: "auto" },
    });
    fireEvent.change(screen.getByTestId("model-background-poll-interval"), {
      target: { value: "6000" },
    });
    fireEvent.click(screen.getByTestId("model-save-profile"));

    await waitFor(() =>
      expect(mocks.workspace.updateModelProfile).toHaveBeenCalledWith(
        "profile-1",
        expect.objectContaining({
          defaultReasoningEffort: "high",
          contextWindowOverride: 750000,
          compactTriggerTokens: 700000,
          capabilityOverrides: expect.objectContaining({
            maxOutputTokens: 16000,
          }),
          responsesApiConfig: expect.objectContaining({
            disableResponseStorage: false,
            useServerState: false,
            backgroundMode: "auto",
            backgroundPollIntervalMs: 6000,
          }),
        }),
      ),
    );
  });

  it("shows saved route copy before re-probing an existing profile", () => {
    mocks.workspace.models = [buildProfile({
      protocolTarget: "openai-chat-compatible",
    })];
    renderModelDetail("/settings/models/profile-1");

    expect(screen.getByText("当前已保存路线：OpenAI Compatible")).toBeTruthy();
    expect(screen.getByText("如需切换到其他路线，请先重新执行路线探测。")).toBeTruthy();
  });

  it("auto probes on save and persists the recommended route when none is selected", async () => {
    mocks.workspace.models = [buildProfile({ protocolTarget: undefined })];
    renderModelDetail("/settings/models/profile-1");

    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(mocks.workspace.probeModelRoutes).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mocks.workspace.updateModelProfile).toHaveBeenCalledWith(
        "profile-1",
        expect.objectContaining({
          protocolTarget: "openai-responses",
          protocolSelectionSource: "probe",
          savedProtocolPreferences: ["openai-responses", "openai-chat-compatible"],
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText("settings-root")).toBeTruthy());
  });

  it("creates a new model, sets it as default, and preserves the auto-probed route", async () => {
    renderModelDetail("/settings/models/new");

    fireEvent.change(screen.getByTestId("model-preset-select"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByPlaceholderText("例如：我的 GPT-4o"), {
      target: { value: "My Custom Model" },
    });
    fireEvent.change(screen.getByTestId("model-id-input"), {
      target: { value: "gpt-4.1" },
    });
    fireEvent.change(screen.getByTestId("model-base-url-input"), {
      target: { value: "https://api.openai.com" },
    });
    fireEvent.change(screen.getByTestId("model-api-key-input"), {
      target: { value: "test-key" },
    });

    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(mocks.workspace.probeModelRoutes).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mocks.workspace.createModelProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My Custom Model",
          model: "gpt-4.1",
          protocolTarget: "openai-responses",
          protocolSelectionSource: "probe",
          savedProtocolPreferences: ["openai-responses", "openai-chat-compatible"],
        }),
      ),
    );
    expect(mocks.workspace.setDefaultModelProfile).toHaveBeenCalledWith("created-profile");
    await waitFor(() => expect(screen.getByText("settings-root")).toBeTruthy());
  });

  it("blocks save when auto probing fails", async () => {
    mocks.workspace.models = [buildProfile({ protocolTarget: undefined })];
    mocks.workspace.probeModelRoutes.mockRejectedValueOnce(new Error("探测失败"));
    renderModelDetail("/settings/models/profile-1");

    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(mocks.workspace.probeModelRoutes).toHaveBeenCalledTimes(1));
    expect(mocks.workspace.updateModelProfile).not.toHaveBeenCalled();
    expect(screen.getByText("探测失败")).toBeTruthy();
  });

  it("blocks save when probing returns no available routes", async () => {
    mocks.workspace.models = [buildProfile({ protocolTarget: undefined })];
    mocks.workspace.probeModelRoutes.mockResolvedValueOnce({
      recommendedProtocolTarget: null,
      availableProtocolTargets: [],
      testedAt: "2026-04-11T00:20:00.000Z",
      entries: [],
    });
    renderModelDetail("/settings/models/profile-1");

    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(mocks.workspace.probeModelRoutes).toHaveBeenCalledTimes(1));
    expect(mocks.workspace.updateModelProfile).not.toHaveBeenCalled();
    expect(screen.getByText("当前模型尚未探测到可用路线，无法保存配置。")).toBeTruthy();
  });

  it("preserves manual route override on save without re-probing", async () => {
    renderModelDetail("/settings/models/profile-1");

    fireEvent.click(screen.getByRole("button", { name: "探测路线" }));
    await waitFor(() => expect(mocks.workspace.probeModelRoutes).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("执行路线"), {
      target: { value: "openai-chat-compatible" },
    });
    mocks.workspace.probeModelRoutes.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() =>
      expect(mocks.workspace.updateModelProfile).toHaveBeenCalledWith(
        "profile-1",
        expect.objectContaining({
          protocolTarget: "openai-chat-compatible",
          protocolSelectionSource: "saved",
          savedProtocolPreferences: ["openai-chat-compatible", "openai-responses"],
        }),
      ),
    );
    expect(mocks.workspace.probeModelRoutes).not.toHaveBeenCalled();
  });

  it("keeps a previously saved route selected after re-probing if it is still available", async () => {
    mocks.workspace.models = [buildProfile({ protocolTarget: "openai-chat-compatible" })];
    renderModelDetail("/settings/models/profile-1");

    mocks.workspace.probeModelRoutes.mockResolvedValueOnce({
      recommendedProtocolTarget: "openai-responses",
      availableProtocolTargets: ["openai-responses", "openai-chat-compatible"],
      testedAt: "2026-04-11T00:05:00.000Z",
      entries: [
        {
          protocolTarget: "openai-responses",
          ok: true,
          latencyMs: 101,
          notes: ["原生 Responses 事件流"],
        },
        {
          protocolTarget: "openai-chat-compatible",
          ok: true,
          latencyMs: 150,
          notes: ["兼容模式，可作为回退路线"],
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "探测路线" }));

    await waitFor(() => expect(mocks.workspace.probeModelRoutes).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText("执行路线") as HTMLSelectElement).value).toBe("openai-chat-compatible");
    expect(screen.getByText("当前已保存路线：OpenAI Compatible")).toBeTruthy();
  });

  it("invalidates a probed route after model changes and re-probes on save", async () => {
    renderModelDetail("/settings/models/profile-1");

    fireEvent.click(screen.getByRole("button", { name: "探测路线" }));
    await waitFor(() => expect(mocks.workspace.probeModelRoutes).toHaveBeenCalledTimes(1));

    mocks.workspace.probeModelRoutes.mockResolvedValueOnce({
      recommendedProtocolTarget: "openai-chat-compatible",
      availableProtocolTargets: ["openai-chat-compatible"],
      testedAt: "2026-04-11T00:10:00.000Z",
      entries: [
        {
          protocolTarget: "openai-chat-compatible",
          ok: true,
          latencyMs: 166,
          notes: ["兼容模式，可作为回退路线"],
        },
      ],
    });

    fireEvent.change(screen.getByTestId("model-id-input"), {
      target: { value: "gpt-4.1-mini" },
    });

    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(mocks.workspace.probeModelRoutes).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(mocks.workspace.updateModelProfile).toHaveBeenCalledWith(
        "profile-1",
        expect.objectContaining({
          model: "gpt-4.1-mini",
          protocolTarget: "openai-chat-compatible",
        }),
      ),
    );
  });

  it("allows managed br-minimax profiles to fetch the provider model catalog", async () => {
    mocks.workspace.models = [
      createBrMiniMaxProfile({
        id: "br-profile",
        apiKey: "br-key",
      }),
    ];
    renderModelDetail("/settings/models/br-profile");

    const fetchButton = screen.getByTestId("model-fetch-list");
    expect(fetchButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(fetchButton);

    await waitFor(() => expect(mocks.workspace.fetchModelCatalog).toHaveBeenCalledTimes(1));
    expect(mocks.workspace.fetchModelCatalog).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai-compatible",
      providerFlavor: "br-minimax",
    }));
  });

  it("reloads form and route state when navigating to another model in the same router session", async () => {
    mocks.workspace.models = [
      buildProfile({
        protocolTarget: "openai-chat-compatible",
      }),
      buildProfile({
        id: "profile-2",
        name: "Claude Profile",
        provider: "anthropic",
        providerFlavor: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-3-7-sonnet",
        protocolTarget: "anthropic-messages",
      }),
    ];
    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/settings/models/profile-1"] },
        React.createElement(NavigationHarness),
      ),
    );

    expect(screen.getByText("OpenAI Profile")).toBeTruthy();
    expect(screen.getAllByText("OpenAI Compatible").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("go-profile-2"));

    await waitFor(() => expect(screen.getByText("Claude Profile")).toBeTruthy());
    expect(screen.getAllByText("Anthropic Messages").length).toBeGreaterThan(0);
  });
});
