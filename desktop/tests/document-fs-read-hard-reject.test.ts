/**
 * Phase 8 Plan 09 Task 1: fs.read hard-reject tests for office / pdf / pptx.
 *
 * Tests that fs.read rejects known document formats with the [E_DOC_USE_DOCUMENT_READ]
 * error code and a ready-to-use document.read invocation template; that .doc has a
 * dedicated legacy hint; that md still reads normally; and that csv passes through
 * with a soft tip.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { BuiltinToolExecutor } from "../src/main/services/builtin-tool-executor";

describe("fs.read hard-reject for document formats (08-09 Task 1)", () => {
  let tmpRoot = "";

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "myclaw-fsread-hardreject-"));
  });

  afterEach(() => {
    if (tmpRoot && existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("Test 1: fs.read on foo.docx hard-rejects with [E_DOC_USE_DOCUMENT_READ] + document.read invocation template", async () => {
    const filePath = join(tmpRoot, "foo.docx");
    await writeFile(filePath, "binary-content", "utf-8");
    const executor = new BuiltinToolExecutor();
    executor.setAllowExternalPaths(true);
    const res = await executor.execute("fs.read", filePath, tmpRoot);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toContain("[E_DOC_USE_DOCUMENT_READ]");
    expect(res.error ?? "").toContain("document.read");
    // JSON invocation template must contain path + mode keys
    expect(res.error ?? "").toMatch(/"path"\s*:/);
    expect(res.error ?? "").toMatch(/"mode"\s*:/);
  });

  it("Test 2: fs.read on foo.pdf rejects with mode=stats template suggestion", async () => {
    const filePath = join(tmpRoot, "foo.pdf");
    await writeFile(filePath, "%PDF-1.4\n", "utf-8");
    const executor = new BuiltinToolExecutor();
    executor.setAllowExternalPaths(true);
    const res = await executor.execute("fs.read", filePath, tmpRoot);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toContain("[E_DOC_USE_DOCUMENT_READ]");
    expect(res.error ?? "").toContain("document.read");
    // PDF should suggest mode=stats first
    expect(res.error ?? "").toMatch(/"mode"\s*:\s*"stats"/);
  });

  it("Test 3: fs.read on foo.pptx rejects with document.read template", async () => {
    const filePath = join(tmpRoot, "foo.pptx");
    await writeFile(filePath, "binary-content", "utf-8");
    const executor = new BuiltinToolExecutor();
    executor.setAllowExternalPaths(true);
    const res = await executor.execute("fs.read", filePath, tmpRoot);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toContain("[E_DOC_USE_DOCUMENT_READ]");
    expect(res.error ?? "").toContain("document.read");
    expect(res.error ?? "").toMatch(/"mode"\s*:\s*"stats"/);
  });

  it("Test 4: fs.read on foo.xlsx mentions both xlsx_extract (legacy) and document.read", async () => {
    const filePath = join(tmpRoot, "foo.xlsx");
    await writeFile(filePath, "binary-content", "utf-8");
    const executor = new BuiltinToolExecutor();
    executor.setAllowExternalPaths(true);
    const res = await executor.execute("fs.read", filePath, tmpRoot);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toContain("[E_DOC_USE_DOCUMENT_READ]");
    expect(res.error ?? "").toContain("document.read");
    expect(res.error ?? "").toContain("xlsx_extract");
  });

  it("Test 5: fs.read on foo.md succeeds (not hard-rejected — md is plain text)", async () => {
    const filePath = join(tmpRoot, "foo.md");
    await writeFile(filePath, "# hello\n\nworld\n", "utf-8");
    const executor = new BuiltinToolExecutor();
    executor.setAllowExternalPaths(true);
    const res = await executor.execute("fs.read", filePath, tmpRoot);
    expect(res.success).toBe(true);
    expect(res.output).toContain("# hello");
    expect(res.output).toContain("world");
  });

  it("Test 6: fs.read on foo.csv succeeds but appends a tip steering to document.read mode=read", async () => {
    const filePath = join(tmpRoot, "foo.csv");
    await writeFile(filePath, "a,b,c\n1,2,3\n", "utf-8");
    const executor = new BuiltinToolExecutor();
    executor.setAllowExternalPaths(true);
    const res = await executor.execute("fs.read", filePath, tmpRoot);
    expect(res.success).toBe(true);
    expect(res.output).toContain("a,b,c");
    expect(res.output).toContain("document.read");
    expect(res.output).toMatch(/mode=read|mode: read/);
  });

  it("Test 7: fs.read on foo.doc returns [E_DOC_LEGACY_DOC_UNSUPPORTED] with save-as-docx hint", async () => {
    const filePath = join(tmpRoot, "foo.doc");
    await writeFile(filePath, "binary-content", "utf-8");
    const executor = new BuiltinToolExecutor();
    executor.setAllowExternalPaths(true);
    const res = await executor.execute("fs.read", filePath, tmpRoot);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toContain("[E_DOC_LEGACY_DOC_UNSUPPORTED]");
    expect(res.error ?? "").toContain(".docx");
  });
});
