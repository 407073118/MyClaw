/**
 * Builtin tool executor for the newApp Electron main process.
 *
 * Self-contained — no imports from desktop packages.
 * Implements real filesystem, shell, git, HTTP, and web-search tools.
 */

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import type { SkillDefinition } from "@shared/contracts";
import { BrowserService } from "./browser-service";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ToolExecutionResult = {
  success: boolean;
  output: string;
  error?: string;
  /** Base64-encoded image for screenshot results (JPEG). */
  imageBase64?: string;
  /** When a skill has view.html, this carries the info needed to open the WebPanel. */
  viewMeta?: {
    viewPath: string;
    title: string;
    data: unknown;
  };
};

// ---------------------------------------------------------------------------
// Argument parsing helpers  (mirrors desktop parsePathAndContentPayload etc.)
// ---------------------------------------------------------------------------

function parsePathAndContent(label: string): { path: string; content: string } {
  if (label.includes("\n---\n")) {
    const [path, ...rest] = label.split("\n---\n");
    return { path: path.trim(), content: rest.join("\n---\n") };
  }
  const idx = label.indexOf("::");
  if (idx > 0) {
    return { path: label.slice(0, idx).trim(), content: label.slice(idx + 2) };
  }
  throw new Error(
    "文件写入格式错误。请使用 `<path>::<content>` 或 `<path>\\n---\\n<content>`。",
  );
}

function parseSearchPayload(label: string): { pattern: string; searchPath: string } {
  if (label.includes("\n---\n")) {
    const [pattern, ...rest] = label.split("\n---\n");
    return { pattern: pattern.trim(), searchPath: rest.join("\n---\n").trim() || "." };
  }
  const idx = label.indexOf("::");
  if (idx > 0) {
    return {
      pattern: label.slice(0, idx).trim(),
      searchPath: label.slice(idx + 2).trim() || ".",
    };
  }
  return { pattern: label.trim(), searchPath: "." };
}

// ---------------------------------------------------------------------------
// Path safety helpers
// ---------------------------------------------------------------------------

function normalizeSep(p: string): string {
  return p.replace(/\\/g, "/");
}

function isInsideBase(base: string, target: string): boolean {
  const nb = normalizeSep(resolve(base)).toLowerCase();
  const nt = normalizeSep(resolve(target)).toLowerCase();
  return nt === nb || nt.startsWith(`${nb}/`);
}

