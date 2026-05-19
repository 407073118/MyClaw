/** @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import InlineFileReferenceContent from "../src/renderer/components/InlineFileReferenceContent";
import {
  findInlineFileCandidateBaseDirectories,
  findInlineFileReferences,
} from "../src/renderer/utils/inline-file-references";

describe("inline file references", () => {
  beforeEach(() => {
    Object.defineProperty(window, "myClawAPI", {
      configurable: true,
      value: {
        fileViewerPreview: vi.fn(async () => ({
          success: true,
          viewMeta: {
            viewPath: "builtin:file-viewer",
            title: "README.md",
            data: { panelKind: "file-viewer" },
          },
        })),
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as Window & { myClawAPI?: unknown }).myClawAPI;
  });

  it("detects local file references while skipping remote URLs", () => {
    const refs = findInlineFileReferences(
      "请看 README.md、docs/plan.md 和 https://example.test/remote.md，再看 package.json。",
    );

    expect(refs.map((ref) => ref.path)).toEqual([
      "README.md",
      "docs/plan.md",
      "package.json",
    ]);
  });

  it("extracts absolute directories from the same message as preview candidates", () => {
    const dirs = findInlineFileCandidateBaseDirectories(
      "E:\\skill 文件夹内容如下：Skill表单开发规范.md；另见 https://example.test/remote.md",
    );

    expect(dirs).toEqual(["E:\\skill"]);
  });

  it("turns message text file names into preview buttons", async () => {
    const openWebPanel = vi.fn();

    render(
      <InlineFileReferenceContent
        className="message-content"
        html="<p>打开 README.md，代码块里的文件名不要增强。</p><pre><code>hidden.md</code></pre>"
        baseDirectory="F:/MyClaw"
        onOpenWebPanel={openWebPanel}
      />,
    );

    const button = await screen.findByRole("button", { name: "README.md" });
    expect(screen.queryByRole("button", { name: "hidden.md" })).toBeNull();

    fireEvent.click(button);

    expect(window.myClawAPI.fileViewerPreview).toHaveBeenCalledWith({
      path: "README.md",
      baseDirectory: "F:/MyClaw",
    });
    await waitFor(() => {
      expect(openWebPanel).toHaveBeenCalledWith({
        viewPath: "builtin:file-viewer",
        title: "README.md",
        data: { panelKind: "file-viewer" },
      });
    });
  });

  it("passes directories mentioned in the same message when opening bare file names", async () => {
    render(
      <InlineFileReferenceContent
        className="message-content"
        html={"<p><code>E:\\skill</code> 文件夹内容如下：</p><p>Skill表单开发规范.md</p>"}
        baseDirectory="F:/MyClaw"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Skill表单开发规范.md" }));

    expect(window.myClawAPI.fileViewerPreview).toHaveBeenCalledWith({
      path: "Skill表单开发规范.md",
      baseDirectory: "F:/MyClaw",
      candidateBaseDirectories: ["E:\\skill"],
    });
  });

  it("enhances inline code file names but skips fenced code blocks", async () => {
    render(
      <InlineFileReferenceContent
        className="message-content"
        html="<p>已生成 <code>今天的天气.md</code> 文件。</p><pre><code>hidden.md</code></pre>"
        baseDirectory="F:/MyClaw"
      />,
    );

    expect(await screen.findByRole("button", { name: "今天的天气.md" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "hidden.md" })).toBeNull();
  });
});
