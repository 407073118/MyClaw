import { beforeEach, describe, expect, it, vi } from "vitest";

const handleMock = vi.fn();
const shellOpenExternalMock = vi.fn(async () => undefined);

vi.mock("electron", () => ({
  ipcMain: {
    handle: handleMock,
  },
  shell: {
    openExternal: shellOpenExternalMock,
  },
}));

function findHandler(channel: string) {
  const matched = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  if (!matched) {
    throw new Error(`未注册 IPC handler: ${channel}`);
  }
  return matched[1] as (...args: unknown[]) => Promise<unknown>;
}

describe("update IPC handlers", () => {
  beforeEach(() => {
    handleMock.mockClear();
    shellOpenExternalMock.mockClear();
  });

  it("exposes updater state through bootstrap and dedicated update channels", async () => {
    const { registerBootstrapHandlers } = await import("../src/main/ipc/bootstrap");
    const { registerUpdateHandlers } = await import("../src/main/ipc/update");
    const updateSnapshot = {
      enabled: true,
      stage: "available",
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      progressPercent: null,
      message: "发现新版本 0.2.0",
      feedLabel: "acme/myclaw-desktop-releases",
      downloadPageUrl: "https://github.com/acme/myclaw-desktop-releases/releases",
    };
    const appUpdater = {
      getSnapshot: vi.fn(() => updateSnapshot),
      checkForUpdates: vi.fn(async () => ({ ...updateSnapshot, stage: "checking" })),
      downloadUpdate: vi.fn(async () => ({ ...updateSnapshot, stage: "downloading", progressPercent: 0 })),
      quitAndInstall: vi.fn(async () => ({ accepted: true })),
    };
    const ctx = {
      state: {
        models: [],
        sessions: [],
        employees: [],
        workflowDefinitions: {},
        workflowRuns: [],
        getDefaultModelProfileId: () => null,
        getWorkflows: () => [],
        getApprovals: () => ({ mode: "prompt", autoApproveReadOnly: true, autoApproveSkills: true, alwaysAllowedTools: [] }),
        getApprovalRequests: () => [],
        getPersonalPromptProfile: () => ({ prompt: "", summary: "", tags: [], updatedAt: null }),
      },
      runtime: {
        myClawRootPath: "/tmp/myclaw",
        skillsRootPath: "/tmp/myclaw/skills",
        sessionsRootPath: "/tmp/myclaw/sessions",
        paths: {},
      },
      services: {
        refreshSkills: async () => [],
        listMcpServers: () => [],
        mcpManager: null,
        appUpdater,
      },
      tools: {
        resolveBuiltinTools: () => [],
        resolveMcpTools: () => [],
      },
    } as any;

    registerBootstrapHandlers(ctx);
    registerUpdateHandlers(ctx);

    const bootstrapHandler = findHandler("app:bootstrap");
    const checkHandler = findHandler("update:check");
    const downloadHandler = findHandler("update:download");
    const installHandler = findHandler("update:quit-and-install");
    const openPageHandler = findHandler("update:open-download-page");

    const bootstrapPayload = await bootstrapHandler(null) as { updates: typeof updateSnapshot };
    expect(bootstrapPayload.updates).toEqual(updateSnapshot);

    await checkHandler(null);
    expect(appUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    await downloadHandler(null);
    expect(appUpdater.downloadUpdate).toHaveBeenCalledTimes(1);

    await installHandler(null);
    expect(appUpdater.quitAndInstall).toHaveBeenCalledTimes(1);

    await openPageHandler(null);
    expect(shellOpenExternalMock).toHaveBeenCalledWith(updateSnapshot.downloadPageUrl);
  });
});
