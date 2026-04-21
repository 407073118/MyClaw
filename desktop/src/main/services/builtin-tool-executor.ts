/**
 * newApp Electron 主进程使用的内置工具执行器。
 *
 * 这里实现文件、命令、Git、HTTP、技能与浏览器工具，
 * 并为 exec.command 提供梯度扩容的超时重试策略。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import type { SkillDefinition } from "@shared/contracts";
import { BrowserService } from "./browser-service";
import { PptEngine } from "./ppt/index";

export type ToolExecutionResult = {
  success: boolean;
  output: string;
  error?: string;
  imageBase64?: string;
  viewMeta?: {
    viewPath: string;
    title: string;
    data: unknown;
  };
};

type ExecCommandRequest = {
  command: string;
  cwd?: string;
  timeoutMs: number;
  timeoutMultiplier: number;
  maxAttempts: number;
  maxTimeoutMs: number;
  retryOnTimeout: boolean;
};

/**
 * 解析 exec.command 时附带的诊断信息。
 * 由 buildToolLabel 在 command 缺失时生成，用于给模型返回自纠错误消息。
 */
type ExecCommandDiagnostics = {
  /** 模型本次调用实际传入的参数键（如 ["cmd"]、["shell_command"]） */
  receivedArgKeys?: string[];
  /** args.command 的实际类型（undefined / string / number / object ...） */
  commandFieldType?: string;
  /** command 是非空字符串但去空白后为空（即只有空白字符） */
  commandIsWhitespace?: boolean;
  /** exec.command label 本身就是一个非法 JSON（JSON.parse 抛异常时设置） */
  labelParseFailed?: boolean;
  /** 原始 label 的前缀片段，用于日志排查（不返回给模型） */
  rawLabelSnippet?: string;
};

type ParsedExecCommand = {
  request: ExecCommandRequest;
  diagnostics?: ExecCommandDiagnostics;
};

type ExecSyncError = {
  code?: string | number;
  signal?: string | null;
  stdout?: string | Uint8Array | null;
  stderr?: string | Uint8Array | null;
  message?: string;
};



type ToolExecutionOptions = {
  signal?: AbortSignal;
};

type AbortSignalScope = {
  signal: AbortSignal;
  dispose: () => void;
};

const DEFAULT_EXEC_TIMEOUT_MS = 30_000;
const DEFAULT_EXEC_TIMEOUT_MULTIPLIER = 2;
const DEFAULT_EXEC_MAX_ATTEMPTS = 6;
const DEFAULT_EXEC_MAX_TIMEOUT_MS = 600_000;

const BLOCKED_SHELL_PATTERNS = [
  /\brm\s+-rf\s+\//,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/[fsq]/i,
  /\brmdir\s+\/s/i,
  />\s*\/dev\/[sh]d[a-z]/,
];

/** 解析 fs.write 使用的 path/content 载荷。 */
function parsePathAndContent(label: string): { path: string; content: string } {
  if (label.includes("\n---\n")) {
    const [path, ...rest] = label.split("\n---\n");
    return { path: path.trim(), content: rest.join("\n---\n") };
  }
  const idx = label.indexOf("::");
  if (idx > 0) {
    return { path: label.slice(0, idx).trim(), content: label.slice(idx + 2) };
  }
  throw new Error("文件写入格式错误。请使用 `<path>::<content>` 或 `<path>\\n---\\n<content>`。");
}

/** 解析 fs.search/fs.find 使用的 pattern/path 载荷。 */
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

/** 统一路径分隔符，便于做工作区边界判断。 */
function normalizeSep(p: string): string {
  return p.replace(/\\/g, "/");
}

