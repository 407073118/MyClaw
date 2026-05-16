import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

const electronMocks = vi.hoisted(() => ({
  addChildView: vi.fn(),
  removeChildView: vi.fn(),
  loadURL: vi.fn(async () => undefined),
  setBounds: vi.fn(),
  closeWebContents: vi.fn(),
  send: vi.fn(),
  executeJavaScript: vi.fn(async () => undefined),
  setWindowOpenHandler: vi.fn(),
  on: vi.fn(),
  sessionSetPermissionRequestHandler: vi.fn(),
  sessionOn: vi.fn(),
  openPath: vi.fn(async () => ""),
  showItemInFolder: vi.fn(),
}));

vi.mock("electron", () => ({
  WebContentsView: vi.fn().mockImplementation((options) => ({
    options,
    setBounds: electronMocks.setBounds,
    webContents: {
      loadURL: electronMocks.loadURL,
      send: electronMocks.send,
      executeJavaScript: electronMocks.executeJavaScript,
      on: electronMocks.on,
      close: electronMocks.closeWebContents,
      setWindowOpenHandler: electronMocks.setWindowOpenHandler,
      session: {
        setPermissionRequestHandler: electronMocks.sessionSetPermissionRequestHandler,
        on: electronMocks.sessionOn,
      },
    },
  })),
  shell: { openExternal: vi.fn(async () => undefined), openPath: electronMocks.openPath, showItemInFolder: electronMocks.showItemInFolder },
}));

import { WebContentsView } from "electron";
import { readFileSync } from "node:fs";
import { PanelViewManager } from "../src/main/services/panel-view-manager";

