// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { SkillDefinition, FileTreeNode } from "@shared/contracts";

const mocks = vi.hoisted(() => {
  const navigateMock = vi.fn();
  const paramsState = { id: "skill-alpha" };
  const apiMock = {
    webPanelResolvePage: vi.fn(),
    skillReadTree: vi.fn(),
    skillReadFile: vi.fn(),
  };
  const workspaceState: Record<string, unknown> = {
    skills: [] as SkillDefinition[],
    skillDetails: {},
    webPanel: {
      isOpen: false,
      viewPath: null,
      title: "",
      data: null,
      panelWidth: 420,
    },
    loadSkillDetail: vi.fn(),
    openWebPanel: vi.fn(),
    closeWebPanel: vi.fn(),
    setWebPanelWidth: vi.fn(),
  };

  return { navigateMock, paramsState, apiMock, workspaceState };
});

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigateMock,
    useParams: () => mocks.paramsState,
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: (selector?: (state: typeof mocks.workspaceState) => unknown) =>
    (typeof selector === "function" ? selector(mocks.workspaceState as typeof mocks.workspaceState) : mocks.workspaceState),
}));

function buildSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: "skill-alpha",
    name: "Alpha Skill",
    description: "Alpha description",
    path: "/skills/alpha",
    enabled: true,
    hasScriptsDirectory: false,
    hasReferencesDirectory: false,
    hasAssetsDirectory: false,
    hasTestsDirectory: false,
    hasAgentsDirectory: false,
    hasViewFile: true,
    viewFiles: ["view.html", "report.html"],
    ...overrides,
  };
}

function buildTree(): FileTreeNode[] {
  return [
    { name: "SKILL.md", relativePath: "SKILL.md", type: "file" },
    { name: "view.html", relativePath: "view.html", type: "file" },
    { name: "report.html", relativePath: "report.html", type: "file" },
    { name: "config.json", relativePath: "config.json", type: "file" },
  ];
}