/** 判断目标路径是否仍位于工作区根目录之内。 */
function isInsideBase(base: string, target: string): boolean {
  const normalizedBase = normalizeSep(resolve(base)).toLowerCase();
  const normalizedTarget = normalizeSep(resolve(target)).toLowerCase();
  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}/`);
}

/** 安全解析用户路径，默认不允许越出工作区。 */
function safeResolve(base: string, userPath: string, allowExternal = false): string {
  const resolved = resolve(base, userPath);
  if (!allowExternal && !isInsideBase(base, resolved)) {
    throw new Error("路径越界：当前审批模式不允许访问工作区外部路径。");
  }
  return resolved;
}

/** 校验 shell 命令是否命中高危黑名单。 */
function validateShellCommand(command: string): string | null {
  for (const pattern of BLOCKED_SHELL_PATTERNS) {
    if (pattern.test(command)) {
      return `命令被安全策略拒绝：${command}`;
    }
  }
  return null;
}

/** 将任意值收敛为合法正整数。 */
function clampPositiveInteger(value: unknown, fallback: number, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }
  return Math.max(Math.floor(parsed), minimum);
}

/** 将任意值收敛为合法正数。 */
function clampPositiveNumber(value: unknown, fallback: number, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }
  return parsed;
}

/** 解析 exec.command 输入，兼容纯命令文本与结构化 JSON，并透出诊断信息。 */
function parseExecCommandRequest(label: string): ParsedExecCommand {
  const rawLabel = label.trim();
  if (!rawLabel) {
    return {
      request: buildExecCommandRequest("", {}),
      diagnostics: { receivedArgKeys: [], commandFieldType: "undefined" },
    };
  }

  // 只有 '{' 开头的 label 才当成结构化 JSON 尝试解析；
  // 其它情况视作旧格式纯命令文本，避免把 "ls -la" 这种误判成 JSON。
  if (rawLabel.startsWith("{")) {
    try {
      const parsed = JSON.parse(rawLabel) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const commandField = parsed.command;
        const commandValue = typeof commandField === "string" ? commandField : "";
        const request = buildExecCommandRequest(commandValue, parsed);

        // 由 buildToolLabel 在 command 缺失时写入的诊断字段
        const embedded =
          parsed._diagnostics && typeof parsed._diagnostics === "object" && !Array.isArray(parsed._diagnostics)
            ? (parsed._diagnostics as Record<string, unknown>)
            : null;

        if (!request.command && embedded) {
          return {
            request,
            diagnostics: {
              receivedArgKeys: Array.isArray(embedded.receivedArgKeys)
                ? (embedded.receivedArgKeys as unknown[]).filter((k): k is string => typeof k === "string")
                : undefined,
              commandFieldType:
                typeof embedded.commandFieldType === "string" ? embedded.commandFieldType : undefined,
              commandIsWhitespace: embedded.commandIsWhitespace === true,
            },
          };
        }

        return { request };
      }
    } catch (error) {
      console.warn("[exec.command] label 解析失败，按原始文本兜底", {
        error: error instanceof Error ? error.message : String(error),
        labelSnippet: rawLabel.slice(0, 200),
      });
      return {
        request: buildExecCommandRequest("", {}),
        diagnostics: {
          labelParseFailed: true,
          rawLabelSnippet: rawLabel.slice(0, 200),
        },
      };
    }
  }

  return { request: buildExecCommandRequest(rawLabel, {}) };
}

/** 把诊断信息编译成一条让模型能自我纠错的错误消息。 */
function formatMissingCommandError(diagnostics: ExecCommandDiagnostics | undefined): string {
  const header =
    'exec_command 调用缺少必填参数 `command` (string)。正确示例：{"command": "ls -la"}。';

  if (!diagnostics) {
    return header;
  }

  const parts: string[] = [header];

  if (diagnostics.labelParseFailed) {
    parts.push(
      `上一次工具调用的 arguments 不是合法 JSON，已被忽略。请重新生成一条完整且合法的 JSON 参数，例如 {"command": "your shell command"}。`,
    );
  }

  const receivedKeys = (diagnostics.receivedArgKeys ?? []).filter((k) => !k.startsWith("_"));
  const hasCommandKey = receivedKeys.includes("command");

  if (diagnostics.commandFieldType && diagnostics.commandFieldType !== "string" && diagnostics.commandFieldType !== "undefined") {
    parts.push(
      `参数 command 的类型必须是 string，但你传入的是 ${diagnostics.commandFieldType}。请改成字符串形式。`,
    );
  }

  if (diagnostics.commandIsWhitespace) {
    parts.push("你传入的 command 去掉首尾空白后为空字符串，请提供实际要执行的 shell 命令。");
  }

  if (!hasCommandKey && receivedKeys.length > 0) {
    parts.push(
      `本次调用传入的参数键为 [${receivedKeys.join(", ")}]，其中没有 \`command\`。常见错误是写成 \`cmd\`、\`shell\`、\`command_line\`、\`script\` 等别名，请改用 \`command\`。`,
    );
  } else if (!hasCommandKey && receivedKeys.length === 0 && !diagnostics.labelParseFailed) {
    parts.push("本次调用未传入任何参数，请提供 `command` 字段。");
  }

  return parts.join(" ");
}

