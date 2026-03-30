import { mkdir } from "node:fs/promises";
import { platform } from "node:os";
import { dirname, resolve } from "node:path";

import type { ChatSession, ExecutionIntent } from "@myclaw-desktop/shared";

import { getBuiltinTask } from "./builtin-task-registry";
import { validateShellCommandInput } from "./command-validation";
import { DirectoryService } from "./directory-service";
import { executeProgram, executeShellCommand, type ProcessExecutionResult } from "./process-executor";
import { applyStructuredPatch } from "./structured-patch";
import type { ToolExecutionResult } from "./tool-executor";

function parsePathAndContentPayload(label: string): { path: string; content: string } {
  if (label.includes("\n---\n")) {
    const [path, ...rest] = label.split("\n---\n");
    return { path: path.trim(), content: rest.join("\n---\n") };
  }

  const index = label.indexOf("::");
  if (index > 0) {
    return {
      path: label.slice(0, index).trim(),
      content: label.slice(index + 2),
    };
  }

  throw new Error("文件写入格式错误。请使用 `<path>::<content>` 或 `<path>\\n---\\n<content>`。");
}

function parsePathPairPayload(label: string): { from: string; to: string } {
  if (label.includes("\n---\n")) {
    const [from, ...rest] = label.split("\n---\n");
    return {
      from: from.trim(),
      to: rest.join("\n---\n").trim(),
    };
  }

  const index = label.indexOf("::");
  if (index > 0) {
    return {
      from: label.slice(0, index).trim(),
      to: label.slice(index + 2).trim(),
    };
  }

  throw new Error("路径移动格式错误。请使用 `<from>::<to>` 或 `<from>\\n---\\n<to>`。");
}

function parseSearchPayload(label: string): { pattern: string; path: string } {
  if (label.includes("\n---\n")) {
    const [pattern, ...rest] = label.split("\n---\n");
    return {
      pattern: pattern.trim(),
      path: rest.join("\n---\n").trim() || ".",
    };
  }

  const index = label.indexOf("::");
  if (index > 0) {
    return {
      pattern: label.slice(0, index).trim(),
      path: label.slice(index + 2).trim() || ".",
    };
  }

  return {
    pattern: label.trim(),
    path: ".",
  };
}

function parseArchivePayload(label: string): { archivePath: string; destinationPath: string } {
  if (label.includes("\n---\n")) {
    const [archivePath, ...rest] = label.split("\n---\n");
    return {
      archivePath: archivePath.trim(),
      destinationPath: rest.join("\n---\n").trim() || ".",
    };
  }

  const index = label.indexOf("::");
  if (index > 0) {
    return {
      archivePath: label.slice(0, index).trim(),
      destinationPath: label.slice(index + 2).trim() || ".",
    };
  }

  return {
    archivePath: label.trim(),
    destinationPath: ".",
  };
}

function compactOutput(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n\n")
    .trim();
}

function formatProcessExecutionResult(
  result: ProcessExecutionResult,
  label: string,
  successSummary: string,
): ToolExecutionResult {
  if (result.timedOut) {
    return {
      ok: false,
      summary: `执行超时：${label}`,
      output: compactOutput([result.stdout, result.stderr]),
    };
  }

  if ((result.exitCode ?? 1) !== 0) {
    return {
      ok: false,
      summary: `执行失败（退出码 ${result.exitCode ?? "unknown"}）：${label}`,
      output: compactOutput([result.stdout, result.stderr]),
    };
  }

  return {
    ok: true,
    summary: successSummary,
    output: compactOutput([result.stdout, result.stderr]) || "(无输出)",
  };
}

export class BuiltinToolExecutor {
  constructor(private readonly directoryService: DirectoryService) {}

