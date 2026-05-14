import { beforeEach, describe, expect, it, vi } from "vitest";

const handleMock = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

function findHandler(channel: string) {
  const matched = handleMock.mock.calls.find(([registeredChannel]) => registeredChannel === channel);
  if (!matched) {
    throw new Error(`handler not found: ${channel}`);
  }
  return matched[1] as (...args: unknown[]) => Promise<unknown>;
}

describe("memory vault IPC", () => {
  beforeEach(() => {
    handleMock.mockClear();
  });

  it("registers root, memo, search, context and candidate channels", async () => {
    const memoryVault = {
      listRoots: vi.fn(() => [{ id: "root-1", path: "C:/memo", mode: "managed" }]),
      addRoot: vi.fn(async (input) => ({ id: "root-2", ...input })),
      removeRoot: vi.fn(async () => ({ ok: true })),
      rescanRoot: vi.fn(async (rootId) => ({ rootId, status: "ready" })),
      createMemo: vi.fn(async (input) => ({ rootId: input.rootId, title: input.title })),
      search: vi.fn(async (input) => ({ query: input.query, items: [] })),
      getContextPack: vi.fn(async (input) => ({ enabled: false, query: input.query, evidence: [], promptBlock: "" })),
      listCandidates: vi.fn(async () => []),
      approveCandidate: vi.fn(async (id) => ({ id, status: "approved" })),
      rejectCandidate: vi.fn(async (id) => ({ id, status: "rejected" })),
    };

    const { registerMemoryHandlers } = await import("../src/main/ipc/memory");
    registerMemoryHandlers({ services: { memoryVault } } as any);

    expect(await findHandler("memory:list-roots")(null)).toEqual({ items: [expect.objectContaining({ id: "root-1" })] });
    expect(await findHandler("memory:add-root")(null, { path: "C:/memo", mode: "managed" })).toEqual({
      item: expect.objectContaining({ id: "root-2" }),
    });
    expect(await findHandler("memory:create-memo")(null, { rootId: "root-1", title: "T", content: "C" })).toEqual({
      item: expect.objectContaining({ title: "T" }),
    });
    expect(await findHandler("memory:search")(null, { query: "审批" })).toEqual({ query: "审批", items: [] });
    expect(await findHandler("memory:get-context-pack")(null, { query: "审批" })).toEqual(expect.objectContaining({ enabled: false }));
    expect(await findHandler("memory:list-candidates")(null)).toEqual({ items: [] });
    await findHandler("memory:remove-root")(null, "root-1");
    await findHandler("memory:rescan-root")(null, "root-1");
    await findHandler("memory:approve-candidate")(null, "cand-1");
    await findHandler("memory:reject-candidate")(null, "cand-1");

    expect(memoryVault.removeRoot).toHaveBeenCalledWith("root-1");
    expect(memoryVault.rescanRoot).toHaveBeenCalledWith("root-1");
    expect(memoryVault.approveCandidate).toHaveBeenCalledWith("cand-1");
    expect(memoryVault.rejectCandidate).toHaveBeenCalledWith("cand-1");
  });
});
