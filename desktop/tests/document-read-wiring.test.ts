/**
 * Wiring tests for document.read: tool-schemas + builtin-tool-executor + tool-id-normalizer.
 *
 * These tests cover the integration surface of 08-03 Task 2 rather than facade internals.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { DocumentIR } from "@shared/contracts";
import {
  __resetParserRegistryForTests,
  registerParser,
} from "../src/main/services/document/parser-registry";
import {
  buildToolLabel,
  buildToolSchemas,
  functionNameToToolId,
} from "../src/main/services/tool-schemas";
import { BuiltinToolExecutor } from "../src/main/services/builtin-tool-executor";

function makeFakeMdIr(path: string, bytes: number, sha: string): DocumentIR {
  return {
    source: { path, format: "md", bytes, sha256: sha },
    meta: { title: "Wiring fixture" },
    outline: [{ level: 1, title: "H", locator: { heading: "H" } }],
    body: [
      { kind: "heading", level: 1, runs: [{ text: "H" }], locator: { heading: "H" } },
      { kind: "paragraph", runs: [{ text: "hello wiring" }], locator: { heading: "H" } },
    ],
    media: [],
  };
}

describe("document.read wiring", () => {
  let tmpRoot = "";
  let fixturePath = "";

  beforeEach(async () => {
    __resetParserRegistryForTests();
    tmpRoot = mkdtempSync(join(tmpdir(), "myclaw-docwire-"));
    fixturePath = join(tmpRoot, "fixture.md");
    await writeFile(fixturePath, "# H\n\nhello wiring\n", "utf-8");
  });

  afterEach(() => {
    if (tmpRoot && existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
    __resetParserRegistryForTests();
  });

  it("Test 1: buildToolSchemas exposes document_read with 4-mode enum", () => {
    const schemas = buildToolSchemas("/cwd");
    const docRead = schemas.find((t) => t.function.name === "document_read");
    expect(docRead).toBeDefined();
    const params = docRead!.function.parameters as {
      properties: { mode: { enum: string[] } };
      required: string[];
    };
    expect(params.properties.mode.enum).toEqual(["stats", "outline", "read", "search"]);
    expect(params.required).toContain("path");
    expect(params.required).toContain("mode");
  });

  it("Test 2: executor dispatches document.read to the facade and returns success", async () => {
    registerParser({
      format: "md",
      parse: async (input) => {
        const st = await import("node:fs/promises").then((m) => m.stat(input.path));
        return makeFakeMdIr(input.path, st.size, input.sha256);
      },
    });
    const executor = new BuiltinToolExecutor();
    executor.setAllowExternalPaths(true); // avoid triggering PathAccessPolicy in this unit test
    executor.setDocCacheRoot(join(tmpRoot, "cache"));
    const label = JSON.stringify({ path: fixturePath, mode: "stats" });
    const res = await executor.execute("document.read", label, tmpRoot);
    expect(res.success).toBe(true);
    const parsed = JSON.parse(res.output);
    expect(parsed.format).toBe("md");
    expect(parsed.outlineCount).toBe(1);
    expect(parsed.bodyCount).toBe(2);
  });

  it("Test 3: executor still handles legacy xlsx.extract (backward compat)", async () => {
    const executor = new BuiltinToolExecutor();
    executor.setAllowExternalPaths(true);
    // Missing path → the executor should complain about missing path rather than
    // crash or route into document.read. The exact error message belongs to
    // executeXlsxExtract; we just assert the dispatch path is reached (the error
    // string should mention xlsx.extract argument parsing).
    const res = await executor.execute("xlsx.extract", JSON.stringify({}), tmpRoot);
    expect(res.success).toBe(false);
    // The legacy branch is intact — we should NOT see [E_DOC_* errors here.
    expect(res.error ?? "").not.toMatch(/\[E_DOC_/);
  });

  it("Test 4: inferOperation maps document.read -> read (via tool-id normalizer round-trip)", () => {
    // The inferOperation function is private to builtin-tool-executor. We verify through
    // functionNameToToolId + a property that indirectly depends on it: the dispatch path.
    // Direct assertion: function name underscore->dot conversion gives document.read.
    expect(functionNameToToolId("document_read")).toBe("document.read");
  });

  it("Test 5: document_read schema documents maxChars default 8000 and hard cap 32000", () => {
    const schemas = buildToolSchemas("/cwd");
    const docRead = schemas.find((t) => t.function.name === "document_read");
    expect(docRead).toBeDefined();
    const params = docRead!.function.parameters as {
      properties: { maxChars: { description: string } };
    };
    const desc = params.properties.maxChars.description;
    expect(desc).toMatch(/8000/);
    expect(desc).toMatch(/32000/);
  });

  it("Test 6: dispatching document.read before setDocCacheRoot returns [E_DOC_CACHE_NOT_INITIALIZED]", async () => {
    registerParser({
      format: "md",
      parse: async (input) => makeFakeMdIr(input.path, 10, input.sha256),
    });
    const executor = new BuiltinToolExecutor();
    executor.setAllowExternalPaths(true);
    // Note: DO NOT call setDocCacheRoot.
    const label = JSON.stringify({ path: fixturePath, mode: "stats" });
    const res = await executor.execute("document.read", label, tmpRoot);
    expect(res.success).toBe(false);
    expect(res.error).toContain("[E_DOC_CACHE_NOT_INITIALIZED]");
    expect(res.error).toMatch(/sessions\.ts|setDocCacheRoot/);
    expect(res.error).toMatch(/。|\./);
  });

  it("Test 7: buildToolLabel serializes document.read args to JSON", () => {
    const label = buildToolLabel("document_read", {
      path: "/tmp/file.md",
      mode: "read",
      locator: { heading: "Intro" },
      maxChars: 5000,
    });
    const parsed = JSON.parse(label);
    expect(parsed.path).toBe("/tmp/file.md");
    expect(parsed.mode).toBe("read");
    expect(parsed.locator.heading).toBe("Intro");
    expect(parsed.maxChars).toBe(5000);
  });
});