describe("skills rendering accessibility and preview safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.workspaceState, {
      skills: [buildSkill()],
      skillDetails: {},
      loadSkillDetail: vi.fn().mockResolvedValue({
        ...buildSkill(),
        entryPath: "/skills/alpha/SKILL.md",
        content: "# Alpha\n\n<script>alert('xss')</script>\n<img src=\"x\" onerror=\"alert(1)\">",
      }),
      openWebPanel: vi.fn((viewPath: string, title: string, data: unknown) => {
        Object.assign(mocks.workspaceState, {
          webPanel: {
            ...(mocks.workspaceState.webPanel as Record<string, unknown>),
            isOpen: true,
            viewPath,
            title,
            data,
          },
        });
      }),
      closeWebPanel: vi.fn(() => {
        Object.assign(mocks.workspaceState, {
          webPanel: {
            ...(mocks.workspaceState.webPanel as Record<string, unknown>),
            isOpen: false,
            viewPath: null,
            title: "",
            data: null,
          },
        });
      }),
      webPanel: {
        isOpen: false,
        viewPath: null,
        title: "",
        data: null,
        panelWidth: 420,
      },
    });
    mocks.apiMock.webPanelResolvePage.mockImplementation(async (_skillId: string, relativePath: string) => `/tmp/${relativePath}`);
    mocks.apiMock.skillReadTree.mockResolvedValue(buildTree());
    mocks.apiMock.skillReadFile.mockImplementation(async (_skillId: string, path: string) => {
      if (path === "view.html") {
        return "<h1>Unsafe</h1><script>alert(1)</script>";
      }
      if (path === "report.html") {
        return "<h1>Report</h1><script>alert(2)</script>";
      }
      if (path === "config.json") {
        return JSON.stringify({ mode: "strict" }, null, 2);
      }
      return "# Alpha\n\n<script>alert('xss')</script>\n<img src=\"x\" onerror=\"alert(1)\">";
    });
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: mocks.apiMock,
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("exposes the skill card header as a real button", async () => {
    const { default: SkillsPage } = await import("../src/renderer/pages/SkillsPage");
    render(React.createElement(SkillsPage));

    const skillCardButton = screen.getByRole("button", { name: "打开 Alpha Skill 详情" });
    fireEvent.click(skillCardButton);

    await waitFor(() => expect(mocks.workspaceState.loadSkillDetail).toHaveBeenCalledWith("skill-alpha"));
    expect(screen.getByTestId("skill-detail-title").textContent).toContain("Alpha Skill");
  });

  it("supports escape close and focus restore for the skill detail dialog", async () => {
    const { default: SkillsPage } = await import("../src/renderer/pages/SkillsPage");
    render(React.createElement(SkillsPage));

    const skillCardButton = screen.getByRole("button", { name: "打开 Alpha Skill 详情" });
    skillCardButton.focus();
    fireEvent.click(skillCardButton);

    const dialog = await screen.findByRole("dialog", { name: "Alpha Skill" });
    await waitFor(() => expect(document.activeElement).toBe(dialog));

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Alpha Skill" })).toBeNull());
    expect(document.activeElement).toBe(skillCardButton);
  });

  it("removes list-level preview actions from the skill list", async () => {
    const { default: SkillsPage } = await import("../src/renderer/pages/SkillsPage");
    render(React.createElement(SkillsPage));

    expect(screen.queryByRole("button", { name: /棰勮|预览/i })).toBeNull();
    expect(screen.getByRole("button", { name: /鏌ョ湅璇︽儏|查看详情/i })).toBeTruthy();
  });

  it("hides package chips from the skill list cards", async () => {
    const { default: SkillsPage } = await import("../src/renderer/pages/SkillsPage");
    render(React.createElement(SkillsPage));

    expect(screen.queryByText("SKILL.md")).toBeNull();
    expect(screen.queryByText("view.html")).toBeNull();
    expect(screen.queryByText("report.html")).toBeNull();
  });

  it("shows html source by default and requires explicit display for html panel files", async () => {
    const { default: SkillDetailPage } = await import("../src/renderer/pages/SkillDetailPage");
    render(React.createElement(SkillDetailPage));

    await waitFor(() => expect(mocks.apiMock.skillReadTree).toHaveBeenCalledWith("skill-alpha"));
    await waitFor(() => expect(mocks.apiMock.skillReadFile).toHaveBeenCalledWith("skill-alpha", "SKILL.md"));

    const markdownContent = screen.getByTestId("skill-detail-content");
    expect(markdownContent.className).toContain("markdown-preview__surface");
    expect(markdownContent.closest(".markdown-preview")).not.toBeNull();
    expect(markdownContent.innerHTML).toContain("<h1>Alpha</h1>");
    expect(markdownContent.innerHTML).not.toContain("<script>");
    expect(markdownContent.innerHTML).not.toContain("onerror");

    fireEvent.click(screen.getByRole("button", { name: "view.html" }));

    await waitFor(() => expect(mocks.apiMock.skillReadFile).toHaveBeenCalledWith("skill-alpha", "view.html"));
    expect(screen.getByText("<h1>Unsafe</h1><script>alert(1)</script>")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Unsafe" })).toBeNull();
    expect(screen.getByRole("button", { name: "展示" })).toBeTruthy();
    expect(mocks.workspaceState.openWebPanel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "展示" }));

    await waitFor(() => expect(mocks.apiMock.webPanelResolvePage).toHaveBeenCalledWith("skill-alpha", "view.html"));
    expect(mocks.workspaceState.openWebPanel).toHaveBeenCalledTimes(1);
  });

  it("auto-switches the web panel when another html file is selected while open", async () => {
    Object.assign(mocks.workspaceState, {
      webPanel: {
        isOpen: true,
        viewPath: "/tmp/view.html",
        title: "Alpha Skill / view.html",
        data: { relativePath: "view.html" },
        panelWidth: 420,
      },
    });

    const { default: SkillDetailPage } = await import("../src/renderer/pages/SkillDetailPage");
    render(React.createElement(SkillDetailPage));

    await waitFor(() => expect(mocks.apiMock.skillReadFile).toHaveBeenCalledWith("skill-alpha", "view.html"));
    fireEvent.click(screen.getByRole("button", { name: "report.html" }));

    await waitFor(() => expect(mocks.apiMock.skillReadFile).toHaveBeenCalledWith("skill-alpha", "report.html"));
    await waitFor(() => expect(mocks.apiMock.webPanelResolvePage).toHaveBeenCalledWith("skill-alpha", "report.html"));
    expect(mocks.workspaceState.openWebPanel).toHaveBeenCalled();
  });

  it("auto-closes the web panel when a non-html file is selected", async () => {
    Object.assign(mocks.workspaceState, {
      webPanel: {
        isOpen: true,
        viewPath: "/tmp/view.html",
        title: "Alpha Skill / view.html",
        data: { relativePath: "view.html" },
        panelWidth: 420,
      },
    });

    const { default: SkillDetailPage } = await import("../src/renderer/pages/SkillDetailPage");
    render(React.createElement(SkillDetailPage));

    await waitFor(() => expect(mocks.apiMock.skillReadFile).toHaveBeenCalledWith("skill-alpha", "view.html"));
    fireEvent.click(screen.getByRole("button", { name: "config.json" }));

    await waitFor(() => expect(mocks.apiMock.skillReadFile).toHaveBeenCalledWith("skill-alpha", "config.json"));
    expect(mocks.workspaceState.closeWebPanel).toHaveBeenCalled();
  });

  it("does not auto-reopen html pages after a manual panel close", async () => {
    const { default: SkillDetailPage } = await import("../src/renderer/pages/SkillDetailPage");
    const view = render(React.createElement(SkillDetailPage));

    await waitFor(() => expect(mocks.apiMock.skillReadFile).toHaveBeenCalledWith("skill-alpha", "SKILL.md"));
    fireEvent.click(screen.getByRole("button", { name: "view.html" }));
    await waitFor(() => expect(mocks.apiMock.skillReadFile).toHaveBeenCalledWith("skill-alpha", "view.html"));
    fireEvent.click(screen.getByRole("button", { name: "展示" }));
    await waitFor(() => expect(mocks.workspaceState.openWebPanel).toHaveBeenCalledTimes(1));

    (mocks.workspaceState.closeWebPanel as ReturnType<typeof vi.fn>)();
    view.rerender(React.createElement(SkillDetailPage));

    fireEvent.click(screen.getByRole("button", { name: "report.html" }));
    await waitFor(() => expect(mocks.apiMock.skillReadFile).toHaveBeenCalledWith("skill-alpha", "report.html"));

    expect(mocks.workspaceState.openWebPanel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "展示" })).toBeTruthy();
  });

  it("hardens the web panel iframe sandbox", async () => {
    const { default: WebPanel } = await import("../src/renderer/components/WebPanel");
    Object.assign(mocks.workspaceState, {
      webPanel: {
        isOpen: true,
        viewPath: "/tmp/view.html",
        title: "Alpha Skill",
        data: { ok: true },
        panelWidth: 420,
      },
    });

    const { container } = render(React.createElement(WebPanel));
    const iframe = container.querySelector("iframe");
    const styleText = container.querySelector("style")?.textContent ?? "";

    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(styleText).toContain(".web-panel::-webkit-scrollbar");
    expect(styleText).toContain("scrollbar-width: thin");
  });
});
