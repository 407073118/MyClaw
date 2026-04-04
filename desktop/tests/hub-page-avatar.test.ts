/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockWorkspace = vi.hoisted(() => ({
  cloudSkills: [
    {
      id: "hub-skill-1",
      name: "Avatar Fallback",
      summary: "Skill with an avatar that fails to load.",
      category: "development",
      tags: ["ui"],
      downloads: 42,
      latestReleaseId: "release-1",
      updatedAt: "2026-04-04T00:00:00.000Z",
      icon: "https://example.com/missing.png",
    },
  ],
  cloudSkillDetail: {
    id: "hub-skill-1",
    name: "Avatar Fallback",
    description: "Skill with an avatar that fails to load.",
    author: "anonymous",
    category: "development",
    latestVersion: "1.0.0",
    downloadCount: 42,
    releases: [],
    icon: "https://example.com/missing.png",
  },
  cloudHubItems: [],
  loadCloudSkills: vi.fn().mockResolvedValue([]),
  loadCloudHubItems: vi.fn().mockResolvedValue([]),
  loadCloudSkillDetail: vi.fn().mockImplementation(async () => mockWorkspace.cloudSkillDetail),
  loadCloudHubDetail: vi.fn().mockResolvedValue({ releases: [] }),
  loadCloudHubManifest: vi.fn().mockResolvedValue(null),
  clearCloudSkillDetail: vi.fn(),
  clearCloudHubDetail: vi.fn(),
  importCloudSkill: vi.fn(),
  importCloudMcp: vi.fn(),
  importCloudEmployeePackage: vi.fn(),
  importCloudWorkflowPackage: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: (selector?: unknown) =>
    typeof selector === "function" ? selector(mockWorkspace) : mockWorkspace,
}));

vi.mock("../src/renderer/stores/shell", () => ({
  useShellStore: (selector?: unknown) =>
    typeof selector === "function"
      ? selector({ runtimeBaseUrl: "http://localhost:3000" })
      : { runtimeBaseUrl: "http://localhost:3000" },
}));

import HubPage from "../src/renderer/pages/HubPage";

afterEach(() => {
  cleanup();
  mockNavigate.mockReset();
});

describe("HubPage", () => {
  it("replaces a broken avatar image with a React-rendered fallback", async () => {
    render(React.createElement(HubPage));

    const card = await screen.findByTestId("hub-item-hub-skill-1");
    const avatarImg = within(card).getByAltText("Avatar Fallback");

    fireEvent.error(avatarImg);

    await waitFor(() => {
      expect(within(card).queryByAltText("Avatar Fallback")).toBeNull();
      expect(within(card).getByText("A")).toBeTruthy();
    });
  });

  it("supports escape close and focus restore for the hub detail dialog", async () => {
    render(React.createElement(HubPage));

    const card = await screen.findByTestId("hub-item-hub-skill-1");
    card.focus();
    fireEvent.click(card);

    const dialog = await screen.findByRole("dialog", { name: "云端资源详情" });
    await waitFor(() => expect(document.activeElement).toBe(dialog));

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "云端资源详情" })).toBeNull());
    expect(document.activeElement).toBe(card);
  });
});