/** 规范化 exec.command 配置，默认会把梯度超时扩到 10 分钟上限。 */
function buildExecCommandRequest(command: string, raw: Record<string, unknown>): ExecCommandRequest {
  const initialTimeoutMs = clampPositiveInteger(raw.timeoutMs, DEFAULT_EXEC_TIMEOUT_MS, 1000);
  const maxTimeoutMs = clampPositiveInteger(
    raw.maxTimeoutMs,
    Math.max(initialTimeoutMs, DEFAULT_EXEC_MAX_TIMEOUT_MS),
    initialTimeoutMs,
  );

  return {
    command: command.trim(),
    cwd: typeof raw.cwd === "string" && raw.cwd.trim() ? raw.cwd.trim() : undefined,
    timeoutMs: Math.min(initialTimeoutMs, maxTimeoutMs),
    timeoutMultiplier: clampPositiveNumber(raw.timeoutMultiplier, DEFAULT_EXEC_TIMEOUT_MULTIPLIER, 1.1),
    maxAttempts: clampPositiveInteger(raw.maxAttempts, DEFAULT_EXEC_MAX_ATTEMPTS, 1),
    maxTimeoutMs,
    retryOnTimeout: raw.retryOnTimeout === false ? false : true,
  };
}

/** 根据梯度策略构建每次尝试的超时时间。 */
function buildExecAttemptTimeouts(request: ExecCommandRequest): number[] {
  const timeouts: number[] = [];
  let currentTimeoutMs = request.timeoutMs;

  for (let attempt = 0; attempt < request.maxAttempts; attempt++) {
    timeouts.push(currentTimeoutMs);
    if (!request.retryOnTimeout) {
      break;
    }
    currentTimeoutMs = Math.min(
      Math.max(Math.ceil(currentTimeoutMs * request.timeoutMultiplier), currentTimeoutMs),
      request.maxTimeoutMs,
    );
  }

  return timeouts;
}

/** 异步执行 shell 命令，替代 execSync 避免阻塞 Electron 主进程事件循环。 */
function execCommandAsync(
  command: string,
  options: { cwd: string; timeout: number; env: NodeJS.ProcessEnv; signal?: AbortSignal },
): Promise<{ stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
    const shellArgs = process.platform === "win32"
      ? ["/c", buildExecCommand(command)]
      : ["-c", command];

    const child = spawn(shell, shellArgs, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    let settled = false;
    const killChild = (reason: string): void => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } }, 2000);
      reject(Object.assign(new Error(reason), {
        code: "ETIMEDOUT",
        signal: "SIGTERM",
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      }));
    };

    const timer = setTimeout(() => {
      killChild(`Command timed out after ${options.timeout}ms`);
    }, options.timeout);

    // 支持外部中断（用户点击停止按钮）
    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timer);
        killChild("Command aborted by user");
        return;
      }
      options.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        killChild("Command aborted by user");
      }, { once: true });
    }

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(Object.assign(new Error(`Command failed with exit code ${code}`), {
          code: code ?? 1,
          signal,
          stdout,
          stderr,
        }));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(Object.assign(err, {
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      }));
    });
  });
}

/** 判断命令执行失败是否属于可重试的超时。 */
function isExecTimeoutError(err: unknown): boolean {
  const execErr = err as ExecSyncError | undefined;
  const message = (execErr?.message ?? "").toLowerCase();
  const code = String(execErr?.code ?? "").toUpperCase();
  const signal = String(execErr?.signal ?? "").toUpperCase();

  return (
    code === "ETIMEDOUT" ||
    message.includes("timed out") ||
    message.includes("etimedout") ||
    (signal === "SIGTERM" && message.includes("timeout"))
  );
}

/** 提取 execSync 失败时的 stdout/stderr。 */
function extractExecErrorOutput(err: unknown): string {
  const execErr = err as ExecSyncError | undefined;
  return [execErr?.stdout, execErr?.stderr].map(decodeExecText).filter(Boolean).join("\n\n").trim();
}

/** 格式化最终超时错误。 */
function formatExecTimeoutError(err: unknown, attemptedTimeouts: number[]): string {
  const execErr = err as ExecSyncError | undefined;
  const baseMessage = execErr?.message ?? String(err);
  return baseMessage + "。命令执行超时，已按梯度扩容 timeoutMs 并重试：" + attemptedTimeouts.join(" -> ");
}

/** 统一按 UTF-8 解码命令输出，避免 Windows 控制台链路误读中文。 */
function decodeExecText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder("utf-8").decode(value);
  }
  if (value == null) {
    return "";
  }
  return String(value);
}

/** 为 exec.command 构建统一环境，尽量让子进程以 UTF-8 输出。 */
function buildExecEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
  };
}

