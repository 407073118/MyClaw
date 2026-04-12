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
    expect(screen.getByText("openai-compatible")).toBeTruthy();
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
});
