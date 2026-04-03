/**
 * Phase 4 + general: BuiltinToolExecutor tests
 *
 * Tests the core tool executor used in the agentic loop:
 * - fs.read, fs.write, fs.edit, fs.list, fs.search, fs.find
 * - exec.command safety checks
 * - git tools (status, diff, log)
 * - task.manage
 * - skill_invoke__* dispatch
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { BuiltinToolExecutor } from "../src/main/services/builtin-tool-executor";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let testDir: string;
let executor: BuiltinToolExecutor;

beforeEach(() => {
  testDir = join(tmpdir(), `myclaw-test-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
  executor = new BuiltinToolExecutor();
});

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// fs.read
// ---------------------------------------------------------------------------

describe("fs.read", () => {
  it("should read a file successfully", async () => {
    writeFileSync(join(testDir, "hello.txt"), "Hello World", "utf8");
    const result = await executor.execute("fs.read", "hello.txt", testDir);
    expect(result.success).toBe(true);
    expect(result.output).toBe("Hello World");
  });

  it("should fail for non-existent file", async () => {
    const result = await executor.execute("fs.read", "nope.txt", testDir);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fs.write
// ---------------------------------------------------------------------------

describe("fs.write", () => {
  it("should write a new file", async () => {
    const result = await executor.execute("fs.write", "new-file.txt\n---\nHello from test", testDir);
    expect(result.success).toBe(true);
    expect(readFileSync(join(testDir, "new-file.txt"), "utf8")).toBe("Hello from test");
  });

  it("should create directories as needed", async () => {
    const result = await executor.execute("fs.write", "sub/dir/file.txt\n---\ncontent", testDir);
    expect(result.success).toBe(true);
    expect(existsSync(join(testDir, "sub/dir/file.txt"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fs.edit
// ---------------------------------------------------------------------------

describe("fs.edit", () => {
  it("should replace a unique string in a file", async () => {
    writeFileSync(join(testDir, "edit-me.txt"), "Hello World\nGoodbye World", "utf8");
    const args = JSON.stringify({ path: "edit-me.txt", old_string: "Hello World", new_string: "Hi World" });
    const result = await executor.execute("fs.edit", args, testDir);
    expect(result.success).toBe(true);
    const content = readFileSync(join(testDir, "edit-me.txt"), "utf8");
    expect(content).toBe("Hi World\nGoodbye World");
  });

  it("should fail when old_string not found", async () => {
    writeFileSync(join(testDir, "edit-me.txt"), "Hello World", "utf8");
    const args = JSON.stringify({ path: "edit-me.txt", old_string: "Not Here", new_string: "Hi" });
    const result = await executor.execute("fs.edit", args, testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("未在文件中找到");
  });

  it("should fail when old_string appears multiple times", async () => {
    writeFileSync(join(testDir, "edit-me.txt"), "AAA\nAAA\nBBB", "utf8");
    const args = JSON.stringify({ path: "edit-me.txt", old_string: "AAA", new_string: "CCC" });
    const result = await executor.execute("fs.edit", args, testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("出现了 2 次");
  });
});

// ---------------------------------------------------------------------------
// fs.list
// ---------------------------------------------------------------------------

describe("fs.list", () => {
  it("should list files in a directory", async () => {
    writeFileSync(join(testDir, "a.txt"), "", "utf8");
    writeFileSync(join(testDir, "b.txt"), "", "utf8");
    mkdirSync(join(testDir, "subdir"));
    const result = await executor.execute("fs.list", ".", testDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain("file a.txt");
    expect(result.output).toContain("file b.txt");
    expect(result.output).toContain("dir subdir");
  });
});

// ---------------------------------------------------------------------------
// fs.search
// ---------------------------------------------------------------------------

describe("fs.search", () => {
  it("should find text pattern in files", async () => {
    writeFileSync(join(testDir, "code.ts"), "function hello() {}\nfunction world() {}", "utf8");
    const result = await executor.execute("fs.search", "hello", testDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain("hello");
  });

  it("should return no match for missing pattern", async () => {
    writeFileSync(join(testDir, "code.ts"), "function hello() {}", "utf8");
    const result = await executor.execute("fs.search", "nonexistent_pattern_xyz", testDir);
    expect(result.success).toBe(true);
    expect(result.output).toBe("(无匹配)");
  });
});

// ---------------------------------------------------------------------------
// fs.find
// ---------------------------------------------------------------------------

describe("fs.find", () => {
  it("should find files by glob pattern", async () => {
    writeFileSync(join(testDir, "a.ts"), "", "utf8");
    writeFileSync(join(testDir, "b.js"), "", "utf8");
    mkdirSync(join(testDir, "src"));
    writeFileSync(join(testDir, "src", "c.ts"), "", "utf8");
    const result = await executor.execute("fs.find", "*.ts", testDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain(".ts");
  });
});

// ---------------------------------------------------------------------------
// exec.command safety
// ---------------------------------------------------------------------------

describe("exec.command", () => {
  it("should execute a safe command", async () => {
    const result = await executor.execute("exec.command", "echo hello", testDir);
    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe("hello");
  });

  it("should block dangerous rm -rf / command", async () => {
    const result = await executor.execute("exec.command", "rm -rf /", testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("安全策略拒绝");
  });
});

// ---------------------------------------------------------------------------
// task.manage
// ---------------------------------------------------------------------------

describe("task.manage", () => {
  it("should add and list tasks", async () => {
    const add1 = await executor.execute("task.manage", "add Write tests", testDir);
    expect(add1.success).toBe(true);
    expect(add1.output).toContain("Write tests");

    const add2 = await executor.execute("task.manage", "add Fix bugs", testDir);
    expect(add2.success).toBe(true);

    const list = await executor.execute("task.manage", "list", testDir);
    expect(list.success).toBe(true);
    expect(list.output).toContain("Write tests");
    expect(list.output).toContain("Fix bugs");
  });

  it("should mark tasks as done", async () => {
    await executor.execute("task.manage", "add Task A", testDir);
    const done = await executor.execute("task.manage", "done 1", testDir);
    expect(done.success).toBe(true);
    expect(done.output).toContain("[x]");
  });

  it("should clear all tasks", async () => {
    await executor.execute("task.manage", "add Task A", testDir);
    const clear = await executor.execute("task.manage", "clear", testDir);
    expect(clear.success).toBe(true);
    expect(clear.output).toContain("已清空");
  });
});

// ---------------------------------------------------------------------------
// skill_invoke__* dispatch
// ---------------------------------------------------------------------------

describe("skill_invoke dispatch", () => {
  it("should fail when skill not loaded", async () => {
    const result = await executor.execute("skill_invoke__nonexistent", "test input", testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("未找到技能");
  });

  it("should read skill content from SKILL.md directory", async () => {
    // Create a skill directory with SKILL.md
    const skillDir = join(testDir, "my-skill");
    mkdirSync(skillDir);
    writeFileSync(join(skillDir, "SKILL.md"), "# My Skill\nThis does amazing things.", "utf8");

    executor.setSkills([{
      id: "my-skill",
      name: "My Skill",
      description: "Amazing skill",
      path: skillDir,
      enabled: true,
      disableModelInvocation: false,
      hasScriptsDirectory: false,
      hasReferencesDirectory: false,
      hasAssetsDirectory: false,
      hasTestsDirectory: false,
      hasAgentsDirectory: false,
    }]);

    const result = await executor.execute("skill_invoke__my-skill", "help me", testDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain("My Skill");
    expect(result.output).toContain("amazing things");
    expect(result.output).toContain("help me");
  });

  it("should fail for disabled skill", async () => {
    executor.setSkills([{
      id: "disabled-skill",
      name: "Disabled",
      description: "desc",
      path: "/fake",
      enabled: false,
      disableModelInvocation: false,
      hasScriptsDirectory: false,
      hasReferencesDirectory: false,
      hasAssetsDirectory: false,
      hasTestsDirectory: false,
      hasAgentsDirectory: false,
    }]);

    const result = await executor.execute("skill_invoke__disabled-skill", "", testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("已禁用");
  });
});

// ---------------------------------------------------------------------------
// Unknown tool
// ---------------------------------------------------------------------------

describe("Unknown tool", () => {
  it("should return error for unknown tool ID", async () => {
    const result = await executor.execute("unknown.tool", "test", testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("暂未实现");
  });
});