/** Windows 下先切换到 UTF-8 code page，再执行用户命令。 */
/** 组合调用方 signal 与内部超时信号，避免互相覆盖。 */
function createAbortSignalScope(timeoutMs: number, callerSignal?: AbortSignal): AbortSignalScope {
  const controller = new AbortController();
  const disposers: Array<() => void> = [];

  /** 统一触发中断，供 caller abort 和 timeout 共用。 */
  const abort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (callerSignal) {
    const onCallerAbort = (): void => {
      abort();
    };

    if (callerSignal.aborted) {
      abort();
    } else {
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      disposers.push(() => callerSignal.removeEventListener("abort", onCallerAbort));
    }
  }

  const timer = setTimeout(() => {
    abort();
  }, timeoutMs);
  disposers.push(() => clearTimeout(timer));

  return {
    signal: controller.signal,
    dispose: () => {
      while (disposers.length > 0) {
        const dispose = disposers.pop();
        dispose?.();
      }
    },
  };
}

/** Windows 下先切换到 UTF-8 code page，再执行用户命令。 */
function buildExecCommand(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }
  return `chcp 65001>nul && ${command}`;
}

/** 判断失败是否属于命令本身不存在。 */
function isExecCommandMissingError(err: unknown, output: string): boolean {
  const execErr = err as ExecSyncError | undefined;
  const merged = [execErr?.message, output].filter(Boolean).join("\n").toLowerCase();
  const code = String(execErr?.code ?? "").toUpperCase();
  return (
    code === "ENOENT" ||
    merged.includes("is not recognized as an internal or external command") ||
    merged.includes("not recognized as an internal or external command") ||
    merged.includes("command not found") ||
    merged.includes("不是内部或外部命令")
  );
}

/** Windows 下在 python 不可用时回退到 py -3。 */
function buildWindowsPythonFallbackCommand(command: string): string | null {
  if (process.platform !== "win32") {
    return null;
  }
  const trimmed = command.trim();
  if (/^py\s+-3\b/i.test(trimmed)) {
    return null;
  }
  const match = trimmed.match(/^python(?:\.exe)?\s+(.+)$/i);
  if (!match) {
    return null;
  }
  return `py -3 ${match[1]}`;
}

/** 为带 scripts/ 的技能生成更安全的执行提示。 */
function buildSkillExecutionGuidance(skillPath: string): string {
  const scriptsDir = join(skillPath, "scripts");
  const structuredCommandExample = `{"command":"py -3 scripts/<script>.py","cwd":"${skillPath}"}`;
  return [
    "## 执行提示",
    `- 技能目录：${skillPath}`,
    "- desktop 当前的 exec_command 默认在会话工作目录执行，不会自动切到技能目录。",
    `- 运行 scripts/ 下的命令前，请先切换目录：cd /d "${skillPath}"`,
    "- Windows 上如果 python 不可用，优先改用 py -3。",
    `- 推荐写法：cd /d "${skillPath}" && py -3 scripts/<script>.py`,
    `- 也可以直接执行绝对路径：py -3 "${join(scriptsDir, "<script>.py")}"`,
    `- structured input 示例：${structuredCommandExample}`,
    "",
  ].join("\n");
}

/** 搜索递归上限：已扫描目录数超过此值时提前退出，防止在超大目录树中阻塞主进程。 */
const MAX_SCAN_DIRS = 2000;

/** 递归搜索文本内容（异步，不阻塞主进程事件循环）。 */
async function searchTextInDir(base: string, pattern: string, maxResults: number, results: string[], scanned: { count: number } = { count: 0 }, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || results.length >= maxResults || scanned.count >= MAX_SCAN_DIRS) return;
  scanned.count++;

  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (signal?.aborted || results.length >= maxResults || scanned.count >= MAX_SCAN_DIRS) break;
    const fullPath = join(base, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await searchTextInDir(fullPath, pattern, maxResults, results, scanned, signal);
    } else {
      try {
        const content = await readFile(fullPath, "utf8");
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;
          if (lines[i].includes(pattern)) {
            results.push(fullPath + ":" + (i + 1) + ": " + lines[i].trim());
          }
        }
      } catch {
        // 跳过不可读文件。
      }
    }
  }
}

/** 将 glob 风格模式转成正则。 */
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
  if (!pattern.includes("/") && !pattern.includes("\\")) {
    const filename = normalized.split("/").pop() ?? "";
    return regex.test(filename);
  }
  return false;
}