function safeResolve(base: string, userPath: string, allowExternal = false): string {
  const resolved = resolve(base, userPath);
  if (!allowExternal && !isInsideBase(base, resolved)) {
    throw new Error(`路径越界：仅允许访问工作目录内文件。当前审批模式不允许访问外部路径，请在设置中调整审批策略。`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Shell command safety check  (mirrors desktop validateShellCommandInput)
// ---------------------------------------------------------------------------

const BLOCKED_SHELL_PATTERNS = [
  /\brm\s+-rf\s+\//,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/[fsq]/i,
  /\brmdir\s+\/s/i,
  // Redirect to /dev/sda or raw block devices
  />\s*\/dev\/[sh]d[a-z]/,
];

function validateShellCommand(command: string): string | null {
  for (const pattern of BLOCKED_SHELL_PATTERNS) {
    if (pattern.test(command)) {
      return `命令被安全策略拒绝：${command}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// fs.search implementation (recursive grep-like text search)
// ---------------------------------------------------------------------------

function searchTextInDir(
  base: string,
  pattern: string,
  maxResults: number,
  results: string[],
): void {
  if (results.length >= maxResults) return;

  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (results.length >= maxResults) break;
    const fullPath = join(base, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      searchTextInDir(fullPath, pattern, maxResults, results);
    } else {
      try {
        const content = readFileSync(fullPath, "utf8");
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;
          if (lines[i].includes(pattern)) {
            results.push(`${fullPath}:${i + 1}: ${lines[i].trim()}`);
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }
}

// ---------------------------------------------------------------------------
// fs.find implementation (glob-style file finder)
// ---------------------------------------------------------------------------

function matchGlob(relPath: string, pattern: string): boolean {
  const normalized = normalizeSep(relPath);
  const regex = new RegExp(
    "^" +
      normalizeSep(pattern)
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\x00GLOBSTAR\x00")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\x00GLOBSTAR\x00/g, ".*") +
      "$",
  );
  if (regex.test(normalized)) return true;
  // Also match just filename part if pattern has no path separator
  if (!pattern.includes("/") && !pattern.includes("\\")) {
    const filename = normalized.split("/").pop() ?? "";
    return regex.test(filename);
  }
  return false;
}

function findFilesInDir(
  base: string,
  root: string,
  pattern: string,
  maxResults: number,
  results: string[],
): void {
  if (results.length >= maxResults) return;

  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (results.length >= maxResults) break;
    const fullPath = join(base, entry.name);
    const relPath = normalizeSep(relative(root, fullPath));
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      findFilesInDir(fullPath, root, pattern, maxResults, results);
    } else {
      if (matchGlob(relPath, pattern)) {
        results.push(relPath);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main executor class
// ---------------------------------------------------------------------------

const MAX_SESSION_TASKS = 200;

export class BuiltinToolExecutor {
  private sessionTasks: Array<{ text: string; done: boolean }> = [];
  private skills: SkillDefinition[] = [];
  private browserService = new BrowserService();

  /** Update the skills list (called when skills are refreshed or session starts) */
  setSkills(skills: SkillDefinition[]): void {
    this.skills = skills;
  }

  /** Close browser on app shutdown to prevent orphaned Chrome processes. */
  async shutdown(): Promise<void> {
    await this.browserService.close();
  }

  /** Whether the current session allows access to paths outside the workspace. */
  private _allowExternalPaths = false;

  /** Set whether external path access is permitted (based on approval mode). */
  setAllowExternalPaths(allow: boolean): void {
    this._allowExternalPaths = allow;
  }

  /**
   * Execute a builtin tool by ID.
   *
   * @param toolId      The tool identifier (e.g. "fs.read", "exec.command")
   * @param label       The primary argument string (may encode multiple values)
   * @param workingDir  The current working directory for the session (may be null)
   */
  async execute(
    toolId: string,
    label: string,
    workingDir: string | null,
  ): Promise<ToolExecutionResult> {
    const cwd = workingDir ? resolve(workingDir) : process.cwd();

    try {
      return await this.dispatch(toolId, label, cwd);
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Resolve a user path, respecting the current external-path permission. */
  private resolvePathSafe(base: string, userPath: string): string {
    return safeResolve(base, userPath, this._allowExternalPaths);
  }

  /** Check whether a resolved path is outside the workspace base. */
  isOutsideWorkspace(base: string, targetPath: string): boolean {
    return !isInsideBase(base, resolve(base, targetPath));
  }

  private async dispatch(
    toolId: string,
    label: string,
    cwd: string,
  ): Promise<ToolExecutionResult> {
    // ------------------------------------------------------------------
    // fs.read
    // ------------------------------------------------------------------
    if (toolId === "fs.read") {
      const filePath = this.resolvePathSafe(cwd,label.trim());
      const content = readFileSync(filePath, "utf8");
      const truncated =
        content.length > 12000 ? `${content.slice(0, 12000)}\n\n...（内容已截断）` : content;
      return { success: true, output: truncated };
    }

    // ------------------------------------------------------------------
    // fs.write
    // ------------------------------------------------------------------
    if (toolId === "fs.write") {
      const { path: filePath, content } = parsePathAndContent(label);
      const resolved = this.resolvePathSafe(cwd,filePath);
      mkdirSync(dirname(resolved), { recursive: true });
      writeFileSync(resolved, content, "utf8");
      return {
        success: true,
        output: `已写入文件：${filePath}（${content.length} 字符）`,
      };
    }

    // ------------------------------------------------------------------
    // fs.list
    // ------------------------------------------------------------------
    if (toolId === "fs.list") {
      const targetPath = label.trim() || ".";
      const resolved = this.resolvePathSafe(cwd,targetPath);
      const entries = readdirSync(resolved, { withFileTypes: true });
      const lines = entries
        .map((e) => `${e.isDirectory() ? "dir" : "file"} ${e.name}`)
        .sort((a, b) => a.localeCompare(b));
      return {
        success: true,
        output: lines.length > 0 ? lines.join("\n") : "(空目录)",
      };
    }

    // ------------------------------------------------------------------
    // fs.search
    // ------------------------------------------------------------------
    if (toolId === "fs.search") {
      const { pattern, searchPath } = parseSearchPayload(label);
      const resolved = this.resolvePathSafe(cwd,searchPath);
      const results: string[] = [];
      searchTextInDir(resolved, pattern, 100, results);
      return {
        success: true,
        output: results.length > 0 ? results.join("\n") : "(无匹配)",
      };
    }

    // ------------------------------------------------------------------
    // fs.find
    // ------------------------------------------------------------------
    if (toolId === "fs.find") {
      const { pattern, searchPath } = parseSearchPayload(label);
      const resolved = this.resolvePathSafe(cwd,searchPath);
      const results: string[] = [];
      findFilesInDir(resolved, resolved, pattern, 200, results);
      return {
        success: true,
        output: results.length > 0 ? results.join("\n") : "(无匹配文件)",
      };
    }

    // ------------------------------------------------------------------
    // exec.command
    // ------------------------------------------------------------------
    if (toolId === "exec.command") {
      const command = label.trim();
      const validationError = validateShellCommand(command);
      if (validationError) {
        return { success: false, output: "", error: validationError };
      }

      try {
        const stdout = execSync(command, {
          cwd,
          timeout: 30_000,
          encoding: "utf8",
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return { success: true, output: stdout || "(无输出)" };
      } catch (err: unknown) {
        const execErr = err as { stdout?: string; stderr?: string; message?: string };
        const output = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n\n").trim();
        return {
          success: false,
          output: output || "",
          error: execErr.message ?? String(err),
        };
      }
    }

    // ------------------------------------------------------------------
    // git.status
    // ------------------------------------------------------------------
    if (toolId === "git.status") {
      const target = label.trim();
      const args = ["status", "--short", "--branch", ...(target && target !== "." ? ["--", target] : [])];
      return this.runGit(args, cwd);
    }

    // ------------------------------------------------------------------
    // http.fetch
    // ------------------------------------------------------------------
    if (toolId === "http.fetch") {
      return this.executeHttpFetch(label.trim());
    }

    // ------------------------------------------------------------------
    // web.search
    // ------------------------------------------------------------------
    if (toolId === "web.search") {
      return this.executeWebSearch(label.trim());
    }

    // ------------------------------------------------------------------
    // fs.edit  (FileEditTool — partial string replacement, like claude-code)
    // ------------------------------------------------------------------
    if (toolId === "fs.edit") {
      return this.executeFileEdit(label, cwd);
    }

    // ------------------------------------------------------------------
    // git.diff
    // ------------------------------------------------------------------
    if (toolId === "git.diff") {
      const target = label.trim();
      const args = target && target !== "."
        ? ["diff", "--stat", "--", target]
        : ["diff", "--stat"];
      return this.runGit(args, cwd);
    }

    // ------------------------------------------------------------------
    // git.log
    // ------------------------------------------------------------------
    if (toolId === "git.log") {
      const count = label.trim() || "10";
      const n = Math.min(Math.max(Number.parseInt(count, 10) || 10, 1), 50);
      return this.runGit(["log", `--oneline`, `-n`, `${n}`], cwd);
    }

    // ------------------------------------------------------------------
    // git.commit
    // ------------------------------------------------------------------
    if (toolId === "git.commit") {
      const message = label.trim();
      if (!message) {
        return { success: false, output: "", error: "请提供 commit 信息。" };
      }
      // Stage all changes first, then commit
      try {
        execSync("git add -A", { cwd, timeout: 15_000, encoding: "utf8", windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      } catch { /* ignore staging errors */ }
      return this.runGit(["commit", "-m", message], cwd);
    }

    // ------------------------------------------------------------------
    // skill_invoke__* (SkillTool — read and return skill content, NO panel)
    // ------------------------------------------------------------------
    if (toolId.startsWith("skill_invoke__")) {
      return this.executeSkillInvoke(toolId, label, cwd);
    }

    // ------------------------------------------------------------------
    // skill.view — model opens an HTML panel with data it provides
    // ------------------------------------------------------------------
    if (toolId === "skill.view") {
      return this.executeSkillView(label);
    }

    // ------------------------------------------------------------------
    // task.manage
    // ------------------------------------------------------------------
    if (toolId === "task.manage") {
      return this.executeTaskManage(label);
    }

    // ------------------------------------------------------------------
    // browser.* — 浏览器自动化工具组
    // ------------------------------------------------------------------
    if (toolId.startsWith("browser.")) {
      return this.executeBrowser(toolId, label);
    }

    return {
      success: false,
      output: "",
      error: `暂未实现的内置工具：${toolId}`,
    };
  }

  // --------------------------------------------------------------------------
  // browser.* — dispatch to BrowserService
  // --------------------------------------------------------------------------

  private async executeBrowser(toolId: string, label: string): Promise<ToolExecutionResult> {
    let args: Record<string, unknown>;
    try {
      args = label.trim() ? JSON.parse(label) : {};
    } catch {
      args = { value: label.trim() };
    }

    const action = toolId.slice("browser.".length);

    switch (action) {
      case "open":
        return this.browserService.open(String(args.url ?? ""));
      case "snapshot":
        return this.browserService.snapshot(args.selector ? String(args.selector) : undefined);
      case "click":
        return this.browserService.click(String(args.selector ?? ""));
      case "type":
        return this.browserService.type(
          String(args.selector ?? ""),
          String(args.text ?? ""),
          Boolean(args.pressEnter),
        );
      case "screenshot":
        return this.browserService.screenshot(Boolean(args.fullPage));
      case "evaluate":
        return this.browserService.evaluate(String(args.expression ?? ""));
      case "select":
        return this.browserService.select(
          String(args.selector ?? ""),
          Array.isArray(args.values) ? args.values.map(String) : [],
        );
      case "hover":
        return this.browserService.hover(String(args.selector ?? ""));
      case "back":
        return this.browserService.back();
      case "forward":
        return this.browserService.forward();
      case "wait":
        return this.browserService.wait(Number(args.milliseconds ?? 1000));
      case "scroll":
        return this.browserService.scroll(
          (args.direction as "up" | "down" | "left" | "right") ?? "down",
          Number(args.amount ?? 3),
          args.selector ? String(args.selector) : undefined,
        );
      case "press_key":
        return this.browserService.pressKey(String(args.key ?? ""));
      default:
        return { success: false, output: "", error: `未知浏览器操作: ${action}` };
    }
  }

  // --------------------------------------------------------------------------
  // fs.edit — partial file edit (string replacement, like claude-code FileEditTool)
  // --------------------------------------------------------------------------

  private executeFileEdit(label: string, cwd: string): ToolExecutionResult {
    // Parse structured args from JSON (when called via function calling)
    // or from label format: path\n---\nold_string\n---\nnew_string
    let filePath: string;
    let oldString: string;
    let newString: string;

    try {
      const parsed = JSON.parse(label);
      filePath = String(parsed.path ?? "");
      oldString = String(parsed.old_string ?? "");
      newString = String(parsed.new_string ?? "");
    } catch {
      // Fallback to delimiter format
      const parts = label.split("\n---\n");
      if (parts.length < 3) {
        return {
          success: false,
          output: "",
          error: "fs.edit 需要 path, old_string, new_string 三个参数。",
        };
      }
      filePath = parts[0].trim();
      oldString = parts[1];
      newString = parts[2];
    }

    if (!filePath) {
      return { success: false, output: "", error: "缺少文件路径。" };
    }
    if (!oldString) {
      return { success: false, output: "", error: "缺少要替换的原始字符串（old_string）。" };
    }

    const resolved = this.resolvePathSafe(cwd,filePath);

    if (!existsSync(resolved)) {
      return { success: false, output: "", error: `文件不存在：${filePath}` };
    }

    const content = readFileSync(resolved, "utf8");

    // Check old_string exists in file
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) {
      // Show a snippet of the file to help the model understand the current content
      const preview = content.length > 500 ? content.slice(0, 500) + "\n...（已截断）" : content;
      return {
        success: false,
        output: `文件内容预览:\n${preview}`,
        error: `未在文件中找到要替换的字符串。请检查 old_string 是否与文件内容完全匹配（包括空格和换行）。`,
      };
    }

    if (occurrences > 1) {
      return {
        success: false,
        output: `找到 ${occurrences} 处匹配`,
        error: `old_string 在文件中出现了 ${occurrences} 次，请提供更多上下文使其唯一。`,
      };
    }

    // Perform the replacement (exactly 1 occurrence)
    const newContent = content.replace(oldString, newString);
    writeFileSync(resolved, newContent, "utf8");

    return {
      success: true,
      output: `已编辑文件：${filePath}\n替换了 ${oldString.split("\n").length} 行 → ${newString.split("\n").length} 行`,
    };
  }

  // --------------------------------------------------------------------------
  // git helper
  // --------------------------------------------------------------------------

  private runGit(args: string[], cwd: string): ToolExecutionResult {
    try {
      const stdout = execSync(["git", ...args].join(" "), {
        cwd,
        timeout: 15_000,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { success: true, output: stdout || "(无输出)" };
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      const output = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n\n").trim();
      return {
        success: false,
        output: output || "",
        error: execErr.message ?? String(err),
      };
    }
  }

  // --------------------------------------------------------------------------
  // http.fetch
  // --------------------------------------------------------------------------

  private async executeHttpFetch(url: string): Promise<ToolExecutionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
      const body = (await response.text()).slice(0, 8000);
      const headers = [...response.headers.entries()]
        .slice(0, 20)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");

      const sections = [`status ${response.status}`, headers, body || "(无响应体)"].filter(Boolean);

      return {
        success: response.ok,
        output: sections.join("\n\n"),
        ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
      };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : "未知错误",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // --------------------------------------------------------------------------
  // web.search  (DuckDuckGo HTML)
  // --------------------------------------------------------------------------

  private async executeWebSearch(query: string): Promise<ToolExecutionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": "MyClaw/1.0" },
        signal: controller.signal,
      });
      const html = await response.text();

      const results: string[] = [];
      const snippetRegex =
        /<a[^>]+class="result__a"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
      let match: RegExpExecArray | null;
      while ((match = snippetRegex.exec(html)) !== null && results.length < 8) {
        const title = match[1].replace(/<[^>]+>/g, "").trim();
        const snippet = match[2].replace(/<[^>]+>/g, "").trim();
        if (title || snippet) {
          results.push(`${results.length + 1}. ${title}\n   ${snippet}`);
        }
      }

      return {
        success: true,
        output: results.length > 0 ? results.join("\n\n") : "(无搜索结果)",
      };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : "未知错误",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // --------------------------------------------------------------------------
  // task.manage  (in-memory task list)
  // --------------------------------------------------------------------------

  private executeTaskManage(label: string): ToolExecutionResult {
    const parts = label.trim().split(/\s+/);
    const action = parts[0] || "list";
    const text = parts.slice(1).join(" ");

    if (action === "add") {
      if (!text) {
        return { success: false, output: "", error: "请提供任务描述。" };
      }
      if (this.sessionTasks.length >= MAX_SESSION_TASKS) {
        // Remove oldest completed tasks first, then oldest overall
        const doneIdx = this.sessionTasks.findIndex(t => t.done);
        if (doneIdx >= 0) {
          this.sessionTasks.splice(doneIdx, 1);
        } else {
          this.sessionTasks.shift();
        }
      }
      this.sessionTasks.push({ text, done: false });
      return {
        success: true,
        output: `已添加任务 #${this.sessionTasks.length}：${text}\n\n${this.formatTasks()}`,
      };
    }

    if (action === "done") {
      const index = Number.parseInt(text, 10) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= this.sessionTasks.length) {
        return { success: false, output: this.formatTasks(), error: `无效的任务编号：${text}` };
      }
      this.sessionTasks[index].done = true;
      return {
        success: true,
        output: `已完成任务 #${index + 1}\n\n${this.formatTasks()}`,
      };
    }

    if (action === "clear") {
      this.sessionTasks = [];
      return { success: true, output: "任务列表已清空。" };
    }

    // default: list
    return {
      success: true,
      output: this.formatTasks() || "(空)",
    };
  }

  // --------------------------------------------------------------------------
  // skill.view — open an HTML panel with model-provided data
  // --------------------------------------------------------------------------

  private executeSkillView(label: string): ToolExecutionResult {
    let args: { skill_id?: string; page?: string; data?: unknown };
    try {
      args = JSON.parse(label);
    } catch {
      return { success: false, output: "", error: "skill_view 参数解析失败，需要 JSON 格式" };
    }

    const { skill_id, page, data } = args;
    if (!skill_id || !page) {
      return { success: false, output: "", error: "缺少 skill_id 或 page 参数" };
    }

    const skill = this.skills.find((s) => {
      const sanitizedId = s.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      return s.id === skill_id || sanitizedId === skill_id;
    });

    if (!skill) {
      return { success: false, output: "", error: `未找到技能：${skill_id}` };
    }

    const viewPath = join(skill.path, page);
    if (!existsSync(viewPath)) {
      return { success: false, output: "", error: `页面不存在：${page}（路径：${viewPath}）` };
    }

    return {
      success: true,
      output: `已打开 ${skill.name} 的 ${page} 面板`,
      viewMeta: {
        viewPath,
        title: skill.name,
        data: data ?? {},
      },
    };
  }

  // --------------------------------------------------------------------------
  // skill_invoke — read skill content and return to model (NO panel)
  // --------------------------------------------------------------------------

  private executeSkillInvoke(toolId: string, input: string, cwd: string): ToolExecutionResult {
    const rawSkillId = toolId.replace("skill_invoke__", "");

    // Find the skill by matching the sanitized ID
    const skill = this.skills.find((s) => {
      const sanitizedId = s.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      return sanitizedId === rawSkillId || s.id === rawSkillId;
    });

    if (!skill) {
      return {
        success: false,
        output: "",
        error: `未找到技能：${rawSkillId}`,
      };
    }

    if (!skill.enabled) {
      return {
        success: false,
        output: "",
        error: `技能 "${skill.name}" 已禁用。`,
      };
    }

    // Read the skill content
    try {
      const skillPath = skill.path;
      let content = "";

      // Try SKILL.md first (directory format)
      const skillMdPath = join(skillPath, "SKILL.md");
      if (existsSync(skillMdPath)) {
        content = readFileSync(skillMdPath, "utf8");
      } else if (existsSync(skillPath) && skillPath.endsWith(".json")) {
        // JSON manifest format
        const raw = readFileSync(skillPath, "utf8");
        const manifest = JSON.parse(raw);
        content = manifest.content || manifest.description || `Skill: ${skill.name}`;

        // If there's an entrypoint, read that too
        if (manifest.entrypoint) {
          const entryPath = resolve(dirname(skillPath), manifest.entrypoint);
          if (existsSync(entryPath)) {
            content += "\n\n---\n\n" + readFileSync(entryPath, "utf8");
          }
        }
      } else if (existsSync(skillPath)) {
        const stat = statSync(skillPath);
        if (stat.isFile()) {
          content = readFileSync(skillPath, "utf8");
        } else if (stat.isDirectory()) {
          for (const candidate of ["SKILL.md", "README.md", "index.md"]) {
            const candidatePath = join(skillPath, candidate);
            if (existsSync(candidatePath)) {
              content = readFileSync(candidatePath, "utf8");
              break;
            }
          }
        }
      }

      if (!content) {
        return {
          success: false,
          output: "",
          error: `无法读取技能内容：${skill.name}（路径：${skillPath}）`,
        };
      }

      // Truncate if too long
      const maxLen = 15000;
      const truncated = content.length > maxLen
        ? content.slice(0, maxLen) + "\n\n...（技能内容已截断）"
        : content;

      const header = `# 技能: ${skill.name}\n${skill.description ? `> ${skill.description}\n` : ""}\n`;
      const userInput = input ? `\n## 用户输入\n${input}\n` : "";

      const result: ToolExecutionResult = {
        success: true,
        output: `${header}${userInput}\n## 技能内容\n\n${truncated}`,
      };

      // Note: skill_invoke does NOT open HTML panels.
      // The model should call skill_view separately after completing work.

      return result;
    } catch (err) {
      return {
        success: false,
        output: "",
        error: `读取技能失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private formatTasks(): string {
    return this.sessionTasks
      .map((t, i) => `${i + 1}. [${t.done ? "x" : " "}] ${t.text}`)
      .join("\n");
  }
}
