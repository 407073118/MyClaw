import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execSync: execSyncMock,
  };
});

import { BuiltinToolExecutor } from "../src/main/services/builtin-tool-executor";

type MockExecError = Error & {
  code?: string;
  signal?: string;
  stdout?: string;
  stderr?: string;
};

function createTimeoutError(timeoutMs: number): MockExecError {
  const error = new Error(`Command timed out after ${timeoutMs}ms`) as MockExecError;
  error.code = "ETIMEDOUT";
  error.signal = "SIGTERM";
  error.stdout = "";
  error.stderr = "";
  return error;
}

function createCommandNotFoundError(message: string): MockExecError {
  const error = new Error(message) as MockExecError;
  error.code = 1;
  error.signal = "";
  error.stdout = "";
  error.stderr = message;
  return error;
}

function setProcessPlatform(platform: NodeJS.Platform): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
  return () => {
    if (originalDescriptor) {
      Object.defineProperty(process, "platform", originalDescriptor);
    }
  };
}

describe("exec.command timeout policy", () => {
  beforeEach(() => {
    execSyncMock.mockReset();
  });

  it("keeps expanding default timeouts until the 10 minute ceiling before failing", async () => {
    execSyncMock.mockImplementation(() => {
      throw createTimeoutError(30_000);
    });

    const executor = new BuiltinToolExecutor();
    const result = await executor.execute("exec.command", "python ten_minute_job.py", "C:/temp");

    expect(result.success).toBe(false);
    expect(execSyncMock).toHaveBeenCalledTimes(6);
    expect(execSyncMock.mock.calls.map(([, options]) => options.timeout)).toEqual([
      30_000,
      60_000,
      120_000,
      240_000,
      480_000,
      600_000,
    ]);
    expect(result.error).toContain("600000");
  });

  it("retries timed-out commands with progressively larger timeouts by default", async () => {
    execSyncMock
      .mockImplementationOnce(() => {
        throw createTimeoutError(30_000);
      })
      .mockImplementationOnce(() => {
        throw createTimeoutError(60_000);
      })
      .mockImplementationOnce(() => "finished\n");

    const executor = new BuiltinToolExecutor();
    const result = await executor.execute("exec.command", "python long_job.py", "C:/temp");

    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe("finished");
    expect(execSyncMock).toHaveBeenCalledTimes(3);
    expect(execSyncMock.mock.calls.map(([, options]) => options.timeout)).toEqual([
      30_000,
      60_000,
      120_000,
    ]);
  });

  it("honors explicit timeout configuration when exec.command receives structured input", async () => {
    execSyncMock
      .mockImplementationOnce(() => {
        throw createTimeoutError(5_000);
      })
      .mockImplementationOnce(() => "ok\n");

    const executor = new BuiltinToolExecutor();
    const label = JSON.stringify({
      command: "python configured_job.py",
      timeoutMs: 5_000,
      timeoutMultiplier: 3,
      maxAttempts: 2,
      maxTimeoutMs: 20_000,
    });
    const result = await executor.execute("exec.command", label, "C:/temp");

    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe("ok");
    expect(execSyncMock.mock.calls.map(([, options]) => options.timeout)).toEqual([
      5_000,
      15_000,
    ]);
  });

  it("uses structured cwd override when exec.command receives one", async () => {
    execSyncMock.mockImplementation(() => "ok\n");

    const executor = new BuiltinToolExecutor();
    const label = JSON.stringify({
      command: "py -3 scripts/doctor.py",
      cwd: "C:/Users/jianing.zhang1/AppData/Roaming/Electron/myClaw/skills/br-interview-workspace",
    });
    const result = await executor.execute("exec.command", label, "C:/temp");

    expect(result.success).toBe(true);
    expect(execSyncMock).toHaveBeenCalledTimes(1);
    expect(execSyncMock.mock.calls[0][1].cwd).toBe(
      resolve("C:/temp", "C:/Users/jianing.zhang1/AppData/Roaming/Electron/myClaw/skills/br-interview-workspace"),
    );
  });

  it("returns timeout escalation details after exhausting retries", async () => {
    execSyncMock.mockImplementation(() => {
      throw createTimeoutError(30_000);
    });

    const executor = new BuiltinToolExecutor();
    const label = JSON.stringify({
      command: "python forever.py",
      timeoutMs: 30_000,
      timeoutMultiplier: 2,
      maxAttempts: 3,
      maxTimeoutMs: 120_000,
    });
    const result = await executor.execute("exec.command", label, "C:/temp");

    expect(result.success).toBe(false);
    expect(result.error).toContain("超时");
    expect(result.error).toContain("30000");
    expect(result.error).toContain("60000");
    expect(result.error).toContain("120000");
  });

  it("wraps Windows exec.command calls with UTF-8 console setup", async () => {
    const restorePlatform = setProcessPlatform("win32");
    execSyncMock.mockImplementation(() => "中文输出\n");

    try {
      const executor = new BuiltinToolExecutor();
      const result = await executor.execute("exec.command", "python demo.py", "C:/temp");

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("中文输出");
      expect(execSyncMock).toHaveBeenCalledTimes(1);

      const [command, options] = execSyncMock.mock.calls[0];
      expect(command).toContain("chcp 65001>nul");
      expect(command).toContain("python demo.py");
      expect(options.encoding).toBe("buffer");
      expect(options.env.PYTHONIOENCODING).toBe("utf-8");
      expect(options.env.PYTHONUTF8).toBe("1");
    } finally {
      restorePlatform();
    }
  });

  it("runs git tools through the same Windows UTF-8 decoding path", async () => {
    const restorePlatform = setProcessPlatform("win32");
    execSyncMock.mockImplementation(() => "M  中文文件.txt\n");

    try {
      const executor = new BuiltinToolExecutor();
      const result = await executor.execute("git.status", "", "C:/temp");

      expect(result.success).toBe(true);
      expect(result.output).toContain("中文文件.txt");

      const [command, options] = execSyncMock.mock.calls[0];
      expect(command).toContain("chcp 65001>nul");
      expect(command).toContain("git status --short --branch");
      expect(options.encoding).toBe("buffer");
      expect(options.env.PYTHONIOENCODING).toBe("utf-8");
    } finally {
      restorePlatform();
    }
  });

  it("falls back to py -3 when python launcher is missing on Windows", async () => {
    const restorePlatform = setProcessPlatform("win32");
    execSyncMock
      .mockImplementationOnce(() => {
        throw createCommandNotFoundError("'python' is not recognized as an internal or external command");
      })
      .mockImplementationOnce(() => "fallback ok\n");

    try {
      const executor = new BuiltinToolExecutor();
      const result = await executor.execute("exec.command", "python scripts/doctor.py", "C:/temp");

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("fallback ok");
      expect(execSyncMock).toHaveBeenCalledTimes(2);
      expect(execSyncMock.mock.calls[0][0]).toContain("python scripts/doctor.py");
      expect(execSyncMock.mock.calls[1][0]).toContain("py -3 scripts/doctor.py");
    } finally {
      restorePlatform();
    }
  });
});
