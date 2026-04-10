/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workspace = {
    approvals: null,
    models: [],
    defaultModelProfileId: null,
    requiresInitialSetup: false,
    myClawRootPath: "C:/Users/demo/AppData/Local/MyClaw/data/myClaw",
    skillsRootPath: "C:/Users/demo/AppData/Local/MyClaw/data/myClaw/skills",
    sessionsRootPath: "C:/Users/demo/AppData/Local/MyClaw/data/myClaw/sessions",
    appUpdate: {
      enabled: true,
      stage: "available",
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      progressPercent: null,
      message: "发现新版本 0.2.0，可立即下载。",
      feedLabel: "acme/myclaw-desktop-releases",
      downloadPageUrl: "https://github.com/acme/myclaw-desktop-releases/releases",
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

describe("SettingsPage update actions", () => {
  afterEach(() => {
    cleanup();
    mocks.workspace.checkForAppUpdates.mockReset();
    mocks.workspace.downloadAppUpdate.mockReset();
    mocks.workspace.quitAndInstallAppUpdate.mockReset();
    mocks.workspace.openAppUpdateDownloadPage.mockReset();
    mocks.workspace.appUpdate.stage = "available";
    mocks.workspace.appUpdate.progressPercent = null;
    mocks.workspace.appUpdate.message = "发现新版本 0.2.0，可立即下载。";
  });

  it("renders update actions and routes each button to the workspace store", async () => {
    const { default: SettingsPage } = await import("../src/renderer/pages/SettingsPage");
    render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SettingsPage),
      ),
    );

    expect(screen.getByTestId("app-update-section")).toBeTruthy();
    expect(screen.getByTestId("app-update-status").textContent).toContain("0.2.0");

    fireEvent.click(screen.getByTestId("app-update-download"));
    expect(mocks.workspace.downloadAppUpdate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("app-update-open-download-page"));
    expect(mocks.workspace.openAppUpdateDownloadPage).toHaveBeenCalledTimes(1);
  });

  it("shows download progress and restart-to-install when the update is already downloaded", async () => {
    mocks.workspace.appUpdate.stage = "downloading";
    mocks.workspace.appUpdate.progressPercent = 42;
    mocks.workspace.appUpdate.message = "正在下载更新";

    const { default: SettingsPage } = await import("../src/renderer/pages/SettingsPage");
    const { rerender } = render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SettingsPage),
      ),
    );

    expect(screen.getByTestId("app-update-downloading").textContent).toContain("42%");

    mocks.workspace.appUpdate.stage = "downloaded";
    mocks.workspace.appUpdate.progressPercent = 100;
    mocks.workspace.appUpdate.message = "更新已下载完成";

    rerender(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(SettingsPage),
      ),
    );

    fireEvent.click(screen.getByTestId("app-update-install"));
    expect(mocks.workspace.quitAndInstallAppUpdate).toHaveBeenCalledTimes(1);
  });
});
