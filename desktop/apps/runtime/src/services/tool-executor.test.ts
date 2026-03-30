import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ToolRiskCategory, type ChatSession, type ExecutionIntent } from "@myclaw-desktop/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DirectoryService } from "./directory-service";
import { SkillManager } from "./skill-manager";
import { ToolExecutor } from "./tool-executor";

function createSession(attachedDirectory: string | null): ChatSession {
  return {
    id: "session-default",
    title: "Session",
    modelProfileId: "model-default",
    attachedDirectory,
    createdAt: "2026-03-17T00:00:00.000Z",
    messages: [],
  };
}

function createIntent(toolId: string, label: string, risk: ToolRiskCategory): ExecutionIntent {
  return {
    source: "builtin-tool",
    toolId,
    label,
    risk,
    detail: `Run ${toolId}`,
  };
}

function createSkillIntent(label: string): ExecutionIntent {
  return {
    source: "skill",
    toolId: `skill.${label}`,
    label,
    risk: ToolRiskCategory.Exec,
    detail: `Run skill ${label}`,
  };
}

function initializeGitRepository(repoRoot: string) {
  execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "MyClaw Test"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "myclaw@example.com"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  execFileSync("git", ["add", "."], { cwd: repoRoot, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial commit"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
}

function normalizePathForAssertion(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function createZipArchive(sourcePath: string, destinationPath: string) {
  execFileSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Compress-Archive -Path '${sourcePath}' -DestinationPath '${destinationPath}' -Force`,
    ],
    { stdio: "ignore" },
  );
}

async function waitForChildExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
}

describe("tool executor builtin tools", () => {
  let tempDir: string;
  let workspaceRoot: string;
  let attachedDirectory: string;
  let executor: ToolExecutor;
  let localServer: Server | undefined;
  let spawnedChild: ChildProcessWithoutNullStreams | undefined;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "myclaw-tool-executor-"));
    workspaceRoot = join(tempDir, "workspace");
    attachedDirectory = join(workspaceRoot, "project");

    await mkdir(join(attachedDirectory, "src"), { recursive: true });
    await writeFile(join(attachedDirectory, "README.md"), "# Demo\nhello builtin tools\n", "utf8");
    await writeFile(join(attachedDirectory, "src", "index.ts"), "export const value = 'hello';\n", "utf8");

    executor = new ToolExecutor(
      workspaceRoot,
      new DirectoryService(workspaceRoot),
      new SkillManager(join(workspaceRoot, "skills")),
    );
  });

  afterEach(() => {
    localServer?.close();
    if (spawnedChild && spawnedChild.exitCode === null) {
      spawnedChild.kill();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads files through the builtin fs.read tool", async () => {
    const result = await executor.execute(
      createIntent("fs.read", "README.md", ToolRiskCategory.Read),
      createSession(attachedDirectory),
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("README.md");
    expect(result.output).toContain("hello builtin tools");
  });

  it("lists files through the builtin fs.list tool", async () => {
    const result = await executor.execute(
      createIntent("fs.list", ".", ToolRiskCategory.Read),
      createSession(attachedDirectory),
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("file README.md");
    expect(result.output).toContain("dir src");
  });

  it("searches file contents and inspects file metadata through builtin fs tools", async () => {
    const searchResult = await executor.execute(
      createIntent("fs.search", "hello\n---\n.", ToolRiskCategory.Read),
      createSession(attachedDirectory),
    );
    const statResult = await executor.execute(
      createIntent("fs.stat", "src/index.ts", ToolRiskCategory.Read),
      createSession(attachedDirectory),
    );

    expect(searchResult.ok).toBe(true);
    expect(searchResult.output).toContain("README.md");
    expect(searchResult.output).toContain("src/index.ts");
    expect(statResult.ok).toBe(true);
    expect(statResult.output).toContain("index.ts");
    expect(statResult.output).toContain("file");
  });

  it("writes files through the builtin fs.write tool", async () => {
    const result = await executor.execute(
      createIntent("fs.write", "notes/todo.txt\n---\nship builtin tools", ToolRiskCategory.Write),
      createSession(attachedDirectory),
    );
    const verify = await executor.execute(
      createIntent("fs.read", "notes/todo.txt", ToolRiskCategory.Read),
      createSession(attachedDirectory),
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("todo.txt");
    expect(verify.output).toContain("ship builtin tools");
  });

  it("applies structured patches through the builtin fs.apply_patch tool", async () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: README.md",
      "@@",
      "-# Demo",
      "-hello builtin tools",
      "+# Demo",
      "+hello patched builtin tools",
      "*** End Patch",
    ].join("\n");

    const result = await executor.execute(
      createIntent("fs.apply_patch", patch, ToolRiskCategory.Write),
      createSession(attachedDirectory),
    );
    const verify = await executor.execute(
      createIntent("fs.read", "README.md", ToolRiskCategory.Read),
      createSession(attachedDirectory),
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("README.md");
    expect(verify.output).toContain("hello patched builtin tools");
  });

  it("inspects git state through builtin git tools", async () => {
    initializeGitRepository(attachedDirectory);
    await writeFile(join(attachedDirectory, "README.md"), "# Demo\nhello git builtin tools\n", "utf8");

    const statusResult = await executor.execute(
      createIntent("git.status", ".", ToolRiskCategory.Read),
      createSession(attachedDirectory),
    );
    const diffResult = await executor.execute(
      createIntent("git.diff", "README.md", ToolRiskCategory.Read),
      createSession(attachedDirectory),
    );
    const showResult = await executor.execute(
      createIntent("git.show", "HEAD", ToolRiskCategory.Read),
      createSession(attachedDirectory),
    );

    expect(statusResult.ok).toBe(true);
    expect(statusResult.output).toContain("README.md");
    expect(diffResult.ok).toBe(true);
    expect(diffResult.output).toContain("hello git builtin tools");
    expect(showResult.ok).toBe(true);
    expect(showResult.output).toContain("initial commit");
  }, 30000);

  it("runs builtin exec.command and process.list tools", async () => {
    const commandResult = await executor.execute(
      createIntent("exec.command", "Write-Output builtin-exec-ok", ToolRiskCategory.Exec),
      createSession(attachedDirectory),
    );
    const processResult = await executor.execute(
      createIntent("process.list", "", ToolRiskCategory.Read),
      createSession(attachedDirectory),
    );

    expect(commandResult.ok).toBe(true);
    expect(commandResult.output).toContain("builtin-exec-ok");
    expect(processResult.ok).toBe(true);
    expect(processResult.output.split(/\r?\n/).length).toBeGreaterThan(0);
  }, 60000);

  it("preserves unicode names in builtin exec.command output", async () => {
    await mkdir(join(attachedDirectory, "中文目录"), { recursive: true });
    await writeFile(join(attachedDirectory, "审批记录.txt"), "unicode payload", "utf8");

    const result = await executor.execute(
      createIntent(
        "exec.command",
        "Get-ChildItem . | Select-Object -ExpandProperty Name",
        ToolRiskCategory.Exec,
      ),
      createSession(attachedDirectory),
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("中文目录");
    expect(result.output).toContain("审批记录.txt");
  }, 30000);

  it("rejects natural-language command payloads before spawning a shell", async () => {
    const shellIntent: ExecutionIntent = {
      source: "shell-command",
      toolId: "shell.command",
      label: "帮我查一下e盘的文件列表",
      risk: ToolRiskCategory.Exec,
      detail: "Run shell command",
    };

    const builtinIntent: ExecutionIntent = {
      source: "builtin-tool",
      toolId: "exec.command",
      label: "帮我查一下e盘的文件列表",
      risk: ToolRiskCategory.Exec,
      detail: "Run builtin exec command",
    };

    const shellResult = await executor.execute(shellIntent, createSession(attachedDirectory));
    const builtinResult = await executor.execute(builtinIntent, createSession(attachedDirectory));

    expect(shellResult.ok).toBe(false);
    expect(shellResult.summary).toContain("not executable shell syntax");
    expect(shellResult.summary).toContain("Get-ChildItem E:\\");
    expect(builtinResult.ok).toBe(false);
    expect(builtinResult.summary).toContain("not executable shell syntax");
  });

  it("moves and deletes files through builtin fs tools", async () => {
    const moveResult = await executor.execute(
      createIntent("fs.move", "README.md\n---\ndocs/guide.md", ToolRiskCategory.Write),
      createSession(attachedDirectory),
    );
    const readMoved = await executor.execute(
      createIntent("fs.read", "docs/guide.md", ToolRiskCategory.Read),
      createSession(attachedDirectory),
    );
    const deleteResult = await executor.execute(
      createIntent("fs.delete", "docs/guide.md", ToolRiskCategory.Write),
      createSession(attachedDirectory),
    );
    const listResult = await executor.execute(
      createIntent("fs.list", "docs", ToolRiskCategory.Read),
      createSession(attachedDirectory),
    );

    expect(moveResult.ok).toBe(true);
    expect(readMoved.output).toContain("hello builtin tools");
    expect(deleteResult.ok).toBe(true);
    expect(listResult.output).not.toContain("guide.md");
  });

  it("extracts archives through the builtin archive.extract tool", async () => {
    await writeFile(join(attachedDirectory, "archive-source.txt"), "archive payload", "utf8");
    createZipArchive(join(attachedDirectory, "archive-source.txt"), join(attachedDirectory, "bundle.zip"));

    const extractResult = await executor.execute(
      createIntent("archive.extract", "bundle.zip\n---\nextracted", ToolRiskCategory.Write),
      createSession(attachedDirectory),
    );
    const verify = await executor.execute(
      createIntent("fs.read", "extracted/archive-source.txt", ToolRiskCategory.Read),
      createSession(attachedDirectory),
    );

    expect(extractResult.ok).toBe(true);
    expect(extractResult.output).toContain("extracted");
    expect(verify.output).toContain("archive payload");
  }, 30000);

  it("runs preset tasks, fetches URLs, and kills processes through builtin tools", async () => {
    localServer = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(`fetched ${request.url}`);
    });
    await new Promise<void>((resolve) => {
      localServer!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = localServer.address();
    const baseUrl = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";

    spawnedChild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: attachedDirectory,
      stdio: "pipe",
      windowsHide: true,
    });

    const taskResult = await executor.execute(
      createIntent("exec.task", "workspace.print-working-directory", ToolRiskCategory.Exec),
      createSession(attachedDirectory),
    );
    const fetchResult = await executor.execute(
      createIntent("http.fetch", `${baseUrl}/health`, ToolRiskCategory.Network),
      createSession(attachedDirectory),
    );
    const killResult = await executor.execute(
      createIntent("process.kill", String(spawnedChild.pid), ToolRiskCategory.Exec),
      createSession(attachedDirectory),
    );
    await waitForChildExit(spawnedChild);

    expect(taskResult.ok).toBe(true);
    expect(normalizePathForAssertion(taskResult.output)).toContain("/workspace/project");
    expect(fetchResult.ok).toBe(true);
    expect(fetchResult.output).toContain("fetched /health");
    expect(killResult.ok).toBe(true);
  }, 45000);

  it("routes MCP tool intents through the injected MCP executor", async () => {
    const mcpExecutor = {
      invoke: async (serverId: string, toolName: string, args: Record<string, unknown>) => {
        expect(serverId).toBe("mcp-filesystem");
        expect(toolName).toBe("read_file");
        expect(args).toEqual({ path: "README.md" });
        return {
          ok: true,
          summary: "MCP read completed",
          output: "# README\nfrom MCP",
        };
      },
    };
    executor = new ToolExecutor(
      workspaceRoot,
      new DirectoryService(workspaceRoot),
      new SkillManager(join(workspaceRoot, "skills")),
      mcpExecutor,
    );

    const result = await executor.execute(
      {
        source: "mcp-tool",
        toolId: "mcp-filesystem:read_file",
        label: "read_file",
        risk: ToolRiskCategory.Read,
        detail: "Run MCP read_file",
        serverId: "mcp-filesystem",
        toolName: "read_file",
        arguments: {
          path: "README.md",
        },
      },
      createSession(attachedDirectory),
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("MCP read completed");
    expect(result.output).toContain("from MCP");
  });

  it("returns structured activation details for standard skills without a run entrypoint", async () => {
    const skillsRoot = join(tempDir, ".myClaw", "skills");
    const skillPath = join(skillsRoot, "br-interview-workspace");
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      [
        "---",
        "name: br-interview-workspace",
        "description: Interview workflow skill.",
        "allowed-tools:",
        "  - exec_command",
        "  - fs_read",
        "disable-model-invocation: true",
        "working-directory: scripts",
        "---",
        "",
        "# br-interview-workspace",
        "",
        "Use this skill to manage interview workflows.",
      ].join("\n"),
      "utf8",
    );

    executor = new ToolExecutor(workspaceRoot, new DirectoryService(workspaceRoot), new SkillManager(skillsRoot));

    const result = await executor.execute(createSkillIntent("br-interview-workspace"), createSession(attachedDirectory));

    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Skill activated");
    expect(result.output).toContain("br-interview-workspace");
    expect(normalizePathForAssertion(result.output)).toContain(normalizePathForAssertion(skillPath));
    expect(result.output).toContain("exec_command");
    expect(result.output).toContain("disableModelInvocation: true");
  });

  it("runs exec.command inside an explicit cwd from intent arguments", async () => {
    const skillPath = join(tempDir, ".myClaw", "skills", "cwd-skill");
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "cwd.txt"), "skill cwd", "utf8");

    const result = await executor.execute(
      {
        source: "builtin-tool",
        toolId: "exec.command",
        label: "Get-ChildItem . | Select-Object -ExpandProperty Name",
        risk: ToolRiskCategory.Exec,
        detail: "Run exec.command in custom cwd",
        arguments: {
          cwd: skillPath,
        },
      },
      createSession(attachedDirectory),
    );

    expect(result.ok).toBe(true);
    expect(result.output).toContain("cwd.txt");
  }, 30000);
});
