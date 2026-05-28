import { beforeEach, describe, expect, it, vi } from "vitest";

const handleMock = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

/** 查找已经注册的 IPC handler，避免测试直接依赖注册顺序。 */
function findHandler(channel: string) {
  const matched = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  if (!matched) {
    throw new Error(`未注册 IPC handler: ${channel}`);
  }
  return matched[1] as (...args: unknown[]) => Promise<unknown>;
}

describe("cloud IPC skill detail", () => {
  beforeEach(() => {
    handleMock.mockClear();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns a recoverable cloud skills error payload instead of rejecting through Electron", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const { registerCloudHandlers } = await import("../src/main/ipc/cloud");
    registerCloudHandlers({} as never);

    await expect(findHandler("cloud:skills")(null, {})).resolves.toMatchObject({
      __myclawCloudError: true,
      channel: "cloud:skills",
      message: expect.stringContaining("Cloud API"),
    });
  });

  it("returns null for missing cloud skill details instead of throwing through Electron", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: vi.fn(),
    } as unknown as Response);

    const { registerCloudHandlers } = await import("../src/main/ipc/cloud");
    registerCloudHandlers({} as never);

    await expect(findHandler("cloud:skill-detail")(null, "bvvv")).resolves.toBeNull();
  });
});
