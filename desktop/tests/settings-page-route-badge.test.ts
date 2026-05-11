/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workspace = {
    approvals: null,
    models: [
      {
        id: "profile-1",
        name: "OpenAI Profile",
        provider: "openai-compatible",
        providerFlavor: "openai",
        vendorFamily: "openai",
        baseUrl: "https://api.openai.com",
        apiKey: "test-key",
        model: "gpt-4.1",
        protocolTarget: "openai-responses",
        protocolSelectionSource: "saved",
        discoveredCapabilities: {
          contextWindowTokens: 1047576,
          maxInputTokens: 1014800,
          maxOutputTokens: 32768,
          supportsTools: true,
          supportsStreaming: true,
          source: "provider-catalog",
        },
      },
    ],
    defaultModelProfileId: "profile-1",
    requiresInitialSetup: false,
    myClawRootPath: "/tmp/myClaw",
    skillsRootPath: "/tmp/myClaw/skills",
    sessionsRootPath: "/tmp/myClaw/sessions",
    appUpdate: {
      enabled: false,
      stage: "disabled",
      currentVersion: "0.1.0",
      latestVersion: null,
      progressPercent: null,
      message: "disabled",
      feedLabel: null,
      downloadPageUrl: null,
    },
    testModelProfileConnectivity: vi.fn(),
    setDefaultModelProfile: vi.fn(),
    updateApprovalPolicy: vi.fn(),
    checkForAppUpdates: vi.fn(),
    downloadAppUpdate: vi.fn(),
    quitAndInstallAppUpdate: vi.fn(),
    openAppUpdateDownloadPage: vi.fn(),
  };

  const useWorkspaceStoreMock = Object.assign(
    (selector?: unknown) =>
      (typeof selector === "function" ? selector(workspace) : workspace),
    {
      getState: () => workspace,
    },
  );

  const auth = {
    session: {
      user: {
        displayName: "测试用户",
        account: "tester@example.com",
      },
    },
    logout: vi.fn().mockResolvedValue(undefined),
  };

  return {
    workspace,
    useWorkspaceStoreMock,
    auth,
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: mocks.useWorkspaceStoreMock,
}));

vi.mock("../src/renderer/stores/auth", () => ({
  useAuthStore: () => mocks.auth,
}));

