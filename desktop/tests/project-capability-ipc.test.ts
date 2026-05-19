import { beforeEach, describe, expect, it, vi } from "vitest";

const handleMock = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

/** 查找已注册 IPC handler。 */
function findHandler(channel: string) {
  const matched = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  if (!matched) {
    throw new Error(`handler not found: ${channel}`);
  }
  return matched[1] as (...args: unknown[]) => Promise<unknown>;
}

describe("project capability IPC", () => {
  beforeEach(() => {
    handleMock.mockClear();
  });

  it("registers list, detail, bind, and state handlers", async () => {
    const listProjects = vi.fn(() => [{ id: "project-1", name: "客服平台" }]);
    const getProjectDetail = vi.fn(() => ({ project: { id: "project-1" }, refs: [], prefs: [], installations: [] }));
    const bindSessionProject = vi.fn();
    const getSessionProjectBinding = vi.fn(() => "project-1");
    const setCapabilityLocalState = vi.fn();
    const getCapabilityRef = vi.fn(() => ({ id: "ref-1", localProjectId: "project-1" }));
    const { registerProjectHandlers } = await import("../src/main/ipc/projects");
    registerProjectHandlers({
      services: {
        projectCapabilities: {
          listProjects,
          getProjectDetail,
          bindSessionProject,
          getSessionProjectBinding,
          setCapabilityLocalState,
          getCapabilityRef,
        },
      },
    } as never);

    const listPayload = await findHandler("projects:list-local")(null);
    const detailPayload = await findHandler("projects:get-detail")(null, "project-1");
    const bindPayload = await findHandler("projects:bind-session")(null, {
      sessionId: "session-1",
      localProjectId: "project-1",
    });
    const bindingPayload = await findHandler("projects:get-session-binding")(null, "session-1");
    const statePayload = await findHandler("projects:set-capability-state")(null, {
      capabilityRefId: "ref-1",
      localState: "disabled",
    });

    expect(listPayload).toEqual({ items: [expect.objectContaining({ id: "project-1" })] });
    expect(detailPayload).toEqual(expect.objectContaining({ project: expect.objectContaining({ id: "project-1" }) }));
    expect(bindPayload).toEqual({ ok: true, localProjectId: "project-1" });
    expect(bindingPayload).toEqual({ localProjectId: "project-1" });
    expect(statePayload).toEqual(expect.objectContaining({ project: expect.objectContaining({ id: "project-1" }) }));
    expect(bindSessionProject).toHaveBeenCalledWith("session-1", "project-1");
    expect(getSessionProjectBinding).toHaveBeenCalledWith("session-1");
    expect(setCapabilityLocalState).toHaveBeenCalledWith("ref-1", "disabled");
  }, 15_000);
});
