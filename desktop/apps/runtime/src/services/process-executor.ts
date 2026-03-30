import { spawn } from "node:child_process";
import { platform } from "node:os";

export type ProcessExecutionResult = {
  commandLine: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

function appendChunk(target: Buffer, chunk: Buffer, maxLength: number): Buffer {
  if (target.length >= maxLength) {
    return target;
  }

  const remaining = maxLength - target.length;
  const chunkToAppend = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
  return Buffer.concat([target, chunkToAppend]);
}

export async function executeProgram(input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
  maxOutputChars?: number;
}): Promise<ProcessExecutionResult> {
  const timeoutMs = input.timeoutMs ?? 120000;
  const maxOutputChars = input.maxOutputChars ?? 20000;
  const commandLine = [input.command, ...input.args].join(" ");

  return new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: process.env.PYTHONUTF8 ?? "1",
        PYTHONIOENCODING: process.env.PYTHONIOENCODING ?? "utf-8",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout: any = Buffer.alloc(0);
    let stderr: any = Buffer.alloc(0);
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: any) => {
      stdout = appendChunk(stdout, chunk, maxOutputChars);
    });

    child.stderr.on("data", (chunk: any) => {
      stderr = appendChunk(stderr, chunk, maxOutputChars);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        commandLine,
        exitCode: code,
        timedOut,
        stdout: stdout.toString("utf8").trim(),
        stderr: stderr.toString("utf8").trim(),
      });
    });
  });
}

export async function executeShellCommand(input: {
  command: string;
  cwd: string;
  timeoutMs?: number;
  maxOutputChars?: number;
}): Promise<ProcessExecutionResult> {
  if (platform() === "win32") {
    const utf8Command = [
      "chcp 65001 > $null",
      "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "$OutputEncoding = [Console]::OutputEncoding",
      input.command,
    ].join("; ");

    return executeProgram({
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        utf8Command,
      ],
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
      maxOutputChars: input.maxOutputChars,
    });
  }

  return executeProgram({
    command: "sh",
    args: ["-lc", input.command],
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    maxOutputChars: input.maxOutputChars,
  });
}