/** 递归查找符合 glob 的文件（异步，不阻塞主进程事件循环）。 */
async function findFilesInDir(base: string, root: string, pattern: string, maxResults: number, results: string[], scanned: { count: number } = { count: 0 }, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || results.length >= maxResults || scanned.count >= MAX_SCAN_DIRS) return;
  scanned.count++;

  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (signal?.aborted || results.length >= maxResults || scanned.count >= MAX_SCAN_DIRS) break;
    const fullPath = join(base, entry.name);
    const relPath = normalizeSep(relative(root, fullPath));
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await findFilesInDir(fullPath, root, pattern, maxResults, results, scanned, signal);
    } else if (matchGlob(relPath, pattern)) {
      results.push(relPath);
    }
  }
}

export class BuiltinToolExecutor {
  private skills: SkillDefinition[] = [];
  private browserService = new BrowserService();
  private pptEngine = new PptEngine();
  private _allowExternalPaths = false;

  /** 更新技能列表。 */
  setSkills(skills: SkillDefinition[]): void {
    this.skills = skills;
  }

  /** 暴露共享浏览器服务，供原生 computer harness 复用同一浏览器上下文。 */
  getBrowserService(): BrowserService {
    return this.browserService;
  }

  /** 关闭浏览器与 PPT 引擎资源。 */
  async shutdown(): Promise<void> {
    await this.browserService.close();
    await this.pptEngine.shutdown();
  }

  /** 设置是否允许访问工作区外部路径。 */
  setAllowExternalPaths(allow: boolean): void {
    this._allowExternalPaths = allow;
  }

  /** 按工具 ID 执行内置工具。 */
  async execute(
    toolId: string,
    label: string,
    workingDir: string | null,
    options?: ToolExecutionOptions,
  ): Promise<ToolExecutionResult> {
    const cwd = workingDir ? resolve(workingDir) : process.cwd();

    try {
      return await this.dispatch(toolId, label, cwd, options);
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** 安全解析用户路径。 */
  private resolvePathSafe(base: string, userPath: string): string {
    return safeResolve(base, userPath, this._allowExternalPaths);
  }

  /** 判断路径是否位于工作区之外。 */
  isOutsideWorkspace(base: string, targetPath: string): boolean {
    return !isInsideBase(base, resolve(base, targetPath));
  }

  /** 分发具体工具实现。 */
  private async dispatch(
    toolId: string,
    label: string,
    cwd: string,
    options?: ToolExecutionOptions,
  ): Promise<ToolExecutionResult> {
    if (toolId === "fs.read") {
      const filePath = this.resolvePathSafe(cwd, label.trim());
      const content = await readFile(filePath, "utf8");
      const truncated = content.length > 12000 ? content.slice(0, 12000) + "\n\n...（内容已截断）" : content;
      return { success: true, output: truncated };
    }

    if (toolId === "fs.write") {
      const { path: filePath, content } = parsePathAndContent(label);
      const resolved = this.resolvePathSafe(cwd, filePath);
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, content, "utf8");
      return {
        success: true,
        output: "已写入文件：" + filePath + "（" + content.length + " 字符）",
      };
    }

    if (toolId === "fs.list") {
      const targetPath = label.trim() || ".";
      const resolved = this.resolvePathSafe(cwd, targetPath);
      const entries = await readdir(resolved, { withFileTypes: true });
      const lines = entries
        .map((entry) => (entry.isDirectory() ? "dir " : "file ") + entry.name)
        .sort((a, b) => a.localeCompare(b));
      return { success: true, output: lines.length > 0 ? lines.join("\n") : "(空目录)" };
    }

    if (toolId === "fs.search") {
      const { pattern, searchPath } = parseSearchPayload(label);
      const resolved = this.resolvePathSafe(cwd, searchPath);
      const results: string[] = [];
      await searchTextInDir(resolved, pattern, 100, results, { count: 0 }, options?.signal);
      return { success: true, output: results.length > 0 ? results.join("\n") : "(无匹配)" };
    }

    if (toolId === "fs.find") {
      const { pattern, searchPath } = parseSearchPayload(label);
      const resolved = this.resolvePathSafe(cwd, searchPath);
      const results: string[] = [];
      await findFilesInDir(resolved, resolved, pattern, 200, results, { count: 0 }, options?.signal);
      return { success: true, output: results.length > 0 ? results.join("\n") : "(无匹配文件)" };
    }

    if (toolId === "fs.edit") {
      return this.executeFileEdit(label, cwd);
    }

    if (toolId === "exec.command") {
      const { request, diagnostics } = parseExecCommandRequest(label);
      if (!request.command) {
        const selfCorrectingError = formatMissingCommandError(diagnostics);
        console.warn("[exec.command] 模型调用缺少 command 参数，已回传自纠错误", {
          diagnostics,
          labelSnippet: label.slice(0, 200),
        });
        return { success: false, output: "", error: selfCorrectingError };
      }

      const validationError = validateShellCommand(request.command);
      if (validationError) {
        return { success: false, output: "", error: validationError };
      }

      return this.executeShellCommand(request, cwd, options?.signal);
    }

    if (toolId === "git.status") {
      const target = label.trim();
      const args = ["status", "--short", "--branch", ...(target && target !== "." ? ["--", target] : [])];
      return await this.runGit(args, cwd);
    }

    if (toolId === "git.diff") {
      const target = label.trim();
      const args = target && target !== "." ? ["diff", "--stat", "--", target] : ["diff", "--stat"];
      return await this.runGit(args, cwd);
    }

    if (toolId === "git.log") {
      const count = label.trim() || "10";
      const n = Math.min(Math.max(Number.parseInt(count, 10) || 10, 1), 50);
      return await this.runGit(["log", "--oneline", "-n", String(n)], cwd);
    }

    if (toolId === "git.commit") {
      const message = label.trim();
      if (!message) {
        return { success: false, output: "", error: "请提供 commit 信息。" };
      }
      try {
        await execCommandAsync("git add -A", {
          cwd,
          timeout: 15_000,
          env: buildExecEnvironment(),
        });
      } catch {
        // 忽略暂存失败，交给 commit 结果统一反馈。
      }
      return await this.runGit(["commit", "-m", message], cwd);
    }

    if (toolId === "http.fetch") {
      return this.executeHttpFetch(label.trim(), options?.signal);
    }

    if (toolId === "web.search") {
      return this.executeWebSearch(label.trim(), options?.signal);
    }

    // ── ppt.* ─────────────────────────────────────────
    if (toolId === "ppt.themes") {
      const themes = this.pptEngine.getThemes();
      return {
        success: true,
        output: JSON.stringify(themes, null, 2),
      };
    }

    if (toolId === "ppt.generate") {
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(label);
      } catch {
        return { success: false, output: "", error: "ppt.generate 参数 JSON 格式无效" };
      }
      // 安全校验输出路径
      if (typeof input.outputPath !== "string" || !input.outputPath) {
        return { success: false, output: "", error: "缺少 outputPath 参数" };
      }
      const safePath = this.resolvePathSafe(cwd, input.outputPath as string);
      input.outputPath = safePath;
      const result = await this.pptEngine.generate(input as any);
      if (!result.success) {
        return { success: false, output: "", error: result.error };
      }
      return {
        success: true,
        output: `已生成演示文稿：${result.outputPath}（${result.slideCount} 页，可在 PowerPoint / WPS 中编辑）`,
      };
    }

    if (toolId.startsWith("skill_invoke__")) {
      return this.executeSkillInvoke(toolId, label);
    }

    if (toolId === "skill.view") {
      return this.executeSkillView(label);
    }

    if (toolId.startsWith("browser.")) {
      return this.executeBrowser(toolId, label);
    }

    return {
      success: false,
      output: "",
      error: "暂未实现的内置工具：" + toolId,
    };
  }

