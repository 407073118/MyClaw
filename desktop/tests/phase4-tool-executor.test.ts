/**
 * Phase 4 + general: BuiltinToolExecutor tests
 *
 * Tests the core tool executor used in the agentic loop:
 * - fs.read, fs.write, fs.edit, fs.list, fs.search, fs.find
 * - exec.command safety checks
 * - git tools (status, diff, log)
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

  // -------------------------------------------------------------------------
  // 自纠错误消息：当 label 缺失 command 时，返回给模型可读的引导
  // -------------------------------------------------------------------------

  it("returns self-correcting error when label is empty", async () => {
    const result = await executor.execute("exec.command", "", testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("exec_command");
    expect(result.error).toContain("`command`");
    expect(result.error).toContain('{"command":');
  });

  it("returns self-correcting error listing wrong parameter name", async () => {
    // 模拟 buildToolLabel 在模型用了 `cmd` 而不是 `command` 时产生的 label
    const label = JSON.stringify({
      command: "",
      _diagnostics: {
        receivedArgKeys: ["cmd"],
        commandFieldType: "undefined",
        commandIsWhitespace: false,
      },
    });
    const result = await executor.execute("exec.command", label, testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("[cmd]");
    expect(result.error).toContain("`command`");
    expect(result.error).toMatch(/cmd|shell|command_line|script/);
  });

  it("returns self-correcting error when command is whitespace-only", async () => {
    const label = JSON.stringify({
      command: "   ",
      _diagnostics: {
        receivedArgKeys: ["command"],
        commandFieldType: "string",
        commandIsWhitespace: true,
      },
    });
    const result = await executor.execute("exec.command", label, testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("空白");
  });

  it("returns self-correcting error when command is wrong type", async () => {
    const label = JSON.stringify({
      command: "",
      _diagnostics: {
        receivedArgKeys: ["command"],
        commandFieldType: "number",
        commandIsWhitespace: false,
      },
    });
    const result = await executor.execute("exec.command", label, testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("string");
    expect(result.error).toContain("number");
  });

  it("returns self-correcting error when the label itself is malformed JSON", async () => {
    // `{` 开头但解析失败 → 走 labelParseFailed 分支
    const result = await executor.execute("exec.command", '{"command": "ls', testDir);
    expect(result.success).toBe(false);
    expect(result.error).toContain("JSON");
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

  it("should include execution guidance for skills with scripts", async () => {
    const skillDir = join(testDir, "script-skill");
    mkdirSync(join(skillDir, "scripts"), { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# Script Skill\nRun local scripts.", "utf8");

    executor.setSkills([{
      id: "script-skill",
      name: "Script Skill",
      description: "Has local scripts",
      path: skillDir,
      enabled: true,
      disableModelInvocation: false,
      hasScriptsDirectory: true,
      hasReferencesDirectory: false,
      hasAssetsDirectory: false,
      hasTestsDirectory: false,
      hasAgentsDirectory: false,
    }]);

    const result = await executor.execute("skill_invoke__script-skill", "run it", testDir);
    expect(result.success).toBe(true);
    expect(result.output).toContain(skillDir);
    expect(result.output).toContain("\"cwd\"");
    expect(result.output).toContain("py -3");
    expect(result.output).toContain("scripts/");
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