  /** 执行 coding-first 内置工具，并统一返回可展示的摘要与输出。 */
  async execute(intent: ExecutionIntent, session: ChatSession): Promise<ToolExecutionResult> {
    const attachedDirectory = session.attachedDirectory;

    if (intent.toolId === "fs.read") {
      const content = await this.directoryService.readTextFile(intent.label, attachedDirectory);
      return {
        ok: true,
        summary: `已读取文件：${intent.label}`,
        output: content,
      };
    }

    if (intent.toolId === "fs.list") {
      const targetPath = intent.label || ".";
      const items = await this.directoryService.listDirectory(targetPath, attachedDirectory);
      return {
        ok: true,
        summary: `目录列表：${targetPath}`,
        output: items.join("\n"),
      };
    }

    if (intent.toolId === "fs.search") {
      const parsed = parseSearchPayload(intent.label);
      const matches = await this.directoryService.searchText(parsed.pattern, parsed.path, attachedDirectory);
      return {
        ok: true,
        summary: `搜索完成：${parsed.pattern}`,
        output: matches.length > 0 ? matches.join("\n") : "(无匹配)",
      };
    }

    if (intent.toolId === "fs.stat") {
      const metadata = await this.directoryService.statPath(intent.label, attachedDirectory);
      return {
        ok: true,
        summary: `文件信息：${intent.label}`,
        output: metadata,
      };
    }

    if (intent.toolId === "fs.write") {
      const parsed = parsePathAndContentPayload(intent.label);
      await this.directoryService.writeTextFile(parsed.path, parsed.content, attachedDirectory);
      return {
        ok: true,
        summary: `已写入文件：${parsed.path}`,
        output: `写入长度：${parsed.content.length} 字符`,
      };
    }

    if (intent.toolId === "fs.apply_patch") {
      const changedPaths = await applyStructuredPatch({
        patch: intent.label,
        attachedDirectory,
        directoryService: this.directoryService,
      });
      return {
        ok: true,
        summary: `已应用补丁：${changedPaths.join(", ")}`,
        output: changedPaths.join("\n"),
      };
    }

    if (intent.toolId === "fs.move") {
      const parsed = parsePathPairPayload(intent.label);
      await this.directoryService.movePath(parsed.from, parsed.to, attachedDirectory);
      return {
        ok: true,
        summary: `已移动路径：${parsed.from} -> ${parsed.to}`,
        output: parsed.to,
      };
    }

    if (intent.toolId === "fs.delete") {
      await this.directoryService.deletePath(intent.label, attachedDirectory);
      return {
        ok: true,
        summary: `已删除路径：${intent.label}`,
        output: intent.label,
      };
    }

    if (intent.toolId === "exec.command") {
      const validationError = validateShellCommandInput(intent.label);
      if (validationError) {
        return {
          ok: false,
          summary: validationError,
          output: "",
        };
      }

      const result = await executeShellCommand({
        command: intent.label,
        cwd: this.resolveCommandCwd(attachedDirectory, intent.arguments),
      });
      return formatProcessExecutionResult(result, intent.label, `命令执行成功：${intent.label}`);
    }

    if (intent.toolId === "exec.task") {
      const task = getBuiltinTask(intent.label);
      if (!task) {
        return {
          ok: false,
          summary: `未找到内置任务：${intent.label}`,
          output: "",
        };
      }

      const cwd =
        task.cwdKind === "workspace"
          ? this.directoryService.getWorkspaceRoot()
          : this.resolveCommandCwd(attachedDirectory);
      const result = await executeProgram({
        command: task.command,
        args: task.args,
        cwd,
      });
      return formatProcessExecutionResult(result, task.id, `任务执行成功：${task.id}`);
    }

    if (intent.toolId === "git.status") {
      const target = intent.label.trim();
      return this.executeGitQuery(
        ["status", "--short", "--branch", ...(target && target !== "." ? ["--", target] : [])],
        target || ".",
        attachedDirectory,
        "Git 状态已读取。",
      );
    }

    if (intent.toolId === "git.diff") {
      const target = intent.label.trim();
      return this.executeGitQuery(
        ["diff", ...(target ? ["--", target] : [])],
        target || "working tree",
        attachedDirectory,
        "Git diff 已读取。",
      );
    }

    if (intent.toolId === "git.show") {
      const target = intent.label.trim() || "HEAD";
      return this.executeGitQuery(["show", "--stat", "--oneline", target], target, attachedDirectory, `Git show 已读取：${target}`);
    }

    if (intent.toolId === "process.list") {
      return this.executeProcessList(intent.label);
    }

    if (intent.toolId === "process.kill") {
      return this.executeProcessKill(intent.label);
    }

    if (intent.toolId === "http.fetch") {
      return this.executeHttpFetch(intent.label);
    }

    if (intent.toolId === "archive.extract") {
      return this.executeArchiveExtract(intent.label, attachedDirectory);
    }

    return {
      ok: false,
      summary: `暂未实现的内置工具：${intent.toolId}`,
      output: "",
    };
  }

  /** 根据会话上下文解析命令类工具的工作目录。 */
  private resolveCommandCwd(
    attachedDirectory: string | null,
    argumentsValue?: ExecutionIntent["arguments"],
  ): string {
    const explicitCwd = argumentsValue?.cwd;
    if (typeof explicitCwd === "string" && explicitCwd.trim()) {
      return resolve(explicitCwd);
    }

    return this.directoryService.getAttachedDirectory(attachedDirectory);
  }

