// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { SkillDefinition, FileTreeNode } from "@shared/contracts";

const mocks = vi.hoisted(() => {
  const navigateMock = vi.fn();
  const paramsState = { id: "skill-alpha" };
  const apiMock = {
    webPanelResolveView: vi.fn(),
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
    viewFiles: ["view.html"],
    ...overrides,
  };
}

function buildTree(): FileTreeNode[] {
  return [
    { name: "SKILL.md", relativePath: "SKILL.md", type: "file" },
    { name: "view.html", relativePath: "view.html", type: "file" },
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
      openWebPanel: vi.fn(),
      webPanel: {
        isOpen: false,
        viewPath: null,
        title: "",
        data: null,
        panelWidth: 420,
      },
    });
    mocks.apiMock.webPanelResolveView.mockResolvedValue("/tmp/view.html");
    mocks.apiMock.skillReadTree.mockResolvedValue(buildTree());
    mocks.apiMock.skillReadFile.mockImplementation(async (_skillId: string, path: string) => {
      if (path === "view.html") {
        return "<h1>Unsafe</h1><script>alert(1)</script>";
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

  it("sanitizes markdown preview and disables html iframe preview", async () => {
    const { default: SkillDetailPage } = await import("../src/renderer/pages/SkillDetailPage");
    render(React.createElement(SkillDetailPage));

    await waitFor(() => expect(mocks.apiMock.skillReadTree).toHaveBeenCalledWith("skill-alpha"));
    await waitFor(() => expect(mocks.apiMock.skillReadFile).toHaveBeenCalledWith("skill-alpha", "SKILL.md"));

    expect(screen.getByTestId("skill-detail-content").innerHTML).toContain("<h1>Alpha</h1>");
    expect(screen.getByTestId("skill-detail-content").innerHTML).not.toContain("<script>");
    expect(screen.getByTestId("skill-detail-content").innerHTML).not.toContain("onerror");

    fireEvent.click(screen.getByRole("button", { name: "view.html" }));

    await waitFor(() => expect(mocks.apiMock.skillReadFile).toHaveBeenCalledWith("skill-alpha", "view.html"));
    expect(document.querySelector("iframe.html-preview")).toBeNull();
    expect(screen.getByText(/Unsafe/)).toBeTruthy();
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

    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
  });
});