  /** 按梯度超时策略执行命令（异步，不阻塞主进程事件循环）。 */
  private async executeShellCommand(request: ExecCommandRequest, cwd: string, signal?: AbortSignal): Promise<ToolExecutionResult> {
    const attemptedTimeouts = buildExecAttemptTimeouts(request);
    const execCwd = request.cwd ? resolve(cwd, request.cwd) : cwd;
    let activeCommand = request.command;
    let pythonFallbackUsed = false;

    for (let index = 0; index < attemptedTimeouts.length; index++) {
      const timeoutMs = attemptedTimeouts[index];
      console.info("[exec.command] 开始执行命令", {
        command: activeCommand,
        cwd: execCwd,
        attempt: index + 1,
        totalAttempts: attemptedTimeouts.length,
        timeoutMs,
      });

      try {
        const { stdout } = await execCommandAsync(activeCommand, {
          cwd: execCwd,
          timeout: timeoutMs,
          env: buildExecEnvironment(),
          signal,
        });
        const decodedOutput = decodeExecText(stdout).trim();
        return { success: true, output: decodedOutput || "(无输出)" };
      } catch (err: unknown) {
        const output = extractExecErrorOutput(err);

        if (!isExecTimeoutError(err)) {
          const fallbackCommand = pythonFallbackUsed ? null : buildWindowsPythonFallbackCommand(activeCommand);
          if (fallbackCommand && isExecCommandMissingError(err, output)) {
            pythonFallbackUsed = true;
            activeCommand = fallbackCommand;
            console.warn("[exec.command] 检测到 python 命令不可用，改用 py -3 重试", {
              cwd: execCwd,
              originalCommand: request.command,
              fallbackCommand,
            });
            index -= 1;
            continue;
          }

          const execErr = err as ExecSyncError;
          return {
            success: false,
            output: output || "",
            error: execErr.message ?? String(err),
          };
        }

        if (index < attemptedTimeouts.length - 1) {
          console.warn("[exec.command] 命令执行超时，准备延长 timeoutMs 后重试", {
            command: activeCommand,
            cwd: execCwd,
            attempt: index + 1,
            nextTimeoutMs: attemptedTimeouts[index + 1],
          });
          continue;
        }

        console.error("[exec.command] 命令在所有重试后仍然超时", {
          command: activeCommand,
          cwd: execCwd,
          attemptedTimeouts,
        });
        return {
          success: false,
          output: output || "",
          error: formatExecTimeoutError(err, attemptedTimeouts),
        };
      }
    }

    return { success: false, output: "", error: "命令未能完成执行：" + activeCommand };
  }

