import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

import { buildPanelViewerHtml } from "../src/main/services/panel-viewer-html";

describe("Panel viewer HTML", () => {
  it("keeps the file viewer inside the native panel contract without iframe content", () => {
    const html = buildPanelViewerHtml();

    expect(html).not.toContain("<iframe");
    expect(html).toContain("myclaw-vendor://monaco/vs/loader.js");
    expect(html).toContain("myclaw-vendor://pdfjs/pdf.min.js");
    expect(html).toContain("file-viewer:open-external");
    expect(html).toContain("file-viewer:reveal");
  });

  it("renders markdown safely and routes local file actions through the panel bridge", () => {
    let onMessage: ((message: unknown) => void) | null = null;
    const invokeAction = vi.fn();
    const dom = new JSDOM(buildPanelViewerHtml(), {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.assign(window, {
          myClawPanel: {
            onMessage(callback: (message: unknown) => void) {
              onMessage = callback;
            },
            invokeAction,
          },
        });
      },
    });

    onMessage?.({
      type: "skill-data",
      payload: {
        panelKind: "file-viewer",
        fileName: "README.md",
        path: "F:/tmp/README.md",
        viewerKind: "markdown",
        sizeBytes: 42,
        content: "# Hello\n\n<script>alert(1)</script>\n\nWorld",
      },
    });

    const html = dom.window.document.body.innerHTML;
    expect(dom.window.document.querySelector("script[src]")).toBeNull();
    expect(html).toContain("Hello");
    expect(html).toContain("World");
    expect(html).not.toContain("<script>alert");

    dom.window.document.querySelector<HTMLButtonElement>("[data-action='openExternal']")?.click();
    dom.window.document.querySelector<HTMLButtonElement>("[data-action='reveal']")?.click();

    expect(invokeAction).toHaveBeenCalledWith("file-viewer:open-external", { path: "F:/tmp/README.md" });
    expect(invokeAction).toHaveBeenCalledWith("file-viewer:reveal", { path: "F:/tmp/README.md" });
  });

  it("renders markdown tables, fenced code blocks, and emphasis in the file preview", () => {
    let onMessage: ((message: unknown) => void) | null = null;
    const dom = new JSDOM(buildPanelViewerHtml(), {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.assign(window, {
          myClawPanel: {
            onMessage(callback: (message: unknown) => void) {
              onMessage = callback;
            },
            invokeAction: vi.fn(),
          },
        });
      },
    });

    onMessage?.({
      type: "skill-data",
      payload: {
        panelKind: "file-viewer",
        fileName: "report.md",
        path: "F:/tmp/report.md",
        viewerKind: "markdown",
        sizeBytes: 128,
        content: [
          "## 调研概述",
          "",
          "| 维度 | 内容 |",
          "|------|------|",
          "| **调研目标** | 了解主流产品 |",
          "",
          "```",
          "选型决策树：",
          "├── 团队技术栈是 JavaScript/TypeScript？",
          "```",
        ].join("\n"),
      },
    });

    const document = dom.window.document;

    expect(document.querySelector("h2")?.textContent).toBe("调研概述");
    expect(document.querySelector("table")).not.toBeNull();
    expect(document.querySelector("th")?.textContent).toBe("维度");
    expect(document.querySelector("td strong")?.textContent).toBe("调研目标");
    expect(document.querySelector("pre code")?.textContent).toContain("选型决策树");
    expect(document.body.textContent).not.toContain("```");
  });

  it("mounts code and PDF viewers through Monaco and PDF.js placeholders", () => {
    let onMessage: ((message: unknown) => void) | null = null;
    const dom = new JSDOM(buildPanelViewerHtml(), {
      runScripts: "dangerously",
      beforeParse(window) {
        Object.assign(window, {
          myClawPanel: {
            onMessage(callback: (message: unknown) => void) {
              onMessage = callback;
            },
            invokeAction: vi.fn(),
          },
        });
      },
    });

    onMessage?.({
      type: "skill-data",
      payload: {
        panelKind: "file-viewer",
        fileName: "notes.ts",
        path: "F:/tmp/notes.ts",
        ext: ".ts",
        viewerKind: "code",
        sizeBytes: 15,
        content: "const ok = true;",
      },
    });
    expect(dom.window.document.querySelector("[data-editor='monaco']")).not.toBeNull();

    onMessage?.({
      type: "skill-data",
      payload: {
        panelKind: "file-viewer",
        fileName: "paper.pdf",
        path: "F:/tmp/paper.pdf",
        viewerKind: "pdf",
        sizeBytes: 100,
        previewUrl: "myclaw-file://panel/token",
      },
    });
    expect(dom.window.document.querySelector("#pdfStatus")?.textContent).toContain("PDF.js");
    expect(dom.window.document.querySelector("#pdfPages")).not.toBeNull();
  });
});
