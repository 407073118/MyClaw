// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => {
  const workspace = {
    personalPrompt: {
      prompt: "我是黑盒测试，负责需求测试和回归验证。",
      summary: "黑盒测试",
      tags: ["测试"],
      updatedAt: "2026-04-04T14:24:46.000Z",
    },
    loadPersonalPrompt: vi.fn().mockResolvedValue(undefined),
    updatePersonalPrompt: vi.fn().mockResolvedValue(undefined),
  };

  return { workspace };
});

vi.mock("../src/renderer/stores/workspace", () => ({
  useWorkspaceStore: (selector?: (state: typeof mocks.workspace) => unknown) =>
    (typeof selector === "function" ? selector(mocks.workspace) : mocks.workspace),
}));

describe("PersonalPromptPage layout contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps header metadata inside the copy column and avoids viewport-height card sizing", async () => {
    const { default: PersonalPromptPage } = await import("../src/renderer/pages/PersonalPromptPage");
    const { container } = render(
      React.createElement(
        MemoryRouter,
        undefined,
        React.createElement(PersonalPromptPage),
      ),
    );

    const headerText = container.querySelector(".personal-prompt-header-text");
    const metaInline = container.querySelector(".header-meta-inline");
    const styleText = Array.from(container.querySelectorAll("style"))
      .map((styleNode) => styleNode.textContent ?? "")
      .join("\n");

    expect(headerText).not.toBeNull();
    expect(metaInline).not.toBeNull();
    expect(headerText?.contains(metaInline)).toBe(true);
    expect(styleText).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(styleText).not.toContain("calc(100vh - 190px)");
  });
});
