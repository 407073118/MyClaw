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
      createFile: vi.fn(async (input) => ({ ...input, title: `${input.title}.md`, content: input.content })),
      createFolder: vi.fn(async (input) => ({ ...input, relativePath: input.name })),
      listFiles: vi.fn(async () => [{ root: { id: "root-1" }, children: [] }]),
      readDocument: vi.fn(async (input) => ({ ...input, title: "roadmap.md", content: "# Roadmap", editable: true })),
      updateDocument: vi.fn(async (input) => ({ ...input, title: "roadmap.md", content: input.content, editable: true })),
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
    expect(await findHandler("memory:create-folder")(null, { rootId: "root-1", parentRelativePath: "", name: "ideas" })).toEqual({
      item: expect.objectContaining({ relativePath: "ideas" }),
    });
    expect(await findHandler("memory:create-file")(null, {
      rootId: "root-1",
      parentRelativePath: "ideas",
      title: "decision",
      content: "",
    })).toEqual({
      item: expect.objectContaining({ title: "decision.md" }),
    });
    expect(await findHandler("memory:list-files")(null)).toEqual({ items: [expect.objectContaining({ root: { id: "root-1" } })] });
    expect(await findHandler("memory:read-document")(null, { rootId: "root-1", relativePath: "notes/roadmap.md" })).toEqual({
      item: expect.objectContaining({ content: "# Roadmap" }),
    });
    expect(await findHandler("memory:update-document")(null, {
      rootId: "root-1",
      relativePath: "notes/roadmap.md",
      content: "# Updated",
    })).toEqual({
      item: expect.objectContaining({ content: "# Updated" }),
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
    expect(memoryVault.createFolder).toHaveBeenCalledWith({ rootId: "root-1", parentRelativePath: "", name: "ideas" });
    expect(memoryVault.createFile).toHaveBeenCalledWith({
      rootId: "root-1",
      parentRelativePath: "ideas",
      title: "decision",
      content: "",
    });
    expect(memoryVault.readDocument).toHaveBeenCalledWith({ rootId: "root-1", relativePath: "notes/roadmap.md" });
    expect(memoryVault.updateDocument).toHaveBeenCalledWith({
      rootId: "root-1",
      relativePath: "notes/roadmap.md",
      content: "# Updated",
    });
    expect(memoryVault.approveCandidate).toHaveBeenCalledWith("cand-1");
    expect(memoryVault.rejectCandidate).toHaveBeenCalledWith("cand-1");
  });
});
