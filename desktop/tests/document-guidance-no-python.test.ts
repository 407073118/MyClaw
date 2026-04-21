/**
 * Phase 8 Plan 09 Task 2: verify skill execution guidance demotes py -3
 * and tool-schemas steers model toward document.read.
 */

import { describe, expect, it } from "vitest";

import {
  buildSkillExecutionGuidance,
  buildWindowsPythonFallbackCommand,
} from "../src/main/services/builtin-tool-executor";
import { buildToolSchemas } from "../src/main/services/tool-schemas";

describe("skill guidance + tool-schemas steer model to document.read (08-09 Task 2)", () => {
  it("Test 1: buildSkillExecutionGuidance mentions document.read at least once", () => {
    const text = buildSkillExecutionGuidance("/some/skill");
    expect(text).toMatch(/document\.read/);
  });

  it("Test 2: guidance's first non-header content does NOT lead with py -3 or python", () => {
    const text = buildSkillExecutionGuidance("/some/skill");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    // Find first bullet (skip markdown '##' header and skill-path line)
    const bullets = lines.filter((l) => l.trim().startsWith("-"));
    expect(bullets.length).toBeGreaterThan(0);
    const firstBullet = bullets[0];
    // First actionable bullet should not lead with python / py -3 guidance.
    expect(firstBullet).not.toMatch(/\bpy\s+-3\b/);
    expect(firstBullet).not.toMatch(/\bpython\b/i);
  });

  it("Test 3: fs_read description references both document_read and xlsx_extract", () => {
    const schemas = buildToolSchemas("/cwd");
    const fsRead = schemas.find((t) => t.function.name === "fs_read");
    expect(fsRead).toBeDefined();
    const desc = fsRead!.function.description;
    expect(desc).toMatch(/document_read/);
    expect(desc).toMatch(/xlsx_extract/);
  });

  it("Test 4: document_read schema description contains all 4 mode examples as JSON fragments", () => {
    const schemas = buildToolSchemas("/cwd");
    const docRead = schemas.find((t) => t.function.name === "document_read");
    expect(docRead).toBeDefined();
    const desc = docRead!.function.description;
    // All four modes must appear as JSON-style "mode":"X" fragments in description
    expect(desc).toMatch(/"mode"\s*:\s*"stats"/);
    expect(desc).toMatch(/"mode"\s*:\s*"outline"/);
    expect(desc).toMatch(/"mode"\s*:\s*"read"/);
    expect(desc).toMatch(/"mode"\s*:\s*"search"/);
  });

  it("Test 5: buildWindowsPythonFallbackCommand is intact (preserved as last-resort)", () => {
    // Non-windows returns null; but function export and shape must still exist.
    expect(typeof buildWindowsPythonFallbackCommand).toBe("function");
    // Call with a clearly-unmatchable string — the function should return null
    // (or a replacement) without throwing. Shape verification is enough here.
    const result = buildWindowsPythonFallbackCommand("echo hello");
    // Either null (non-win32 or no-match) or a string starting with "py -3".
    if (result !== null) {
      expect(result).toMatch(/^py\s+-3/);
    }
  });

  it("Test 6: xlsx_extract description steers to document_read", () => {
    const schemas = buildToolSchemas("/cwd");
    const xlsxExtract = schemas.find((t) => t.function.name === "xlsx_extract");
    expect(xlsxExtract).toBeDefined();
    expect(xlsxExtract!.function.description).toMatch(/document_read/);
  });
});
