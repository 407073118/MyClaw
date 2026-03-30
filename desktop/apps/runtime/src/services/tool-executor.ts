import { access, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import type { ChatSession, ExecutionIntent } from "@myclaw-desktop/shared";

import { BuiltinToolExecutor } from "./builtin-tool-executor";
import { validateShellCommandInput } from "./command-validation";
import { DirectoryService } from "./directory-service";
import { executeProgram, executeShellCommand } from "./process-executor";
import { SkillManager } from "./skill-manager";

export type ToolExecutionResult = {
  ok: boolean;
  summary: string;
  output: string;
};

type McpIntentExecutor = {
  invoke: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<ToolExecutionResult>;
};

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function compactOutput(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n\n")
    .trim();
}

function parseWriteFilePayload(label: string): { path: string; content: string } {
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

  throw new Error("写入文件格式错误。请使用 `<path>::<content>` 或 `<path>\\n---\\n<content>`。");
}

function splitInvocationArgs(invocation: string): string[] {
  const matches = invocation.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) ?? [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

function resolveIntentWorkingDirectory(argumentsValue: ExecutionIntent["arguments"]): string | null {
  const cwd = argumentsValue?.cwd;
  if (typeof cwd !== "string" || !cwd.trim()) {
    return null;
  }

  return resolve(cwd);
}

function buildSkillActivationOutput(input: {
  skillName: string;
  skillDir: string;
  workingDirectory: string;
  markdown: string;
  allowedTools?: string[];
  disableModelInvocation?: boolean;
  entrypoint?: string | null;
}): string {
  const bodyPreview = input.markdown.slice(0, 4000).trim();
  return [
    `Skill activated: ${input.skillName}`,
    `baseDirectory: ${input.skillDir}`,
    `workingDirectory: ${input.workingDirectory}`,
    `allowedTools: ${(input.allowedTools ?? []).join(", ") || "(not declared)"}`,
    `disableModelInvocation: ${input.disableModelInvocation ? "true" : "false"}`,
    `entrypoint: ${input.entrypoint ?? "(not declared)"}`,
    "",
    "Instructions:",
    bodyPreview,
  ].join("\n");
}

export class ToolExecutor {
  private readonly builtinToolExecutor: BuiltinToolExecutor;

  constructor(
    private readonly workspaceRoot: string,
    private readonly directoryService: DirectoryService,
    private readonly skillManager: SkillManager,
    private readonly mcpIntentExecutor?: McpIntentExecutor,
  ) {
    this.builtinToolExecutor = new BuiltinToolExecutor(directoryService);
  }

  /** 按执行来源分发到内置工具、MCP、Skill 或命令执行器。 */
  async execute(intent: ExecutionIntent, session: ChatSession): Promise<ToolExecutionResult> {
    switch (intent.source) {
      case "builtin-tool":
        return this.executeBuiltinIntent(intent, session);
      case "shell-command":
        return this.executeShellIntent(intent);
      case "skill":
        return this.executeSkillIntent(intent);
      case "network-request":
        return this.executeNetworkIntent(intent);
      case "mcp-tool":
        return this.executeMcpIntent(intent, session);
      default:
        return {
          ok: false,
          summary: `暂不支持执行来源 ${intent.source}。`,
          output: "",
        };
    }
  }

  /** 执行内置 coding-first 工具。 */
  private async executeBuiltinIntent(
    intent: ExecutionIntent,
    session: ChatSession,
  ): Promise<ToolExecutionResult> {
    return this.builtinToolExecutor.execute(intent, session);
  }

  /** 执行原始命令行调用。 */
  private async executeShellIntent(intent: ExecutionIntent): Promise<ToolExecutionResult> {
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
      cwd: this.workspaceRoot,
    });

    if (result.timedOut) {
      return {
        ok: false,
        summary: `命令执行超时：${intent.label}`,
        output: compactOutput([result.stdout, result.stderr]),
      };
    }

    if ((result.exitCode ?? 1) !== 0) {
      return {
        ok: false,
        summary: `命令执行失败（退出码 ${result.exitCode ?? "unknown"}）：${intent.label}`,
        output: compactOutput([result.stdout, result.stderr]),
      };
    }

    return {
      ok: true,
      summary: `命令执行成功：${intent.label}`,
      output: compactOutput([result.stdout, result.stderr]) || "(无输出)",
    };
  }

  /** 执行本地 Skill 脚本或回退返回 SKILL.md 内容。 */
  private async executeSkillIntent(intent: ExecutionIntent): Promise<ToolExecutionResult> {
    await this.skillManager.initialize();
    const skill = await this.skillManager.resolveSkillByInvocation(intent.label);
    if (!skill) {
      return {
        ok: false,
        summary: `未找到 Skill：${intent.label}`,
        output: `Skills 目录：${this.skillManager.getRootPath()}`,
      };
    }

    const args = splitInvocationArgs(intent.label).slice(1);
    const skillDir = resolve(skill.path);
    const skillWorkingDirectory = resolve(skillDir, skill.workingDirectory ?? ".");
    const scriptCandidates = [
      ...(skill.entrypoint ? [skill.entrypoint] : []),
      "run.ps1",
      "run.cmd",
      "run.bat",
      "run.sh",
      "run.js",
      "run.ts",
      "run.py",
    ];

    for (const scriptName of scriptCandidates) {
      const scriptPath = resolve(skillDir, scriptName);
      if (!(await pathExists(scriptPath))) {
        continue;
      }

      let execution;
      const lowerScriptPath = scriptPath.toLowerCase();
      if (lowerScriptPath.endsWith(".ps1")) {
        execution = await executeProgram({
          command: "powershell.exe",
          args: [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            scriptPath,
            ...args,
          ],
          cwd: skillWorkingDirectory,
        });
      } else if (lowerScriptPath.endsWith(".cmd") || lowerScriptPath.endsWith(".bat")) {
        execution = await executeProgram({
          command: "cmd.exe",
          args: ["/c", scriptPath, ...args],
          cwd: skillWorkingDirectory,
        });
      } else if (lowerScriptPath.endsWith(".sh")) {
        execution = await executeProgram({
          command: "sh",
          args: [scriptPath, ...args],
          cwd: skillWorkingDirectory,
        });
      } else if (lowerScriptPath.endsWith(".js")) {
        execution = await executeProgram({
          command: "node",
          args: [scriptPath, ...args],
          cwd: skillWorkingDirectory,
        });
      } else if (lowerScriptPath.endsWith(".ts")) {
        execution = await executeProgram({
          command: "pnpm",
          args: ["exec", "tsx", scriptPath, ...args],
          cwd: skillWorkingDirectory,
        });
      } else {
        execution = await executeProgram({
          command: "python",
          args: [scriptPath, ...args],
          cwd: skillWorkingDirectory,
        });
      }

      const ok = !execution.timedOut && (execution.exitCode ?? 1) === 0;
      return {
        ok,
        summary: ok ? `Skill 执行成功：${skill.name}` : `Skill 执行失败：${skill.name}`,
        output: compactOutput([execution.stdout, execution.stderr]) || "(无输出)",
      };
    }

    const skillMarkdownPath = join(skillDir, "SKILL.md");
    if (await pathExists(skillMarkdownPath)) {
      const markdown = await readFile(skillMarkdownPath, "utf8");
      return {
        ok: true,
        summary: `Skill activated: ${skill.name}`,
        output: buildSkillActivationOutput({
          skillName: skill.name,
          skillDir,
          workingDirectory: skillWorkingDirectory,
          markdown,
          allowedTools: skill.allowedTools,
          disableModelInvocation: skill.disableModelInvocation,
          entrypoint: skill.entrypoint,
        }).slice(0, 12000),
      };
    }

    const markdownPath = join(skillDir, "SKILL.md");
    if (await pathExists(markdownPath)) {
      const markdown = await readFile(markdownPath, "utf8");
      return {
        ok: true,
        summary: `Skill ${skill.name} 无可执行脚本，已返回 SKILL.md 内容。`,
        output: markdown.slice(0, 12000),
      };
    }

    return {
      ok: false,
      summary: `Skill ${skill.name} 缺少可执行入口。`,
      output: "",
    };
  }

  /** 执行简单的 GET 网络请求。 */
  private async executeNetworkIntent(intent: ExecutionIntent): Promise<ToolExecutionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(intent.label, {
        method: "GET",
        signal: controller.signal,
      });
      const text = (await response.text()).slice(0, 8000);
      return {
        ok: response.ok,
        summary: `网络请求完成：${intent.label} (${response.status})`,
        output: text || "(无响应体)",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 兼容现有 MCP 文件工具，后续会逐步被 builtin 工具替代。 */
  private async executeMcpIntent(intent: ExecutionIntent, session: ChatSession): Promise<ToolExecutionResult> {
    if (this.mcpIntentExecutor && intent.serverId && intent.toolName) {
      return this.mcpIntentExecutor.invoke(intent.serverId, intent.toolName, intent.arguments ?? {});
    }

    const toolName = basename(intent.toolId).toLowerCase();
    const attachedDirectory = session.attachedDirectory;

    if (toolName === "read_file" || intent.toolId === "fs.read_file") {
      const content = await this.directoryService.readTextFile(intent.label, attachedDirectory);
      return {
        ok: true,
        summary: `已读取文件：${intent.label}`,
        output: content,
      };
    }

    if (toolName === "write_file" || intent.toolId === "fs.write_file") {
      const parsed = parseWriteFilePayload(intent.label);
      await this.directoryService.writeTextFile(parsed.path, parsed.content, attachedDirectory);
      return {
        ok: true,
        summary: `已写入文件：${parsed.path}`,
        output: `写入长度：${parsed.content.length} 字符`,
      };
    }

    if (toolName === "list_files" || intent.toolId === "fs.list_files") {
      const items = await this.directoryService.listDirectory(intent.label || ".", attachedDirectory);
      return {
        ok: true,
        summary: `目录列表：${intent.label || "."}`,
        output: items.join("\n"),
      };
    }

    return {
      ok: false,
      summary: `不支持的 MCP 工具：${intent.toolId}`,
      output: "",
    };
  }
}
