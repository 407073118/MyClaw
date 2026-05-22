import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { BuiltinToolExecutor } from "../src/main/services/builtin-tool-executor";
import { buildFileViewerPreviewResult } from "../src/main/ipc/file-viewer";
import { buildToolLabel, buildToolSchemas, functionNameToToolId } from "../src/main/services/tool-schemas";

describe("file_view tool wiring", () => {
  let tmpRoot = "";
  let executor: BuiltinToolExecutor;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "myclaw-file-view-"));
    executor = new BuiltinToolExecutor();
  });

  afterEach(() => {
    if (tmpRoot && existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("exposes file_view as a read-only user-facing viewer tool", () => {
    const schemas = buildToolSchemas(tmpRoot);
    const schema = schemas.find((tool) => tool.function.name === "file_view");

    expect(schema).toBeDefined();
    expect(functionNameToToolId("file_view")).toBe("file.view");

    const label = buildToolLabel("file_view", {
      path: "README.md",
      mode: "panel",
    });
    expect(JSON.parse(label)).toEqual({ path: "README.md", mode: "panel" });
  });

  it("opens markdown in the right panel without returning file body to the model", async () => {
    const body = "# Secret Plan\n\nThe launch code is 12345.";
    writeFileSync(join(tmpRoot, "README.md"), body, "utf8");

    const result = await executor.execute(
      "file.view",
      JSON.stringify({ path: "README.md", mode: "auto" }),
      tmpRoot,
    );

    expect(result.success).toBe(true);
    expect(result.output).not.toContain("launch code");
    expect(result.viewMeta).toBeDefined();
    expect(result.viewMeta?.viewPath).toBe("builtin:file-viewer");
    expect(result.viewMeta?.data).toMatchObject({
      panelKind: "file-viewer",
      fileName: "README.md",
      viewerKind: "markdown",
      content: body,
    });
  });

  it("falls back to an unsupported panel without embedding binary content", async () => {
    writeFileSync(join(tmpRoot, "archive.bin"), Buffer.from([0, 1, 2, 3, 4]));

    const result = await executor.execute(
      "file.view",
      JSON.stringify({ path: "archive.bin", mode: "auto" }),
      tmpRoot,
    );

    expect(result.success).toBe(true);
    expect(result.output).not.toContain("\u0000");
    expect(result.viewMeta?.data).toMatchObject({
      panelKind: "file-viewer",
      fileName: "archive.bin",
      viewerKind: "unsupported",
    });
    expect((result.viewMeta?.data as { content?: unknown }).content).toBeUndefined();
  });

  it("uses injected native open handlers for external and reveal modes", async () => {
    writeFileSync(join(tmpRoot, "notes.txt"), "hello", "utf8");
    const openPath = vi.fn(async () => "");
    const revealPath = vi.fn(() => undefined);
    (executor as unknown as {
      setFileActionHandlers: (handlers: {
        openPath: (path: string) => Promise<string>;
        revealPath: (path: string) => void;
      }) => void;
    }).setFileActionHandlers({ openPath, revealPath });

    const external = await executor.execute(
      "file.view",
      JSON.stringify({ path: "notes.txt", mode: "external" }),
      tmpRoot,
    );
    const reveal = await executor.execute(
      "file.view",
      JSON.stringify({ path: "notes.txt", mode: "reveal" }),
      tmpRoot,
    );

    expect(external.success).toBe(true);
    expect(reveal.success).toBe(true);
    expect(openPath).toHaveBeenCalledWith(join(tmpRoot, "notes.txt"));
    expect(revealPath).toHaveBeenCalledWith(join(tmpRoot, "notes.txt"));
    expect(external.viewMeta).toBeUndefined();
    expect(reveal.viewMeta).toBeUndefined();
  });

  it("builds a renderer-triggered preview result from a relative file reference", async () => {
    const body = "# Inline Link\n\nPreview me.";
    writeFileSync(join(tmpRoot, "README.md"), body, "utf8");

    const result = await buildFileViewerPreviewResult({
      path: "README.md",
      baseDirectory: tmpRoot,
    });

    expect(result.success).toBe(true);
    expect(result.viewMeta).toMatchObject({
      viewPath: "builtin:file-viewer",
      title: "README.md",
      data: {
        panelKind: "file-viewer",
        fileName: "README.md",
        viewerKind: "markdown",
        content: body,
      },
    });
  });

  it("opens html reports as rendered panel previews instead of code source", async () => {
    const body = "<!doctype html><html><body><h1>Interview Report</h1></body></html>";
    writeFileSync(join(tmpRoot, "interview-final-report.html"), body, "utf8");

    const result = await buildFileViewerPreviewResult({
      path: "interview-final-report.html",
      baseDirectory: tmpRoot,
    });

    expect(result.success).toBe(true);
    expect(result.viewMeta).toMatchObject({
      viewPath: "builtin:file-viewer",
      title: "interview-final-report.html",
      data: {
        panelKind: "file-viewer",
        fileName: "interview-final-report.html",
        viewerKind: "html",
        mimeType: "text/html",
      },
    });
    expect((result.viewMeta?.data as { previewUrl?: string }).previewUrl).toMatch(/^file:\/\//);
  });

  it("resolves a bare file name from candidate directories mentioned in the chat message", async () => {
    const externalDir = join(tmpRoot, "external-skill");
    const fileName = "Skill表单开发规范.md";
    const body = "# Skill 表单开发规范\n\n可预览。";
    mkdirSync(externalDir, { recursive: true });
    writeFileSync(join(externalDir, fileName), body, "utf8");

    const result = await buildFileViewerPreviewResult({
      path: fileName,
      baseDirectory: tmpRoot,
      candidateBaseDirectories: [externalDir],
    });

    expect(result.success).toBe(true);
    expect(result.resolvedPath).toBe(join(externalDir, fileName));
    expect(result.viewMeta).toMatchObject({
      title: fileName,
      data: {
        panelKind: "file-viewer",
        fileName,
        viewerKind: "markdown",
        content: body,
      },
    });
  });
});
