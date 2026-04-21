import { describe, it, expect } from "vitest";
import { functionNameToToolId, buildToolLabel } from "../src/main/services/tool-schemas";

// ---------------------------------------------------------------------------
// functionNameToToolId — browser tool name conversion
// ---------------------------------------------------------------------------

describe("functionNameToToolId — browser tools", () => {
  it("converts single-word browser tools", () => {
    expect(functionNameToToolId("browser_open")).toBe("browser.open");
    expect(functionNameToToolId("browser_click")).toBe("browser.click");
    expect(functionNameToToolId("browser_snapshot")).toBe("browser.snapshot");
    expect(functionNameToToolId("browser_type")).toBe("browser.type");
    expect(functionNameToToolId("browser_screenshot")).toBe("browser.screenshot");
    expect(functionNameToToolId("browser_evaluate")).toBe("browser.evaluate");
    expect(functionNameToToolId("browser_select")).toBe("browser.select");
    expect(functionNameToToolId("browser_hover")).toBe("browser.hover");
    expect(functionNameToToolId("browser_back")).toBe("browser.back");
    expect(functionNameToToolId("browser_forward")).toBe("browser.forward");
    expect(functionNameToToolId("browser_wait")).toBe("browser.wait");
    expect(functionNameToToolId("browser_scroll")).toBe("browser.scroll");
  });

  it("preserves inner underscores for multi-word browser tools", () => {
    expect(functionNameToToolId("browser_press_key")).toBe("browser.press_key");
  });

  it("does not affect non-browser tool conversion", () => {
    expect(functionNameToToolId("fs_read")).toBe("fs.read");
    expect(functionNameToToolId("fs_write")).toBe("fs.write");
    expect(functionNameToToolId("fs_edit")).toBe("fs.edit");
    expect(functionNameToToolId("exec_command")).toBe("exec.command");
    expect(functionNameToToolId("git_status")).toBe("git.status");
    expect(functionNameToToolId("git_diff")).toBe("git.diff");
    expect(functionNameToToolId("git_log")).toBe("git.log");
    expect(functionNameToToolId("git_commit")).toBe("git.commit");
    expect(functionNameToToolId("http_fetch")).toBe("http.fetch");
    expect(functionNameToToolId("web_search")).toBe("web.search");
  });

  it("preserves skill_invoke__ prefix as-is", () => {
    expect(functionNameToToolId("skill_invoke__my_skill")).toBe("skill_invoke__my_skill");
    expect(functionNameToToolId("skill_invoke__abc_def")).toBe("skill_invoke__abc_def");
  });

  it("converts skill_view correctly", () => {
    expect(functionNameToToolId("skill_view")).toBe("skill.view");
  });
});

// ---------------------------------------------------------------------------
// buildToolLabel — browser tool argument serialization
// ---------------------------------------------------------------------------

