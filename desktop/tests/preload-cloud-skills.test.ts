import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
  setZoomFactor: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
    send: electronMocks.send,
  },
  webFrame: {
    setZoomFactor: electronMocks.setZoomFactor,
  },
}));

/** 加载 preload 暴露的 API，验证渲染层拿到的仍是稳定 Promise 语义。 */
async function loadExposedApi() {
  await import("../src/preload/index");
  const exposed = electronMocks.exposeInMainWorld.mock.calls.find(([name]) => name === "myClawAPI")?.[1];
  if (!exposed) {
    throw new Error("未暴露 myClawAPI");
  }
  return exposed as {
    fetchCloudSkills: (query?: Record<string, unknown>) => Promise<unknown>;
  };
}

describe("preload cloud skills bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    electronMocks.exposeInMainWorld.mockClear();
    electronMocks.invoke.mockReset();
    electronMocks.on.mockClear();
    electronMocks.removeListener.mockClear();
    electronMocks.send.mockClear();
    electronMocks.setZoomFactor.mockClear();
  });

  it("turns recoverable main-process cloud errors back into renderer rejections", async () => {
    electronMocks.invoke.mockResolvedValueOnce({
      __myclawCloudError: true,
      channel: "cloud:skills",
      message: "Cloud API 连接失败",
    });

    const api = await loadExposedApi();

    await expect(api.fetchCloudSkills()).rejects.toThrow("Cloud API 连接失败");
  });
});