describe("PanelViewManager", () => {
  let tmpRoot = "";

  beforeEach(() => {
    vi.clearAllMocks();
    tmpRoot = mkdtempSync(join(tmpdir(), "myclaw-panel-manager-"));
  });

  afterEach(() => {
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("creates a sandboxed WebContentsView for panel content and attaches it to the main window", async () => {
    const manager = new PanelViewManager({
      getMainWindow: () => ({ contentView: { addChildView: electronMocks.addChildView, removeChildView: electronMocks.removeChildView } } as any),
      runtimeContext: makeRuntimeContext(tmpRoot),
      panelPreloadPath: "F:/MyClaw/dist/src/preload/panel-preload.js",
    });

    await manager.open({
      viewPath: "builtin:file-viewer",
      title: "README.md",
      data: { panelKind: "file-viewer", fileName: "README.md", viewerKind: "markdown" },
    });

    expect(WebContentsView).toHaveBeenCalledWith(expect.objectContaining({
      webPreferences: expect.objectContaining({
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: "F:/MyClaw/dist/src/preload/panel-preload.js",
      }),
    }));
    expect(electronMocks.addChildView).toHaveBeenCalledTimes(1);
    expect(electronMocks.loadURL).toHaveBeenCalledWith(expect.stringContaining("myclaw-viewer://file-viewer"));
    expect(electronMocks.send).toHaveBeenCalledWith("panel:host-message", {
      type: "skill-data",
      payload: expect.objectContaining({ panelKind: "file-viewer" }),
    });
    expect(electronMocks.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('new MessageEvent("message"'),
    );
  });

  it("maps declared Skill HTML pages to myclaw-skill URLs and rejects undeclared pages", async () => {
    const skillRoot = join(tmpRoot, "skill-one");
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(join(skillRoot, "view.html"), "<!doctype html><html></html>", "utf8");
    writeFileSync(join(skillRoot, "hidden.html"), "<!doctype html><html></html>", "utf8");
    const manager = new PanelViewManager({
      getMainWindow: () => ({ contentView: { addChildView: electronMocks.addChildView, removeChildView: electronMocks.removeChildView } } as any),
      runtimeContext: makeRuntimeContext(tmpRoot, skillRoot),
      panelPreloadPath: "panel-preload.js",
    });

    await manager.open({
      viewPath: join(skillRoot, "view.html"),
      title: "Skill",
      data: { ok: true },
    });

    expect(electronMocks.loadURL).toHaveBeenCalledWith("myclaw-skill://skill-one/view.html");
    await expect(manager.open({
      viewPath: join(skillRoot, "hidden.html"),
      title: "Hidden",
      data: {},
    })).rejects.toThrow(/未声明/);
  });

  it("updates bounds and disposes the WebContentsView through the host contentView", async () => {
    const manager = new PanelViewManager({
      getMainWindow: () => ({ contentView: { addChildView: electronMocks.addChildView, removeChildView: electronMocks.removeChildView } } as any),
      runtimeContext: makeRuntimeContext(tmpRoot),
      panelPreloadPath: "panel-preload.js",
    });
    await manager.open({ viewPath: "builtin:file-viewer", title: "Viewer", data: {} });

    manager.setBounds({ x: 720, y: 42, width: 420, height: 680 });
    manager.close();

    expect(electronMocks.setBounds).toHaveBeenCalledWith({ x: 720, y: 42, width: 420, height: 680 });
    expect(electronMocks.removeChildView).toHaveBeenCalledTimes(1);
    expect(electronMocks.closeWebContents).toHaveBeenCalledTimes(1);
  });

  it("exposes the current panel sender for IPC source checks", async () => {
    const manager = new PanelViewManager({
      getMainWindow: () => ({ contentView: { addChildView: electronMocks.addChildView, removeChildView: electronMocks.removeChildView } } as any),
      runtimeContext: makeRuntimeContext(tmpRoot),
      panelPreloadPath: "panel-preload.js",
    });
    await manager.open({ viewPath: "builtin:file-viewer", title: "Viewer", data: {} });
    const panelWebContents = (WebContentsView as unknown as { mock: { results: Array<{ value: any }> } }).mock.results.at(-1)?.value.webContents;

    expect((manager as any).isPanelSender(panelWebContents)).toBe(true);
    expect((manager as any).isPanelSender({})).toBe(false);
  });

  it("allows local file actions only for the current file viewer payload", async () => {
    const skillRoot = join(tmpRoot, "skill-one");
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(join(skillRoot, "view.html"), "<!doctype html><html></html>", "utf8");
    const manager = new PanelViewManager({
      getMainWindow: () => ({ contentView: { addChildView: electronMocks.addChildView, removeChildView: electronMocks.removeChildView } } as any),
      runtimeContext: makeRuntimeContext(tmpRoot, skillRoot),
      panelPreloadPath: "panel-preload.js",
    });

    await manager.open({ viewPath: join(skillRoot, "view.html"), title: "Skill", data: {} });
    await expect(manager.invokeAction("file-viewer:open-external", { path: join(tmpRoot, "notes.txt") }))
      .resolves.toMatchObject({ success: false });

    await manager.open({
      viewPath: "builtin:file-viewer",
      title: "notes.txt",
      data: { panelKind: "file-viewer", path: join(tmpRoot, "notes.txt"), fileName: "notes.txt", viewerKind: "text" },
    });
    await expect(manager.invokeAction("file-viewer:open-external", { path: join(tmpRoot, "other.txt") }))
      .resolves.toMatchObject({ success: false });
    await expect(manager.invokeAction("file-viewer:open-external", { path: join(tmpRoot, "notes.txt") }))
      .resolves.toMatchObject({ success: true });
  });

  it("limits legacy dataRef callbacks to JSON files inside the skill root", async () => {
    const skillRoot = join(tmpRoot, "skill-one");
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(join(skillRoot, "view.html"), "<!doctype html><html></html>", "utf8");
    writeFileSync(join(skillRoot, "payload.json"), JSON.stringify({ ok: true }), "utf8");
    writeFileSync(join(skillRoot, "payload.txt"), "{}", "utf8");
    const manager = new PanelViewManager({
      getMainWindow: () => ({ contentView: { addChildView: electronMocks.addChildView, removeChildView: electronMocks.removeChildView } } as any),
      runtimeContext: makeRuntimeContext(tmpRoot, skillRoot),
      panelPreloadPath: "panel-preload.js",
    });

    await manager.open({ viewPath: join(skillRoot, "view.html"), title: "Skill", data: {} });
    await expect(manager.handlePanelMessage({
      type: "skill-callback",
      action: "read-data-ref",
      skillId: "skill-one",
      dataRef: "../outside.json",
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("当前 Skill") });

    await expect(manager.handlePanelMessage({
      type: "skill-callback",
      action: "read-data-ref",
      skillId: "skill-one",
      dataRef: "payload.txt",
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("JSON") });

    await expect(manager.handlePanelMessage({
      type: "skill-callback",
      action: "read-data-ref",
      skillId: "skill-one",
      dataRef: "payload.json",
    })).resolves.toMatchObject({ success: true, data: { ok: true } });
  });

  it("binds legacy dataRef callbacks to the currently opened skill", async () => {
    const skillOne = join(tmpRoot, "skill-one");
    const skillTwo = join(tmpRoot, "skill-two");
    mkdirSync(skillOne, { recursive: true });
    mkdirSync(skillTwo, { recursive: true });
    writeFileSync(join(skillOne, "view.html"), "<!doctype html><html></html>", "utf8");
    writeFileSync(join(skillTwo, "secret.json"), JSON.stringify({ secret: true }), "utf8");
    const manager = new PanelViewManager({
      getMainWindow: () => ({ contentView: { addChildView: electronMocks.addChildView, removeChildView: electronMocks.removeChildView } } as any),
      runtimeContext: makeRuntimeContext(tmpRoot, skillOne, skillTwo),
      panelPreloadPath: "panel-preload.js",
    });

    await manager.open({ viewPath: join(skillOne, "view.html"), title: "Skill One", data: {} });
    await expect(manager.handlePanelMessage({
      type: "skill-callback",
      action: "read-data-ref",
      skillId: "skill-two",
      dataRef: "secret.json",
    })).resolves.toMatchObject({ success: false, error: expect.stringContaining("当前面板") });
  });

  it("streams myclaw-file resources with a content length header", async () => {
    const filePath = join(tmpRoot, "large.pdf");
    writeFileSync(filePath, "pdf-body", "utf8");
    const manager = new PanelViewManager({
      getMainWindow: () => ({ contentView: { addChildView: electronMocks.addChildView, removeChildView: electronMocks.removeChildView } } as any),
      runtimeContext: makeRuntimeContext(tmpRoot),
      panelPreloadPath: "panel-preload.js",
    });

    await manager.open({
      viewPath: "builtin:file-viewer",
      title: "large.pdf",
      data: {
        panelKind: "file-viewer",
        path: filePath,
        fileName: "large.pdf",
        viewerKind: "pdf",
        previewUrl: "file://" + filePath,
        mimeType: "application/pdf",
      },
    });
    const previewUrl = electronMocks.send.mock.calls.find(([channel]) => channel === "panel:host-message")?.[1].payload.previewUrl;
    const response = manager.handleProtocolRequest(previewUrl);

    expect(response.headers.get("content-length")).toBe(String(readFileSync(filePath).byteLength));
    await expect(response.text()).resolves.toBe("pdf-body");
  });

  it("does not expose arbitrary skill-root files through myclaw-skill", async () => {
    const skillRoot = join(tmpRoot, "skill-one");
    mkdirSync(join(skillRoot, "assets"), { recursive: true });
    writeFileSync(join(skillRoot, "view.html"), "<!doctype html><html></html>", "utf8");
    writeFileSync(join(skillRoot, "secret.json"), JSON.stringify({ secret: true }), "utf8");
    writeFileSync(join(skillRoot, "assets", "panel.css"), "body{}", "utf8");
    const manager = new PanelViewManager({
      getMainWindow: () => ({ contentView: { addChildView: electronMocks.addChildView, removeChildView: electronMocks.removeChildView } } as any),
      runtimeContext: makeRuntimeContext(tmpRoot, skillRoot),
      panelPreloadPath: "panel-preload.js",
    });

    expect(manager.handleProtocolRequest("myclaw-skill://skill-one/secret.json").status).toBe(403);
    expect(manager.handleProtocolRequest("myclaw-skill://skill-one/assets/panel.css").status).toBe(200);
  });
});

function makeRuntimeContext(tmpRoot: string, skillRoot?: string, secondSkillRoot?: string) {
  const skills = [];
  if (skillRoot) {
    skills.push({
      id: "skill-one",
      name: "Skill One",
      path: skillRoot,
      enabled: true,
      hasViewFile: true,
      hasAssetsDirectory: true,
      viewFiles: ["view.html"],
    });
  }
  if (secondSkillRoot) {
    skills.push({
      id: "skill-two",
      name: "Skill Two",
      path: secondSkillRoot,
      enabled: true,
      hasViewFile: true,
      hasAssetsDirectory: false,
      viewFiles: ["view.html"],
    });
  }
  return {
    state: {
      skills,
    },
  } as any;
}
