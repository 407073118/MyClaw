const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const PROJECT_ROOT = path.join(__dirname, "..");
const MAIN_ENTRY = path.join(PROJECT_ROOT, "dist", "src", "main", "index.js");
const RENDERER_DEV_URL = process.env.MYCLAW_RENDERER_DEV_URL || "http://127.0.0.1:1420";
const START_TIMEOUT_MS = 60_000;

/** 构建开发模式使用的环境变量。 */
function buildDevEnvironment(baseEnv = process.env) {
  return {
    ...baseEnv,
    NODE_ENV: "development",
  };
}

/** 根据平台返回可执行的 pnpm 命令名。 */
function resolvePnpmCommand(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

/** 启动一个 pnpm 子进程，并复用当前项目根目录作为工作目录。 */
function spawnPnpm(args, env) {
  return spawn(resolvePnpmCommand(), args, {
    cwd: PROJECT_ROOT,
    env,
    stdio: "inherit",
  });
}

/** 运行一次性 pnpm 命令，命令失败时直接抛错。 */
function runPnpmOnce(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawnPnpm(args, env);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`命令执行失败：${args.join(" ")}，code=${code ?? "null"}，signal=${signal ?? "null"}`));
    });
    child.on("error", reject);
  });
}

/** 轮询等待主进程构建产物出现。 */
function waitForFile(filePath, timeoutMs = START_TIMEOUT_MS) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (existsSync(filePath)) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`等待文件超时：${filePath}`));
      }
    }, 300);
  });
}

/** 探测开发服务器是否已经就绪。 */
function probeUrl(url) {
  return new Promise((resolve) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(1_500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

/** 轮询等待渲染层开发服务器就绪。 */
function waitForUrl(url, timeoutMs = START_TIMEOUT_MS) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      if (await probeUrl(url)) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`等待开发服务器超时：${url}`));
      }
    }, 500);
  });
}

/** 结束全部子进程，避免留下孤儿进程。 */
function terminateChildren(children) {
  for (const child of children) {
    if (!child || child.killed) {
      continue;
    }
    try {
      child.kill("SIGTERM");
    } catch (error) {
      console.warn("[dev] 结束子进程失败", {
        pid: child.pid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** 启动桌面端开发环境，兼容 macOS 与 Windows。 */
async function main() {
  const env = buildDevEnvironment();
  const children = [];
  let shuttingDown = false;

  const shutdown = (reason, exitCode = 0) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.info("[dev] 准备关闭开发进程", { reason, exitCode });
    terminateChildren(children);
    process.exit(exitCode);
  };

  process.on("SIGINT", () => shutdown("收到 SIGINT", 0));
  process.on("SIGTERM", () => shutdown("收到 SIGTERM", 0));

  console.info("[dev] 开始准备桌面端开发环境", {
    platform: process.platform,
    rendererUrl: RENDERER_DEV_URL,
    dataRoot: env.MYCLAW_DATA_ROOT || "未显式指定，运行时将使用 Electron 默认目录",
  });

  console.info("[dev] 先构建一次主进程，确保 Electron 有可启动入口");
  await runPnpmOnce(["run", "build:main"], env);

  console.info("[dev] 启动主进程监听编译");
  const mainWatcher = spawnPnpm(["run", "dev:main"], env);
  children.push(mainWatcher);

  console.info("[dev] 启动渲染层开发服务器");
  const rendererWatcher = spawnPnpm(["run", "dev:renderer"], env);
  children.push(rendererWatcher);

  mainWatcher.on("exit", (code, signal) => {
    if (!shuttingDown) {
      shutdown(`主进程监听已退出，code=${code ?? "null"}，signal=${signal ?? "null"}`, code ?? 1);
    }
  });
  rendererWatcher.on("exit", (code, signal) => {
    if (!shuttingDown) {
      shutdown(`渲染层开发服务器已退出，code=${code ?? "null"}，signal=${signal ?? "null"}`, code ?? 1);
    }
  });

  console.info("[dev] 等待主进程入口文件就绪", { file: MAIN_ENTRY });
  await waitForFile(MAIN_ENTRY);

  console.info("[dev] 等待渲染层开发服务器可访问", { url: RENDERER_DEV_URL });
  await waitForUrl(RENDERER_DEV_URL);

  console.info("[dev] 启动 Electron 桌面应用");
  const electronProcess = spawnPnpm(["exec", "electron", MAIN_ENTRY], env);
  children.push(electronProcess);

  electronProcess.on("exit", (code, signal) => {
    if (!shuttingDown) {
      shutdown(`Electron 进程已退出，code=${code ?? "null"}，signal=${signal ?? "null"}`, code ?? 0);
    }
  });
  electronProcess.on("error", (error) => {
    if (!shuttingDown) {
      console.error("[dev] Electron 启动失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      shutdown("Electron 启动失败", 1);
    }
  });
}

module.exports = {
  buildDevEnvironment,
  main,
  resolvePnpmCommand,
  waitForFile,
  waitForUrl,
};

if (require.main === module) {
  main().catch((error) => {
    console.error("[dev] 开发环境启动失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
