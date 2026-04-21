/**
 * Alias/backward-compat tests for Phase 8 Plan 04 Task 2.
 *
 * Guarantees:
 *   1. Legacy toolId "xlsx.extract" still returns Markdown table (byte-compatible with pre-Phase-8).
 *   2. "xlsx.extract" with a specific sheet name targets that sheet.
 *   3. "xlsx.extract" with maxRows caps rows and emits the Chinese truncation footer.
 *   4. "document.read" with mode=stats on the same xlsx returns sheet-aware JSON.
 *   5. Registration happens at most once per executor instance even across multiple dispatches.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { BuiltinToolExecutor } from "../src/main/services/builtin-tool-executor";
import {
  __resetParserRegistryForTests,
  listRegisteredFormats,
} from "../src/main/services/document/parser-registry";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require("xlsx") as typeof import("xlsx");

async function writeXlsxFixture(
  filePath: string,
  sheets: Array<{ name: string; aoa: unknown[][] }>,
): Promise<void> {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(s.aoa as any[][]);
    XLSX.utils.book_append_sheet(wb, sheet, s.name);
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  await writeFile(filePath, buf);
}

describe("xlsx.extract alias + document.read registration", () => {
  let tmpRoot = "";
  let fixturePath = "";

  beforeEach(async () => {
    __resetParserRegistryForTests();
    tmpRoot = mkdtempSync(join(tmpdir(), "myclaw-xlsxalias-"));
    fixturePath = join(tmpRoot, "fixture.xlsx");
    await writeXlsxFixture(fixturePath, [
      {
        name: "Summary",
        aoa: [
          ["Col1", "Col2"],
          ["a1", "b1"],
          ["a2", "b2"],
          ["a3", "b3"],
          ["a4", "b4"],
          ["a5", "b5"],
        ],
      },
      {
        name: "Details",
        aoa: [
          ["D1", "D2", "D3"],
          ["x", "y", "z"],
        ],
      },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpRoot && existsSync(tmpRoot)) {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
    __resetParserRegistryForTests();
  });

  it("Test 1: xlsx.extract returns Markdown table (legacy behavior)", async () => {
    const exec = new BuiltinToolExecutor();
    exec.setAllowExternalPaths(true);
    const res = await exec.execute("xlsx.extract", JSON.stringify({ path: fixturePath }), tmpRoot);
    expect(res.success).toBe(true);
    // Markdown table header pipe
    expect(res.output).toContain("| ");
    // GFM separator
    expect(res.output).toContain("| --- ");
    // Sheet header line from legacy code: 工作表 "Summary"（可选：Summary, Details）
    expect(res.output).toMatch(/工作表\s+"Summary"/);
    // No [E_DOC_* leakage into legacy branch
    expect(res.output).not.toMatch(/\[E_DOC_/);
  });

  it("Test 2: xlsx.extract honors sheet argument", async () => {
    const exec = new BuiltinToolExecutor();
    exec.setAllowExternalPaths(true);
    const res = await exec.execute(
      "xlsx.extract",
      JSON.stringify({ path: fixturePath, sheet: "Details" }),
      tmpRoot,
    );
    expect(res.success).toBe(true);
    expect(res.output).toMatch(/工作表\s+"Details"/);
    // Details-only headers, not Summary's
    expect(res.output).toContain("D1");
    expect(res.output).not.toContain("Col1");
  });

  it("Test 3: xlsx.extract with maxRows caps rows and appends truncation footer", async () => {
    const exec = new BuiltinToolExecutor();
    exec.setAllowExternalPaths(true);
    const res = await exec.execute(
      "xlsx.extract",
      JSON.stringify({ path: fixturePath, maxRows: 3 }),
      tmpRoot,
    );
    expect(res.success).toBe(true);
    // Footer pattern: （共 6 行，已显示前 3 行...）
    expect(res.output).toMatch(/共\s+6\s+行，已显示前\s+3\s+行/);
  });

  it("Test 4: document.read mode=stats on xlsx returns sheet-aware JSON", async () => {
    const exec = new BuiltinToolExecutor();
    exec.setAllowExternalPaths(true);
    exec.setDocCacheRoot(join(tmpRoot, "cache"));
    const res = await exec.execute(
      "document.read",
      JSON.stringify({ path: fixturePath, mode: "stats" }),
      tmpRoot,
    );
    expect(res.success).toBe(true);
    const parsed = JSON.parse(res.output);
    expect(parsed.format).toBe("xlsx");
    // 2 sheets -> bodyCount === 2 and outlineCount === 2
    expect(parsed.bodyCount).toBe(2);
    expect(parsed.outlineCount).toBe(2);
    expect(parsed.bytes).toBeGreaterThan(0);
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("Test 5: parsers register only once across multiple dispatch calls", async () => {
    const exec = new BuiltinToolExecutor();
    exec.setAllowExternalPaths(true);
    exec.setDocCacheRoot(join(tmpRoot, "cache"));

    const label = JSON.stringify({ path: fixturePath, mode: "stats" });
    const r1 = await exec.execute("document.read", label, tmpRoot);
    const r2 = await exec.execute("document.read", label, tmpRoot);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // Parser registry has xlsx/xls/xlsm/docx/pdf registered — not multiplied by call count.
    // (docx landed in 08-05, pdf in 08-06; this list grows as Wave 3 plans add more parsers.)
    const formats = listRegisteredFormats().sort();
    expect(formats).toEqual(["docx", "pdf", "xls", "xlsm", "xlsx"]);
  });
});