describe("buildToolLabel — browser tools", () => {
  it("serializes browser_open args as JSON", () => {
    const label = buildToolLabel("browser_open", { url: "https://example.com" });
    expect(JSON.parse(label)).toEqual({ url: "https://example.com" });
  });

  it("serializes browser_click args as JSON", () => {
    const label = buildToolLabel("browser_click", { selector: "ref=5" });
    expect(JSON.parse(label)).toEqual({ selector: "ref=5" });
  });

  it("serializes browser_type args as JSON", () => {
    const label = buildToolLabel("browser_type", { selector: "ref=3", text: "hello", pressEnter: true });
    expect(JSON.parse(label)).toEqual({ selector: "ref=3", text: "hello", pressEnter: true });
  });

  it("serializes browser_scroll args as JSON", () => {
    const label = buildToolLabel("browser_scroll", { direction: "down", amount: 5 });
    expect(JSON.parse(label)).toEqual({ direction: "down", amount: 5 });
  });

  it("serializes browser_press_key args as JSON", () => {
    const label = buildToolLabel("browser_press_key", { key: "Escape" });
    expect(JSON.parse(label)).toEqual({ key: "Escape" });
  });

  it("serializes browser_screenshot args as JSON", () => {
    const label = buildToolLabel("browser_screenshot", { fullPage: true });
    expect(JSON.parse(label)).toEqual({ fullPage: true });
  });

  it("serializes browser_evaluate args as JSON", () => {
    const label = buildToolLabel("browser_evaluate", { expression: "document.title" });
    expect(JSON.parse(label)).toEqual({ expression: "document.title" });
  });

  it("serializes empty browser args as empty JSON", () => {
    const label = buildToolLabel("browser_back", {});
    expect(JSON.parse(label)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// buildToolLabel — non-browser tools (regression tests)
// ---------------------------------------------------------------------------

describe("buildToolLabel — non-browser tools", () => {
  it("serializes fs_read as plain path", () => {
    expect(buildToolLabel("fs_read", { path: "src/index.ts" })).toBe("src/index.ts");
  });

  it("serializes fs_write with separator", () => {
    const label = buildToolLabel("fs_write", { path: "test.txt", content: "hello world" });
    expect(label).toBe("test.txt\n---\nhello world");
  });

  it("serializes fs_edit as JSON", () => {
    const label = buildToolLabel("fs_edit", { path: "f.ts", old_string: "a", new_string: "b" });
    const parsed = JSON.parse(label);
    expect(parsed).toEqual({ path: "f.ts", old_string: "a", new_string: "b" });
  });

  it("serializes exec_command as plain command", () => {
    expect(buildToolLabel("exec_command", { command: "ls -la" })).toBe("ls -la");
  });

  it("serializes exec_command as JSON when timeout options are provided", () => {
    const label = buildToolLabel("exec_command", {
      command: "python long_job.py",
      timeoutMs: 120000,
      maxAttempts: 4,
      maxTimeoutMs: 600000,
      timeoutMultiplier: 2,
    });
    expect(JSON.parse(label)).toEqual({
      command: "python long_job.py",
      timeoutMs: 120000,
      maxAttempts: 4,
      maxTimeoutMs: 600000,
      timeoutMultiplier: 2,
    });
  });

  it("serializes exec_command as JSON when cwd is provided", () => {
    const label = buildToolLabel("exec_command", {
      command: "py -3 scripts/doctor.py",
      cwd: "C:/skills/br-interview-workspace",
    });
    expect(JSON.parse(label)).toEqual({
      command: "py -3 scripts/doctor.py",
      cwd: "C:/skills/br-interview-workspace",
    });
  });

  // 当 command 缺失或非法时，label 必须携带 _diagnostics，
  // 让执行器可以把"模型传错参数"翻译成可读的自纠错误消息。
  it("embeds _diagnostics when exec_command is called with wrong parameter name", () => {
    const label = buildToolLabel("exec_command", { cmd: "ls -la" });
    const parsed = JSON.parse(label);
    expect(parsed.command).toBe("");
    expect(parsed._diagnostics).toEqual({
      receivedArgKeys: ["cmd"],
      commandFieldType: "undefined",
      commandIsWhitespace: false,
    });
  });

  it("embeds _diagnostics when exec_command is called with empty command string", () => {
    const label = buildToolLabel("exec_command", { command: "" });
    const parsed = JSON.parse(label);
    expect(parsed.command).toBe("");
    expect(parsed._diagnostics.receivedArgKeys).toEqual(["command"]);
    expect(parsed._diagnostics.commandFieldType).toBe("string");
    expect(parsed._diagnostics.commandIsWhitespace).toBe(false);
  });

  it("embeds _diagnostics when exec_command command is whitespace-only", () => {
    const label = buildToolLabel("exec_command", { command: "   " });
    const parsed = JSON.parse(label);
    expect(parsed._diagnostics.commandIsWhitespace).toBe(true);
  });

  it("embeds _diagnostics when exec_command command is wrong type", () => {
    const label = buildToolLabel("exec_command", { command: 42 as unknown as string });
    const parsed = JSON.parse(label);
    expect(parsed.command).toBe("");
    expect(parsed._diagnostics.commandFieldType).toBe("number");
  });

  it("does NOT embed _diagnostics when exec_command command is valid", () => {
    // 合法调用必须保留旧契约：纯字符串 label，不带任何诊断字段
    expect(buildToolLabel("exec_command", { command: "echo hi" })).toBe("echo hi");
  });

  it("serializes task_create as JSON", () => {
    const label = buildToolLabel("task_create", {
      subject: "Run tests",
      description: "Run the desktop regression suite",
      activeForm: "Running tests",
      status: "in_progress",
    });
    expect(JSON.parse(label)).toEqual({
      subject: "Run tests",
      description: "Run the desktop regression suite",
      activeForm: "Running tests",
      status: "in_progress",
    });
  });
});
