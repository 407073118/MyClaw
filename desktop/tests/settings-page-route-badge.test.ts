/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  return {
    workspace,
    useWorkspaceStoreMock,
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: mocks.useWorkspaceStoreMock,
}));

describe("SettingsPage route badge", () => {
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
});