  /** 执行只读 Git 查询，并复用统一的结果格式化逻辑。 */
  private async executeGitQuery(
    args: string[],
    label: string,
    attachedDirectory: string | null,
    successSummary: string,
  ): Promise<ToolExecutionResult> {
    const result = await executeProgram({
      command: "git",
      args,
      cwd: this.resolveCommandCwd(attachedDirectory),
    });
    return formatProcessExecutionResult(result, `git ${label}`.trim(), successSummary);
  }

  /** 列出本机进程，并按需根据关键字过滤输出内容。 */
  private async executeProcessList(filterText: string): Promise<ToolExecutionResult> {
    const result =
      platform() === "win32"
        ? await executeProgram({
            command: "tasklist",
            args: ["/fo", "csv", "/nh"],
            cwd: this.directoryService.getWorkspaceRoot(),
          })
        : await executeProgram({
            command: "ps",
            args: ["-eo", "pid,ppid,comm"],
            cwd: this.directoryService.getWorkspaceRoot(),
          });

    const formatted = formatProcessExecutionResult(result, "process list", "进程列表已读取。");
    if (!formatted.ok) {
      return formatted;
    }

    const keyword = filterText.trim().toLowerCase();
    if (!keyword) {
      return formatted;
    }

    const lines = formatted.output
      .split(/\r?\n/)
      .filter((line) => line.toLowerCase().includes(keyword));

    return {
      ...formatted,
      output: lines.length > 0 ? lines.join("\n") : "(无匹配进程)",
    };
  }

  /** 按 pid 终止进程，默认使用强制结束以避免僵持。 */
  private async executeProcessKill(label: string): Promise<ToolExecutionResult> {
    const pid = Number.parseInt(label.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      return {
        ok: false,
        summary: `无效的进程号：${label}`,
        output: "",
      };
    }

    const result =
      platform() === "win32"
        ? await executeProgram({
            command: "taskkill",
            args: ["/pid", String(pid), "/t", "/f"],
            cwd: this.directoryService.getWorkspaceRoot(),
          })
        : await executeProgram({
            command: "kill",
            args: ["-9", String(pid)],
            cwd: this.directoryService.getWorkspaceRoot(),
          });

    return formatProcessExecutionResult(result, String(pid), `已终止进程：${pid}`);
  }

  /** 发送 GET 请求并返回状态、响应头与截断后的正文。 */
  private async executeHttpFetch(url: string): Promise<ToolExecutionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
      const body = (await response.text()).slice(0, 8000);
      const headers = [...response.headers.entries()]
        .slice(0, 20)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");

      return {
        ok: response.ok,
        summary: `HTTP 请求完成：${url} (${response.status})`,
        output: [`status ${response.status}`, headers, body || "(无响应体)"].filter(Boolean).join("\n\n"),
      };
    } catch (error) {
      return {
        ok: false,
        summary: `HTTP 请求失败：${url}`,
        output: error instanceof Error ? error.message : "未知错误",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 解压 zip 或 tar 系列归档文件到受工作区约束的目标目录。 */
  private async executeArchiveExtract(
    label: string,
    attachedDirectory: string | null,
  ): Promise<ToolExecutionResult> {
    const parsed = parseArchivePayload(label);
    const archivePath = this.directoryService.resolvePath(parsed.archivePath, attachedDirectory);
    const destinationPath = this.directoryService.resolvePath(parsed.destinationPath, attachedDirectory);
    await mkdir(dirname(destinationPath), { recursive: true });
    await mkdir(destinationPath, { recursive: true });

    const lowerPath = archivePath.toLowerCase();
    const result =
      platform() === "win32" && lowerPath.endsWith(".zip")
        ? await executeProgram({
            command: "powershell.exe",
            args: [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-Command",
              `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destinationPath}' -Force`,
            ],
            cwd: this.resolveCommandCwd(attachedDirectory),
          })
        : await executeProgram({
            command: "tar",
            args: ["-xf", archivePath, "-C", destinationPath],
            cwd: this.resolveCommandCwd(attachedDirectory),
          });

    const formatted = formatProcessExecutionResult(result, parsed.archivePath, `已解压归档：${parsed.archivePath}`);
    if (!formatted.ok) {
      return formatted;
    }

    return {
      ...formatted,
      output: destinationPath,
    };
  }
}