describe("SettingsPage route badge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).window ??= {};
    (window as any).myClawAPI = {
      getAsrConfig: vi.fn().mockResolvedValue({ config: null }),
      saveAsrConfig: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
  });

  it("shows saved route tags inside model cards", async () => {
    const { default: SettingsPage } = await import("../src/renderer/pages/SettingsPage");

    render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SettingsPage),
      ),
    );

    expect(screen.getAllByText("OpenAI Responses").length).toBeGreaterThan(0);
    expect(screen.getAllByText("保存选择").length).toBeGreaterThan(0);
    expect(screen.getByText("服务商目录")).toBeTruthy();
  });

  it("shows model config notice when returning from model detail save", async () => {
    const { default: SettingsPage } = await import("../src/renderer/pages/SettingsPage");

    render(
      React.createElement(
        MemoryRouter,
        {
          initialEntries: [{
            pathname: "/settings",
            state: {
              activeTab: "模型",
              modelConfigNotice: "已保存模型配置，默认路线：OpenAI Responses",
            },
          } as any],
        },
        React.createElement(SettingsPage),
      ),
    );

    expect(screen.getByText("已保存模型配置，默认路线：OpenAI Responses")).toBeTruthy();
  });

  it("does not show route tags for models without protocolTarget", async () => {
    mocks.workspace.models = [
      {
        id: "profile-2",
        name: "No Route Profile",
        provider: "openai-compatible",
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        model: "gpt-4.1-mini",
      },
    ];
    const { default: SettingsPage } = await import("../src/renderer/pages/SettingsPage");

    render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SettingsPage),
      ),
    );

    expect(screen.queryByText("OpenAI Responses")).toBeNull();
    expect(screen.queryByText("Anthropic Messages")).toBeNull();
    expect(screen.queryByText("OpenAI Compatible")).toBeNull();
  });

  it("renders the model list as a single-column stack with separated title and tags", async () => {
    mocks.workspace.models = [
      {
        id: "profile-1",
        name: "OpenAI Profile",
        provider: "openai-compatible",
        providerFlavor: "openai",
        vendorFamily: "openai",
        baseUrl: "https://api.openai.com",
        apiKey: "test-key",
        model: "gpt-4.1",
        protocolTarget: "openai-responses",
        protocolSelectionSource: "saved",
        discoveredCapabilities: {
          contextWindowTokens: 1047576,
          maxInputTokens: 1014800,
          maxOutputTokens: 32768,
          supportsTools: true,
          supportsStreaming: true,
          source: "provider-catalog",
        },
      },
      {
        id: "profile-2",
        name: "Reasoning Profile",
        provider: "openai-compatible",
        providerFlavor: "openai",
        vendorFamily: "openai",
        baseUrl: "https://api.example.com",
        apiKey: "test-key",
        model: "o4-mini",
        protocolTarget: "openai-responses",
        protocolSelectionSource: "probe",
        discoveredCapabilities: {
          contextWindowTokens: 200000,
          maxInputTokens: 120000,
          maxOutputTokens: 32768,
          supportsTools: true,
          supportsStreaming: true,
          source: "provider-catalog",
        },
      },
    ];
    const { default: SettingsPage } = await import("../src/renderer/pages/SettingsPage");

    render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SettingsPage),
      ),
    );

    const list = screen.getByTestId("model-cards-container");
    expect(list.className).toContain("single-column");

    const titleRows = screen.getAllByTestId("model-name-title");
    expect(titleRows).toHaveLength(2);
    expect(screen.getAllByTestId("model-name-tags")).toHaveLength(2);
  });

  it("renders Qwen as a first-class vendor tag inside model cards", async () => {
    mocks.workspace.models = [
      {
        id: "profile-qwen",
        name: "Qwen Profile",
        provider: "openai-compatible",
        providerFlavor: "qwen",
        vendorFamily: "qwen",
        providerFamily: "qwen-native",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: "test-key",
        model: "qwen-max",
        protocolTarget: "openai-responses",
        protocolSelectionSource: "saved",
        discoveredCapabilities: {
          contextWindowTokens: 131072,
          maxInputTokens: 120000,
          maxOutputTokens: 8192,
          supportsTools: true,
          supportsStreaming: true,
          thinkingControlKind: "budget",
          source: "provider-catalog",
        },
      },
    ];
    const { default: SettingsPage } = await import("../src/renderer/pages/SettingsPage");

    render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SettingsPage),
      ),
    );

    expect(screen.getByText("Qwen")).toBeTruthy();
    expect(screen.getByText("OpenAI Responses")).toBeTruthy();
    expect(screen.queryByText("openai-compatible")).toBeNull();
  });

  it("groups personal prompt and logout under account settings", async () => {
    const { default: SettingsPage } = await import("../src/renderer/pages/SettingsPage");

    const { container } = render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SettingsPage),
      ),
    );

    fireEvent.click(screen.getByTestId("settings-tab-账户"));

    const personalPromptAction = screen.getByTestId("settings-account-personal-prompt");

    expect(personalPromptAction.textContent).toContain("我的个性");
    expect(personalPromptAction.className).toContain("list-row");
    expect(container.querySelector(".account-profile-panel")).toBeNull();
    expect(screen.getByText("测试用户")).toBeTruthy();

    fireEvent.click(screen.getByTestId("settings-account-logout"));

    await waitFor(() => {
      expect(mocks.auth.logout).toHaveBeenCalledTimes(1);
    });
  });
});
