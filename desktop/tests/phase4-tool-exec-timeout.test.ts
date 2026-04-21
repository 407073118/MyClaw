import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import { BuiltinToolExecutor } from "../src/main/services/builtin-tool-executor";

/**
 * 创建一个模拟 ChildProcess，用于替代真实 spawn 返回值。
 * - success: 立即输出 stdout 并以 code 0 关闭
 * - timeout: 立即触发 ETIMEDOUT 错误（模拟 execCommandAsync 超时行为）
 * - error: 触发指定错误（如命令不存在）
 */
function createMockChild(
  behavior: "success" | "timeout" | "error",
  output?: string,
): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn>; pid: number } {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.pid = 12345;

  process.nextTick(() => {
    if (behavior === "success") {
      if (output) child.stdout.emit("data", Buffer.from(output));
      child.emit("close", 0, null);
    } else if (behavior === "timeout") {
      const err = Object.assign(new Error("Command timed out"), {
        code: "ETIMEDOUT",
        signal: "SIGTERM",
      });
      child.emit("error", err);
    } else if (behavior === "error") {
      if (output) child.stderr.emit("data", Buffer.from(output));
      const err = Object.assign(new Error(output || "Command error"), {
        code: "ENOENT",
      });
      child.emit("error", err);
    }
  });

  return child;
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

/** 模拟一个只会在收到 abort 信号时结束的 fetch。 */
function installAbortAwareFetchMock() {
  const fetchMock = vi.fn((_, init) => {
    return new Promise((_, reject) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      if (!signal) {
        return;
      }

      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";

      if (signal.aborted) {
        reject(abortError);
        return;
      }

      signal.addEventListener(
        "abort",
        () => {
          reject(abortError);
        },
        { once: true },
      );
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("exec.command timeout policy", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("keeps expanding default timeouts until the 10 minute ceiling before failing", async () => {
    spawnMock.mockImplementation(() => createMockChild("timeout"));

    const executor = new BuiltinToolExecutor();
    const result = await executor.execute("exec.command", "python ten_minute_job.py", "C:/temp");

    expect(result.success).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(6);
    expect(result.error).toContain("30000 -> 60000 -> 120000 -> 240000 -> 480000 -> 600000");
  });

  it("retries timed-out commands with progressively larger timeouts by default", async () => {
    spawnMock
      .mockImplementationOnce(() => createMockChild("timeout"))
      .mockImplementationOnce(() => createMockChild("timeout"))
      .mockImplementationOnce(() => createMockChild("success", "finished\n"));

    const executor = new BuiltinToolExecutor();
    const result = await executor.execute("exec.command", "python long_job.py", "C:/temp");

    expect(result.success).toBe(true);
    expect(result.output.trim()).toBe("finished");
    expect(spawnMock).toHaveBeenCalledTimes(3);
  });

  it("honors explicit timeout configuration when exec.command receives structured input", async () => {
    spawnMock
      .mockImplementationOnce(() => createMockChild("timeout"))
      .mockImplementationOnce(() => createMockChild("success", "ok\n"));

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
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("uses structured cwd override when exec.command receives one", async () => {
    spawnMock.mockImplementation(() => createMockChild("success", "'ok\n"));

    const executor = new BuiltinToolExecutor();
    const label = JSON.stringify({
      command: "py -3 scripts/doctor.py",
      cwd: "C:/Users/jianing.zhang1/AppData/Roaming/Electron/myClaw/skills/br-interview-workspace",
    });
    const result = await executor.execute("exec.command", label, "C:/temp");

    expect(result.success).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][2].cwd).toBe(
      resolve("C:/temp", "C:/Users/jianing.zhang1/AppData/Roaming/Electron/myClaw/skills/br-interview-workspace"),
    );
  });

  it("returns timeout escalation details after exhausting retries", async () => {
    spawnMock.mockImplementation(() => createMockChild("timeout"));

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
    spawnMock.mockImplementation(() => createMockChild("success", "中文输出\n"));

    try {
      const executor = new BuiltinToolExecutor();
      const result = await executor.execute("exec.command", "python demo.py", "C:/temp");

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("中文输出");
      expect(spawnMock).toHaveBeenCalledTimes(1);

      const [shell, args, options] = spawnMock.mock.calls[0];
      expect(shell).toBe("cmd.exe");
      expect(args[1]).toContain("chcp 65001>nul");
      expect(args[1]).toContain("python demo.py");
      expect(options.env.PYTHONIOENCODING).toBe("utf-8");
      expect(options.env.PYTHONUTF8).toBe("1");
    } finally {
      restorePlatform();
    }
  });

  it("runs git tools through the same Windows UTF-8 decoding path", async () => {
    const restorePlatform = setProcessPlatform("win32");
    spawnMock.mockImplementation(() => createMockChild("success", "M  中文文件.txt\n"));

    try {
      const executor = new BuiltinToolExecutor();
      const result = await executor.execute("git.status", "", "C:/temp");

      expect(result.success).toBe(true);
      expect(result.output).toContain("中文文件.txt");

      const [shell, args, options] = spawnMock.mock.calls[0];
      expect(shell).toBe("cmd.exe");
      expect(args[1]).toContain("chcp 65001>nul");
      expect(args[1]).toContain("git status --short --branch");
      expect(options.env.PYTHONIOENCODING).toBe("utf-8");
    } finally {
      restorePlatform();
    }
  });

  it("falls back to py -3 when python launcher is missing on Windows", async () => {
    const restorePlatform = setProcessPlatform("win32");
    spawnMock
      .mockImplementationOnce(() => createMockChild("error", "'python' is not recognized as an internal or external command"))
      .mockImplementationOnce(() => createMockChild("success", "fallback ok\n"));

    try {
      const executor = new BuiltinToolExecutor();
      const result = await executor.execute("exec.command", "python scripts/doctor.py", "C:/temp");

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe("fallback ok");
      expect(spawnMock).toHaveBeenCalledTimes(2);
      expect(spawnMock.mock.calls[0][1][1]).toContain("python scripts/doctor.py");
      expect(spawnMock.mock.calls[1][1][1]).toContain("py -3 scripts/doctor.py");
    } finally {
      restorePlatform();
    }
  });
});

describe("network tool cancellation policy", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ["http.fetch", "https://example.test/slow"],
    ["web.search", "desktop cancel support"],
  ])("aborts %s quickly when the caller signal is canceled", async (toolId, label) => {
    vi.useFakeTimers();
    const fetchMock = installAbortAwareFetchMock();
    const executor = new BuiltinToolExecutor();
    const controller = new AbortController();
    let settled = false;
    let result: Awaited<ReturnType<BuiltinToolExecutor["execute"]>> | undefined;

    const executePromise = (executor as any).execute(toolId, label, "C:/temp", {
      signal: controller.signal,
    });
    executePromise.then((value: Awaited<ReturnType<BuiltinToolExecutor["execute"]>>) => {
      settled = true;
      result = value;
    });

    controller.abort();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(settled).toBe(true);
    expect(result?.success).toBe(false);
    expect(result?.error).toContain("aborted");
  });

  it.each([
    ["http.fetch", "https://example.test/timeout", 12_000],
    ["web.search", "desktop timeout policy", 15_000],
  ])("keeps the internal timeout for %s intact", async (toolId, label, timeoutMs) => {
    vi.useFakeTimers();
    const fetchMock = installAbortAwareFetchMock();
    const executor = new BuiltinToolExecutor();
    let settled = false;
    let result: Awaited<ReturnType<BuiltinToolExecutor["execute"]>> | undefined;

    const executePromise = (executor as any).execute(toolId, label, "C:/temp");
    executePromise.then((value: Awaited<ReturnType<BuiltinToolExecutor["execute"]>>) => {
      settled = true;
      result = value;
    });

    await vi.advanceTimersByTimeAsync(timeoutMs - 1);
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(settled).toBe(true);
    expect(result?.success).toBe(false);
    expect(result?.error).toContain("aborted");
  });
});
