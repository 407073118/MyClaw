/** @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workspace = {
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

describe("ModelsPage route badges", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows saved route badge and save success notice", async () => {
    const { default: ModelsPage } = await import("../src/renderer/pages/ModelsPage");

    render(
      React.createElement(
        MemoryRouter,
        {
          initialEntries: [{
            pathname: "/settings/models",
            state: {
              modelConfigNotice: "已保存模型配置，默认路线：OpenAI Responses",
            },
          } as any],
        },
        React.createElement(ModelsPage),
      ),
    );

    expect(screen.getByText("已保存模型配置，默认路线：OpenAI Responses")).toBeTruthy();
    expect(screen.getAllByText("OpenAI Responses").length).toBeGreaterThan(0);
    expect(screen.getAllByText("保存选择").length).toBeGreaterThan(0);
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("服务商目录")).toBeTruthy();
  });

  it("does not render a route badge or notice when protocolTarget and notice are absent", async () => {
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
    const { default: ModelsPage } = await import("../src/renderer/pages/ModelsPage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/settings/models"] },
        React.createElement(ModelsPage),
      ),
    );

    expect(screen.queryByText(/已保存模型配置/)).toBeNull();
    expect(screen.queryByText("OpenAI Responses")).toBeNull();
    expect(screen.queryByText("Anthropic Messages")).toBeNull();
    expect(screen.queryByText("OpenAI Compatible")).toBeNull();
  });

  it("shows Qwen as a first-class vendor badge for DashScope profiles", async () => {
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
        protocolSelectionSource: "probe",
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
    const { default: ModelsPage } = await import("../src/renderer/pages/ModelsPage");

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/settings/models"] },
        React.createElement(ModelsPage),
      ),
    );

    expect(screen.getByText("Qwen")).toBeTruthy();
    expect(screen.getByText("OpenAI Responses")).toBeTruthy();
    expect(screen.queryByText("openai-compatible")).toBeNull();
  });
});