  /** 处理浏览器工具分发。 */
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
        return { success: false, output: "", error: "未知浏览器操作 " + action };
    }
  }

  /** 处理局部文件编辑。 */
  private async executeFileEdit(label: string, cwd: string): Promise<ToolExecutionResult> {
    let filePath: string;
    let oldString: string;
    let newString: string;

    try {
      const parsed = JSON.parse(label);
      filePath = String(parsed.path ?? "");
      oldString = String(parsed.old_string ?? "");
      newString = String(parsed.new_string ?? "");
    } catch {
      const parts = label.split("\n---\n");
      if (parts.length < 3) {
        return { success: false, output: "", error: "fs.edit 需要 path、old_string、new_string 三个参数。" };
      }
      filePath = parts[0].trim();
      oldString = parts[1];
      newString = parts[2];
    }

    if (!filePath) {
      return { success: false, output: "", error: "缺少文件路径。" };
    }
    if (!oldString) {
      return { success: false, output: "", error: "缺少 old_string。" };
    }

    const resolved = this.resolvePathSafe(cwd, filePath);
    if (!existsSync(resolved)) {
      return { success: false, output: "", error: "文件不存在：" + filePath };
    }

    const content = await readFile(resolved, "utf8");
    const occurrences = content.split(oldString).length - 1;

    if (occurrences === 0) {
      const preview = content.length > 500 ? content.slice(0, 500) + "\n...（已截断）" : content;
      return {
        success: false,
        output: "文件内容预览：\n" + preview,
        error: "未在文件中找到要替换的字符串，请检查 old_string 是否与文件内容完全匹配。",
      };
    }

    if (occurrences > 1) {
      return {
        success: false,
        output: "找到 " + occurrences + " 处匹配",
        error: "old_string 在文件中出现了 " + occurrences + " 次，请提供更多上下文让匹配唯一。",
      };
    }

    const newContent = content.replace(oldString, newString);
    await writeFile(resolved, newContent, "utf8");

    return {
      success: true,
      output:
        "已编辑文件：" +
        filePath +
        "\n替换了 " +
        oldString.split("\n").length +
        " 行 -> " +
        newString.split("\n").length +
        " 行",
    };
  }

  /** 执行 Git 命令（异步，不阻塞主进程事件循环）。 */
  private async runGit(args: string[], cwd: string): Promise<ToolExecutionResult> {
    try {
      const { stdout } = await execCommandAsync(["git", ...args].join(" "), {
        cwd,
        timeout: 15_000,
        env: buildExecEnvironment(),
      });
      const decodedOutput = decodeExecText(stdout).trim();
      return { success: true, output: decodedOutput || "(无输出)" };
    } catch (err: unknown) {
      const output = extractExecErrorOutput(err);
      const execErr = err as ExecSyncError;
      return {
        success: false,
        output: output || "",
        error: execErr.message ?? String(err),
      };
    }
  }

  /** 发起简单 HTTP GET 请求。 */
  private async executeHttpFetch(url: string, callerSignal?: AbortSignal): Promise<ToolExecutionResult> {
    const scope = createAbortSignalScope(12_000, callerSignal);

    try {
      const response = await fetch(url, { method: "GET", signal: scope.signal });
      const body = (await response.text()).slice(0, 8000);
      const headers = [...response.headers.entries()]
        .slice(0, 20)
        .map(([k, v]) => k + ": " + v)
        .join("\n");
      const sections = ["status " + response.status, headers, body || "(无响应体)"].filter(Boolean);

      return {
        success: response.ok,
        output: sections.join("\n\n"),
        ...(response.ok ? {} : { error: "HTTP " + response.status }),
      };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: err instanceof Error ? err.message : "未知错误",
      };
    } finally {
      scope.dispose();
    }
  }

  /** 使用 DuckDuckGo HTML 页面做简单搜索。 */
  private async executeWebSearch(query: string, callerSignal?: AbortSignal): Promise<ToolExecutionResult> {
    const scope = createAbortSignalScope(15_000, callerSignal);

    try {
      const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
      const response = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": "MyClaw/1.0" },
        signal: scope.signal,
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
          results.push(String(results.length + 1) + ". " + title + "\n   " + snippet);
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
      scope.dispose();
    }
  }

  /** 根据技能数据打开 HTML 面板。 */
  private executeSkillView(label: string): ToolExecutionResult {
    let args: { skill_id?: string; page?: string; data?: unknown };
    try {
      args = JSON.parse(label);
    } catch {
      return { success: false, output: "", error: "skill.view 参数解析失败，需要 JSON 格式。" };
    }

    const { skill_id, page, data } = args;
    if (!skill_id || !page) {
      return { success: false, output: "", error: "缺少 skill_id 或 page 参数。" };
    }

    const skill = this.skills.find((item) => {
      const sanitizedId = item.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      return item.id === skill_id || sanitizedId === skill_id;
    });
    if (!skill) {
      return { success: false, output: "", error: "未找到技能：" + skill_id };
    }

    const viewPath = join(skill.path, page);
    if (!existsSync(viewPath)) {
      return { success: false, output: "", error: "页面不存在：" + page + "（路径：" + viewPath + "）" };
    }

    return {
      success: true,
      output: "已打开 " + skill.name + " 的 " + page + " 面板",
      viewMeta: {
        viewPath,
        title: skill.name,
        data: data ?? {},
      },
    };
  }

  /** 读取技能内容并返回给模型。 */
  private async executeSkillInvoke(toolId: string, input: string): Promise<ToolExecutionResult> {
    const rawSkillId = toolId.replace("skill_invoke__", "");
    const skill = this.skills.find((item) => {
      const sanitizedId = item.id.replace(/[^a-zA-Z0-9_-]/g, "_");
      return sanitizedId === rawSkillId || item.id === rawSkillId;
    });

    if (!skill) {
      return { success: false, output: "", error: "未找到技能：" + rawSkillId };
    }
    if (!skill.enabled) {
      return { success: false, output: "", error: `技能 "${skill.name}" 已禁用。` };
    }

    try {
      const skillPath = skill.path;
      let content = "";

      const skillMdPath = join(skillPath, "SKILL.md");
      if (existsSync(skillMdPath)) {
        content = await readFile(skillMdPath, "utf8");
      } else if (existsSync(skillPath) && skillPath.endsWith(".json")) {
        const raw = await readFile(skillPath, "utf8");
        const manifest = JSON.parse(raw);
        content = manifest.content || manifest.description || ("Skill: " + skill.name);
        if (manifest.entrypoint) {
          const entryPath = resolve(dirname(skillPath), manifest.entrypoint);
          if (existsSync(entryPath)) {
            content += "\n\n---\n\n" + await readFile(entryPath, "utf8");
          }
        }
      } else if (existsSync(skillPath)) {
        const fileStat = await stat(skillPath);
        if (fileStat.isFile()) {
          content = await readFile(skillPath, "utf8");
        } else if (fileStat.isDirectory()) {
          for (const candidate of ["SKILL.md", "README.md", "index.md"]) {
            const candidatePath = join(skillPath, candidate);
            if (existsSync(candidatePath)) {
              content = await readFile(candidatePath, "utf8");
              break;
            }
          }
        }
      }

      if (!content) {
        return { success: false, output: "", error: "无法读取技能内容：" + skill.name + "（路径：" + skillPath + "）" };
      }

      const maxLen = 15000;
      const truncated = content.length > maxLen ? content.slice(0, maxLen) + "\n\n...（技能内容已截断）" : content;
      const header = "# 技能 " + skill.name + "\n" + (skill.description ? "> " + skill.description + "\n" : "") + "\n";
      const executionNote = skill.hasScriptsDirectory ? buildSkillExecutionGuidance(skillPath) : "";
      const userInput = input ? "\n## 用户输入\n" + input + "\n" : "";

      return {
        success: true,
        output: header + executionNote + userInput + "\n## 技能内容\n\n" + truncated,
      };
    } catch (err) {
      return {
        success: false,
        output: "",
        error: "读取技能失败：" + (err instanceof Error ? err.message : String(err)),
      };
    }
  }
}
